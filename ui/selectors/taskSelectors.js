import { officeLayout } from '../config/officeLayout.js';
import { isLifecycleEvent } from '../../core/world/eventTaxonomy.js';
import { assertNoSystemEventInLifecycleDerivation } from './eventTaxonomyInvariant.js';

function normalizeTaskId(taskId) {
  return taskId === null || taskId === undefined ? null : String(taskId);
}

function eventTaskId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const payload = event && typeof event.payload === 'object' ? event.payload : {};
  return normalizeTaskId(event.taskId)
    || normalizeTaskId(payload.taskId)
    || normalizeTaskId(event && event.task && event.task.id);
}

function payloadStatus(event) {
  const payload = event && typeof event.payload === 'object' ? event.payload : {};
  return typeof payload.status === 'string' ? payload.status : null;
}

function hashString(text) {
  const value = String(text || '');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function payloadValue(event, key) {
  const payload = event && typeof event.payload === 'object' ? event.payload : {};
  return Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : undefined;
}

function normalizeSeconds(value) {
  return Number.isFinite(value) && value > 0 ? Number(value) : 0;
}

function taskTouchedAt(task) {
  if (!task || typeof task !== 'object') {
    return null;
  }

  if (Number.isFinite(task.updatedAt)) {
    return Number(task.updatedAt);
  }

  if (Number.isFinite(task.createdAt)) {
    return Number(task.createdAt);
  }

  return null;
}

export function isActiveTaskStatus(status) {
  return status === 'claimed' || status === 'executing' || status === 'awaiting_ack';
}

function getRawTaskEvents(indexedWorld, taskId) {
  const id = normalizeTaskId(taskId);
  if (!id || !indexedWorld || !(indexedWorld.eventsByTaskId instanceof Map)) {
    return [];
  }

  const events = indexedWorld.eventsByTaskId.get(id);
  return Array.isArray(events) ? events : [];
}

export function getLifecycleEvents(events) {
  if (!Array.isArray(events)) {
    return [];
  }

  return events.filter((event) => isLifecycleEvent(event && event.type));
}

function getLifecycleTaskEvents(indexedWorld, taskId, context) {
  const rawEvents = getRawTaskEvents(indexedWorld, taskId);
  const lifecycleEvents = getLifecycleEvents(rawEvents);
  assertNoSystemEventInLifecycleDerivation(lifecycleEvents, context);
  return lifecycleEvents;
}

export function getTaskIds(indexedWorld) {
  if (!indexedWorld || !(indexedWorld.eventsByTaskId instanceof Map)) {
    return [];
  }

  return Array.from(indexedWorld.eventsByTaskId.keys())
    .filter((taskId) => getLifecycleTaskEvents(indexedWorld, taskId, 'getTaskIds').length > 0);
}

export function getTaskEvents(indexedWorld, taskId) {
  return getLifecycleTaskEvents(indexedWorld, taskId, 'getTaskEvents');
}

export function getTaskStatus(indexedWorld, taskId) {
  const events = getLifecycleTaskEvents(indexedWorld, taskId, 'getTaskStatus');
  let status = 'unknown';

  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type : null;
    if (type === 'TASK_CREATED') {
      status = 'created';
      continue;
    }

    if (type === 'TASK_ENQUEUED') {
      status = 'queued';
      continue;
    }

    if (type === 'TASK_CLAIMED') {
      status = 'claimed';
      continue;
    }

    if (type === 'TASK_EXECUTE_STARTED') {
      status = 'executing';
      continue;
    }

    if (type === 'TASK_EXECUTE_FINISHED') {
      status = 'awaiting_ack';
      continue;
    }

    if (type === 'TASK_ACKED') {
      const ack = payloadStatus(event);
      if (ack === 'failed') {
        status = 'failed';
      } else if (ack) {
        status = 'completed';
      }
    }
  }

  return status;
}

