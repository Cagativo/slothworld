import { agents, desks, workflows, commandHistory, emitEvent, getDeskSlotPosition, isDeskAvailableForAgent } from '../core/app-state.js';
import { generateId, cloneContext } from '../core/utils.js';
import { addTaskToDesk, ingestTask, sanitizeTaskForView, createDiscordTask, createShopifyTask } from '../core/task-handling.js';
import { clearAgentTarget } from '../core/agent-logic.js';
import {
  getWorkflow,
  listWorkflows,
  approveWorkflow,
  rejectWorkflow,
  editWorkflowStep,
  getWorkflowsControl,
  createProductWorkflowFromTask
} from '../core/workflow.js';
import { parseCommandInput } from './command-parser.js';

// --- Snapshot helpers ---
function getTasks() {
  const tasks = [];
  for (let deskIndex = 0; deskIndex < desks.length; deskIndex += 1) {
    const desk = desks[deskIndex];
    if (desk.currentTask) {
      tasks.push({ deskIndex, lane: 'current', task: sanitizeTaskForView(desk.currentTask) });
    }

    for (const queuedTask of desk.queue) {
      tasks.push({ deskIndex, lane: 'queue', task: sanitizeTaskForView(queuedTask) });
    }
  }

  return tasks;
}

function captureRuntimeSnapshot() {
  return {
    agents: agents.map((agent) => ({
      id: agent.id,
      role: agent.role,
      state: agent.state,
      targetDeskIndex: agent.targetDesk ? desks.indexOf(agent.targetDesk) : null,
      position: { x: Math.round(agent.x), y: Math.round(agent.y) }
    })),
    desks: desks.map((desk, index) => ({
      id: index,
      paused: !!desk.paused,
      occupied: desk.occupied,
      queueLength: desk.queue.length,
      hasCurrentTask: !!desk.currentTask
    })),
    workflows: listWorkflows().map((workflow) => ({
      id: workflow.id,
      status: workflow.status,
      currentStepIndex: workflow.currentStep ? workflow.currentStep.index : null
    })),
    taskCount: getTasks().length
  };
}

