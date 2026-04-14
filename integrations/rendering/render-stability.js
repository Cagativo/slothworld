import { emitEvent } from '../../core/app-state.js';

const MAX_RECENT_ITEMS = 120;

const traces = new Map();
const currentStates = new Map();
const failedRenders = new Map();
const recentCompleted = [];
const recentFailed = [];
const correlationMap = new Map();
const correlationByDiscordMessageId = new Map();

const workerMetrics = {
  workerCount: 0,
  midjourneyWorkerCount: 0,
  activeWorkers: 0,
  queueSize: 0,
  utilization: 0,
  updatedAt: 0
};

let replayEnqueueHandler = null;

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return null;
  }
}

function pushBounded(list, entry) {
  list.push(entry);
  if (list.length > MAX_RECENT_ITEMS) {
    list.shift();
  }
}

function ensureTrace(renderId) {
  const key = String(renderId || 'unknown-render');
  if (!traces.has(key)) {
    traces.set(key, {
      renderId: key,
      timestamps: {
        enqueued: null,
        dequeued: null,
        started: null,
        dispatched_discord: null,
        response_received: null,
        completed: null,
        failed: null
      },
      events: []
    });
  }

  return traces.get(key);
}

function applyTimestamp(trace, eventType, timestamp) {
  const map = {
    RENDER_ENQUEUED: 'enqueued',
    RENDER_DEQUEUED: 'dequeued',
    RENDER_STARTED: 'started',
    DISCORD_RENDER_DISPATCHED: 'dispatched_discord',
    DISCORD_RENDER_RECEIVED: 'response_received',
    RENDER_COMPLETED: 'completed',
    RENDER_COMPLETE: 'completed',
    RENDER_FAILED: 'failed'
  };

  const field = map[eventType];
  if (field) {
    trace.timestamps[field] = timestamp;
  }
}

export function logRenderEvent(renderId, eventType, metadata = {}) {
  const trace = ensureTrace(renderId);
  const timestamp = Date.now();
  const event = {
    type: String(eventType || 'RENDER_TRACE'),
    timestamp,
    metadata: clone(metadata) || {}
  };

  trace.events.push(event);
  applyTimestamp(trace, event.type, timestamp);

  emitEvent('RENDER_TRACE_EVENT', {
    renderId: trace.renderId,
    eventType: event.type,
    metadata: event.metadata,
    timestamp
  });

  return trace;
}

export function updateRenderState(renderId, statePatch) {
  const key = String(renderId || 'unknown-render');
  const existing = currentStates.get(key) || {
    renderId: key,
    status: 'pending',
    taskId: null,
    provider: null,
    productId: null,
    retryCount: 0,
    waitMs: 0,
    lastError: null,
    updatedAt: Date.now(),
    task: null
  };

  const merged = {
    ...existing,
    ...clone(statePatch),
    updatedAt: Date.now()
  };

  currentStates.set(key, merged);
  return merged;
}

export function registerRenderTaskSnapshot(task, status = 'queued') {
  if (!task) {
    return null;
  }

  const renderId = task.renderId || task.id;
  const snapshot = clone(task) || {};
  const trace = ensureTrace(renderId);
  const enqueuedAt = trace.timestamps.enqueued || Date.now();

  return updateRenderState(renderId, {
    status,
    taskId: task.id || null,
    provider: task.provider || (task.payload && task.payload.provider) || null,
    productId: task.productId || (task.payload && task.payload.productId) || null,
    retryCount: typeof task.retries === 'number' ? task.retries : 0,
    task: snapshot,
    enqueuedAt
  });
}

export function registerDiscordDispatch(renderId, messageId, channelId) {
  const key = String(renderId || 'unknown-render');
  const entry = {
    renderId: key,
    discordMessageId: messageId || null,
    channelId: channelId || null,
    status: 'dispatched',
    lastSeenTimestamp: Date.now()
  };

  correlationMap.set(key, entry);
  if (entry.discordMessageId) {
    correlationByDiscordMessageId.set(entry.discordMessageId, key);
  }

  emitEvent('RENDER_CORRELATION_UPDATED', clone(entry) || {});
  logRenderEvent(key, 'DISCORD_RENDER_DISPATCHED', {
    discordMessageId: entry.discordMessageId,
    channelId: entry.channelId
  });
  return entry;
}

export function resolveDiscordResponse(messageId, imageUrl) {
  const renderId = correlationByDiscordMessageId.get(messageId) || null;
  if (!renderId) {
    return null;
  }

  const existing = correlationMap.get(renderId) || {
    renderId,
    discordMessageId: messageId,
    channelId: null,
    status: 'unknown',
    lastSeenTimestamp: Date.now()
  };

  const resolved = {
    ...existing,
    status: 'response_received',
    imageUrl: imageUrl || null,
    lastSeenTimestamp: Date.now()
  };

  correlationMap.set(renderId, resolved);
  emitEvent('RENDER_CORRELATION_UPDATED', clone(resolved) || {});
  logRenderEvent(renderId, 'DISCORD_RENDER_RECEIVED', {
    discordMessageId: messageId,
    imageUrl: imageUrl || null
  });

  return resolved;
}