export function getTaskTimeline(indexedWorld, taskId) {
  const events = getLifecycleTaskEvents(indexedWorld, taskId, 'getTaskTimeline');
  let previousTimestamp = null;

  return events
    .filter((event) => eventTaskId(event) === normalizeTaskId(taskId))
    .map((event) => {
      const timestamp = Number.isFinite(event && event.timestamp) ? Number(event.timestamp) : null;
      const deltaMs = Number.isFinite(previousTimestamp) && Number.isFinite(timestamp)
        ? Math.max(0, timestamp - previousTimestamp)
        : null;

      previousTimestamp = Number.isFinite(timestamp) ? timestamp : previousTimestamp;

      return {
        taskId: normalizeTaskId(taskId),
        timestamp,
        type: typeof event.type === 'string' ? event.type : 'UNKNOWN',
        payload: event && typeof event.payload === 'object' ? event.payload : {},
        deltaMs
      };
    });
}

export function getTaskSnapshot(indexedWorld, taskId) {
  const id = normalizeTaskId(taskId);
  if (!id) {
    return null;
  }

  const events = getLifecycleTaskEvents(indexedWorld, id, 'getTaskSnapshot');
  if (!events.length) {
    return null;
  }

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const status = getTaskStatus(indexedWorld, id);

  let title = id;
  let type = 'unknown';
  let assignedAgentId = null;
  let deskId = null;
  let error = null;

  for (const event of events) {
    const eventType = typeof event.type === 'string' ? event.type : null;
    const payload = event && typeof event.payload === 'object' ? event.payload : {};

    const payloadTitle = payloadValue(event, 'title');
    if (typeof payloadTitle === 'string' && payloadTitle.trim()) {
      title = payloadTitle.trim();
    }

    const payloadType = payloadValue(event, 'type');
    if (typeof payloadType === 'string' && payloadType.trim()) {
      type = payloadType.trim();
    }

    const agentId = payload.agentId !== undefined && payload.agentId !== null
      ? String(payload.agentId)
      : (payload.workerId !== undefined && payload.workerId !== null ? String(payload.workerId) : null);
    if (agentId) {
      assignedAgentId = agentId;
    }

    const eventDeskId = payload.deskId !== undefined && payload.deskId !== null ? String(payload.deskId) : null;
    if (eventDeskId) {
      deskId = eventDeskId;
    }

    if (eventType === 'TASK_ACKED' && payload.status === 'failed') {
      error = typeof payload.error === 'string' ? payload.error : (error || 'ack_failed');
    }

    if (eventType === 'TASK_EXECUTE_FINISHED' && typeof payload.error === 'string') {
      error = payload.error;
    }
  }

  return {
    id,
    title,
    type,
    status,
    assignedAgentId,
    deskId: deskId || `desk-${hashString(id) % 6}`,
    error,
    createdAt: Number.isFinite(firstEvent && firstEvent.timestamp) ? Number(firstEvent.timestamp) : null,
    updatedAt: Number.isFinite(lastEvent && lastEvent.timestamp) ? Number(lastEvent.timestamp) : null
  };
}

export function getAllTasks(indexedWorld) {
  return getTaskIds(indexedWorld)
    .map((taskId) => getTaskSnapshot(indexedWorld, taskId))
    .filter(Boolean)
    .sort((a, b) => {
      const ta = Number.isFinite(a.createdAt) ? a.createdAt : 0;
      const tb = Number.isFinite(b.createdAt) ? b.createdAt : 0;
      if (ta !== tb) {
        return ta - tb;
      }
      return String(a.id).localeCompare(String(b.id));
    });
}

export function filterTasks(indexedWorld, options = {}) {
  const activeOnly = options && options.activeOnly === true;
  const recentSeconds = normalizeSeconds(options && options.recentSeconds);
  const now = Number.isFinite(options && options.now) ? Number(options.now) : Date.now();

  let tasks = getAllTasks(indexedWorld);

  if (activeOnly) {
    tasks = tasks.filter((task) => isActiveTaskStatus(task.status));
  }

  if (recentSeconds > 0) {
    const cutoff = now - recentSeconds * 1000;
    tasks = tasks.filter((task) => {
      const touchedAt = taskTouchedAt(task);
      return isActiveTaskStatus(task.status) || (Number.isFinite(touchedAt) && touchedAt >= cutoff);
    });
  }

  return tasks;
}

