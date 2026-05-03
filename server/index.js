/**
 * 🚨 ARCHITECTURE LOCK
 *
 * This module participates in the event-sourced execution model.
 *
 * DO NOT:
 * - Infer lifecycle state
 * - Introduce fallback transitions
 * - Derive failure outside TASK_ACKED
 *
 * ONLY TaskEngine defines lifecycle.
 * ONLY events define truth.
 *
 * If something is missing -> FIX EVENT EMISSION, not derivation.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import { createTaskExecutionWorker } from '../core/workers/taskExecutionWorker.js';
import { createDiscordNotificationWorker } from '../core/workers/discordNotificationWorker.js';
import { createTaskEngine } from '../core/engine/taskEngine.js';
import { getCanonicalPipelineLabel, warnLegacyExecutionPath } from '../core/execution-pipeline.js';
import {
  TASK_TYPE_DISCORD,
  TASK_TYPE_SHOPIFY,
  TASK_TYPE_IMAGE_RENDER,
  TASK_TYPE_TREND_RESEARCH,
  ACTION_REPLY_TO_MESSAGE,
  ACTION_PROCESS_ORDER,
  ACTION_START_PRODUCT_WORKFLOW,
  ACTION_SEND_CHANNEL_MESSAGE,
  ACTION_RENDER_PRODUCT_IMAGE,
  TASK_STATUS_FAILED,
  TASK_STATUS_AWAITING_ACK,
  TASK_REQUIRED_DISCORD_MIN,
  TASK_REQUIRED_DISCORD_MAX,
  TASK_REQUIRED_SHOPIFY_MIN,
  TASK_REQUIRED_SHOPIFY_MAX
} from '../core/constants.js';

import { createIntakeRoutes } from './intake.js';
import { createEventsRoutes } from './events.js';
import { createMetricsRoutes } from './metrics.js';
import { createSimulationRoutes } from './simulation.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = ROOT_DIR;
const MAX_EVENTS = 1000;
const STORE_PATH = path.join(ROOT_DIR, 'bridge-store.json');
const DISCORD_COMMAND_PREFIX = '!';
const TREND_RESEARCH_DEFAULT_CHANNEL_ID = '1491500223288184964';
const TASK_CREATION_WINDOW_MS = 10_000;
const TASK_CREATION_LIMIT = Number(process.env.TASK_CREATION_LIMIT || 40);
const TASK_MAX_DEPTH = Number(process.env.TASK_MAX_DEPTH || 3);
const TASK_CORRELATION_WINDOW_MS = Number(process.env.TASK_CORRELATION_WINDOW_MS || 30_000);
const ALLOWED_CHANNELS = new Set(
  String(process.env.ALLOWED_CHANNELS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
const taskTriggeredMessageIds = new Set();

let nextEventId = 1;
let eventLog = [];
let taskStore = {};
let discordClient = null;
const taskCreationTimestamps = [];

function isValidEventType(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidTaskId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidTimestamp(value) {
  return Number.isFinite(value) && value > 0;
}

function assertStrictEventSchema(event) {
  if (!event || typeof event !== 'object') {
    throw new Error('EVENT_SCHEMA_VIOLATION:event_object_required');
  }

  if (!isValidEventType(event.type)) {
    throw new Error('EVENT_SCHEMA_VIOLATION:type_required');
  }

  if (!isValidTaskId(event.taskId)) {
    throw new Error('EVENT_SCHEMA_VIOLATION:taskId_required');
  }

  if (!isValidTimestamp(event.timestamp)) {
    throw new Error('EVENT_SCHEMA_VIOLATION:timestamp_required');
  }

  if (!Number.isFinite(event.id)) {
    throw new Error('EVENT_SCHEMA_VIOLATION:id_required');
  }
}

function appendEventToLog(event) {
  assertStrictEventSchema(event);
  eventLog.push(event);
  while (eventLog.length > MAX_EVENTS) {
    eventLog.shift();
  }
}

function emitBridgeEvent(event) {
  const timestamp = Number.isFinite(event && event.timestamp) ? event.timestamp : Date.now();
  const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
  const eventType = event && typeof event.event === 'string'
    ? event.event
    : (event && typeof event.type === 'string' ? event.type : null);
  const taskId = event && event.taskId ? String(event.taskId) : String(payload.taskId || 'system');

  if (!eventType) {
    return;
  }

  appendEventToLog({
    id: nextEventId++,
    type: eventType,
    taskId,
    timestamp,
    payload
  });

  saveStore();
}

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('[DISCORD] Missing DISCORD_BOT_TOKEN. Discord execution is disabled.');
} else {
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  discordClient.once('ready', () => {
    console.log(`[DISCORD] Logged in as ${discordClient.user.tag}`);
  });

  discordClient.login(process.env.DISCORD_BOT_TOKEN).catch((error) => {
    console.error('[DISCORD] Login failed:', error.message);
    discordClient = null;
  });
}

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return;
    }

    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    taskStore = parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {};

    const loadedEvents = Array.isArray(parsed.events) ? parsed.events : [];
    const validEvents = [];
    let droppedInvalidEvents = 0;

    for (const candidate of loadedEvents) {
      try {
        assertStrictEventSchema(candidate);
        validEvents.push(candidate);
      } catch (_error) {
        droppedInvalidEvents += 1;
      }
    }

    eventLog = validEvents.slice(-MAX_EVENTS);

    const highestId = eventLog.reduce((max, event) => {
      return Math.max(max, Number(event.id) || 0);
    }, 0);

    const parsedNextEventId = Number.isFinite(parsed.nextEventId) ? parsed.nextEventId : 1;
    nextEventId = Math.max(parsedNextEventId, highestId + 1, 1);

    if (droppedInvalidEvents > 0) {
      console.warn('[BRIDGE]', 'store_load_dropped_invalid_events', droppedInvalidEvents);
      saveStore();
    }
  } catch (error) {
    console.warn('[BRIDGE]', 'store_load_failed', error.message);
  }
}

function saveStore() {
  const payload = {
    nextEventId,
    tasks: taskStore,
    events: eventLog.slice(-MAX_EVENTS)
  };

  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('[BRIDGE]', 'store_save_failed', error.message);
  }
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizePathSegment(value, fallback = 'item') {
  const sanitized = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return sanitized || fallback;
}

function inferPriority(task) {
  const title = String(task.title || '').toLowerCase();

  if (title.includes('log') || title.includes('passive')) {
    return 0;
  }

  if (task.type === TASK_TYPE_DISCORD && (title.includes('mention') || title.includes('command'))) {
    return 2;
  }

  if (task.type === TASK_TYPE_SHOPIFY && title.includes('order')) {
    return 2;
  }

  return 1;
}

function logTaskStatus(taskId, status, details) {
  if (details !== undefined) {
    console.log(`[TASK][${taskId}][${status}]`, details);
    return;
  }

  console.log(`[TASK][${taskId}][${status}]`);
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isInternalTaskShape(task) {
  if (!task || typeof task !== 'object') {
    return false;
  }

  if (task.internal === true || task.domain === 'system') {
    return true;
  }

  const payload = task.payload && typeof task.payload === 'object' ? task.payload : null;
  if (payload && (payload.internal === true || payload.domain === 'system')) {
    return true;
  }

  return false;
}

function pruneCreationWindow(now) {
  while (taskCreationTimestamps.length > 0 && now - taskCreationTimestamps[0] > TASK_CREATION_WINDOW_MS) {
    taskCreationTimestamps.shift();
  }
}

function checkTaskCreationCircuitBreaker(now) {
  pruneCreationWindow(now);
  if (taskCreationTimestamps.length >= TASK_CREATION_LIMIT) {
    return false;
  }

  taskCreationTimestamps.push(now);
  return true;
}

function hasRecentCorrelationDuplicate(correlationId, incomingId, now) {
  if (!correlationId) {
    return false;
  }

  for (const task of Object.values(taskStore)) {
    if (!task || task.id === incomingId) {
      continue;
    }

    if (task.correlationId !== correlationId) {
      continue;
    }

    const createdAt = toFiniteNumber(task.createdAt, 0);
    if (createdAt > 0 && now - createdAt <= TASK_CORRELATION_WINDOW_MS) {
      return true;
    }
  }

  return false;
}

function parseDiscordCommand(rawContent) {
  const trimmed = String(rawContent || '').trim();
  if (!trimmed.startsWith(DISCORD_COMMAND_PREFIX)) {
    return null;
  }

  const withoutPrefix = trimmed.slice(DISCORD_COMMAND_PREFIX.length).trim();
  if (!withoutPrefix) {
    return { command: '', args: [], raw: trimmed };
  }

  const parts = withoutPrefix.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  return {
    command,
    args,
    raw: trimmed
  };
}

function mapTaskResultToExecution(taskResult) {
  return {
    success: taskResult && taskResult.success === true,
    result: taskResult && taskResult.output ? taskResult.output : null,
    error: taskResult && taskResult.error ? taskResult.error : undefined
  };
}

function mapEngineStatusToPublic(engineStatus) {
  if (engineStatus === 'acknowledged') {
    return 'done';
  }

  if (engineStatus === 'failed') {
    return TASK_STATUS_FAILED;
  }

  if (engineStatus === 'executing' || engineStatus === 'claimed') {
    return 'processing';
  }

  if (engineStatus === TASK_STATUS_AWAITING_ACK) {
    return 'processing';
  }

  return 'pending';
}

function getTrendResearchRequestId(task) {
  const payloadRequestId = task
    && task.payload
    && typeof task.payload.requestId === 'string'
    ? task.payload.requestId.trim()
    : '';

  if (payloadRequestId) {
    return payloadRequestId;
  }

  return typeof task.id === 'string' ? task.id : '';
}

function getTrendResearchCompletedPayload(task) {
  const output = task && task.lastResult && task.lastResult.output;

  if (output && typeof output === 'object' && output.result && typeof output.result === 'object') {
    return output.result;
  }

  if (output && typeof output === 'object') {
    return output;
  }

  return null;
}

function getTrendResearchKeyword(task, resultPayload) {
  const payloadKeyword = task
    && task.payload
    && typeof task.payload.keyword === 'string'
    ? task.payload.keyword.trim()
    : '';
  if (payloadKeyword) {
    return payloadKeyword;
  }

  const resultKeyword = resultPayload
    && typeof resultPayload.keyword === 'string'
    ? resultPayload.keyword.trim()
    : '';
  if (resultKeyword) {
    return resultKeyword;
  }

  return null;
}

function getTrendResearchAssignedAgentId(task, resultPayload) {
  const candidates = [
    task && task.assignedAgentId,
    task && task.payload && task.payload.assignedAgentId,
    task && task.payload && task.payload.agentId,
    task && task.payload && task.payload.workerId,
    resultPayload && resultPayload.assignedAgentId,
    resultPayload && resultPayload.agentId,
    resultPayload && resultPayload.workerId,
    resultPayload && resultPayload.result && resultPayload.result.assignedAgentId,
    resultPayload && resultPayload.result && resultPayload.result.agentId,
    resultPayload && resultPayload.result && resultPayload.result.workerId
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function projectTaskForRead(task) {
  if (!task || !task.id) {
    return task;
  }

  const engineTask = taskEngine.getTask(task.id);
  const projectedStatus = mapEngineStatusToPublic(engineTask ? engineTask.status : null);

  return {
    ...task,
    status: projectedStatus,
    engineStatus: engineTask ? engineTask.status : null
  };
}

function mapCommandToAction(command) {
  if (command === 'reply') {
    return ACTION_REPLY_TO_MESSAGE;
  }

  if (command === 'product') {
    return ACTION_START_PRODUCT_WORKFLOW;
  }

  if (command === 'order') {
    return 'fetch_order';
  }

  if (command === 'refund') {
    return 'refund_order';
  }

  return ACTION_REPLY_TO_MESSAGE;
}

function isDiscordSnowflake(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function readPathValue(source, dottedPath) {
  if (!source || typeof source !== 'object') {
    return undefined;
  }

  const parts = String(dottedPath || '').split('.').filter(Boolean);
  let current = source;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function hasPresentValue(value) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
}

function collectRequiredFieldAnomalies(requiredFields, input, payload) {
  if (!Array.isArray(requiredFields) || requiredFields.length === 0) {
    return [];
  }

  const root = {
    payload,
    designIntent: input && typeof input.designIntent === 'object' && input.designIntent !== null
      ? input.designIntent
      : {}
  };

  const anomalies = [];
  for (const requirement of requiredFields) {
    const alternatives = String(requirement || '').split('|').map((part) => part.trim()).filter(Boolean);
    if (alternatives.length === 0) {
      continue;
    }

    const satisfied = alternatives.some((candidate) => hasPresentValue(readPathValue(root, candidate)));
    if (!satisfied) {
      anomalies.push(`missing_required_field:${alternatives.join('|')}`);
    }
  }

  return anomalies;
}

function normalizeIntentMode(mode) {
  if (mode === 'soft' || mode === 'experimental') {
    return mode;
  }

  return 'strict';
}

const INTENT_REGISTRY = Object.freeze({
  discord_message: Object.freeze({
    mode: 'soft',
    requiredFields: Object.freeze(['payload.channelId']),
    mapAction: () => ACTION_SEND_CHANNEL_MESSAGE,
    validate: ({ payload }) => {
      if (!isDiscordSnowflake(payload.channelId)) {
        return 'payload.channelId must be a Discord snowflake';
      }

      return null;
    },
    fallback: ({ input, payload }) => {
      const nextPayload = {
        ...payload
      };

      if (typeof nextPayload.content !== 'string' || !nextPayload.content.trim()) {
        nextPayload.content = input.title || 'Untitled task';
      }

      return nextPayload;
    }
  }),
  discord_reply: Object.freeze({
    mode: 'strict',
    requiredFields: Object.freeze(['payload.channelId', 'payload.messageId']),
    mapAction: () => ACTION_REPLY_TO_MESSAGE,
    validate: ({ payload }) => {
      if (!isDiscordSnowflake(payload.channelId)) {
        return 'payload.channelId must be a Discord snowflake';
      }

      if (!isDiscordSnowflake(payload.messageId)) {
        return 'payload.messageId must be a Discord snowflake';
      }

      return null;
    },
    fallback: null
  }),
  shopify_process_order: Object.freeze({
    mode: 'soft',
    requiredFields: Object.freeze([]),
    mapAction: () => ACTION_PROCESS_ORDER,
    validate: () => null,
    fallback: null
  }),
  render_product_image: Object.freeze({
    mode: 'experimental',
    requiredFields: Object.freeze(['payload.prompt|designIntent.prompt']),
    mapAction: () => ACTION_RENDER_PRODUCT_IMAGE,
    validate: ({ input, payload }) => {
      const bodyDesignIntent = input.designIntent && typeof input.designIntent === 'object' ? input.designIntent : {};
      const payloadDesignIntent = payload.designIntent && typeof payload.designIntent === 'object' ? payload.designIntent : {};
      const promptFromPayload = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
      const promptFromBodyDesignIntent = typeof bodyDesignIntent.prompt === 'string' ? bodyDesignIntent.prompt.trim() : '';
      const promptFromPayloadDesignIntent = typeof payloadDesignIntent.prompt === 'string' ? payloadDesignIntent.prompt.trim() : '';

      if (!promptFromPayload && !promptFromBodyDesignIntent && !promptFromPayloadDesignIntent) {
        return 'payload.prompt or designIntent.prompt is required';
      }

      return null;
    },
    fallback: null
  })
});

function normalizeIntentName(intent) {
  if (typeof intent !== 'string') {
    return '';
  }

  return intent.trim().toLowerCase();
}

function getIntentContract(intent) {
  const normalizedIntent = normalizeIntentName(intent);
  if (!normalizedIntent) {
    return null;
  }

  const contract = INTENT_REGISTRY[normalizedIntent];
  if (!contract) {
    return null;
  }

  return {
    name: normalizedIntent,
    mode: normalizeIntentMode(contract.mode),
    ...contract
  };
}

function mapIntentToAction(intent) {
  const contract = getIntentContract(intent);
  return contract ? contract.mapAction() : null;
}

function applyIntentFallback(intentContract, input, payload) {
  if (!intentContract || typeof intentContract.fallback !== 'function') {
    return {
      ...payload
    };
  }

  const fallbackPayload = intentContract.fallback({ input, payload: { ...payload } });
  if (!fallbackPayload || typeof fallbackPayload !== 'object') {
    return {
      ...payload
    };
  }

  return fallbackPayload;
}

function validateIntentContract(intentContract, input, payload) {
  if (!intentContract || typeof intentContract.validate !== 'function') {
    return null;
  }

  return intentContract.validate({ input, payload });
}

function evaluateIntentContractAtIngestion(intentContract, input, payload) {
  if (!intentContract) {
    return {
      accepted: true,
      payload,
      anomalies: []
    };
  }

  const payloadWithFallback = applyIntentFallback(intentContract, input, payload);
  const anomalies = collectRequiredFieldAnomalies(intentContract.requiredFields, input, payloadWithFallback);
  const validationError = validateIntentContract(intentContract, input, payloadWithFallback);
  if (typeof validationError === 'string' && validationError.trim()) {
    anomalies.push(`validation_error:${validationError}`);
  }

  if (anomalies.length === 0) {
    return {
      accepted: true,
      payload: payloadWithFallback,
      anomalies: []
    };
  }

  if (intentContract.mode === 'strict') {
    return {
      accepted: false,
      payload: payloadWithFallback,
      anomalies,
      error: `${intentContract.name}: ${anomalies.join('; ')}`
    };
  }

  if (intentContract.mode === 'experimental') {
    console.warn('[INTENT_CONTRACT_ANOMALY]', {
      intent: intentContract.name,
      mode: intentContract.mode,
      anomalies,
      taskType: input && input.type ? input.type : null
    });
  }

  return {
    accepted: true,
    payload: payloadWithFallback,
    anomalies
  };
}

function defaultActionForType(type, payload) {
  if (type === TASK_TYPE_DISCORD) {
    if (typeof payload.messageId === 'string' && payload.messageId.trim()) {
      return ACTION_REPLY_TO_MESSAGE;
    }

    return ACTION_SEND_CHANNEL_MESSAGE;
  }

  if (type === TASK_TYPE_SHOPIFY) {
    return ACTION_PROCESS_ORDER;
  }

  if (type === TASK_TYPE_IMAGE_RENDER) {
    return ACTION_RENDER_PRODUCT_IMAGE;
  }

  return null;
}

function resolveActionFromInput(input, payload, intentContract = null) {
  const contract = intentContract || getIntentContract(input.intent);
  if (contract) {
    return contract.mapAction();
  }

  if (typeof input.action === 'string' && input.action.trim()) {
    return input.action.trim().toLowerCase();
  }

  return defaultActionForType(input.type, payload);
}

function resolveImageRenderFields(input, payload) {
  const provider = typeof input.provider === 'string' && input.provider.trim()
    ? input.provider.trim()
    : (typeof payload.provider === 'string' && payload.provider.trim() ? payload.provider.trim() : 'openai');
  const productId = typeof input.productId === 'string' && input.productId.trim()
    ? input.productId.trim()
    : (typeof payload.productId === 'string' && payload.productId.trim() ? payload.productId.trim() : `product-${generateId()}`);
  const providedDesignIntent = typeof input.designIntent === 'object' && input.designIntent !== null
    ? input.designIntent
    : (typeof payload.designIntent === 'object' && payload.designIntent !== null ? payload.designIntent : {});
  const promptText = typeof payload.prompt === 'string' && payload.prompt.trim() ? payload.prompt.trim() : null;
  const designIntent = {
    ...providedDesignIntent
  };

  if (!designIntent.prompt && promptText) {
    designIntent.prompt = promptText;
  }

  return {
    provider,
    productId,
    designIntent
  };
}

/**
 * Normalizes raw task input into the canonical task shape accepted by the Bridge.
 *
 * Contract: pure transformation only — no I/O, no state mutation, no engine calls.
 * Derives intent, action, depth, correlationId, and image render fields from input.
 *
 * FORBIDDEN: Bridge must not accept lifecycle timing from external input.
 * `startedAt`, `completedAt`, and `failedAt` are ALWAYS set to null here.
 * They are exclusively set by the engine after execution and ACK.
 *
 * @param {object} input - Raw task input from HTTP body or Discord message.
 * @returns {object} Normalized task object ready for `upsertTask`.
 */
