import { getTaskEvents, getLifecycleEvents } from './taskSelectors.js';
import { getAllTasks } from './taskSelectors.js';
import { assertNoSystemEventInLifecycleDerivation } from './eventTaxonomyInvariant.js';

function firstTimestamp(events, type) {
  const match = events.find((event) => event && event.type === type);
  return match && Number.isFinite(match.timestamp) ? Number(match.timestamp) : null;
}

export function getQueueTime(indexedWorld, taskId) {
  const events = getLifecycleEvents(getTaskEvents(indexedWorld, taskId));
  assertNoSystemEventInLifecycleDerivation(events, 'metrics:getQueueTime');
  const createdAt = firstTimestamp(events, 'TASK_CREATED');
  const startedAt = firstTimestamp(events, 'TASK_EXECUTE_STARTED');

  if (!Number.isFinite(createdAt) || !Number.isFinite(startedAt)) {
    return null;
  }

  return Math.max(0, startedAt - createdAt);
}

export function getExecutionDuration(indexedWorld, taskId) {
  const events = getLifecycleEvents(getTaskEvents(indexedWorld, taskId));
  assertNoSystemEventInLifecycleDerivation(events, 'metrics:getExecutionDuration');
  const startedAt = firstTimestamp(events, 'TASK_EXECUTE_STARTED');
  const finishedAt = firstTimestamp(events, 'TASK_EXECUTE_FINISHED');

  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) {
    return null;
  }

  return Math.max(0, finishedAt - startedAt);
}

export function getAckLatency(indexedWorld, taskId) {
  const events = getLifecycleEvents(getTaskEvents(indexedWorld, taskId));
  assertNoSystemEventInLifecycleDerivation(events, 'metrics:getAckLatency');
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
