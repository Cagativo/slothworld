import test from 'node:test';
import assert from 'node:assert/strict';

import { getIncidentClusters } from '../ui/selectors/anomalySelectors.js';
import { getTaskStatus } from '../ui/selectors/taskSelectors.js';

/**
 * getIncidentClusters Output-Contract Tests
 *
 * Verifies:
 *   - Cluster schema: type, severity, taskIds, summary, representativeEvents
 *   - Correct cluster types and fixed set
 *   - Severity values are within the allowed vocabulary
 *   - representativeEvents contains only canonical lifecycle events (no status inference)
 *   - Clusters do not mutate the world or alter lifecycle state
 */

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let _ts = 1000;
const tick = (step = 100) => (_ts += step);

function makeEvent(type, taskId, extraPayload = {}) {
  return { type, taskId, timestamp: tick(), payload: { ...extraPayload } };
}

function buildWorld(taskMap) {
  const allEvents = Array.from(taskMap.values()).flat();
  return {
    events: allEvents,
    eventsByTaskId: new Map(taskMap),
    eventsByWorkerId: new Map()
  };
}

// A task that was acknowledged as failed.
const TASK_FAIL = 'task-fail-1';
const failEvents = [
  makeEvent('TASK_CREATED',          TASK_FAIL),
  makeEvent('TASK_ENQUEUED',         TASK_FAIL),
  makeEvent('TASK_CLAIMED',          TASK_FAIL),
  makeEvent('TASK_EXECUTE_STARTED',  TASK_FAIL),
  makeEvent('TASK_EXECUTE_FINISHED', TASK_FAIL),
  makeEvent('TASK_ACKED',            TASK_FAIL, { status: 'failed', error: 'timeout' })
];

// A task that completed successfully.
const TASK_OK = 'task-ok-1';
const okEvents = [
  makeEvent('TASK_CREATED',          TASK_OK),
  makeEvent('TASK_ENQUEUED',         TASK_OK),
  makeEvent('TASK_CLAIMED',          TASK_OK),
  makeEvent('TASK_EXECUTE_STARTED',  TASK_OK),
  makeEvent('TASK_EXECUTE_FINISHED', TASK_OK),
  makeEvent('TASK_ACKED',            TASK_OK, { status: 'acknowledged' })
];

// A task that is stalled — has EXECUTE_FINISHED but no ACKED, and is old.
const TASK_STALL = 'task-stall-1';
const STALL_FINISH_TS = 100; // very old timestamp
const stallEvents = [
  { type: 'TASK_CREATED',          taskId: TASK_STALL, timestamp: 10,  payload: {} },
  { type: 'TASK_ENQUEUED',         taskId: TASK_STALL, timestamp: 20,  payload: {} },
  { type: 'TASK_CLAIMED',          taskId: TASK_STALL, timestamp: 30,  payload: {} },
  { type: 'TASK_EXECUTE_STARTED',  taskId: TASK_STALL, timestamp: 40,  payload: {} },
  { type: 'TASK_EXECUTE_FINISHED', taskId: TASK_STALL, timestamp: STALL_FINISH_TS, payload: {} }
];

const FIXED_NOW = 99_999_999; // far in the future so stalled task is always over threshold

const worldWithAll = buildWorld(new Map([
  [TASK_FAIL,  failEvents],
  [TASK_OK,    okEvents],
  [TASK_STALL, stallEvents]
]));

const worldClean = buildWorld(new Map([
  [TASK_OK, okEvents]
]));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALLOWED_SEVERITY = new Set(['high', 'medium', 'low']);
const ALLOWED_TYPES    = new Set(['execution_failures', 'notification_issues', 'stalled_tasks']);

