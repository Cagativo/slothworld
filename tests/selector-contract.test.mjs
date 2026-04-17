import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorldState } from '../core/world/deriveWorldState.js';
import {
  getLifecycleEvents,
  getTaskEvents,
  getTaskStatus
} from '../ui/selectors/taskSelectors.js';
import {
  getQueueTime,
  getExecutionDuration,
  getAckLatency
} from '../ui/selectors/metricsSelectors.js';
import { getIncidentClusters } from '../ui/selectors/anomalySelectors.js';
import { isSystemEvent } from '../core/world/eventTaxonomy.js';

function buildWorld(events) {
  return deriveWorldState(events);
}

function event(type, taskId, timestamp, payload = {}) {
  return { type, taskId, timestamp, payload };
}

test('task selectors ignore system events in lifecycle derivation', () => {
  const mixedEvents = [
    event('TASK_CREATED', 'task-1', 1, { title: 'Task One' }),
    event('TASK_NOTIFICATION_SKIPPED', 'task-1', 2, { reason: 'missing_channelId' }),
    event('TASK_EXECUTE_STARTED', 'task-1', 3, {}),
    event('TASK_NOTIFICATION_FAILED', 'task-1', 4, { reason: 'send_failed' }),
    event('TASK_EXECUTE_FINISHED', 'task-1', 5, { success: true }),
    event('TASK_ACKED', 'task-1', 6, { status: 'completed' })
  ];

  const world = buildWorld(mixedEvents);
  const lifecycleEvents = getTaskEvents(world, 'task-1');
  const status = getTaskStatus(world, 'task-1');

  assert.ok(lifecycleEvents.length > 0);
  assert.equal(lifecycleEvents.some((item) => isSystemEvent(item.type)), false);
  assert.equal(status, 'completed');
});

test('getLifecycleEvents filters only lifecycle event types', () => {
  const mixed = [
    event('TASK_CREATED', 'task-2', 1, {}),
    event('TASK_NOTIFICATION_SENT', 'task-2', 2, {}),
    event('TASK_EXECUTE_STARTED', 'task-2', 3, {}),
    event('TASK_UNKNOWN_TYPE', 'task-2', 4, {}),
    event('TASK_ACKED', 'task-2', 5, { status: 'completed' })
  ];

  const lifecycleOnly = getLifecycleEvents(mixed);
  assert.deepEqual(
    lifecycleOnly.map((item) => item.type),
    ['TASK_CREATED', 'TASK_EXECUTE_STARTED', 'TASK_ACKED']
  );
});

test('metrics selectors are invariant to presence of system events', () => {
  const lifecycleOnly = [
    event('TASK_CREATED', 'task-3', 1000, {}),
    event('TASK_ENQUEUED', 'task-3', 1100, {}),
    event('TASK_EXECUTE_STARTED', 'task-3', 2000, {}),
    event('TASK_EXECUTE_FINISHED', 'task-3', 3500, { success: true }),
    event('TASK_ACKED', 'task-3', 4000, { status: 'completed' })
  ];

  const withSystem = [
    ...lifecycleOnly,
    event('TASK_NOTIFICATION_SENT', 'task-3', 4100, { mode: 'channel' }),
    event('TASK_NOTIFICATION_FAILED', 'task-3', 4200, { reason: 'transient' })
  ];

  const worldLifecycle = buildWorld(lifecycleOnly);
  const worldWithSystem = buildWorld(withSystem);

  assert.equal(getQueueTime(worldLifecycle, 'task-3'), getQueueTime(worldWithSystem, 'task-3'));
  assert.equal(getExecutionDuration(worldLifecycle, 'task-3'), getExecutionDuration(worldWithSystem, 'task-3'));
  assert.equal(getAckLatency(worldLifecycle, 'task-3'), getAckLatency(worldWithSystem, 'task-3'));
});

test('getIncidentClusters returns expected shape with includeSystemEvents=true', () => {
  const now = 100000;
  const events = [
    event('TASK_CREATED', 'task-4', 1000, {}),
    event('TASK_EXECUTE_STARTED', 'task-4', 2000, {}),
    event('TASK_EXECUTE_FINISHED', 'task-4', 3000, { success: false }),
    event('TASK_ACKED', 'task-4', 3100, { status: 'failed', error: 'boom' }),

    event('TASK_CREATED', 'task-5', 1000, {}),
    event('TASK_EXECUTE_STARTED', 'task-5', 1500, {}),
    event('TASK_EXECUTE_FINISHED', 'task-5', 2000, { success: true }),
    event('TASK_NOTIFICATION_SKIPPED', 'task-5', 2500, { reason: 'missing_channelId' }),

    event('TASK_CREATED', 'task-6', 1000, {}),
    event('TASK_EXECUTE_STARTED', 'task-6', 1100, {}),
    event('TASK_EXECUTE_FINISHED', 'task-6', 1200, { success: true })
  ];

  const world = buildWorld(events);
  const clusters = getIncidentClusters(world, {
    includeSystemEvents: true,
    thresholdMs: 1000,
    now
  });

  assert.ok(Array.isArray(clusters));
  assert.ok(clusters.length >= 3);

  clusters.forEach((cluster) => {
    assert.equal(typeof cluster.type, 'string');
    assert.ok(['low', 'medium', 'high'].includes(cluster.severity));
    assert.ok(Array.isArray(cluster.taskIds));
    assert.equal(typeof cluster.summary, 'string');
    assert.ok(Array.isArray(cluster.representativeEvents));
  });

  const clusterTypes = new Set(clusters.map((item) => item.type));
  assert.equal(clusterTypes.has('execution_failures'), true);
  assert.equal(clusterTypes.has('notification_issues'), true);
  assert.equal(clusterTypes.has('stalled_tasks'), true);
});

test('getIncidentClusters excludes notification cluster when includeSystemEvents=false', () => {
  const now = 100000;
  const events = [
    event('TASK_CREATED', 'task-7', 1000, {}),
    event('TASK_EXECUTE_STARTED', 'task-7', 1500, {}),
    event('TASK_EXECUTE_FINISHED', 'task-7', 2000, { success: true }),
    event('TASK_NOTIFICATION_FAILED', 'task-7', 2100, { reason: 'send_failed' })
  ];

  const world = buildWorld(events);
  const clusters = getIncidentClusters(world, {
    includeSystemEvents: false,
    thresholdMs: 1000,
    now
  });

  const clusterTypes = new Set(clusters.map((item) => item.type));
  assert.equal(clusterTypes.has('notification_issues'), false);

  clusters.forEach((cluster) => {
    assert.equal(typeof cluster.type, 'string');
    assert.ok(['low', 'medium', 'high'].includes(cluster.severity));
    assert.ok(Array.isArray(cluster.taskIds));
    assert.equal(typeof cluster.summary, 'string');
    assert.ok(Array.isArray(cluster.representativeEvents));
  });
});