function normalizeTask(input) {
  const now = Date.now();
  const requiredRange = input.type === TASK_TYPE_SHOPIFY
    ? [TASK_REQUIRED_SHOPIFY_MIN, TASK_REQUIRED_SHOPIFY_MAX]
    : [TASK_REQUIRED_DISCORD_MIN, TASK_REQUIRED_DISCORD_MAX];
  const payload = typeof input.payload === 'object' && input.payload !== null ? input.payload : {};
  const correlationId = typeof input.correlationId === 'string' && input.correlationId.trim()
    ? input.correlationId.trim()
    : (typeof payload.correlationId === 'string' && payload.correlationId.trim() ? payload.correlationId.trim() : (input.id || generateId()));
  const depth = Math.max(0, Math.floor(toFiniteNumber(input.depth, toFiniteNumber(payload.depth, 0))));
  const internal = input.internal === true || input.domain === 'system' || payload.internal === true || payload.domain === 'system';

  const intentContract = getIntentContract(input.intent);
  const resolvedAction = resolveActionFromInput(input, payload, intentContract);
  const payloadWithIntentFallback = applyIntentFallback(intentContract, input, payload);
  const imageRenderFields = input.type === TASK_TYPE_IMAGE_RENDER
    ? resolveImageRenderFields(input, payloadWithIntentFallback)
    : null;
  const normalizedPayload = {
    ...payloadWithIntentFallback
  };

  if (input.type === TASK_TYPE_DISCORD && (resolvedAction === ACTION_SEND_CHANNEL_MESSAGE || resolvedAction === ACTION_REPLY_TO_MESSAGE)) {
    if (typeof normalizedPayload.content !== 'string' || !normalizedPayload.content.trim()) {
      normalizedPayload.content = input.title || 'Untitled task';
    }
  }

  if (imageRenderFields) {
    normalizedPayload.provider = imageRenderFields.provider;
    normalizedPayload.productId = imageRenderFields.productId;
    normalizedPayload.designIntent = imageRenderFields.designIntent;
    if (!normalizedPayload.prompt && imageRenderFields.designIntent && imageRenderFields.designIntent.prompt) {
      normalizedPayload.prompt = imageRenderFields.designIntent.prompt;
    }
  }

  if (input.type === TASK_TYPE_TREND_RESEARCH) {
    const payloadChannelId =
      typeof normalizedPayload.channelId === 'string' && normalizedPayload.channelId.trim()
        ? normalizedPayload.channelId.trim()
        : null;
    const rootChannelId =
      typeof input.channelId === 'string' && input.channelId.trim()
        ? input.channelId.trim()
        : null;

    normalizedPayload.channelId = payloadChannelId || rootChannelId || TREND_RESEARCH_DEFAULT_CHANNEL_ID;

    // Ensure workerId is always set for TREND_RESEARCH tasks so the engine
    // can establish ownership at TASK_CLAIMED. If the caller did not explicitly
    // provide a worker identity, default to the resolved channelId — the agent
    // responsible for a channel is the authoritative worker for that channel's
    // research tasks.
    if (
      !normalizedPayload.workerId
      && !normalizedPayload.agentId
      && !normalizedPayload.assignedAgentId
    ) {
      normalizedPayload.workerId = normalizedPayload.channelId;
    }
  }

  return {
    id: input.id || generateId(),
    type: input.type,
    title: input.title || 'Untitled task',
    priority: [0, 1, 2].includes(input.priority) ? input.priority : inferPriority(input),
    progress: typeof input.progress === 'number' ? input.progress : 0,
    required: typeof input.required === 'number' ? input.required : randomInRange(requiredRange[0], requiredRange[1]),
    action: resolvedAction,
    payload: normalizedPayload,
    correlationId,
    depth,
    internal,
    domain: internal ? 'system' : 'external',
    productId: imageRenderFields ? imageRenderFields.productId : (typeof input.productId === 'string' ? input.productId : null),
    provider: imageRenderFields ? imageRenderFields.provider : (typeof input.provider === 'string' ? input.provider : null),
    designIntent: imageRenderFields
      ? imageRenderFields.designIntent
      : (typeof input.designIntent === 'object' && input.designIntent !== null ? input.designIntent : null),
    retries: typeof input.retries === 'number' ? input.retries : 0,
    maxRetries: typeof input.maxRetries === 'number' ? input.maxRetries : 3,
    createdAt: typeof input.createdAt === 'number' ? input.createdAt : now,
    // Lifecycle timing fields are engine-owned and must never be accepted from external input.
    // They are set exclusively by the ACK path after TaskEngine finalizes the task.
    startedAt: null,
    completedAt: null,
    failedAt: null
  };
}