function assertClusterSchema(cluster, label) {
  assert.ok(typeof cluster.type === 'string',
    `${label}: cluster.type must be a string`);
  assert.ok(ALLOWED_TYPES.has(cluster.type),
    `${label}: cluster.type "${cluster.type}" is not in the allowed set`);

  assert.ok(typeof cluster.severity === 'string',
    `${label}: cluster.severity must be a string`);
  assert.ok(ALLOWED_SEVERITY.has(cluster.severity),
    `${label}: cluster.severity "${cluster.severity}" is not in the allowed vocabulary`);

  assert.ok(Array.isArray(cluster.taskIds),
    `${label}: cluster.taskIds must be an array`);
  for (const id of cluster.taskIds) {
    assert.ok(typeof id === 'string',
      `${label}: every entry in taskIds must be a string, got ${typeof id}`);
  }

  assert.ok(typeof cluster.summary === 'string' && cluster.summary.length > 0,
    `${label}: cluster.summary must be a non-empty string`);

  assert.ok(Array.isArray(cluster.representativeEvents),
    `${label}: cluster.representativeEvents must be an array`);
}

// ─── Schema contract ──────────────────────────────────────────────────────────

test('getIncidentClusters: every cluster has the required schema fields', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: false });
  assert.ok(clusters.length > 0, 'Must return at least one cluster');
  for (const cluster of clusters) {
    assertClusterSchema(cluster, cluster.type);
  }
});

test('getIncidentClusters: with includeSystemEvents false, returns exactly two clusters', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: false });
  assert.equal(clusters.length, 2,
    'Must return exactly 2 clusters when includeSystemEvents is false');
});

test('getIncidentClusters: with includeSystemEvents true, returns exactly three clusters', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: true });
  assert.equal(clusters.length, 3,
    'Must return exactly 3 clusters when includeSystemEvents is true');
});

test('getIncidentClusters: cluster types are exactly the canonical set (no extras, no missing)', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: true });
  const types = clusters.map((c) => c.type).sort();
  assert.deepStrictEqual(
    types,
    ['execution_failures', 'notification_issues', 'stalled_tasks'],
    'Cluster types must be exactly the three canonical types'
  );
});

test('getIncidentClusters: without includeSystemEvents, notification_issues cluster is absent', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: false });
  assert.ok(
    !clusters.some((c) => c.type === 'notification_issues'),
    'notification_issues must not appear when includeSystemEvents is false'
  );
});

// ─── severity field contract ──────────────────────────────────────────────────

test('getIncidentClusters: execution_failures severity is "high" when failed tasks exist', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: false });
  const cluster = clusters.find((c) => c.type === 'execution_failures');
  assert.equal(cluster.severity, 'high',
    'execution_failures must be "high" severity when at least one task failed');
});

test('getIncidentClusters: execution_failures severity is "low" when no failed tasks exist', () => {
  const clusters = getIncidentClusters(worldClean, { now: FIXED_NOW, includeSystemEvents: false });
  const cluster = clusters.find((c) => c.type === 'execution_failures');
  assert.equal(cluster.severity, 'low',
    'execution_failures must be "low" severity when no tasks failed');
});

test('getIncidentClusters: stalled_tasks severity is "medium" when stalled tasks exist', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: false });
  const cluster = clusters.find((c) => c.type === 'stalled_tasks');
  assert.equal(cluster.severity, 'medium',
    'stalled_tasks must be "medium" severity when at least one task is stalled');
});

test('getIncidentClusters: stalled_tasks severity is "low" when no stalled tasks exist', () => {
  const clusters = getIncidentClusters(worldClean, { now: FIXED_NOW, includeSystemEvents: false });
  const cluster = clusters.find((c) => c.type === 'stalled_tasks');
  assert.equal(cluster.severity, 'low',
    'stalled_tasks must be "low" severity when no tasks are stalled');
});

// ─── taskIds field contract ───────────────────────────────────────────────────

test('getIncidentClusters: execution_failures taskIds contains the failed task', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: false });
  const cluster = clusters.find((c) => c.type === 'execution_failures');
  assert.ok(cluster.taskIds.includes(TASK_FAIL),
    'execution_failures taskIds must include the task acknowledged as failed');
});

test('getIncidentClusters: execution_failures taskIds does not include a successfully completed task', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: false });
  const cluster = clusters.find((c) => c.type === 'execution_failures');
  assert.ok(!cluster.taskIds.includes(TASK_OK),
    'execution_failures taskIds must not include a successfully completed task');
});

