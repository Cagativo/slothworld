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

export function getTaskIds(indexedWorld) {
  if (!indexedWorld || !(indexedWorld.eventsByTaskId instanceof Map)) {
    return [];
  }

  return Array.from(indexedWorld.eventsByTaskId.keys());
}

export function getTaskEvents(indexedWorld, taskId) {
  const id = normalizeTaskId(taskId);
  if (!id || !indexedWorld || !(indexedWorld.eventsByTaskId instanceof Map)) {
    return [];
  }

  const events = indexedWorld.eventsByTaskId.get(id);
  return Array.isArray(events) ? events : [];
}

export function getTaskStatus(indexedWorld, taskId) {
  const events = getTaskEvents(indexedWorld, taskId);
  let status = 'unknown';

  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type : null;
    if (type === 'TASK_CREATED') {
      status = 'created';
      continue;
    }

    if (type === 'TASK_ENQUEUED' || type === 'TASK_QUEUED') {
      status = 'queued';
      continue;
    }

    if (type === 'TASK_CLAIMED') {
      status = 'claimed';
      continue;
    }

    if (type === 'TASK_EXECUTE_STARTED' || type === 'TASK_STARTED') {
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
  const events = getTaskEvents(indexedWorld, taskId);
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

  const events = getTaskEvents(indexedWorld, id);
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

export function getDeskIndexForTask(task, deskCount = 6) {
  const safeDeskCount = Math.max(1, Number.isFinite(deskCount) ? Number(deskCount) : 6);
  const fallbackTaskId = task && task.id ? String(task.id) : 'task';
  const rawDeskId = task && task.deskId ? String(task.deskId) : `desk-${hashString(fallbackTaskId) % safeDeskCount}`;
  const parsed = /^desk-(\d+)$/.exec(rawDeskId);
  if (parsed) {
    return Number(parsed[1]) % safeDeskCount;
  }

  return hashString(rawDeskId) % safeDeskCount;
}

export function getDeskPosition(index, deskCount = 6) {
  const cols = [208, 348, 488];
  const rows = [220, 360];
  const safeDeskCount = Math.max(1, Number.isFinite(deskCount) ? Number(deskCount) : 6);
  const i = Math.max(0, Number.isFinite(index) ? Number(index) : 0) % safeDeskCount;

  return {
    x: cols[i % cols.length],
    y: rows[Math.floor(i / cols.length)]
  };
}

export function getAllDesks(indexedWorld, options = {}) {
  const deskCount = Math.max(1, Number.isFinite(options && options.deskCount) ? Number(options.deskCount) : 6);
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
  const capped = events.slice(-Math.max(1, Number(limit) || 100));

  return capped.map((event) => ({
    id: Number.isFinite(event && event.id) ? Number(event.id) : null,
    timestamp: Number.isFinite(event && event.timestamp) ? Number(event.timestamp) : null,
    type: typeof event.type === 'string' ? event.type : 'UNKNOWN',
    taskId: eventTaskId(event),
    payload: event && typeof event.payload === 'object' ? event.payload : {}
  }));
}