function createDiscordTaskFromMessage(message) {
  const content = String(message.content || '').trim();
  const parsedCommand = parseDiscordCommand(content);
  const isCommand = Boolean(parsedCommand);
  const action = mapCommandToAction(parsedCommand ? parsedCommand.command : '');

  return {
    id: `discord-message-${message.id}`,
    type: TASK_TYPE_DISCORD,
    title: isCommand ? `Discord Command: ${content.slice(0, 40)}` : `Discord Mention: ${content.slice(0, 40)}`,
    priority: 2,
    progress: 0,
    required: randomInRange(TASK_REQUIRED_DISCORD_MIN, TASK_REQUIRED_DISCORD_MAX),
    action,
    payload: {
      channelId: message.channelId,
      messageId: message.id,
      content: message.content,
      command: parsedCommand ? parsedCommand.command : null,
      args: parsedCommand ? parsedCommand.args : [],
      raw: content
    },
    meta: {
      source: 'discord-message',
      authorId: message.author ? message.author.id : null,
      isCommand
    }
  };
}

function validateTaskInput(body) {
  if (!body || typeof body !== 'object') {
    return 'Body must be a JSON object';
  }

  if (
    body.type !== TASK_TYPE_DISCORD
    && body.type !== TASK_TYPE_SHOPIFY
    && body.type !== TASK_TYPE_IMAGE_RENDER
    && body.type !== TASK_TYPE_TREND_RESEARCH
  ) {
    return "type must be 'discord', 'shopify', 'image_render', or 'TREND_RESEARCH'";
  }

  if (body.title !== undefined && typeof body.title !== 'string') {
    return 'title must be a string';
  }

  if (body.priority !== undefined && ![0, 1, 2].includes(body.priority)) {
    return 'priority must be 0, 1, or 2';
  }

  if (body.action !== undefined && typeof body.action !== 'string') {
    return 'action must be a string';
  }

  if (body.intent !== undefined && typeof body.intent !== 'string') {
    return 'intent must be a string';
  }

  if (body.payload !== undefined && (typeof body.payload !== 'object' || body.payload === null || Array.isArray(body.payload))) {
    return 'payload must be an object';
  }

  if (isInternalTaskShape(body)) {
    return 'internal/system tasks are not accepted on /task intake';
  }

  const payloadDepth = body && body.payload && typeof body.payload === 'object' ? body.payload.depth : undefined;
  const depth = Math.max(0, Math.floor(toFiniteNumber(body.depth, toFiniteNumber(payloadDepth, 0))));
  if (depth > TASK_MAX_DEPTH) {
    return `task depth exceeds limit (${TASK_MAX_DEPTH})`;
  }

  if (body.designIntent !== undefined && (typeof body.designIntent !== 'object' || body.designIntent === null || Array.isArray(body.designIntent))) {
    return 'designIntent must be an object';
  }

  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  const intentName = normalizeIntentName(body.intent);
  const intentContract = intentName ? getIntentContract(intentName) : null;
  if (intentName && !intentContract) {
    return 'intent is not supported';
  }

  const intentEvaluation = evaluateIntentContractAtIngestion(intentContract, body, payload);
  if (!intentEvaluation.accepted) {
    return intentEvaluation.error;
  }

  const resolvedAction = resolveActionFromInput(body, intentEvaluation.payload, intentContract);
  const messageId = payload && typeof payload.messageId === 'string' ? payload.messageId : null;
  if (!intentContract && resolvedAction === ACTION_REPLY_TO_MESSAGE && !(typeof messageId === 'string' && /^\d{17,20}$/.test(messageId))) {
    return 'reply_to_message requires payload.messageId as a Discord snowflake';
  }

  return null;
}


