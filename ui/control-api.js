import { parseCommandInput } from './command-parser.js';
import { getIndexedWorldSnapshot } from '../core/world/indexedWorldSnapshot.js';
import { getAllTasks, getAllDesks, getRecentEvents } from './selectors/taskSelectors.js';
import { getAllAgents } from './selectors/agentSelectors.js';

function toTaskPayload(task) {
  const payload = task && typeof task.payload === 'object' && task.payload !== null
    ? { ...task.payload }
    : {};

  const type = task && task.type ? String(task.type) : 'discord';
  const normalized = {
    type,
    title: task && task.title ? String(task.title) : 'UI task',
    payload
  };

  if (typeof task.action === 'string' && task.action.trim()) {
    normalized.action = task.action.trim();
  }

  if (Number.isFinite(task && task.priority)) {
    normalized.priority = Number(task.priority);
  }

  if (typeof task.productId === 'string') {
    normalized.productId = task.productId;
  }

  if (typeof task.provider === 'string') {
    normalized.provider = task.provider;
  }

  if (task && task.designIntent && typeof task.designIntent === 'object') {
    normalized.designIntent = { ...task.designIntent };
  }

  return normalized;
}

async function injectTask(task) {
  try {
    const response = await fetch('/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(toTaskPayload(task))
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error: body && body.error ? body.error : `http_${response.status}`,
        statusCode: response.status,
        data: body || null
      };
    }

    // TaskEngine owns the full lifecycle after creation.
    // UI intent ends here — engine auto-drives enqueue → claim → execute → ack.
    return {
      success: true,
      data: body && body.task ? body.task : body
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'task_injection_failed'
    };
  }
}

function getWorldState() {
  return getIndexedWorldSnapshot();
}

function getTasks() {
  return getAllTasks(getWorldState());
}

function getAgents() {
  return getAllAgents(getWorldState());
}

function getDeskState() {
  return getAllDesks(getWorldState());
}

function getEventView(limit = 100) {
  return getRecentEvents(getWorldState(), limit);
}

export const controlAPI = {
  injectTask,
  getWorldState,
  getTasks,
  getAgents,
  getDeskState,
  getEventView
};

export async function dispatchCommand(inputString) {
  const parsed = parseCommandInput(inputString);
  if (!parsed.success) {
    return {
      success: false,
      command: 'parse',
      error: parsed.error
    };
  }

  if (parsed.command === 'inject') {
    if (parsed.type === 'discord') {
      return {
        command: 'inject',
        ...(await controlAPI.injectTask({
          type: 'discord',
          title: 'Manual inject',
          action: 'reply_to_message',
          payload: {
            channelId: parsed.channelId || null,
            messageId: parsed.messageId || null,
            content: parsed.message
          }
        }))
      };
    }

    return {
      command: 'inject',
      ...(await controlAPI.injectTask({
        type: 'shopify',
        title: parsed.message,
        action: 'process_order',
        payload: {
          note: parsed.message
        }
      }))
    };
  }

  return {
    success: false,
    command: parsed.command,
    error: 'unsupported_command'
  };
}
