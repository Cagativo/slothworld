import { isLifecycleEvent, isSystemEvent } from '../../core/world/eventTaxonomy.js';

function allTaskIds(indexedWorld) {
  if (!indexedWorld || !(indexedWorld.eventsByTaskId instanceof Map)) {
    return [];
  }

  return Array.from(indexedWorld.eventsByTaskId.keys());
}

function getTaskEvents(indexedWorld, taskId) {
  if (!indexedWorld || !(indexedWorld.eventsByTaskId instanceof Map)) {
    return [];
  }

  const events = indexedWorld.eventsByTaskId.get(String(taskId));
  return Array.isArray(events) ? events : [];
}

function getLifecycleTaskEvents(indexedWorld, taskId) {
  return getTaskEvents(indexedWorld, taskId)
    .filter((event) => isLifecycleEvent(event && event.type));
}

function getSystemTaskEvents(indexedWorld, taskId) {
  return getTaskEvents(indexedWorld, taskId)
    .filter((event) => isSystemEvent(event && event.type));
}

function safeTimestamp(event) {
  return Number.isFinite(event && event.timestamp) ? Number(event.timestamp) : null;
}

function eventType(event) {
  return event && typeof event.type === 'string' ? event.type : null;
}

function normalizeTaskId(taskId) {
  return taskId === null || taskId === undefined ? null : String(taskId);
}

function taskEventsForType(events, type) {
  if (!Array.isArray(events)) {
    return [];
  }

  return events.filter((event) => eventType(event) === type);
}

function firstByTimestampDesc(events, limit = 3) {
  return [...events]
    .sort((a, b) => (safeTimestamp(b) || 0) - (safeTimestamp(a) || 0))
    .slice(0, Math.max(1, Number(limit) || 3));
}

export function getStalledAckTasks(indexedWorld, thresholdMs = 15000, now = Date.now()) {
  return allTaskIds(indexedWorld)
    .filter((taskId) => {
      const events = getLifecycleTaskEvents(indexedWorld, taskId);
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
      const events = getLifecycleTaskEvents(indexedWorld, taskId);
      const hasStart = events.some((event) => event && event.type === 'TASK_EXECUTE_STARTED');
      const hasFinish = events.some((event) => event && event.type === 'TASK_EXECUTE_FINISHED');
      return hasStart && !hasFinish;
    });
}

export function getDuplicateAckTasks(indexedWorld) {
  return allTaskIds(indexedWorld)
    .filter((taskId) => {
      const events = getLifecycleTaskEvents(indexedWorld, taskId);
      const ackCount = taskEventsForType(events, 'TASK_ACKED').length;
      return ackCount > 1;
    });
}

export function getNotificationSkippedTasks(indexedWorld) {
  return allTaskIds(indexedWorld)
    .filter((taskId) => {
      const events = getSystemTaskEvents(indexedWorld, taskId);
      return events.some((event) => event && event.type === 'TASK_NOTIFICATION_SKIPPED');
    });
}

export function getNotificationFailedTasks(indexedWorld) {
  return allTaskIds(indexedWorld)
    .filter((taskId) => {
      const events = getSystemTaskEvents(indexedWorld, taskId);
      return events.some((event) => event && event.type === 'TASK_NOTIFICATION_FAILED');
    });
}

export function getNotificationSkipReason(indexedWorld, taskId) {
  const events = getSystemTaskEvents(indexedWorld, taskId);
  const skipEvent = events.find((event) => event && event.type === 'TASK_NOTIFICATION_SKIPPED');
  return skipEvent && skipEvent.payload && typeof skipEvent.payload.reason === 'string'
    ? skipEvent.payload.reason
    : null;
}

export function getNotificationFailReason(indexedWorld, taskId) {
  const events = getSystemTaskEvents(indexedWorld, taskId);
  const failEvent = [...events].reverse().find((event) => event && event.type === 'TASK_NOTIFICATION_FAILED');
  return failEvent && failEvent.payload && typeof failEvent.payload.reason === 'string'
    ? failEvent.payload.reason
    : null;
}

export function getIncidentClusters(indexedWorld, options = {}) {
  const thresholdMs = Number.isFinite(options.thresholdMs) ? Number(options.thresholdMs) : 15000;
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const includeSystemEvents = options.includeSystemEvents !== false;

  const taskIds = allTaskIds(indexedWorld);
  const failedAckEvents = [];
  const notificationIssueEvents = [];
  const stalledTaskIds = getStalledAckTasks(indexedWorld, thresholdMs, now).map((taskId) => normalizeTaskId(taskId));

  taskIds.forEach((taskId) => {
    const lifecycleEvents = getLifecycleTaskEvents(indexedWorld, taskId);
    const systemEvents = includeSystemEvents ? getSystemTaskEvents(indexedWorld, taskId) : [];

    taskEventsForType(lifecycleEvents, 'TASK_ACKED').forEach((event) => {
      const payload = event && typeof event.payload === 'object' ? event.payload : {};
      if (payload.status === 'failed') {
        failedAckEvents.push(event);
      }
    });

    taskEventsForType(systemEvents, 'TASK_NOTIFICATION_FAILED').forEach((event) => {
      notificationIssueEvents.push(event);
    });

    taskEventsForType(systemEvents, 'TASK_NOTIFICATION_SKIPPED').forEach((event) => {
      notificationIssueEvents.push(event);
    });
  });

  const executionFailureTaskIds = Array.from(new Set(failedAckEvents
    .map((event) => normalizeTaskId(event && event.taskId))
    .filter(Boolean)));

  const notificationIssueTaskIds = Array.from(new Set(notificationIssueEvents
    .map((event) => normalizeTaskId(event && event.taskId))
    .filter(Boolean)));

  const clusters = [
    {
      type: 'execution_failures',
      severity: executionFailureTaskIds.length > 0 ? 'high' : 'low',
      taskIds: executionFailureTaskIds,
      summary: executionFailureTaskIds.length
        ? `${executionFailureTaskIds.length} tasks acknowledged as failed.`
        : 'No failed acknowledgements detected.',
      representativeEvents: firstByTimestampDesc(failedAckEvents, 5)
    },
    {
      type: 'stalled_tasks',
      severity: stalledTaskIds.length > 0 ? 'medium' : 'low',
      taskIds: stalledTaskIds,
      summary: stalledTaskIds.length
        ? `${stalledTaskIds.length} tasks are stalled awaiting ACK beyond threshold.`
        : 'No stalled tasks detected.',
      representativeEvents: firstByTimestampDesc(
        stalledTaskIds.flatMap((taskId) => taskEventsForType(getLifecycleTaskEvents(indexedWorld, taskId), 'TASK_EXECUTE_FINISHED')),
        5
      )
    }
  ];

  if (includeSystemEvents) {
    clusters.splice(1, 0, {
      type: 'notification_issues',
      severity: notificationIssueTaskIds.length > 0 ? 'medium' : 'low',
      taskIds: notificationIssueTaskIds,
      summary: notificationIssueTaskIds.length
        ? `${notificationIssueTaskIds.length} tasks have skipped or failed notifications.`
        : 'No notification issues detected.',
      representativeEvents: firstByTimestampDesc(notificationIssueEvents, 5)
    });
  }

  return clusters;
}
