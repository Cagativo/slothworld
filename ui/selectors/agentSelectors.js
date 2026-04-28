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

  // Walk the task list newest-first and find the most recent task that is still
  // active (i.e. TASK_CLAIMED has fired but TASK_ACKED has not yet fired for it).
  //
  // Active statuses set by getTaskStatus via TASK_CLAIMED / TASK_EXECUTE_STARTED /
  // TASK_EXECUTE_FINISHED:   'claimed' | 'executing' | 'awaiting_ack'
  //
  // Terminal statuses set by TASK_ACKED:   'completed' | 'failed'
  //
  // currentTaskId returns to null as soon as TASK_ACKED is observed by getTaskStatus.
  // No raw event payload is inspected here — all status logic lives in taskSelectors.
  let currentTaskId = null;
  for (let i = tasks.length - 1; i >= 0; i--) {
    const status = getTaskStatus(indexedWorld, tasks[i]);
    if (status === 'claimed' || status === 'executing' || status === 'awaiting_ack') {
      currentTaskId = tasks[i];
      break;
    }
    // Terminal — this task is done; no point searching further back.
    if (status === 'completed' || status === 'failed') {
      break;
    }
    // 'created', 'queued', 'unknown' — task exists but is not yet assigned to this
    // agent; keep searching in case an earlier claimed task is still in flight.
  }

  const currentTask = currentTaskId ? getTaskSnapshot(indexedWorld, currentTaskId) : null;
  const taskDeskId = currentTask && currentTask.deskId ? currentTask.deskId : null;

  // Fall back to the desk registered at agent spawn (AGENT_ASSIGNED_IDLE) when
  // the agent has no active task. Mirrors core/world/agentSelectors.js which reads
  // the same event. Without this, idle agents resolve to deskId=null, causing the
  // position map to fall through to {x:0, y:0} and draw sprites at the canvas origin.
  let registeredDeskId = null;
  if (!taskDeskId) {
    const workerEvents = (indexedWorld.eventsByWorkerId instanceof Map)
      ? (indexedWorld.eventsByWorkerId.get(id) || [])
      : [];
    for (const evt of workerEvents) {
      if (evt && evt.type === 'AGENT_ASSIGNED_IDLE' &&
          evt.payload && evt.payload.deskId != null) {
        registeredDeskId = String(evt.payload.deskId);
        break;
      }
    }
  }

  const deskId = taskDeskId || registeredDeskId;

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