export function updateWorkerUtilization(payload = {}) {
  workerMetrics.workerCount = Number(payload.workerCount || workerMetrics.workerCount || 0);
  workerMetrics.midjourneyWorkerCount = Number(payload.midjourneyWorkerCount || workerMetrics.midjourneyWorkerCount || 0);
  workerMetrics.activeWorkers = Number(payload.activeWorkers || 0);
  workerMetrics.queueSize = Number(payload.queueSize || 0);

  const totalWorkers = workerMetrics.workerCount + workerMetrics.midjourneyWorkerCount;
  workerMetrics.utilization = totalWorkers > 0
    ? Math.max(0, Math.min(1, workerMetrics.activeWorkers / totalWorkers))
    : 0;
  workerMetrics.updatedAt = Date.now();
}

export function recordRenderCompletion(renderId, result) {
  const trace = ensureTrace(renderId);
  const waitMs = trace.timestamps.enqueued && trace.timestamps.dequeued
    ? Math.max(0, trace.timestamps.dequeued - trace.timestamps.enqueued)
    : 0;

  const state = updateRenderState(renderId, {
    status: 'completed',
    waitMs,
    lastError: null
  });

  const summary = {
    renderId: state.renderId,
    taskId: state.taskId,
    provider: state.provider,
    productId: state.productId,
    waitMs,
    completedAt: Date.now(),
    assetId: result && result.asset ? result.asset.assetId : null,
    url: result && result.asset ? result.asset.url : null
  };

  pushBounded(recentCompleted, summary);
  failedRenders.delete(state.renderId);
  return summary;
}

export function recordRenderFailure(renderId, failure) {
  const trace = ensureTrace(renderId);
  const state = updateRenderState(renderId, {
    status: 'failed',
    lastError: failure && failure.error ? failure.error : 'render_failed',
    retryCount: failure && Number.isFinite(failure.attempt) ? failure.attempt : 0
  });

  const report = {
    renderId: state.renderId,
    taskId: state.taskId,
    provider: state.provider,
    productId: state.productId,
    retryCount: state.retryCount,
    failureReason: state.lastError,
    failedAt: Date.now(),
    trace: clone(trace)
  };

  failedRenders.set(state.renderId, {
    ...report,
    task: clone(state.task)
  });
  pushBounded(recentFailed, report);
  return report;
}

export function registerReplayEnqueueHandler(handler) {
  replayEnqueueHandler = typeof handler === 'function' ? handler : null;
}

export async function replayFailedRender(renderId) {
  const key = String(renderId || '');
  const failed = failedRenders.get(key);
  if (!failed) {
    throw new Error('failed_render_not_found');
  }

  if (!replayEnqueueHandler) {
    throw new Error('replay_handler_not_registered');
  }

  updateRenderState(key, {
    status: 'queued',
    lastError: null
  });

  logRenderEvent(key, 'RENDER_REPLAY_TRIGGERED', {
    previousFailureReason: failed.failureReason,
    previousRetryCount: failed.retryCount
  });
  emitEvent('RENDER_REPLAY_TRIGGERED', {
    renderId: key,
    taskId: failed.taskId,
    provider: failed.provider,
    productId: failed.productId
  });

  if (!failed.task) {
    throw new Error('failed_render_missing_task_snapshot');
  }

  return replayEnqueueHandler(failed.task);
}

export function getFailedRenderReport() {
  return Array.from(failedRenders.values()).map((entry) => ({
    renderId: entry.renderId,
    taskId: entry.taskId,
    provider: entry.provider,
    productId: entry.productId,
    retryCount: entry.retryCount,
    failureReason: entry.failureReason,
    failedAt: entry.failedAt,
    trace: clone(entry.trace)
  }));
}

export function getRenderQueueSnapshot(options = {}) {
  const recentLimit = Number.isFinite(options.recentLimit) ? Math.max(1, options.recentLimit) : 20;
  const states = Array.from(currentStates.values());

  const queued = states.filter((state) => state.status === 'queued').map((state) => clone(state));
  const processing = states.filter((state) => state.status === 'processing').map((state) => clone(state));
  const retrying = states.filter((state) => state.status === 'retrying').map((state) => clone(state));

  const completedTasks = recentCompleted.slice(-recentLimit).map((entry) => clone(entry));
  const failedTasks = recentFailed.slice(-recentLimit).map((entry) => clone(entry));

  const waitSamples = completedTasks
    .map((entry) => Number(entry.waitMs || 0))
    .filter((value) => Number.isFinite(value));
  const averageWaitTimeMs = waitSamples.length > 0
    ? waitSamples.reduce((acc, value) => acc + value, 0) / waitSamples.length
    : 0;

  return {
    queuedTasks: queued,
    processingTasks: processing,
    retryingTasks: retrying,
    completedTasks,
    failedTasks,
    workerUtilization: clone(workerMetrics),
    queueSize: queued.length + processing.length + retrying.length,
    averageWaitTimeMs,
    correlations: Array.from(correlationMap.values()).map((entry) => clone(entry))
  };
}

export function getRenderTrace(renderId) {
  if (!renderId) {
    return null;
  }

  const trace = traces.get(String(renderId));
  return trace ? clone(trace) : null;
}