/**
 * Persists a normalized task to the Bridge store.
 *
 * Contract: idempotent — creates on first call, merges on subsequent calls.
 * Does NOT call TaskEngine. Does NOT set lifecycle status on the stored record.
 * Bridge is the persistence layer; engine is the lifecycle authority.
 *
 * When merging with an existing record, lifecycle timing fields (`startedAt`,
 * `completedAt`, `failedAt`) are preserved from the EXISTING store record only —
 * they are set by the ACK path, never by intake normalization.
 *
 * FORBIDDEN: Must not accept lifecycle status or timing from normalized intake.
 *
 * @param {object} normalizedTask - Output of `normalizeTask`.
 * @returns {{ task: object, isNew: boolean }}
 */
function upsertTask(normalizedTask) {
  const { status: _ignoredStatus, ...taskWithoutStatus } = normalizedTask;
  const existing = taskStore[normalizedTask.id];
  if (!existing) {
    taskStore[taskWithoutStatus.id] = taskWithoutStatus;
    saveStore();
    return { task: taskWithoutStatus, isNew: true };
  }

  const mergedTask = {
    ...existing,
    ...taskWithoutStatus,
    createdAt: existing.createdAt || taskWithoutStatus.createdAt,
    startedAt: existing.startedAt || taskWithoutStatus.startedAt || null,
    completedAt: existing.completedAt || taskWithoutStatus.completedAt || null,
    failedAt: existing.failedAt || taskWithoutStatus.failedAt || null
  };

  taskStore[mergedTask.id] = mergedTask;
  saveStore();
  return { task: mergedTask, isNew: false };
}

