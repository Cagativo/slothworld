import { getTaskSnapshot, getTaskStatus } from './taskSelectors.js';

function normalizeWorkerId(workerId) {
  return workerId === null || workerId === undefined ? null : String(workerId);
}

function eventTaskId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const payload = event && typeof event.payload === 'object' ? event.payload : {};
  return (event.taskId !== undefined && event.taskId !== null)
    ? String(event.taskId)
    : (payload.taskId !== undefined && payload.taskId !== null)
      ? String(payload.taskId)
      : null;
}

export function getAgentTasks(indexedWorld, workerId) {
  const id = normalizeWorkerId(workerId);
  if (!id || !indexedWorld || !(indexedWorld.eventsByWorkerId instanceof Map)) {
    return [];
  }

  const workerEvents = indexedWorld.eventsByWorkerId.get(id) || [];
  const orderedTaskIds = [];
  const seen = new Set();

  for (const event of workerEvents) {
    const taskId = eventTaskId(event);
    if (!taskId || seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    orderedTaskIds.push(taskId);
  }

  return orderedTaskIds;
}

export function getAgentState(indexedWorld, workerId) {
  const taskIds = getAgentTasks(indexedWorld, workerId);
  let state = 'idle';

  for (const taskId of taskIds) {
    const status = getTaskStatus(indexedWorld, taskId);

    if (status === 'claimed') {
      state = 'moving';
      continue;
    }

    if (status === 'executing') {
      state = 'working';
      continue;
    }

    if (status === 'awaiting_ack') {
      state = 'delivering';
      continue;
    }

    if (status === 'failed') {
      state = 'error';
    }
  }

  return state;
}

export function getAllAgentIds(indexedWorld) {
  if (!indexedWorld || !(indexedWorld.eventsByWorkerId instanceof Map)) {
    return [];
  }

  return Array.from(indexedWorld.eventsByWorkerId.keys())
    .map((value) => String(value))
    .sort((a, b) => a.localeCompare(b));
}

export function getAgentSnapshot(indexedWorld, workerId) {
  const id = normalizeWorkerId(workerId);
  if (!id) {
    return null;
  }

  const tasks = getAgentTasks(indexedWorld, id);
  const state = getAgentState(indexedWorld, id);
  const currentTaskId = tasks.length ? tasks[tasks.length - 1] : null;
  const currentTask = currentTaskId ? getTaskSnapshot(indexedWorld, currentTaskId) : null;
  const deskId = currentTask && currentTask.deskId ? currentTask.deskId : null;

  return {
    id,
    role: 'operator',
    state,
    currentTaskId,
    deskId,
    targetDeskId: deskId
  };
}

export function getAllAgents(indexedWorld) {
  return getAllAgentIds(indexedWorld)
    .map((workerId) => getAgentSnapshot(indexedWorld, workerId))
    .filter(Boolean);
}
