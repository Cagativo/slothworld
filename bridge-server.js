import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { AttachmentBuilder, Client, GatewayIntentBits } from 'discord.js';
import { generateImage as generateOpenAIProviderImage } from './integrations/rendering/providers/openaiImageProvider.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = __dirname;
const MAX_EVENTS = 1000;
const STORE_PATH = path.join(__dirname, 'bridge-store.json');
const GENERATED_ASSETS_DIR = path.join(__dirname, 'assets', 'generated');
const DISCORD_COMMAND_PREFIX = '!';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
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
    nextEventId = Number.isFinite(parsed.nextEventId) ? parsed.nextEventId : 1;
    eventLog = Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : [];
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

  if (task.type === 'discord' && (title.includes('mention') || title.includes('command'))) {
    return 2;
  }

  if (task.type === 'shopify' && title.includes('order')) {
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

async function generateOpenAIImage(renderRequest) {
  if (!OPENAI_API_KEY) {
    throw new Error('openai_api_key_missing');
  }

  const prompt = typeof (renderRequest && renderRequest.prompt) === 'string' ? renderRequest.prompt.trim() : '';
  const productId = typeof (renderRequest && renderRequest.productId) === 'string'
    ? renderRequest.productId
    : 'product';

  if (!prompt) {
    throw new Error('missing_prompt');
  }

  const asset = await generateOpenAIProviderImage({
    prompt,
    productId
  });

  const assetPath = path.join(PUBLIC_DIR, asset.url.replace(/^\//, ''));
  const imageBase64 = fs.readFileSync(assetPath).toString('base64');

  return {
    provider: 'openai',
    model: 'gpt-5',
    mimeType: 'image/png',
    imageBase64,
    asset
  };
}

function mapCommandToAction(command) {
  if (command === 'reply') {
    return 'reply_to_message';
  }

  if (command === 'product') {
    return 'start_product_workflow';
  }

  if (command === 'order') {
    return 'fetch_order';
  }

  if (command === 'refund') {
    return 'refund_order';
  }

  return 'reply_to_message';
}

function normalizeTask(input) {
  const now = Date.now();
  const requiredRange = input.type === 'shopify' ? [120, 260] : [80, 200];
  return {
    id: input.id || generateId(),
    type: input.type,
    title: input.title || 'Untitled task',
    priority: [0, 1, 2].includes(input.priority) ? input.priority : inferPriority(input),
    progress: typeof input.progress === 'number' ? input.progress : 0,
    required: typeof input.required === 'number' ? input.required : randomInRange(requiredRange[0], requiredRange[1]),
    status: input.status || 'pending',
    action: typeof input.action === 'string' ? input.action : null,
    payload: typeof input.payload === 'object' && input.payload !== null ? input.payload : {},
    productId: typeof input.productId === 'string' ? input.productId : null,
    provider: typeof input.provider === 'string' ? input.provider : null,
    designIntent: typeof input.designIntent === 'object' && input.designIntent !== null ? input.designIntent : null,
    retries: typeof input.retries === 'number' ? input.retries : 0,
    maxRetries: typeof input.maxRetries === 'number' ? input.maxRetries : 3,
    createdAt: typeof input.createdAt === 'number' ? input.createdAt : now,
    startedAt: typeof input.startedAt === 'number' ? input.startedAt : null,
    completedAt: typeof input.completedAt === 'number' ? input.completedAt : null,
    failedAt: typeof input.failedAt === 'number' ? input.failedAt : null
  };
}

function createDiscordTaskFromMessage(message) {
  const content = String(message.content || '').trim();
  const parsedCommand = parseDiscordCommand(content);
  const isCommand = Boolean(parsedCommand);
  const action = mapCommandToAction(parsedCommand ? parsedCommand.command : '');

  return {
    id: `discord-message-${message.id}`,
    type: 'discord',
    title: isCommand ? `Discord Command: ${content.slice(0, 40)}` : `Discord Mention: ${content.slice(0, 40)}`,
    priority: 2,
    progress: 0,
    required: randomInRange(80, 200),
    status: 'pending',
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

  if (body.type !== 'discord' && body.type !== 'shopify' && body.type !== 'image_render') {
    return "type must be 'discord', 'shopify', or 'image_render'";
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

  if (body.payload !== undefined && (typeof body.payload !== 'object' || body.payload === null || Array.isArray(body.payload))) {
    return 'payload must be an object';
  }

  if (body.designIntent !== undefined && (typeof body.designIntent !== 'object' || body.designIntent === null || Array.isArray(body.designIntent))) {
    return 'designIntent must be an object';
  }

  return null;
}

function pushTaskEvent(task) {
  const event = {
    id: nextEventId++,
    timestamp: Date.now(),
    taskId: task.id
  };

  eventLog.push(event);
  if (eventLog.length > MAX_EVENTS) {
    eventLog.shift();
  }

  saveStore();

  return event;
}

function upsertTask(normalizedTask) {
  const existing = taskStore[normalizedTask.id];
  if (!existing) {
    taskStore[normalizedTask.id] = normalizedTask;
    saveStore();
    return { task: normalizedTask, isNew: true };
  }

  const mergedTask = {
    ...existing,
    ...normalizedTask,
    createdAt: existing.createdAt || normalizedTask.createdAt,
    startedAt: existing.startedAt || normalizedTask.startedAt || null,
    completedAt: existing.completedAt || normalizedTask.completedAt || null,
    failedAt: existing.failedAt || normalizedTask.failedAt || null
  };

  taskStore[mergedTask.id] = mergedTask;
  saveStore();
  return { task: mergedTask, isNew: false };
}

function ingestNormalizedTask(taskInput) {
  const normalizedTask = normalizeTask(taskInput);
  const { task: storedTask, isNew } = upsertTask(normalizedTask);
  const event = pushTaskEvent(storedTask);
  logTaskStatus(storedTask.id, isNew ? 'added' : 'updated', {
    type: storedTask.type,
    action: storedTask.action,
    status: storedTask.status
  });
  return {
    task: storedTask,
    event,
    isNew
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

async function sendDiscordCompletionNotification(task, discordClient) {
  const { channelId, messageId, content: taskContent } = task.payload || {};

  if (!channelId || !discordClient || !discordClient.isReady || !discordClient.isReady()) {
    console.log('[DISCORD]', 'completion_notification_skipped', {
      taskId: task && task.id,
      hasChannelId: !!channelId,
      clientReady: !!(discordClient && discordClient.isReady && discordClient.isReady())
    });
    return null;
  }

  try {
    const channel = await discordClient.channels.fetch(channelId);
    const executionResult = task && typeof task.executionResult === 'object' && task.executionResult !== null
      ? task.executionResult
      : {};
    const imageBase64 = typeof executionResult.imageBase64 === 'string'
      ? executionResult.imageBase64
      : (typeof executionResult.contentBase64 === 'string' ? executionResult.contentBase64 : '');
    const imageMimeType = typeof executionResult.mimeType === 'string' ? executionResult.mimeType : 'image/png';
    const imageUrl = typeof executionResult.imageUrl === 'string' ? executionResult.imageUrl : null;
    const files = [];

    if (imageBase64) {
      const extension = imageMimeType.includes('jpeg') || imageMimeType.includes('jpg')
        ? 'jpg'
        : (imageMimeType.includes('webp') ? 'webp' : 'png');
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      files.push(new AttachmentBuilder(imageBuffer, { name: `${task.id}.${extension}` }));
    }

    const completionMsg = {
      taskId: task.id,
      type: task.type,
      title: task.title,
      status: task.status,
      durationMs: task.durationMs || 0,
      error: task.lastError || null,
      content: typeof taskContent === 'string' ? taskContent : null,
      hasGeneratedImage: files.length > 0,
      imageUrl: imageUrl || null
    };
    const suffix = imageUrl ? `\nImage URL: ${imageUrl}` : '';
    const content = `**Task Completed**\n\`\`\`json\n${JSON.stringify(completionMsg, null, 2).slice(0, 1700)}\n\`\`\`${suffix}`;

    if (messageId) {
      try {
        const originalMessage = await channel.messages.fetch(messageId);
        const sent = await originalMessage.reply(files.length > 0 ? { content, files } : content);
        console.log('[DISCORD]', 'completion_notification_sent', {
          taskId: task.id,
          mode: 'reply',
          channelId,
          messageId,
          sentMessageId: sent && sent.id ? sent.id : null
        });
        return true;
      } catch (replyError) {
        console.warn('[DISCORD]', 'completion_reply_failed_fallback_send', task.id, replyError.message);
      }
    }

    const sent = await channel.send(files.length > 0 ? { content, files } : content);
    console.log('[DISCORD]', 'completion_notification_sent', {
      taskId: task.id,
      mode: 'channel',
      channelId,
      sentMessageId: sent && sent.id ? sent.id : null
    });
    return true;
  } catch (error) {
    console.warn('[DISCORD]', 'completion_notification_failed', task.id, error.message);
    return false;
  }
}

async function executeDiscordTask(task) {
  const { channelId, messageId, content } = task.payload || {};

  if (!discordClient || !discordClient.isReady || !discordClient.isReady()) {
    return { success: false, error: 'discordClient is not configured' };
  }

  try {
    if (task.action === 'fetch_order' || task.action === 'refund_order') {
      return {
        success: true,
        action: task.action,
        note: 'Action received and queued for downstream commerce worker.'
      };
    }

    const channel = await discordClient.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);

    const replyMessage = await message.reply(content);
    if (replyMessage && replyMessage.id) {
      taskTriggeredMessageIds.add(replyMessage.id);
    }

    return { success: true };
  } catch (err) {
    console.error('[DISCORD ERROR]', err);
    return { success: false, error: err.message };
  }
}

async function executeShopifyTask(task) {
  console.log('[SHOPIFY ACTION]', task && task.action, task && task.payload);
  return { success: true };
}

async function executeTask(task) {
  if (!task) {
    return { success: false, error: 'Invalid task' };
  }

  switch (task.action) {
    case 'reply_to_message':
    case 'summarize_message':
    case 'classify_intent':
    case 'fetch_order':
    case 'refund_order':
      return executeDiscordTask(task);
    default:
      if (task.type === 'shopify') {
        return executeShopifyTask(task);
      }

      if (task.type === 'discord') {
        return executeDiscordTask(task);
      }

      return { success: false, error: `Unsupported task type: ${task.type}` };
  }
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

    const result = ingestNormalizedTask(createDiscordTaskFromMessage(message));
    logTaskStatus(result.task.id, result.isNew ? 'added' : 'updated', {
      source: 'discord-listener',
      title: result.task.title,
      action: result.task.action
    });
  });
}

loadStore();

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    writeJson(res, 204, {});
    return;
  }

  if (req.method === 'POST' && req.url === '/task') {
    try {
      const body = await readJsonBody(req);
      const validationError = validateTaskInput(body);
      if (validationError) {
        writeJson(res, 400, { error: validationError });
        return;
      }

      const { task: storedTask, isNew, event } = ingestNormalizedTask(body);
      writeJson(res, isNew ? 201 : 200, { ok: true, eventId: event.id, task: storedTask, deduplicated: !isNew });
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Request failed' });
    }

    return;
  }

  if (req.method === 'POST' && req.url === '/asset-store/render') {
    try {
      const body = await readJsonBody(req, { maxBytes: 25 * 1024 * 1024 });
      const expectedKeys = [
        'assetId',
        'productId',
        'provider',
        'prompt',
        'contentBase64',
        'extension',
        'mimeType',
        'metadata'
      ];
      const receivedKeys = body && typeof body === 'object' ? Object.keys(body) : [];
      const missingKeys = expectedKeys.filter((key) => !(body && Object.prototype.hasOwnProperty.call(body, key)));
      const disallowedKeys = receivedKeys.filter((key) => ['content', 'externalUrl', 'imageBase64', 'buffer', 'filePath'].includes(key));
      const unknownKeys = receivedKeys.filter((key) => !expectedKeys.includes(key));

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        writeJson(res, 400, {
          error: 'invalid_asset_store_payload',
          expectedKeys,
          receivedKeys
        });
        return;
      }

      if (missingKeys.length > 0 || disallowedKeys.length > 0) {
        writeJson(res, 400, {
          error: 'asset_store_contract_mismatch',
          detail: 'Expected PNG base64 payload under contentBase64 only.',
          expectedKeys,
          receivedKeys,
          missingKeys,
          disallowedKeys,
          unknownKeys
        });
        return;
      }

      const productId = sanitizePathSegment(body && body.productId, 'product');
      const assetId = sanitizePathSegment(body && body.assetId, generateId());
      const extensionRaw = sanitizePathSegment(body && body.extension, 'png').toLowerCase();
      const provider = typeof body.provider === 'string' ? body.provider : 'unknown';
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      const mimeTypeRaw = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : 'image/png';
      const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64.trim() : '';
      const metadata = body && typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {};
      const extension = 'png';
      const mimeType = 'image/png';

      if (!contentBase64) {
        writeJson(res, 400, {
          error: 'asset_store_contract_mismatch',
          detail: 'contentBase64 must be a non-empty base64 string.',
          expectedKeys,
          receivedKeys,
          missingKeys,
          disallowedKeys,
          unknownKeys
        });
        return;
      }

      if (extensionRaw !== 'png' || mimeTypeRaw !== 'image/png') {
        writeJson(res, 400, {
          error: 'asset_store_contract_mismatch',
          detail: 'Only PNG assets are accepted. extension must be png and mimeType must be image/png.',
          expectedKeys,
          receivedKeys,
          missingKeys,
          disallowedKeys,
          unknownKeys
        });
        return;
      }

      const targetDir = path.join(GENERATED_ASSETS_DIR, productId);
      fs.mkdirSync(targetDir, { recursive: true });

      const assetFilename = `${assetId}.${extension}`;
      const manifestFilename = `${assetId}.json`;
      const assetPath = path.join(targetDir, assetFilename);
      const manifestPath = path.join(targetDir, manifestFilename);
      const publicAssetUrl = `/assets/generated/${productId}/${assetFilename}`;
      const publicManifestUrl = `/assets/generated/${productId}/${manifestFilename}`;
      const createdAt = Date.now();

      fs.writeFileSync(assetPath, Buffer.from(contentBase64, 'base64'));
      fs.writeFileSync(manifestPath, JSON.stringify({
        assetId,
        productId,
        url: publicAssetUrl,
        sourceUrl: null,
        provider,
        prompt,
        createdAt,
        mimeType,
        hasContentBase64: true,
        metadata
      }, null, 2), 'utf8');

      writeJson(res, 201, {
        ok: true,
        asset: {
          assetId,
          productId,
          url: publicAssetUrl,
          provider,
          prompt,
          createdAt,
          manifestUrl: publicManifestUrl
        }
      });
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Request failed' });
    }

    return;
  }

  if (req.method === 'POST' && req.url === '/render/openai/generate') {
    try {
      const body = await readJsonBody(req);
      const result = await generateOpenAIImage(body || {});
      writeJson(res, 200, {
        ok: true,
        result
      });
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'openai_generate_failed' });
    }

    return;
  }

  if (req.method === 'POST' && req.url === '/debug/test-openai-image') {
    try {
      const body = await readJsonBody(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt : 'Pixel-art office scene, isometric view, bright daylight';
      const result = await generateOpenAIImage({ prompt, model: body.model, size: body.size });
      writeJson(res, 200, {
        ok: true,
        result: {
          provider: result.provider,
          model: result.model,
          mimeType: result.mimeType,
          imageBase64Length: result.imageBase64.length
        }
      });
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'openai_test_failed' });
    }

    return;
  }

  if (req.method === 'GET' && req.url === '/tasks') {
    const tasks = Object.values(taskStore).sort((a, b) => b.createdAt - a.createdAt);
    writeJson(res, 200, { ok: true, tasks });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/events')) {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const afterRaw = requestUrl.searchParams.get('after');
    const after = Number(afterRaw || 0);
    const scopedEvents = Number.isFinite(after)
      ? eventLog.filter((event) => event.id > after)
      : eventLog;

    // Reliability mode: only emit tasks that are still pending.
    const events = scopedEvents
      .map((event) => {
        const task = taskStore[event.taskId];
        if (!task || task.status !== 'pending') {
          return null;
        }

        return {
          id: event.id,
          timestamp: event.timestamp,
          task
        };
      })
      .filter(Boolean);

    writeJson(res, 200, { ok: true, events });
    return;
  }

  if (req.method === 'POST' && /^\/task\/[^/]+\/start$/.test(req.url)) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);
      const parts = requestUrl.pathname.split('/');
      const taskId = decodeURIComponent(parts[2]);

      const existing = taskStore[taskId];
      if (!existing) {
        writeJson(res, 404, { error: 'Task not found' });
        return;
      }

      if (existing.status === 'processing' || existing.status === 'done' || existing.status === 'failed') {
        writeJson(res, 200, { ok: true, ignored: true, task: existing });
        return;
      }

      existing.status = 'processing';
      existing.startedAt = existing.startedAt || Date.now();

      saveStore();
      logTaskStatus(taskId, 'processing');
      writeJson(res, 200, { ok: true, task: existing });
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Request failed' });
    }

    return;
  }

  if (req.method === 'POST' && /^\/task\/[^/]+\/ack$/.test(req.url)) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);
      const parts = requestUrl.pathname.split('/');
      const taskId = decodeURIComponent(parts[2]);
      const body = await readJsonBody(req);

      if (!body || (body.status !== 'done' && body.status !== 'failed')) {
        writeJson(res, 400, { error: "status must be 'done' or 'failed'" });
        return;
      }

      const existing = taskStore[taskId];
      if (!existing) {
        writeJson(res, 404, { error: 'Task not found' });
        return;
      }

      const now = Date.now();
      const completedAt = body.status === 'done' ? now : existing.completedAt;
      const failedAt = body.status === 'failed' ? now : existing.failedAt;
      const finishedAt = body.status === 'done' ? completedAt : failedAt;
      const durationMs = existing.startedAt && finishedAt ? Math.max(0, finishedAt - existing.startedAt) : existing.durationMs;
      const task = existing;
      task.status = body.status;
      task.retries = typeof body.retries === 'number' ? body.retries : task.retries;
      task.executionResult = body.executionResult !== undefined ? body.executionResult : task.executionResult;
      if (body.payload && typeof body.payload === 'object') {
        if (!task.payload || typeof task.payload !== 'object') {
          task.payload = {};
        }
        Object.assign(task.payload, body.payload);
      }
      task.startedAt = task.startedAt || now;
      task.completedAt = completedAt;
      task.failedAt = failedAt;
      task.durationMs = durationMs;
      task.lastError = body.executionResult && body.executionResult.error ? body.executionResult.error : task.lastError;

      console.log('[ACK DEBUG]', task.id, task.payload);

      saveStore();
      logTaskStatus(taskId, body.status, {
        durationMs: task.durationMs,
        error: task.lastError || null,
        hasPayload: !!task.payload,
        channelId: task.payload && task.payload.channelId ? task.payload.channelId : null
      });
      sendDiscordCompletionNotification(task, discordClient);
      writeJson(res, 200, { ok: true, task });
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Request failed' });
    }

    return;
  }

  if (req.method === 'POST' && /^\/task\/[^/]+\/execute$/.test(req.url)) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);
      const parts = requestUrl.pathname.split('/');
      const taskId = decodeURIComponent(parts[2]);

      const existing = taskStore[taskId];
      if (!existing) {
        writeJson(res, 404, { error: 'Task not found' });
        return;
      }

      const executionStartedAt = Date.now();
      const result = await executeTask(existing);
      const executionCompletedAt = Date.now();
      existing.executionResult = result;
      existing.executionStartedAt = executionStartedAt;
      existing.executionCompletedAt = executionCompletedAt;
      existing.executionDurationMs = executionCompletedAt - executionStartedAt;
      existing.lastError = result && result.error ? result.error : existing.lastError;

      saveStore();
      logTaskStatus(taskId, result && result.success ? 'executed' : 'execute_failed', {
        durationMs: existing.executionDurationMs,
        error: existing.lastError || null
      });
      writeJson(res, 200, { ok: true, result, durationMs: existing.executionDurationMs });
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Request failed' });
    }

    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    writeJson(res, 200, { ok: true, events: eventLog.length, tasks: Object.keys(taskStore).length });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Bridge server running at http://${HOST}:${PORT}`);
  console.log('POST /task, GET /tasks, POST /task/:id/start, POST /task/:id/execute, POST /task/:id/ack, and GET /events are ready');
});
