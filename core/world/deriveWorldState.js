/**
 * 🚨 ARCHITECTURE LOCK
 *
 * This module participates in the event-sourced execution model.
 *
 * DO NOT:
 * - Infer lifecycle state
 * - Introduce fallback transitions
 * - Derive failure outside TASK_ACKED
 * - Treat any event other than TASK_ACKED as terminal authority
 *
 * ONLY TaskEngine defines lifecycle.
 * TASK_ACKED is the ONLY terminal authority.
 * ONLY events define truth.
 *
 * If something is missing -> FIX EVENT EMISSION, not derivation.
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

function stableDeskIdFromTaskId(taskId, deskIds) {
  if (!Array.isArray(deskIds) || deskIds.length === 0) {
    return null;
  }

  const text = normalizeId(taskId) || 'task';
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  return deskIds[hash % deskIds.length] || null;
}

function ensureDesk(desksById, deskId, fallbackIndex = 0) {
  const id = normalizeId(deskId) || `desk-${fallbackIndex}`;
  if (!desksById.has(id)) {
    desksById.set(id, {
      id,
      deskIndex: Number.isFinite(fallbackIndex) ? fallbackIndex : 0,
      role: 'operator',
      x: 208 + (Number.isFinite(fallbackIndex) ? fallbackIndex * 140 : 0),
      y: 182,
      currentTaskId: null,
      queueTaskIds: []
    });
  }

  return desksById.get(id);
}

function ensureAgent(agentsById, agentId) {
  const id = normalizeId(agentId);
  if (!id) {
    return null;
  }

  if (!agentsById.has(id)) {
    agentsById.set(id, {
      id,
      name: 'Julia',
      role: 'operator',
      deskId: null,
      state: 'idle',
      currentTaskId: undefined,
      targetDeskId: undefined
    });
  }

  return agentsById.get(id);
}

function ensureTask(tasksById, taskId) {
  const id = normalizeId(taskId);
  if (!id) {
    return null;
  }

  if (!tasksById.has(id)) {
    tasksById.set(id, {
      id,
      type: 'unknown',
      title: id,
      status: 'created',
      deskId: null,
      assignedAgentId: null,
      progress: 0,
      required: 100,
      createdAt: null,
      updatedAt: null,
      payload: null,
      error: null
    });
  }

  return tasksById.get(id);
}

function desksInOrder(desksById) {
  return Array.from(desksById.values())
    .sort((a, b) => {
      const ai = Number.isFinite(a.deskIndex) ? a.deskIndex : 0;
      const bi = Number.isFinite(b.deskIndex) ? b.deskIndex : 0;
      if (ai !== bi) {
        return ai - bi;
      }
      return a.id.localeCompare(b.id);
    });
}

function resolveDeskIdForTask(event, task, desksById) {
  const payload = event && typeof event.payload === 'object' ? event.payload : {};

  const payloadDeskId = normalizeId(payload.deskId);
  if (payloadDeskId && desksById.has(payloadDeskId)) {
    return payloadDeskId;
  }

  if (Number.isFinite(payload.deskIndex)) {
    const byIndex = desksInOrder(desksById).find((desk) => Number(desk.deskIndex) === Number(payload.deskIndex));
    if (byIndex) {
      return byIndex.id;
    }
  }

  if (event && event.task && Number.isFinite(event.task.deskIndex)) {
    const byIndex = desksInOrder(desksById).find((desk) => Number(desk.deskIndex) === Number(event.task.deskIndex));
    if (byIndex) {
      return byIndex.id;
    }
  }

  if (task && task.deskId && desksById.has(task.deskId)) {
    return task.deskId;
  }

  const orderedDeskIds = desksInOrder(desksById).map((desk) => desk.id);
  return stableDeskIdFromTaskId(task && task.id, orderedDeskIds);
}

function applyEntityEvent(event, desksById, agentsById) {
  const type = event && event.type ? String(event.type) : null;
  const payload = event && typeof event.payload === 'object' ? event.payload : {};

  if (type === 'SYSTEM_BOOT') {
    return true;
  }

  if (type === 'DESK_CREATED') {
    const deskId = normalizeId(payload.deskId) || (Number.isFinite(payload.deskIndex) ? `desk-${payload.deskIndex}` : null);
    const desk = ensureDesk(
      desksById,
      deskId,
      Number.isFinite(payload.deskIndex) ? Number(payload.deskIndex) : desksById.size
    );

    desk.role = payload.role ? String(payload.role) : desk.role;
    desk.deskIndex = Number.isFinite(payload.deskIndex) ? Number(payload.deskIndex) : desk.deskIndex;

    if (payload.position && Number.isFinite(payload.position.x) && Number.isFinite(payload.position.y)) {
      desk.x = Number(payload.position.x);
      desk.y = Number(payload.position.y);
    }

    return true;
  }

  if (type === 'AGENT_SPAWNED') {
    const agent = ensureAgent(agentsById, payload.agentId);
    if (!agent) {
      return true;
    }

    agent.name = typeof payload.name === 'string' ? payload.name : agent.name;
    agent.role = typeof payload.role === 'string' ? payload.role : agent.role;
    agent.state = 'idle';
    agent.currentTaskId = undefined;
    agent.targetDeskId = undefined;
    return true;
  }

  if (type === 'AGENT_ASSIGNED_IDLE') {
    const agent = ensureAgent(agentsById, payload.agentId);
    if (!agent) {
      return true;
    }

    const deskId = normalizeId(payload.deskId);
    if (deskId) {
      ensureDesk(desksById, deskId, desksById.size);
      agent.deskId = deskId;
      agent.targetDeskId = deskId;
    }

    agent.state = 'idle';
    agent.currentTaskId = undefined;
    return true;
  }

  return false;
}

function applyTaskSnapshot(task, snapshot, timestamp, desksById) {
  task.type = snapshot && snapshot.type ? String(snapshot.type) : task.type;
  task.title = snapshot && snapshot.title ? String(snapshot.title) : task.title;
  task.status = snapshot && snapshot.status ? String(snapshot.status) : task.status;
  task.progress = Number.isFinite(snapshot && snapshot.progress) ? Number(snapshot.progress) : task.progress;
  task.required = Number.isFinite(snapshot && snapshot.required) ? Number(snapshot.required) : task.required;
  task.payload = snapshot && snapshot.payload ? clone(snapshot.payload) : task.payload;
  task.updatedAt = timestamp;
  if (!task.createdAt) {
    task.createdAt = timestamp;
  }

  if (Number.isFinite(snapshot && snapshot.deskIndex)) {
    const desk = desksInOrder(desksById).find((item) => Number(item.deskIndex) === Number(snapshot.deskIndex));
    if (desk) {
      task.deskId = desk.id;
    }
  }
}

function resolveAgentForTask(event, task, desksById, agentsById, taskToAgentId, agentToTaskId) {
  const payload = event && typeof event.payload === 'object' ? event.payload : {};

  const payloadAgentId = normalizeId(payload.agentId);
  if (payloadAgentId) {
    return ensureAgent(agentsById, payloadAgentId);
  }

  if (task && task.assignedAgentId) {
    return ensureAgent(agentsById, task.assignedAgentId);
  }

  const existingAgentId = taskToAgentId.get(task.id);
  if (existingAgentId) {
    return ensureAgent(agentsById, existingAgentId);
  }

  const deskId = task && task.deskId ? task.deskId : null;
  if (deskId) {
    const deskAgent = ensureAgent(agentsById, `agent-${deskId}`);
    if (deskAgent && !deskAgent.deskId) {
      deskAgent.deskId = deskId;
    }
    return deskAgent;
  }

  const idleAgent = Array.from(agentsById.values())
    .find((agent) => !agentToTaskId.has(agent.id));

  return idleAgent || null;
}

function unbindTaskFromAgent(taskId, taskToAgentId, agentToTaskId) {
  const existingAgentId = taskToAgentId.get(taskId);
  if (!existingAgentId) {
    return;
  }

  taskToAgentId.delete(taskId);
  if (agentToTaskId.get(existingAgentId) === taskId) {
    agentToTaskId.delete(existingAgentId);
  }
}

function bindTaskToAgent(task, agent, taskToAgentId, agentToTaskId) {
  if (!task || !agent) {
    return;
  }

  const previousTaskForAgent = agentToTaskId.get(agent.id);
  if (previousTaskForAgent && previousTaskForAgent !== task.id) {
    taskToAgentId.delete(previousTaskForAgent);
  }

  unbindTaskFromAgent(task.id, taskToAgentId, agentToTaskId);

  taskToAgentId.set(task.id, agent.id);
  agentToTaskId.set(agent.id, task.id);
  task.assignedAgentId = agent.id;
}

function applyTaskLifecycleEvent(event, task, desksById, agentsById, taskToAgentId, agentToTaskId, tasksById) {
  const type = event && event.type ? String(event.type) : null;
  const timestamp = Number.isFinite(event && event.timestamp) ? Number(event.timestamp) : null;
  const payload = event && typeof event.payload === 'object' ? event.payload : {};

  const deskId = resolveDeskIdForTask(event, task, desksById);
  if (deskId) {
    ensureDesk(desksById, deskId, desksById.size);
    task.deskId = deskId;
  }

  task.updatedAt = timestamp;
  if (!task.createdAt) {
    task.createdAt = timestamp;
  }

  if (type === 'TASK_CREATED') {
    task.status = 'created';
    return;
  }

  if (type === 'TASK_QUEUED' || type === 'TASK_ENQUEUED') {
    task.status = 'queued';
    return;
  }

  if (type === 'TASK_CLAIMED') {
    task.status = 'claimed';

    const agent = resolveAgentForTask(event, task, desksById, agentsById, taskToAgentId, agentToTaskId);
    if (!agent) {
      return;
    }

    bindTaskToAgent(task, agent, taskToAgentId, agentToTaskId);
    agent.state = 'moving';
    agent.currentTaskId = task.id;
    agent.targetDeskId = task.deskId || agent.deskId || undefined;
    if (!agent.deskId && task.deskId) {
      agent.deskId = task.deskId;
    }
    return;
  }

  if (type === 'TASK_STARTED' || type === 'TASK_EXECUTE_STARTED') {
    task.status = 'executing';

    const agent = resolveAgentForTask(event, task, desksById, agentsById, taskToAgentId, agentToTaskId);
    if (!agent) {
      return;
    }

    bindTaskToAgent(task, agent, taskToAgentId, agentToTaskId);
    agent.state = 'working';
    agent.currentTaskId = task.id;
    agent.targetDeskId = task.deskId || agent.deskId || undefined;
    if (!agent.deskId && task.deskId) {
      agent.deskId = task.deskId;
    }
    return;
  }

  if (type === 'TASK_PROGRESS') {
    task.status = 'executing';
    if (Number.isFinite(payload.progress)) {
      task.progress = Number(payload.progress);
    }
    if (Number.isFinite(payload.required)) {
      task.required = Number(payload.required);
    }

    const agent = resolveAgentForTask(event, task, desksById, agentsById, taskToAgentId, agentToTaskId);
    if (!agent) {
      return;
    }

    bindTaskToAgent(task, agent, taskToAgentId, agentToTaskId);
    agent.state = 'working';
    agent.currentTaskId = task.id;
    agent.targetDeskId = task.deskId || agent.deskId || undefined;
    return;
  }

  if (type === 'TASK_COMPLETED' || type === 'TASK_FAILED') {
    // Accept legacy terminal aliases for replay tolerance, but do not
    // derive terminal lifecycle authority from them.
    return;
  }

  if (type === 'TASK_EXECUTE_FINISHED') {
    task.status = 'awaiting_ack';
    task.error = payload && Object.prototype.hasOwnProperty.call(payload, 'error')
      ? (payload.error || null)
      : task.error;

    const agent = resolveAgentForTask(event, task, desksById, agentsById, taskToAgentId, agentToTaskId);
    if (!agent) {
      return;
    }

    bindTaskToAgent(task, agent, taskToAgentId, agentToTaskId);
    agent.state = 'delivering';
    agent.currentTaskId = task.id;
    agent.targetDeskId = task.deskId || agent.deskId || undefined;
    return;
  }

  if (type === 'TASK_ACKED') {
    const ackStatus = typeof payload.status === 'string' ? payload.status : null;
    if (!ackStatus) {
      return;
    }

    task.status = ackStatus;
    if (ackStatus === 'failed') {
      task.error = payload.error || task.error || 'ack_failed';
    }

    const agent = resolveAgentForTask(event, task, desksById, agentsById, taskToAgentId, agentToTaskId);
    if (!agent) {
      return;
    }

    unbindTaskFromAgent(task.id, taskToAgentId, agentToTaskId);
    agent.state = 'idle';
    agent.currentTaskId = undefined;
    agent.targetDeskId = agent.deskId || undefined;
  }

  // Keep tasksById referenced to satisfy no overlap cleanup in bind path.
  void tasksById;
}

function rebuildDeskQueues(desksById, tasks) {
  for (const desk of desksById.values()) {
    desk.currentTaskId = null;
    desk.queueTaskIds = [];
  }

  for (const task of tasks) {
    if (!task.deskId || !desksById.has(task.deskId)) {
      continue;
    }

    const desk = desksById.get(task.deskId);

    if (task.status === 'claimed' || task.status === 'executing' || task.status === 'awaiting_ack') {
      desk.currentTaskId = task.id;
      continue;
    }

    if (task.status === 'queued' || task.status === 'created') {
      desk.queueTaskIds.push(task.id);
    }
  }

  for (const desk of desksById.values()) {
    desk.queueTaskIds.sort((a, b) => String(a).localeCompare(String(b)));
  }
}

function finalizeAgents(agentsById, taskToAgentId) {
  for (const agent of agentsById.values()) {
    const activeTaskId = agent.currentTaskId;
    if (!activeTaskId) {
      agent.state = 'idle';
      agent.currentTaskId = undefined;
      agent.targetDeskId = agent.deskId || undefined;
      continue;
    }

    if (taskToAgentId.get(activeTaskId) !== agent.id) {
      agent.state = 'idle';
      agent.currentTaskId = undefined;
      agent.targetDeskId = agent.deskId || undefined;
    }
  }
}

export function deriveWorldState(events) {
  const immutableEvents = Array.isArray(events) ? events.map((event) => clone(event)) : [];

  const desksById = new Map();
  const agentsById = new Map();
  const tasksById = new Map();
  const taskToAgentId = new Map();
  const agentToTaskId = new Map();

  for (const event of immutableEvents) {
    if (!event || typeof event !== 'object') {
      continue;
    }

    if (applyEntityEvent(event, desksById, agentsById)) {
      continue;
    }

    const eventTaskId = normalizeId(event.taskId) || normalizeId(event && event.payload && event.payload.taskId);
    const timestamp = Number.isFinite(event.timestamp) ? Number(event.timestamp) : null;

    if (event.task && typeof event.task === 'object') {
      const snapshotTaskId = normalizeId(event.task.id) || eventTaskId;
      if (snapshotTaskId) {
        const task = ensureTask(tasksById, snapshotTaskId);
        applyTaskSnapshot(task, event.task, timestamp, desksById);
      }
      continue;
    }

    if (!eventTaskId) {
      continue;
    }

    const task = ensureTask(tasksById, eventTaskId);
    if (!task) {
      continue;
    }

    applyTaskLifecycleEvent(event, task, desksById, agentsById, taskToAgentId, agentToTaskId, tasksById);
  }

  const tasks = Array.from(tasksById.values())
    .map((task) => ({
      ...task,
      payload: clone(task.payload)
    }))
    .sort((a, b) => {
      const aTime = Number.isFinite(a.createdAt) ? a.createdAt : 0;
      const bTime = Number.isFinite(b.createdAt) ? b.createdAt : 0;
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      return a.id.localeCompare(b.id);
    });

  rebuildDeskQueues(desksById, tasks);
  finalizeAgents(agentsById, taskToAgentId);

  const desks = desksInOrder(desksById)
    .map((desk) => ({
      ...desk,
      queueTaskIds: [...desk.queueTaskIds]
    }));

  const agents = Array.from(agentsById.values())
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      deskId: agent.deskId,
      state: agent.state,
      currentTaskId: agent.currentTaskId,
      targetDeskId: agent.targetDeskId
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const notifications = tasks
    .filter((task) => task.status === 'failed')
    .slice(-8)
    .map((task) => ({
      type: 'task_failed',
      taskId: task.id,
      message: task.error || 'Task failed'
    }));

  const overlays = [
    {
      type: 'hud',
      counts: {
        queued: tasks.filter((task) => task.status === 'queued' || task.status === 'created').length,
        active: tasks.filter((task) => task.status === 'claimed' || task.status === 'executing' || task.status === 'awaiting_ack').length,
        done: tasks.filter((task) => task.status === 'acknowledged' || task.status === 'completed').length,
        failed: tasks.filter((task) => task.status === 'failed').length
      }
    }
  ];

  return {
    agents,
    tasks,
    desks,
    ui: {
      overlays,
      notifications
    }
  };
}
