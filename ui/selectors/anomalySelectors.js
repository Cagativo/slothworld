import { getTaskEvents } from './taskSelectors.js';

function allTaskIds(indexedWorld) {
  if (!indexedWorld || !(indexedWorld.eventsByTaskId instanceof Map)) {
    return [];
  }

  return Array.from(indexedWorld.eventsByTaskId.keys());
}

export function getStalledAckTasks(indexedWorld, thresholdMs = 15000, now = Date.now()) {
  return allTaskIds(indexedWorld)
    .filter((taskId) => {
      const events = getTaskEvents(indexedWorld, taskId);
      const lastFinish = [...events].reverse().find((event) => event && event.type === 'TASK_EXECUTE_FINISHED');
      if (!lastFinish || !Number.isFinite(lastFinish.timestamp)) {
        return false;
      }

      const hasAckAfterFinish = events.some((event) => {
        return event
          && event.type === 'TASK_ACKED'
          && Number.isFinite(event.timestamp)
          && Number(event.timestamp) > Number(lastFinish.timestamp);
      });

      return !hasAckAfterFinish && (now - Number(lastFinish.timestamp)) >= thresholdMs;
    });
}

export function getExecutionMissingFinishTasks(indexedWorld) {
  return allTaskIds(indexedWorld)
    .filter((taskId) => {
      const events = getTaskEvents(indexedWorld, taskId);
      const hasStart = events.some((event) => event && (event.type === 'TASK_EXECUTE_STARTED' || event.type === 'TASK_STARTED'));
      const hasFinish = events.some((event) => event && event.type === 'TASK_EXECUTE_FINISHED');
      return hasStart && !hasFinish;
    });
}

export function getDuplicateAckTasks(indexedWorld) {
  return allTaskIds(indexedWorld)
    .filter((taskId) => {
      const events = getTaskEvents(indexedWorld, taskId);
      const ackCount = events.filter((event) => event && event.type === 'TASK_ACKED').length;
      return ackCount > 1;
    });
}

export function getIncidentClusters(indexedWorld, options = {}) {
  const thresholdMs = Number.isFinite(options.thresholdMs) ? Number(options.thresholdMs) : 15000;
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();

  const stalled = getStalledAckTasks(indexedWorld, thresholdMs, now).map((taskId) => ({
    id: `stalled-${taskId}`,
    severity: 'medium',
    category: 'Stalled Awaiting ACK',
    taskId,
    summary: 'Execution finished but ACK is missing beyond threshold.'
  }));

  const missingFinish = getExecutionMissingFinishTasks(indexedWorld).map((taskId) => ({
    id: `missing-finish-${taskId}`,
    severity: 'low',
    category: 'Execution Missing Finish',
    taskId,
    summary: 'Execution start observed without execution finish event.'
  }));

  const duplicateAck = getDuplicateAckTasks(indexedWorld).map((taskId) => ({
    id: `duplicate-ack-${taskId}`,
    severity: 'high',
    category: 'Duplicate ACK',
    taskId,
    summary: 'Multiple TASK_ACKED events observed for one task.'
  }));

  return [...duplicateAck, ...stalled, ...missingFinish];
}