export function getTaskBuckets(indexedWorld, options = {}) {
  const tasks = Array.isArray(options && options.tasks)
    ? options.tasks
    : filterTasks(indexedWorld, options);

  const queued = [];
  const active = [];
  const done = [];
  const failed = [];

  for (const task of tasks) {
    if (task.status === 'failed') {
      failed.push(task);
      continue;
    }

    if (task.status === 'completed' || task.status === 'acknowledged') {
      done.push(task);
      continue;
    }

    if (isActiveTaskStatus(task.status)) {
      active.push(task);
      continue;
    }

    queued.push(task);
  }

  return { queued, active, done, failed };
}

export function getTaskById(indexedWorld, taskId) {
  const id = normalizeTaskId(taskId);
  if (!id) {
    return null;
  }

  return getTaskSnapshot(indexedWorld, id);
}

function resolveOfficePoint(value, fallback) {
  if (!value || typeof value !== 'object') {
    return { ...fallback };
  }

  const x = Number.isFinite(value.x) ? Number(value.x) : fallback.x;
  const y = Number.isFinite(value.y) ? Number(value.y) : fallback.y;
  return { x, y };
}

function resolveWorkerDeskPositions() {
  const fallback = [
    { x: 208, y: 220 },
    { x: 348, y: 220 },
    { x: 488, y: 220 },
    { x: 208, y: 360 },
    { x: 348, y: 360 },
    { x: 488, y: 360 }
  ];

  const configured = officeLayout && Array.isArray(officeLayout.workerDesks)
    ? officeLayout.workerDesks
    : [];

  if (!configured.length) {
    return fallback;
  }

  return configured.map((desk, index) => resolveOfficePoint(desk, fallback[index % fallback.length]));
}

export function getOfficeLayoutSnapshot() {
  const workerDesks = resolveWorkerDeskPositions();
  return {
    intakeDesk: resolveOfficePoint(officeLayout && officeLayout.intakeDesk, { x: 120, y: 220 }),
    workerDesks,
    executionZone: resolveOfficePoint(officeLayout && officeLayout.executionZone, { x: 640, y: 220 }),
    deliveryZone: resolveOfficePoint(officeLayout && officeLayout.deliveryZone, { x: 640, y: 360 })
  };
}

export function getDeskIndexForTask(task, deskCount = resolveWorkerDeskPositions().length) {
  const safeDeskCount = Math.max(1, Number.isFinite(deskCount) ? Number(deskCount) : 6);
  const fallbackTaskId = task && task.id ? String(task.id) : 'task';
  const rawDeskId = task && task.deskId ? String(task.deskId) : `desk-${hashString(fallbackTaskId) % safeDeskCount}`;
  const parsed = /^desk-(\d+)$/.exec(rawDeskId);
  if (parsed) {
    return Number(parsed[1]) % safeDeskCount;
  }

  return hashString(rawDeskId) % safeDeskCount;
}

export function getDeskPosition(index, deskCount = resolveWorkerDeskPositions().length) {
  const workerDesks = resolveWorkerDeskPositions();
  const safeDeskCount = Math.max(1, Number.isFinite(deskCount) ? Number(deskCount) : 6);
  const i = Math.max(0, Number.isFinite(index) ? Number(index) : 0) % safeDeskCount;
  const fallback = workerDesks[Math.min(i, workerDesks.length - 1)] || { x: 208, y: 220 };
  const desk = workerDesks[i] || fallback;

  return {
    x: desk.x,
    y: desk.y
  };
}

export function getTaskOfficeRoute(task, options = {}) {
  const layout = getOfficeLayoutSnapshot();
  const deskCount = Math.max(1, Number.isFinite(options && options.deskCount) ? Number(options.deskCount) : layout.workerDesks.length || 1);
  const deskIndex = getDeskIndexForTask(task, deskCount);
  const workerDesk = getDeskPosition(deskIndex, deskCount);

  return {
    intakeDesk: layout.intakeDesk,
    workerDesk,
    executionZone: layout.executionZone,
    deliveryZone: layout.deliveryZone,
    deskIndex
  };
}