function computeStateDiff(beforeSnapshot, afterSnapshot) {
  const diff = {};
  for (const key of Object.keys(afterSnapshot)) {
    const beforeValue = JSON.stringify(beforeSnapshot[key]);
    const afterValue = JSON.stringify(afterSnapshot[key]);
    if (beforeValue !== afterValue) {
      diff[key] = {
        before: beforeSnapshot[key],
        after: afterSnapshot[key]
      };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

function summarizeResult(result) {
  if (!result) {
    return 'no_result';
  }

  if (!result.success) {
    return result.error || 'failed';
  }

  if (result.command) {
    return `${result.command}:ok`;
  }

  return 'ok';
}

function recordCommandHistory(commandString, parsedCommand, result, affectedEntities, stateDiff) {
  commandHistory.push({
    command: commandString,
    timestamp: Date.now(),
    success: !!(result && result.success),
    parsed: parsedCommand,
    affectedEntities: affectedEntities || {},
    resultSummary: summarizeResult(result),
    stateDiff: stateDiff || null
  });

  if (commandHistory.length > 1000) {
    commandHistory.shift();
  }
}

// --- Inspection helpers ---
export function inspectAgent(id) {
  const agentId = Number(id);
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return null;
  }

  return {
    id: agent.id,
    role: agent.role,
    state: agent.state,
    position: { x: Math.round(agent.x), y: Math.round(agent.y) },
    targetDeskIndex: agent.targetDesk ? desks.indexOf(agent.targetDesk) : null,
    speed: agent.speed,
    productivity: agent.productivity,
    skills: { ...agent.skills }
  };
}

export function inspectDesk(id) {
  const deskIndex = Number(id);
  const desk = desks[deskIndex];
  if (!desk) {
    return null;
  }

  return {
    id: deskIndex,
    paused: !!desk.paused,
    occupied: desk.occupied,
    queueLength: desk.queue.length,
    completedTasks: desk.completedTasks,
    failedTasks: desk.failedTasks,
    currentTask: sanitizeTaskForView(desk.currentTask),
    queuedTasks: desk.queue.map((task) => sanitizeTaskForView(task))
  };
}

export function inspectWorkflow(id) {
  return getWorkflow(id);
}

// --- Control API ---
function injectTask(task) {
  if (!task || typeof task !== 'object') {
    return { success: false, error: 'invalid_task' };
  }

  console.log('[UI][TASK_INJECT]', 'incoming_task', task);

  const mergedTask = {
    ...task,
    id: task.id || `manual-${generateId()}`,
    payload: task && typeof task.payload === 'object' && task.payload !== null
      ? { ...task.payload }
      : {}
  };

  if (mergedTask.type === 'discord') {
    if (!mergedTask.payload.channelId && task.channelId) {
      mergedTask.payload.channelId = String(task.channelId).trim();
    }

    if ((mergedTask.payload.content === undefined || mergedTask.payload.content === null || mergedTask.payload.content === '') && task.content) {
      mergedTask.payload.content = String(task.content);
    }

    if (!mergedTask.payload.messageId && task.messageId) {
      mergedTask.payload.messageId = String(task.messageId).trim();
    }

    mergedTask.payload = {
      channelId: mergedTask.payload.channelId || null,
      content: typeof mergedTask.payload.content === 'string' ? mergedTask.payload.content : '',
      messageId: mergedTask.payload.messageId || null,
      ...mergedTask.payload
    };

    if (!mergedTask.payload.channelId) {
      console.warn('Missing channelId for Discord task', {
        taskId: mergedTask.id,
        type: mergedTask.type,
        payload: mergedTask.payload
      });
    }
  }

  if (mergedTask.type === 'image_render') {
    mergedTask.payload = {
      ...(mergedTask.payload || {}),
      designIntent: task.designIntent && typeof task.designIntent === 'object'
        ? { ...task.designIntent }
        : (mergedTask.payload && mergedTask.payload.designIntent && typeof mergedTask.payload.designIntent === 'object' ? { ...mergedTask.payload.designIntent } : {})
    };

    console.log('[RenderTaskInjected]', mergedTask);
  }

  console.log('[UI][TASK_INJECT]', 'normalized_task', mergedTask);
  console.log('[UI][TASK_INJECT]', 'before_addTaskToDesk', mergedTask);

  const desk = addTaskToDesk(mergedTask);
  if (!desk) {
    return { success: false, error: 'task_injection_rejected' };
  }

  emitEvent('TASK_CREATED', {
    source: 'control_api',
    taskId: mergedTask.id,
    taskType: mergedTask.type || 'discord',
    deskIndex: desks.indexOf(desk)
  });

  return { success: true, data: sanitizeTaskForView(mergedTask) };
}

function getDeskState() {
  return desks.map((desk, index) => ({
    id: index,
    paused: !!desk.paused,
    occupied: desk.occupied,
    queueLength: desk.queue.length,
    completedTasks: desk.completedTasks,
    failedTasks: desk.failedTasks,
    currentTask: sanitizeTaskForView(desk.currentTask)
  }));
}

function getAgents() {
  return agents.map((agent) => inspectAgent(agent.id));
}

function moveAgent(agentId, deskIndex) {
  const agent = agents.find((candidate) => candidate.id === Number(agentId));
  const desk = desks[Number(deskIndex)];

  if (!agent) {
    return { success: false, error: 'agent_not_found' };
  }

  if (!desk) {
    return { success: false, error: 'desk_not_found' };
  }

  if (!isDeskAvailableForAgent(desk, agent)) {
    return { success: false, error: 'desk_occupied' };
  }

  clearAgentTarget(agent);
  desk.occupied = true;
  desk.occupant = agent;
  agent.targetDesk = desk;
  agent.targetSlot = desk.slots.seat;
  const seatPosition = getDeskSlotPosition(desk, 'seat');
  agent.targetX = seatPosition.x;
  agent.targetY = seatPosition.y;
  agent.state = 'moving';
  agent.stateTimer = 0;
  agent.wanderTimer = 0;
  agent.targetRetryTimer = 0;

  emitEvent('AGENT_MOVED', {
    agentId: agent.id,
    deskIndex: Number(deskIndex)
  });

  return { success: true, data: inspectAgent(agent.id) };
}

function setAgentRole(agentId, role) {
  const agent = agents.find((candidate) => candidate.id === Number(agentId));
  if (!agent) {
    return { success: false, error: 'agent_not_found' };
  }

  if (role !== 'researcher' && role !== 'executor' && role !== 'other') {
    return { success: false, error: 'invalid_role' };
  }

  agent.role = role;
  if (role === 'researcher') {
    agent.skills.discord = 1.5;
    agent.skills.shopify = 0.9;
  } else if (role === 'executor') {
    agent.skills.discord = 0.9;
    agent.skills.shopify = 1.5;
  } else {
    agent.skills.discord = 1;
    agent.skills.shopify = 1;
  }

  emitEvent('AGENT_ROLE_CHANGED', {
    agentId: agent.id,
    role: agent.role
  });

  return { success: true, data: inspectAgent(agent.id) };
}

function pauseDesk(deskId) {
  const desk = desks[Number(deskId)];
  if (!desk) {
    return { success: false, error: 'desk_not_found' };
  }

  desk.paused = true;
  emitEvent('DESK_PAUSED', {
    deskId: Number(deskId)
  });

  return { success: true, data: inspectDesk(deskId) };
}

function resumeDesk(deskId) {
  const desk = desks[Number(deskId)];
  if (!desk) {
    return { success: false, error: 'desk_not_found' };
  }

  desk.paused = false;
  emitEvent('DESK_RESUMED', {
    deskId: Number(deskId)
  });

  return { success: true, data: inspectDesk(deskId) };
}

export const controlAPI = {
  injectTask,
  getTasks,
  getDeskState,
  getAgents,
  moveAgent,
  setAgentRole,
  pauseDesk,
  resumeDesk,
  getWorkflows: getWorkflowsControl,
  inspectWorkflow,
  approveWorkflow,
  rejectWorkflow,
  editWorkflowStep
};

// --- Command dispatcher ---
export function dispatchCommand(inputString) {
  const beforeSnapshot = captureRuntimeSnapshot();
  const parsed = parseCommandInput(inputString);
  if (!parsed.success) {
    const failedResult = { success: false, command: 'parse', error: parsed.error };
    recordCommandHistory(String(inputString || ''), parsed, failedResult, {}, null);
    return failedResult;
  }

  let result;
  let affectedEntities = {};

  if (parsed.command === 'inject') {
    if (parsed.type === 'discord') {
      result = {
        command: 'inject',
        ...controlAPI.injectTask(createDiscordTask({
          title: 'Manual inject',
          type: 'command',
          content: parsed.message,
          channelId: parsed.channelId || undefined,
          messageId: parsed.messageId || undefined
        }))
      };
      affectedEntities = {
        tasks: result && result.data && result.data.id ? [result.data.id] : []
      };
      const afterSnapshot = captureRuntimeSnapshot();
      recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
      return result;
    }

    result = {
      command: 'inject',
      ...controlAPI.injectTask(createShopifyTask({ title: parsed.message, type: 'order' }))
    };
    affectedEntities = {
      tasks: result && result.data && result.data.id ? [result.data.id] : []
    };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'spawn_workflow_product') {
    const workflow = createProductWorkflowFromTask({
      id: `manual-cmd-${generateId()}`,
      type: 'discord',
      action: 'start_product_workflow',
      payload: {
        args: [parsed.keyword],
        channelId: null,
        messageId: null
      }
    });

    result = {
      success: true,
      command: 'spawn_workflow_product',
      data: workflow ? getWorkflow(workflow.id) : null
    };
    affectedEntities = {
      workflows: workflow ? [workflow.id] : []
    };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'inspect_agent') {
    const data = inspectAgent(parsed.agentId);
    result = { success: !!data, command: 'inspect_agent', data, error: data ? undefined : 'agent_not_found' };
    affectedEntities = { agents: [parsed.agentId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'inspect_desk') {
    const data = inspectDesk(parsed.deskId);
    result = { success: !!data, command: 'inspect_desk', data, error: data ? undefined : 'desk_not_found' };
    affectedEntities = { desks: [parsed.deskId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'inspect_workflow') {
    const data = controlAPI.inspectWorkflow(parsed.workflowId);
    result = { success: !!data, command: 'inspect_workflow', data, error: data ? undefined : 'workflow_not_found' };
    affectedEntities = { workflows: [parsed.workflowId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'pause_desk') {
    result = {
      command: 'pause_desk',
      ...controlAPI.pauseDesk(parsed.deskId)
    };
    affectedEntities = { desks: [parsed.deskId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'resume_desk') {
    result = {
      command: 'resume_desk',
      ...controlAPI.resumeDesk(parsed.deskId)
    };
    affectedEntities = { desks: [parsed.deskId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'approve_workflow') {
    const approval = approveWorkflow(parsed.workflowId);
    result = {
      success: approval.success,
      command: 'approve_workflow',
      data: approval.data,
      error: approval.error
    };
    affectedEntities = { workflows: [parsed.workflowId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'reject_workflow') {
    const rejection = rejectWorkflow(parsed.workflowId, parsed.reason);
    result = {
      success: rejection.success,
      command: 'reject_workflow',
      data: rejection.data,
      error: rejection.error
    };
    affectedEntities = { workflows: [parsed.workflowId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  result = { success: false, command: parsed.command, error: 'unsupported_command' };
  const afterSnapshot = captureRuntimeSnapshot();
  recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
  return result;
}