test('getIncidentClusters: stalled_tasks taskIds contains the stalled task', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: false });
  const cluster = clusters.find((c) => c.type === 'stalled_tasks');
  assert.ok(cluster.taskIds.includes(TASK_STALL),
    'stalled_tasks taskIds must include the task that is stalled waiting for ACK');
});

test('getIncidentClusters: taskIds entries are all strings', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: true });
  for (const cluster of clusters) {
    for (const id of cluster.taskIds) {
      assert.equal(typeof id, 'string',
        `taskIds entry in "${cluster.type}" must be a string, got ${typeof id}`);
    }
  }
});

// ─── summary field contract ───────────────────────────────────────────────────

test('getIncidentClusters: summary is non-empty string for every cluster', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: true });
  for (const cluster of clusters) {
    assert.ok(typeof cluster.summary === 'string' && cluster.summary.trim().length > 0,
      `"${cluster.type}" summary must be a non-empty string`);
  }
});

test('getIncidentClusters: summary reflects detected count for execution_failures', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: false });
  const cluster = clusters.find((c) => c.type === 'execution_failures');
  assert.ok(cluster.summary.includes('1'),
    'execution_failures summary must mention the count of failed tasks');
});

test('getIncidentClusters: summary is a "none detected" message when no anomaly exists', () => {
  const clusters = getIncidentClusters(worldClean, { now: FIXED_NOW, includeSystemEvents: false });
  const ef = clusters.find((c) => c.type === 'execution_failures');
  const st = clusters.find((c) => c.type === 'stalled_tasks');
  assert.ok(ef.summary.length > 0, 'execution_failures summary must still be set when empty');
  assert.ok(st.summary.length > 0, 'stalled_tasks summary must still be set when empty');
  // Summaries must not claim a count they don't have.
  assert.ok(!ef.summary.includes('1'), 'execution_failures summary must not claim count when empty');
});

// ─── representativeEvents field contract ──────────────────────────────────────

test('getIncidentClusters: representativeEvents is an array for every cluster', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: true });
  for (const cluster of clusters) {
    assert.ok(Array.isArray(cluster.representativeEvents),
      `"${cluster.type}" representativeEvents must be an array`);
  }
});

test('getIncidentClusters: representativeEvents contains at most 5 entries per cluster', () => {
  // Build a world with 10 failed tasks to exercise the cap.
  const taskMap = new Map();
  for (let i = 0; i < 10; i++) {
    const id = `task-fail-many-${i}`;
    taskMap.set(id, [
      { type: 'TASK_CREATED',          taskId: id, timestamp: i * 10 + 1,  payload: {} },
      { type: 'TASK_ENQUEUED',         taskId: id, timestamp: i * 10 + 2,  payload: {} },
      { type: 'TASK_CLAIMED',          taskId: id, timestamp: i * 10 + 3,  payload: {} },
      { type: 'TASK_EXECUTE_STARTED',  taskId: id, timestamp: i * 10 + 4,  payload: {} },
      { type: 'TASK_EXECUTE_FINISHED', taskId: id, timestamp: i * 10 + 5,  payload: {} },
      { type: 'TASK_ACKED',            taskId: id, timestamp: i * 10 + 6,  payload: { status: 'failed' } }
    ]);
  }
  const world = buildWorld(taskMap);
  const clusters = getIncidentClusters(world, { now: FIXED_NOW, includeSystemEvents: false });
  const ef = clusters.find((c) => c.type === 'execution_failures');
  assert.ok(ef.representativeEvents.length <= 5,
    'representativeEvents must contain at most 5 entries');
});

test('getIncidentClusters: representativeEvents are sorted descending by timestamp', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: false });
  for (const cluster of clusters) {
    const events = cluster.representativeEvents;
    if (events.length < 2) continue;
    for (let i = 1; i < events.length; i++) {
      assert.ok(
        (events[i - 1].timestamp || 0) >= (events[i].timestamp || 0),
        `"${cluster.type}" representativeEvents must be sorted descending by timestamp`
      );
    }
  }
});