export function getTaskVisualTarget(task, options = {}) {
  const route = getTaskOfficeRoute(task, options);
  const status = task && typeof task.status === 'string' ? task.status : 'unknown';

  if (status === 'queued' || status === 'created' || status === 'unknown') {
    return route.intakeDesk;
  }

  if (status === 'claimed') {
    return route.workerDesk;
  }

  if (status === 'executing') {
    return route.executionZone;
  }

  if (status === 'awaiting_ack' || status === 'completed' || status === 'acknowledged' || status === 'failed') {
    return route.deliveryZone;
  }

  return route.workerDesk;
}

export function getTaskTransitionTimestamps(indexedWorld, taskId) {
  const events = getLifecycleTaskEvents(indexedWorld, taskId, 'getTaskTransitionTimestamps');
  const transitions = {
    createdAt: null,
    queuedAt: null,
    claimedAt: null,
    executingAt: null,
    awaitingAckAt: null,
    ackedAt: null
  };

  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type : null;
    const ts = Number.isFinite(event && event.timestamp) ? Number(event.timestamp) : null;
    if (!Number.isFinite(ts) || !type) {
      continue;
    }

    if (type === 'TASK_CREATED' && !Number.isFinite(transitions.createdAt)) {
      transitions.createdAt = ts;
      continue;
    }

    if (type === 'TASK_ENQUEUED' && !Number.isFinite(transitions.queuedAt)) {
      transitions.queuedAt = ts;
      continue;
    }

    if (type === 'TASK_CLAIMED' && !Number.isFinite(transitions.claimedAt)) {
      transitions.claimedAt = ts;
      continue;
    }

    if (type === 'TASK_EXECUTE_STARTED' && !Number.isFinite(transitions.executingAt)) {
      transitions.executingAt = ts;
      continue;
    }

    if (type === 'TASK_EXECUTE_FINISHED' && !Number.isFinite(transitions.awaitingAckAt)) {
      transitions.awaitingAckAt = ts;
      continue;
    }

    if (type === 'TASK_ACKED' && !Number.isFinite(transitions.ackedAt)) {
      transitions.ackedAt = ts;
    }
  }

  return transitions;
}

export function getAllDesks(indexedWorld, options = {}) {
  const layout = getOfficeLayoutSnapshot();
  const deskCount = Math.max(1, Number.isFinite(options && options.deskCount) ? Number(options.deskCount) : layout.workerDesks.length || 1);
  const tasks = getAllTasks(indexedWorld);
  const buckets = Array.from({ length: deskCount }, (_, idx) => ({
    id: `desk-${idx}`,
    deskIndex: idx,
    queueTaskIds: [],
    currentTaskId: null,
    ...getDeskPosition(idx, deskCount)
  }));

  for (const task of tasks) {
    const deskIndex = getDeskIndexForTask(task, deskCount);
    const desk = buckets[deskIndex];
    if (!desk) {
      continue;
    }

    if (isActiveTaskStatus(task.status)) {
      desk.currentTaskId = task.id;
      continue;
    }

    if (task.status === 'queued' || task.status === 'created' || task.status === 'unknown') {
      desk.queueTaskIds.push(task.id);
    }
  }

  return buckets;
}

export function getRecentEvents(indexedWorld, limit = 100) {
  const events = indexedWorld && Array.isArray(indexedWorld.events) ? indexedWorld.events : [];
  const lifecycleOnly = getLifecycleEvents(events);
  const capped = lifecycleOnly.slice(-Math.max(1, Number(limit) || 100));
  assertNoSystemEventInLifecycleDerivation(capped, 'getRecentEvents');

  return capped.map((event) => ({
    id: Number.isFinite(event && event.id) ? Number(event.id) : null,
    timestamp: Number.isFinite(event && event.timestamp) ? Number(event.timestamp) : null,
    type: typeof event.type === 'string' ? event.type : 'UNKNOWN',
    taskId: eventTaskId(event),
    payload: event && typeof event.payload === 'object' ? event.payload : {}
  }));
}
