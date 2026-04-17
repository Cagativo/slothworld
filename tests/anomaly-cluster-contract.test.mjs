/**
 * Anomaly Cluster Contract
 *
 * Architecture gate: validates getIncidentClusters output shape,
 * determinism, and system-event inclusion rules.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorldState } from '../core/world/deriveWorldState.js';
import { getIncidentClusters } from '../ui/selectors/anomalySelectors.js';

const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);

function ev(type, taskId, timestamp, payload = {}) {
  return { type, taskId, timestamp, payload };
}

function world(...events) {
  return deriveWorldState(events);
}

// ─── A. Output shape ──────────────────────────────────────────────────────────

test('getIncidentClusters returns an array', () => {
  const indexed = world(ev('TASK_CREATED', 't1', 1, {}));
  const clusters = getIncidentClusters(indexed);
  assert.ok(Array.isArray(clusters));
});

test('each cluster has required fields: type, severity, taskIds, summary, representativeEvents', () => {
  const indexed = world(
    ev('TASK_CREATED', 't2', 1, {}),
    ev('TASK_EXECUTE_STARTED', 't2', 2, {}),
    ev('TASK_EXECUTE_FINISHED', 't2', 3, {}),
    ev('TASK_ACKED', 't2', 4, { status: 'failed' })
  );
  const clusters = getIncidentClusters(indexed, { includeSystemEvents: true, now: 100000 });
  assert.ok(clusters.length > 0);
  for (const cluster of clusters) {
    assert.equal(typeof cluster.type, 'string', 'type must be string');
    assert.ok(cluster.type.length > 0, 'type must not be empty');
    assert.ok(VALID_SEVERITIES.has(cluster.severity), `severity must be low|medium|high, got: ${cluster.severity}`);
    assert.ok(Array.isArray(cluster.taskIds), 'taskIds must be array');
    assert.equal(typeof cluster.summary, 'string', 'summary must be string');
    assert.ok(cluster.summary.length > 0, 'summary must not be empty');
    assert.ok(Array.isArray(cluster.representativeEvents), 'representativeEvents must be array');
  }
});

test('cluster type is always a non-empty string', () => {
  const indexed = world(ev('TASK_CREATED', 't3', 1, {}));
  const clusters = getIncidentClusters(indexed);
  for (const cluster of clusters) {
    assert.equal(typeof cluster.type, 'string');
    assert.ok(cluster.type.trim().length > 0);
  }
});

test('cluster severity is always low, medium, or high', () => {
  const indexed = world(
    ev('TASK_CREATED', 't4', 1, {}),
    ev('TASK_EXECUTE_STARTED', 't4', 2, {}),
    ev('TASK_EXECUTE_FINISHED', 't4', 3, {}),
    ev('TASK_ACKED', 't4', 4, { status: 'failed' })
  );
  const clusters = getIncidentClusters(indexed, { includeSystemEvents: true, now: 100000 });
  for (const cluster of clusters) {
    assert.ok(
      VALID_SEVERITIES.has(cluster.severity),
      `Expected low|medium|high but got: ${cluster.severity}`
    );
  }
});

test('cluster taskIds is always an array', () => {
  const indexed = world(ev('TASK_CREATED', 't5', 1, {}));
  const clusters = getIncidentClusters(indexed);
  for (const cluster of clusters) {
    assert.ok(Array.isArray(cluster.taskIds));
  }
});

test('cluster representativeEvents is always an array', () => {
  const indexed = world(ev('TASK_CREATED', 't6', 1, {}));
  const clusters = getIncidentClusters(indexed);
  for (const cluster of clusters) {
    assert.ok(Array.isArray(cluster.representativeEvents));
  }
});

// ─── B. Determinism ───────────────────────────────────────────────────────────

test('same events produce identical cluster output on repeated calls', () => {
  const events = [
    ev('TASK_CREATED', 't7', 1000, {}),
    ev('TASK_EXECUTE_STARTED', 't7', 1500, {}),
    ev('TASK_EXECUTE_FINISHED', 't7', 2000, {}),
    ev('TASK_ACKED', 't7', 2100, { status: 'failed' }),
    ev('TASK_NOTIFICATION_FAILED', 't7', 2200, { reason: 'send_failed' })
  ];
  const options = { includeSystemEvents: true, thresholdMs: 1000, now: 100000 };

  const run1 = getIncidentClusters(deriveWorldState(events), options);
  const run2 = getIncidentClusters(deriveWorldState(events), options);

  assert.equal(run1.length, run2.length);
  for (let i = 0; i < run1.length; i++) {
    assert.equal(run1[i].type, run2[i].type);
    assert.equal(run1[i].severity, run2[i].severity);
    assert.deepEqual(run1[i].taskIds, run2[i].taskIds);
    assert.equal(run1[i].summary, run2[i].summary);
  }
});

// ─── C. System event inclusion rules ─────────────────────────────────────────

test('includeSystemEvents=false does not include notification_issues cluster', () => {
  const indexed = world(
    ev('TASK_CREATED', 't8', 1, {}),
    ev('TASK_EXECUTE_STARTED', 't8', 2, {}),
    ev('TASK_EXECUTE_FINISHED', 't8', 3, {}),
    ev('TASK_NOTIFICATION_SKIPPED', 't8', 4, { reason: 'missing_channelId' }),
    ev('TASK_NOTIFICATION_FAILED', 't8', 5, { reason: 'send_failed' })
  );
  const clusters = getIncidentClusters(indexed, { includeSystemEvents: false, now: 100000 });
  const types = new Set(clusters.map((c) => c.type));
  assert.equal(types.has('notification_issues'), false);
});

test('includeSystemEvents=true includes notification_issues cluster when notification events exist', () => {
  const indexed = world(
    ev('TASK_CREATED', 't9', 1, {}),
    ev('TASK_EXECUTE_STARTED', 't9', 2, {}),
    ev('TASK_EXECUTE_FINISHED', 't9', 3, {}),
    ev('TASK_NOTIFICATION_FAILED', 't9', 4, { reason: 'send_failed' })
  );
  const clusters = getIncidentClusters(indexed, {
    includeSystemEvents: true,
    thresholdMs: 1000,
    now: 100000
  });
  const types = new Set(clusters.map((c) => c.type));
  assert.equal(types.has('notification_issues'), true);
});

test('notification_issues cluster includes affected taskIds', () => {
  const indexed = world(
    ev('TASK_CREATED', 'ta', 1, {}),
    ev('TASK_EXECUTE_STARTED', 'ta', 2, {}),
    ev('TASK_EXECUTE_FINISHED', 'ta', 3, {}),
    ev('TASK_NOTIFICATION_SKIPPED', 'ta', 4, { reason: 'client_not_configured' })
  );
  const clusters = getIncidentClusters(indexed, {
    includeSystemEvents: true,
    thresholdMs: 1000,
    now: 100000
  });
  const notifCluster = clusters.find((c) => c.type === 'notification_issues');
  assert.ok(notifCluster, 'notification_issues cluster must exist');
  assert.ok(notifCluster.taskIds.includes('ta'), 'ta must appear in taskIds');
});

test('execution_failures cluster is present in both inclusion modes', () => {
  const indexed = world(
    ev('TASK_CREATED', 'tb', 1, {}),
    ev('TASK_EXECUTE_STARTED', 'tb', 2, {}),
    ev('TASK_EXECUTE_FINISHED', 'tb', 3, {}),
    ev('TASK_ACKED', 'tb', 4, { status: 'failed' })
  );
  const withSystem = getIncidentClusters(indexed, { includeSystemEvents: true, now: 100000 });
  const withoutSystem = getIncidentClusters(indexed, { includeSystemEvents: false, now: 100000 });

  const wsWith = new Set(withSystem.map((c) => c.type));
  const wsWithout = new Set(withoutSystem.map((c) => c.type));

  assert.equal(wsWith.has('execution_failures'), true);
  assert.equal(wsWithout.has('execution_failures'), true);
});