test('getIncidentClusters: execution_failures representativeEvents contain only TASK_ACKED events', () => {
  const clusters = getIncidentClusters(worldWithAll, { now: FIXED_NOW, includeSystemEvents: false });
  const ef = clusters.find((c) => c.type === 'execution_failures');
  for (const event of ef.representativeEvents) {
    assert.equal(event.type, 'TASK_ACKED',
      'execution_failures representativeEvents must only contain TASK_ACKED events');
  }
});

test('getIncidentClusters: representativeEvents for empty cluster is an empty array', () => {
  const clusters = getIncidentClusters(worldClean, { now: FIXED_NOW, includeSystemEvents: false });
  const ef = clusters.find((c) => c.type === 'execution_failures');
  assert.deepStrictEqual(ef.representativeEvents, [],
    'representativeEvents must be [] when the cluster has no matching tasks');
});

// ─── Clusters do not modify lifecycle state ───────────────────────────────────

test('getIncidentClusters: does not mutate world.events', () => {
  const world = buildWorld(new Map([
    [TASK_FAIL,  [...failEvents]],
    [TASK_OK,    [...okEvents]],
    [TASK_STALL, [...stallEvents]]
  ]));
  const eventsBefore = JSON.stringify(world.events);

  getIncidentClusters(world, { now: FIXED_NOW, includeSystemEvents: true });

  assert.equal(JSON.stringify(world.events), eventsBefore,
    'world.events must not be mutated by getIncidentClusters');
});

test('getIncidentClusters: does not mutate eventsByTaskId entries', () => {
  const world = buildWorld(new Map([
    [TASK_FAIL,  [...failEvents]],
    [TASK_OK,    [...okEvents]],
    [TASK_STALL, [...stallEvents]]
  ]));
  const before = new Map(
    Array.from(world.eventsByTaskId.entries()).map(([k, v]) => [k, JSON.stringify(v)])
  );

  getIncidentClusters(world, { now: FIXED_NOW, includeSystemEvents: true });

  for (const [taskId, snapshot] of before) {
    assert.equal(
      JSON.stringify(world.eventsByTaskId.get(taskId)),
      snapshot,
      `eventsByTaskId[${taskId}] must not be mutated by getIncidentClusters`
    );
  }
});

test('getIncidentClusters: calling it does not change getTaskStatus for any task', () => {
  const world = buildWorld(new Map([
    [TASK_FAIL,  [...failEvents]],
    [TASK_OK,    [...okEvents]],
    [TASK_STALL, [...stallEvents]]
  ]));

  const statusBefore = {
    [TASK_FAIL]:  getTaskStatus(world, TASK_FAIL),
    [TASK_OK]:    getTaskStatus(world, TASK_OK),
    [TASK_STALL]: getTaskStatus(world, TASK_STALL)
  };

  getIncidentClusters(world, { now: FIXED_NOW, includeSystemEvents: true });

  assert.equal(getTaskStatus(world, TASK_FAIL),  statusBefore[TASK_FAIL],
    'TASK_FAIL lifecycle status must be unchanged after getIncidentClusters');
  assert.equal(getTaskStatus(world, TASK_OK),    statusBefore[TASK_OK],
    'TASK_OK lifecycle status must be unchanged after getIncidentClusters');
  assert.equal(getTaskStatus(world, TASK_STALL), statusBefore[TASK_STALL],
    'TASK_STALL lifecycle status must be unchanged after getIncidentClusters');
});

test('getIncidentClusters: result object fields are not live references into the world', () => {
  const world = buildWorld(new Map([
    [TASK_FAIL, [...failEvents]]
  ]));

  const clusters = getIncidentClusters(world, { now: FIXED_NOW, includeSystemEvents: false });
  const ef = clusters.find((c) => c.type === 'execution_failures');

  // Push a new task id into the returned taskIds array and verify the world is unaffected.
  const lengthBefore = world.eventsByTaskId.size;
  ef.taskIds.push('injected-id');

  assert.equal(world.eventsByTaskId.size, lengthBefore,
    'Mutating cluster.taskIds must not affect the world\'s eventsByTaskId');
});
