import { getTaskEvents } from './taskSelectors.js';
import { getAllTasks } from './taskSelectors.js';

function firstTimestamp(events, type) {
  const match = events.find((event) => event && event.type === type);
  return match && Number.isFinite(match.timestamp) ? Number(match.timestamp) : null;
}

export function getQueueTime(indexedWorld, taskId) {
  const events = getTaskEvents(indexedWorld, taskId);
  const createdAt = firstTimestamp(events, 'TASK_CREATED');
  const startedAt = firstTimestamp(events, 'TASK_EXECUTE_STARTED') || firstTimestamp(events, 'TASK_STARTED');

  if (!Number.isFinite(createdAt) || !Number.isFinite(startedAt)) {
    return null;
  }

  return Math.max(0, startedAt - createdAt);
}

export function getExecutionDuration(indexedWorld, taskId) {
  const events = getTaskEvents(indexedWorld, taskId);
  const startedAt = firstTimestamp(events, 'TASK_EXECUTE_STARTED') || firstTimestamp(events, 'TASK_STARTED');
  const finishedAt = firstTimestamp(events, 'TASK_EXECUTE_FINISHED');

  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) {
    return null;
  }

  return Math.max(0, finishedAt - startedAt);
}

export function getAckLatency(indexedWorld, taskId) {
  const events = getTaskEvents(indexedWorld, taskId);
  const finishedAt = firstTimestamp(events, 'TASK_EXECUTE_FINISHED');
  const ackedAt = firstTimestamp(events, 'TASK_ACKED');

  if (!Number.isFinite(finishedAt) || !Number.isFinite(ackedAt)) {
    return null;
  }

  return Math.max(0, ackedAt - finishedAt);
}

export function getTaskCounts(indexedWorld) {
  const tasks = getAllTasks(indexedWorld);
  const counts = {
    queued: 0,
    active: 0,
    done: 0,
    failed: 0
  };

  for (const task of tasks) {
    if (task.status === 'failed') {
      counts.failed += 1;
      continue;
    }

    if (task.status === 'completed' || task.status === 'acknowledged') {
      counts.done += 1;
      continue;
    }

    if (task.status === 'claimed' || task.status === 'executing' || task.status === 'awaiting_ack') {
      counts.active += 1;
      continue;
    }

    counts.queued += 1;
  }

  return counts;
}