/**
 * Normalizes, guards, persists, and registers an incoming task with TaskEngine.
 *
 * Contract: Bridge intake boundary. This is the ONLY entry point for task creation.
 * Guards applied in order: source restriction → depth limit → correlation dedup → circuit breaker.
 * After persistence, delegates lifecycle progression exclusively to TaskEngine via `ensureTaskInEngine`.
 *
 * FORBIDDEN:
 * - Must not execute task logic.
 * - Must not set lifecycle status, startedAt, completedAt, or failedAt.
 * - Must not call providers directly.
 * - Must not derive lifecycle meaning from execution results.
 *
 * @param {object} taskInput - Raw or pre-shaped task input.
 * @param {{ source?: string }} [options]
 * @returns {{ task: object|null, event: object|null, isNew: boolean, ignored: boolean, reason?: string }}
 */
function ingestNormalizedTask(taskInput, options = {}) {
  const source = typeof options.source === 'string' ? options.source : 'unknown';
  const normalizedTask = normalizeTask(taskInput);

  if (source === 'http' && (normalizedTask.internal === true || normalizedTask.domain === 'system')) {
    return {
      task: null,
      event: null,
      isNew: false,
      ignored: true,
      reason: 'internal_task_blocked'
    };
  }

  if (normalizedTask.depth > TASK_MAX_DEPTH) {
    return {
      task: null,
      event: null,
      isNew: false,
      ignored: true,
      reason: 'depth_limit_exceeded'
    };
  }

  const now = Date.now();
  if (hasRecentCorrelationDuplicate(normalizedTask.correlationId, normalizedTask.id, now)) {
    return {
      task: null,
      event: null,
      isNew: false,
      ignored: true,
      reason: 'correlation_loop_guard'
    };
  }

  const { task: storedTask, isNew } = upsertTask(normalizedTask);
  if (isNew && !checkTaskCreationCircuitBreaker(now)) {
    delete taskStore[storedTask.id];
    saveStore();
    return {
      task: null,
      event: null,
      isNew: false,
      ignored: true,
      reason: 'task_circuit_breaker_open'
    };
  }

  const engineTask = ensureTaskInEngine(storedTask);
  const projectedTask = projectTaskForRead(storedTask);
  logTaskStatus(storedTask.id, isNew ? 'added' : 'updated', {
    type: storedTask.type,
    action: storedTask.action,
    status: mapEngineStatusToPublic(engineTask ? engineTask.status : null)
  });
  return {
    task: projectedTask,
    event: null,
    isNew,
    ignored: false
  };
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  const requestPath = req.url === '/' ? '/index.html' : req.url;
  const sanitizedPath = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, sanitizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    writeJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      writeJson(res, 404, { error: 'Not found' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif'
    };

    res.writeHead(200, {
      'Content-Type': mimeMap[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    res.end(data);
  });
}

function readJsonBody(req, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : 1024 * 1024;

  return new Promise((resolve, reject) => {
    let raw = '';
    let rejected = false;

    req.on('data', (chunk) => {
      if (rejected) {
        return;
      }

      raw += chunk;
      if (raw.length > maxBytes) {
        rejected = true;
        reject(new Error('Payload too large'));
      }
    });

    req.on('end', () => {
      if (rejected) {
        return;
      }

      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

const discordNotificationWorker = createDiscordNotificationWorker({
  getDiscordClient: () => discordClient,
  emitEvent: emitBridgeEvent
});

const taskExecutionWorker = createTaskExecutionWorker({
  getDiscordClient: () => discordClient,
  taskTriggeredMessageIds
});

const taskEngine = createTaskEngine({
  executor: async (task) => {
    const execution = await taskExecutionWorker.executeTask(task);
    return {
      success: execution && execution.success === true,
      output: execution && Object.prototype.hasOwnProperty.call(execution, 'result')
        ? execution.result
        : execution,
      error: execution && execution.error ? execution.error : undefined,
      retryable: false
    };
  },
  onTaskAcked: async (task) => {
    if (task && task.type === TASK_TYPE_TREND_RESEARCH) {
      const requestId = getTrendResearchRequestId(task);
      const resultPayload = getTrendResearchCompletedPayload(task);
      const assignedAgentId = getTrendResearchAssignedAgentId(task, resultPayload);
      const keyword = getTrendResearchKeyword(task, resultPayload);

      if (task.status === 'acknowledged') {
        if (!assignedAgentId) {
          throw new Error('ENGINE_VIOLATION: missing assignedAgentId at completion');
        }

        console.log('[TREND_RESEARCH_COMPLETED_EMITTED]', {
          taskId: task.id,
          requestId,
          assignedAgentId,
          hasResult: !!resultPayload
        });

        emitBridgeEvent({
          type: 'TREND_RESEARCH_COMPLETED',
          taskId: task.id,
          payload: {
            taskId: task.id,
            requestId,
            keyword,
            assignedAgentId,
            workerId: assignedAgentId,
            result: resultPayload
          }
        });
      } else if (task.status === 'failed') {
        emitBridgeEvent({
          type: 'TREND_RESEARCH_FAILED',
          taskId: task.id,
          payload: {
            requestId,
            error: task.lastResult && task.lastResult.error ? task.lastResult.error : 'trend_research_failed'
          }
        });
      }
    }

    await discordNotificationWorker.notifyTaskCompletion(task);
  },
  emitEvent: emitBridgeEvent
});

async function autoExecuteAndAck(taskId) {
  try {
    const existing = taskStore[taskId];
    if (!existing) {
      return;
    }

    const taskSource = existing && existing.payload && typeof existing.payload.source === 'string'
      ? existing.payload.source
      : 'unknown';
    console.log('[AUTO_EXECUTE_ACK_START]', {
      taskId,
      type: existing.type,
      action: existing.action,
      source: taskSource,
      engineStatusBeforeEnsure: taskEngine.getTask(taskId) ? taskEngine.getTask(taskId).status : null
    });

    const executionStartedAt = Date.now();
    const ensuredTask = ensureTaskInEngine(existing);
    console.log('[AUTO_EXECUTE_ACK_AFTER_ENSURE]', {
      taskId,
      type: existing.type,
      action: existing.action,
      source: taskSource,
      engineStatusAfterEnsure: ensuredTask ? ensuredTask.status : null
    });
    const claimingWorkerId = getTrendResearchAssignedAgentId(existing, null);
    const taskResult = await taskEngine.executeTask(taskId, { workerId: claimingWorkerId || undefined });
    const execution = mapTaskResultToExecution(taskResult);
    const executionCompletedAt = Date.now();
    existing.executionResult = execution;
    existing.executionStartedAt = executionStartedAt;
    existing.executionCompletedAt = executionCompletedAt;
    existing.executionDurationMs = executionCompletedAt - executionStartedAt;
    existing.lastError = execution && execution.error ? execution.error : existing.lastError;
    saveStore();

    const engineTaskBeforeAck = taskEngine.getTask(taskId);
    if (engineTaskBeforeAck && engineTaskBeforeAck.status === TASK_STATUS_AWAITING_ACK && engineTaskBeforeAck.executionRecord) {
      console.log('[AUTO_EXECUTE_ACK_BEFORE_ACK]', {
        taskId,
        type: existing.type,
        action: existing.action,
        source: taskSource,
        engineStatus: engineTaskBeforeAck.status,
        success: execution.success
      });
      await taskEngine.ackTask(taskId);
      const engineTask = taskEngine.getTask(taskId);
      const resolvedStatus = mapEngineStatusToPublic(engineTask ? engineTask.status : null);
      const engineExecutionResult = engineTask && engineTask.executionRecord
        ? mapTaskResultToExecution(engineTask.executionRecord.result)
        : execution;
      const now = Date.now();
      const completedAt = resolvedStatus === 'done' ? now : existing.completedAt;
      const failedAt = resolvedStatus === TASK_STATUS_FAILED ? now : existing.failedAt;
      const finishedAt = resolvedStatus === 'done' ? completedAt : failedAt;
      existing.executionResult = engineExecutionResult;
      existing.startedAt = existing.startedAt || now;
      existing.completedAt = completedAt;
      existing.failedAt = failedAt;
      existing.durationMs = existing.startedAt && finishedAt ? Math.max(0, finishedAt - existing.startedAt) : existing.durationMs;
      existing.lastError = engineExecutionResult && engineExecutionResult.error
        ? engineExecutionResult.error
        : existing.lastError;
      saveStore();
      logTaskStatus(taskId, resolvedStatus, {
        durationMs: existing.durationMs,
        error: existing.lastError || null,
        source: 'auto_execute_ack'
      });
      console.log('[AUTO_EXECUTE_ACK_DONE]', {
        taskId,
        type: existing.type,
        action: existing.action,
        source: taskSource,
        resolvedStatus,
        error: existing.lastError || null
      });
      return;
    }

    console.log('[AUTO_EXECUTE_ACK_SKIPPED_ACK]', {
      taskId,
      type: existing.type,
      action: existing.action,
      source: taskSource,
      engineStatus: engineTaskBeforeAck ? engineTaskBeforeAck.status : null,
      error: execution.error || null
    });
  } catch (error) {
    console.error('[AUTO_EXECUTE_ACK_ERROR]', taskId, error && error.message ? error.message : error);
  }
}

/**
 * Registers a persisted task with TaskEngine if not already registered, and ensures it is enqueued.
 *
 * Contract: Bridge → Engine delegation only. Never executes the task; only creates and enqueues.
 * TaskEngine is the lifecycle authority — this function hands off control to the engine.
 *
 * @param {object} task - A task record from the Bridge store (must have `id`).
 * @returns {object|null} The engine task, or null if the input is invalid.
 */
function ensureTaskInEngine(task) {
  if (!task || !task.id) {
    return null;
  }

  let engineTask = taskEngine.getTask(task.id);
  if (!engineTask) {
    engineTask = taskEngine.createTask(task);
  }

  if (engineTask.status === 'created') {
    taskEngine.enqueueTask(engineTask.id);
  }

  return engineTask;
}

if (discordClient) {
  discordClient.on('messageCreate', (message) => {
    if (!message || !discordClient || !discordClient.user) {
      return;
    }

    if (message.author && message.author.bot) {
      return;
    }

    const content = String(message.content || '');
    const isMention = message.mentions && message.mentions.has(discordClient.user);
    const isPrefixed = content.startsWith(DISCORD_COMMAND_PREFIX);
    const isAllowedChannel = ALLOWED_CHANNELS.size === 0 || ALLOWED_CHANNELS.has(message.channelId);
    const referencesTaskMessage = Boolean(
      message.reference && message.reference.messageId && taskTriggeredMessageIds.has(message.reference.messageId)
    );

    console.log('[DISCORD MESSAGE]', message.id, {
      channelId: message.channelId,
      content
    });

    if (!isMention && !isPrefixed) {
      return;
    }

    if (!isAllowedChannel && !isMention) {
      return;
    }

    if (content.includes('Automated response')) {
      return;
    }

    if (taskTriggeredMessageIds.has(message.id) || referencesTaskMessage) {
      return;
    }

    taskTriggeredMessageIds.add(message.id);

    const result = ingestNormalizedTask(createDiscordTaskFromMessage(message), { source: 'discord' });
    if (result.ignored) {
      return;
    }
    logTaskStatus(result.task.id, result.isNew ? 'added' : 'updated', {
      source: 'discord-listener',
      title: result.task.title,
      action: result.task.action
    });
  });
}

loadStore();

// Build shared context for route modules
const routeContext = {
  taskStore,
  eventLog,
  taskEngine,
  validateTaskInput,
  ingestNormalizedTask,
  isInternalTaskShape,
  projectTaskForRead,
  autoExecuteAndAck,
  ensureTaskInEngine,
  mapTaskResultToExecution,
  mapEngineStatusToPublic,
  logTaskStatus,
  saveStore,
  isValidEventType,
  writeJson,
  readJsonBody,
  serveStatic,
  TASK_STATUS_AWAITING_ACK,
  TASK_STATUS_FAILED
};

// Initialise route modules
const intakeRoutes = createIntakeRoutes(routeContext);
const eventsRoutes = createEventsRoutes(routeContext);
const metricsRoutes = createMetricsRoutes(routeContext);
const simulationRoutes = createSimulationRoutes(routeContext);

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    writeJson(res, 204, {});
    return;
  }

  if (await intakeRoutes.handle(req, res)) return;
  if (eventsRoutes.handle(req, res)) return;
  if (await simulationRoutes.handle(req, res)) return;
  if (metricsRoutes.handle(req, res)) return;

  serveStatic(req, res);
});

export function startServer() {
  server.listen(PORT, HOST, () => {
    console.log(`Bridge server running at http://${HOST}:${PORT}`);
    console.log('POST /task, GET /tasks, POST /task/:id/start, POST /task/:id/execute, POST /task/:id/ack, and GET /events are ready');
  });
}
