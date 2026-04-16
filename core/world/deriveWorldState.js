/**
 * 🚨 ARCHITECTURE LOCK — DO NOT MODIFY WITHOUT SYSTEM REVIEW
 *
 * This is a PURE INDEXING LAYER.
 *
 * Any introduction of:
 * - lifecycle logic
 * - task state derivation
 * - anomaly detection
 * - UI semantics
 *
 * is a CRITICAL ARCHITECTURE VIOLATION.
 */

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function compareEvents(a, b) {
  const ta = Number.isFinite(a && a.timestamp) ? Number(a.timestamp) : 0;
  const tb = Number.isFinite(b && b.timestamp) ? Number(b.timestamp) : 0;
  if (ta !== tb) {
    return ta - tb;
  }

  const ia = Number.isFinite(a && a.id) ? Number(a.id) : 0;
  const ib = Number.isFinite(b && b.id) ? Number(b.id) : 0;
  if (ia !== ib) {
    return ia - ib;
  }

  return 0;
}

function workerIdFromEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const payload = event && typeof event.payload === 'object' ? event.payload : {};
  return normalizeId(event.workerId)
    || normalizeId(event.agentId)
    || normalizeId(payload.workerId)
    || normalizeId(payload.agentId);
}

function taskIdFromEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const payload = event && typeof event.payload === 'object' ? event.payload : {};
  return normalizeId(event.taskId)
    || normalizeId(payload.taskId)
    || normalizeId(event && event.task && event.task.id);
}

function pushGrouped(map, key, event) {
  if (!key) {
    return;
  }

  if (!map.has(key)) {
    map.set(key, []);
  }

  map.get(key).push(event);
}

export function deriveWorldState(events) {
  const immutableEvents = Array.isArray(events) ? events.map((event) => clone(event)) : [];
  const sortedEvents = immutableEvents
    .filter((event) => event && typeof event === 'object')
    .sort(compareEvents);

  const eventsByTaskId = new Map();
  const eventsByWorkerId = new Map();

  for (const event of sortedEvents) {
    pushGrouped(eventsByTaskId, taskIdFromEvent(event), event);
    pushGrouped(eventsByWorkerId, workerIdFromEvent(event), event);
  }

  return {
    events: sortedEvents,
    eventsByTaskId,
    eventsByWorkerId
  };
}
