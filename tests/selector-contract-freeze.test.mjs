/**
 * Selector Contract Freeze
 *
 * Architecture gate: fails if deriveWorldState gains semantics,
 * if lifecycle derivation uses system events, or if anomaly isolation breaks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorldState } from '../core/world/deriveWorldState.js';
import {
  getTaskStatus,
  getTaskEvents,
  getTaskSnapshot,
  getLifecycleEvents,
  getAllTasks
} from '../ui/selectors/taskSelectors.js';
import {
  getQueueTime,
  getExecutionDuration,
  getAckLatency
} from '../ui/selectors/metricsSelectors.js';
import { getIncidentClusters } from '../ui/selectors/anomalySelectors.js';
import { isSystemEvent } from '../core/world/eventTaxonomy.js';

function ev(type, taskId, timestamp, payload = {}) {
  return { type, taskId, timestamp, payload };
}

function world(...events) {
  return deriveWorldState(events);
}

// ─── A. deriveWorldState purity ───────────────────────────────────────────────

test('deriveWorldState output has exactly: events, eventsByTaskId, eventsByWorkerId', () => {
  const result = world(ev('TASK_CREATED', 't1', 1, {}));
  const keys = Object.keys(result).sort();
  assert.deepEqual(keys, ['events', 'eventsByTaskId', 'eventsByWorkerId']);
});

test('deriveWorldState does not include lifecycle status fields', () => {
  const result = world(
    ev('TASK_CREATED', 't1', 1, {}),
    ev('TASK_ACKED', 't1', 2, { status: 'failed' })
  );
  assert.equal('status' in result, false);
  assert.equal('taskStatus' in result, false);
  assert.equal('failedTasks' in result, false);
});

test('deriveWorldState does not include metrics fields', () => {
  const result = world(ev('TASK_CREATED', 't1', 1, {}));
  assert.equal('queueTime' in result, false);
  assert.equal('executionDuration' in result, false);
  assert.equal('ackLatency' in result, false);
  assert.equal('metrics' in result, false);
});

test('deriveWorldState does not include anomaly fields', () => {
  const result = world(ev('TASK_CREATED', 't1', 1, {}));
  assert.equal('anomalies' in result, false);
  assert.equal('incidents' in result, false);
  assert.equal('stalledTasks' in result, false);
  assert.equal('clusters' in result, false);
});

test('deriveWorldState eventsByTaskId is a Map', () => {
  const result = world(ev('TASK_CREATED', 't1', 1, {}));
  assert.ok(result.eventsByTaskId instanceof Map);
});

test('deriveWorldState eventsByWorkerId is a Map', () => {
  const result = world(ev('TASK_CREATED', 't1', 1, {}));
  assert.ok(result.eventsByWorkerId instanceof Map);
});

// ─── B. Selector-only rule ────────────────────────────────────────────────────

test('taskSelectors accept deriveWorldState output as input', () => {
  const indexed = world(
    ev('TASK_CREATED', 't2', 1, { title: 'Test' }),
    ev('TASK_ACKED', 't2', 2, { status: 'completed' })
  );
  const status = getTaskStatus(indexed, 't2');
  assert.equal(typeof status, 'string');
  assert.ok(status.length > 0);
});

test('metricsSelectors accept deriveWorldState output as input', () => {
  const indexed = world(
    ev('TASK_CREATED', 't3', 1000, {}),
    ev('TASK_EXECUTE_STARTED', 't3', 2000, {}),
    ev('TASK_EXECUTE_FINISHED', 't3', 3500, {}),
    ev('TASK_ACKED', 't3', 4000, { status: 'completed' })
  );
  const duration = getExecutionDuration(indexed, 't3');
  assert.ok(duration === null || typeof duration === 'number');
});

test('anomalySelectors accept deriveWorldState output as input', () => {
  const indexed = world(ev('TASK_CREATED', 't4', 1, {}));
  const clusters = getIncidentClusters(indexed);
  assert.ok(Array.isArray(clusters));
});

// ─── C. Lifecycle purity enforcement ─────────────────────────────────────────

test('system events injected alongside lifecycle events do not change task status', () => {
  const baseEvents = [
    ev('TASK_CREATED', 't5', 1, {}),
    ev('TASK_EXECUTE_STARTED', 't5', 2, {}),
    ev('TASK_EXECUTE_FINISHED', 't5', 3, {}),
    ev('TASK_ACKED', 't5', 4, { status: 'completed' })
  ];
  const withSystem = [
    ...baseEvents,
    ev('TASK_NOTIFICATION_SENT', 't5', 5, {}),
    ev('TASK_NOTIFICATION_SKIPPED', 't5', 6, { reason: 'missing_channelId' }),
    ev('TASK_NOTIFICATION_FAILED', 't5', 7, { reason: 'send_failed' })
  ];

  const statusBase = getTaskStatus(deriveWorldState(baseEvents), 't5');
  const statusMixed = getTaskStatus(deriveWorldState(withSystem), 't5');

  assert.equal(statusBase, statusMixed);
});

test('system events do not affect metrics timing', () => {
  const base = [
    ev('TASK_CREATED', 't6', 1000, {}),
    ev('TASK_EXECUTE_STARTED', 't6', 2000, {}),
    ev('TASK_EXECUTE_FINISHED', 't6', 3000, {}),
    ev('TASK_ACKED', 't6', 3500, { status: 'completed' })
  ];
  const withSystem = [
    ...base,
    ev('TASK_NOTIFICATION_FAILED', 't6', 3600, { reason: 'send_failed' }),
    ev('TASK_NOTIFICATION_SKIPPED', 't6', 3700, {})
  ];

  const w1 = deriveWorldState(base);
  const w2 = deriveWorldState(withSystem);

  assert.equal(getQueueTime(w1, 't6'), getQueueTime(w2, 't6'));
  assert.equal(getExecutionDuration(w1, 't6'), getExecutionDuration(w2, 't6'));
  assert.equal(getAckLatency(w1, 't6'), getAckLatency(w2, 't6'));
});

test('getLifecycleEvents strips system events from mixed input', () => {
  const mixed = [
    ev('TASK_CREATED', 't7', 1, {}),
    ev('TASK_NOTIFICATION_SENT', 't7', 2, {}),
    ev('TASK_EXECUTE_STARTED', 't7', 3, {}),
    ev('TASK_NOTIFICATION_FAILED', 't7', 4, {}),
    ev('TASK_ACKED', 't7', 5, { status: 'completed' })
  ];
  const lifecycle = getLifecycleEvents(mixed);
  const hasSystem = lifecycle.some((e) => isSystemEvent(e && e.type));
  assert.equal(hasSystem, false);
});

test('task lifecycle events returned by getTaskEvents contain no system events', () => {
  const indexed = world(
    ev('TASK_CREATED', 't8', 1, {}),
    ev('TASK_NOTIFICATION_SKIPPED', 't8', 2, {}),
    ev('TASK_EXECUTE_STARTED', 't8', 3, {}),
    ev('TASK_NOTIFICATION_FAILED', 't8', 4, {}),
    ev('TASK_ACKED', 't8', 5, { status: 'completed' })
  );
  const events = getTaskEvents(indexed, 't8');
  const hasSystem = events.some((e) => isSystemEvent(e && e.type));
  assert.equal(hasSystem, false);
});

// ─── D. Anomaly isolation ─────────────────────────────────────────────────────

test('getIncidentClusters with includeSystemEvents=false does not include notification cluster', () => {
  const indexed = world(
    ev('TASK_CREATED', 't9', 1, {}),
    ev('TASK_EXECUTE_STARTED', 't9', 2, {}),
    ev('TASK_EXECUTE_FINISHED', 't9', 3, {}),
    ev('TASK_NOTIFICATION_FAILED', 't9', 4, { reason: 'send_failed' })
  );
  const clusters = getIncidentClusters(indexed, { includeSystemEvents: false });
  const types = new Set(clusters.map((c) => c.type));
  assert.equal(types.has('notification_issues'), false);
});

test('getIncidentClusters with includeSystemEvents=true includes notification cluster', () => {
  const indexed = world(
    ev('TASK_CREATED', 'ta', 1, {}),
    ev('TASK_EXECUTE_STARTED', 'ta', 2, {}),
    ev('TASK_EXECUTE_FINISHED', 'ta', 3, {}),
    ev('TASK_NOTIFICATION_FAILED', 'ta', 4, { reason: 'send_failed' })
  );
  const clusters = getIncidentClusters(indexed, {
    includeSystemEvents: true,
    thresholdMs: 1000,
    now: 100000
  });
  const types = new Set(clusters.map((c) => c.type));
  assert.equal(types.has('notification_issues'), true);
});
