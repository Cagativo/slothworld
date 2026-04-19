import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getTaskStatus,
  getTaskEvents,
  getLifecycleEvents,
  getTaskSnapshot,
  getTaskIds,
  getAllTasks,
  filterTasks,
  getTaskBuckets,
  getTaskById,
  getTaskTransitionTimestamps,
  getRecentEvents,
  isActiveTaskStatus
} from '../ui/selectors/taskSelectors.js';

import {
  getQueueTime,
  getExecutionDuration,
  getAckLatency,
  getTaskCounts
} from '../ui/selectors/metricsSelectors.js';

import {
  getStalledAckTasks,
  getExecutionMissingFinishTasks,
  getDuplicateAckTasks,
  getNotificationSkippedTasks,
  getNotificationFailedTasks,
  getNotificationSkipReason,
  getNotificationFailReason,
  getIncidentClusters
} from '../ui/selectors/anomalySelectors.js';

/**
 * Selector Purity Tests
 *
 * Verifies that selectors from taskSelectors, metricsSelectors and
 * anomalySelectors are pure functions:
 *   - same input → identical output
 *   - no mutation of input
 *   - no hidden external state dependency (world input is the sole source)
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _ts = 1_000_000;
const tick = (step = 100) => (_ts += step);

function makeEvent(type, taskId, extraPayload = {}) {
  return Object.freeze({ type, taskId, timestamp: tick(), payload: Object.freeze({ ...extraPayload }) });
}

const TASK_A = 'task-pure-a';
const TASK_B = 'task-pure-b';

/** Full lifecycle for TASK_A, partial for TASK_B. */
function buildWorld() {
  const aEvents = [
    makeEvent('TASK_CREATED', TASK_A),
    makeEvent('TASK_ENQUEUED', TASK_A),
    makeEvent('TASK_CLAIMED', TASK_A),
    makeEvent('TASK_EXECUTE_STARTED', TASK_A),
    makeEvent('TASK_EXECUTE_FINISHED', TASK_A),
    makeEvent('TASK_ACKED', TASK_A, { status: 'acknowledged', success: true })
  ];
  const bEvents = [
    makeEvent('TASK_CREATED', TASK_B),
    makeEvent('TASK_ENQUEUED', TASK_B)
  ];

  const allEvents = [...aEvents, ...bEvents];

  return Object.freeze({
    events: Object.freeze([...allEvents]),
    eventsByTaskId: new Map([
      [TASK_A, Object.freeze([...aEvents])],
      [TASK_B, Object.freeze([...bEvents])]
    ]),
    eventsByWorkerId: new Map()
  });
}

/** Deep-equal check using JSON round-trip (sufficient for plain data). */
function deepEqual(a, b) {
  assert.deepStrictEqual(a, b);
}

// ─── taskSelectors — idempotency ──────────────────────────────────────────────

test('Purity taskSelectors: getTaskStatus returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getTaskStatus(world, TASK_A), getTaskStatus(world, TASK_A));
  deepEqual(getTaskStatus(world, TASK_B), getTaskStatus(world, TASK_B));
});

test('Purity taskSelectors: getTaskEvents returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getTaskEvents(world, TASK_A), getTaskEvents(world, TASK_A));
});

test('Purity taskSelectors: getLifecycleEvents returns same value on repeated calls', () => {
  const world = buildWorld();
  const raw = Array.from(world.eventsByTaskId.get(TASK_A));
  deepEqual(getLifecycleEvents(raw), getLifecycleEvents(raw));
});

test('Purity taskSelectors: getTaskIds returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getTaskIds(world), getTaskIds(world));
});

test('Purity taskSelectors: getAllTasks returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getAllTasks(world), getAllTasks(world));
});

test('Purity taskSelectors: getTaskSnapshot returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getTaskSnapshot(world, TASK_A), getTaskSnapshot(world, TASK_A));
});

test('Purity taskSelectors: getTaskById returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getTaskById(world, TASK_A), getTaskById(world, TASK_A));
});

test('Purity taskSelectors: getTaskTransitionTimestamps returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getTaskTransitionTimestamps(world, TASK_A), getTaskTransitionTimestamps(world, TASK_A));
});

test('Purity taskSelectors: filterTasks returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(filterTasks(world, { status: 'queued' }), filterTasks(world, { status: 'queued' }));
});

test('Purity taskSelectors: getTaskBuckets returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getTaskBuckets(world), getTaskBuckets(world));
});

test('Purity taskSelectors: isActiveTaskStatus is referentially stable', () => {
  assert.equal(isActiveTaskStatus('claimed'), isActiveTaskStatus('claimed'));
  assert.equal(isActiveTaskStatus('idle'), isActiveTaskStatus('idle'));
});

// ─── metricsSelectors — idempotency ──────────────────────────────────────────

test('Purity metricsSelectors: getQueueTime returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getQueueTime(world, TASK_A), getQueueTime(world, TASK_A));
});

test('Purity metricsSelectors: getExecutionDuration returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getExecutionDuration(world, TASK_A), getExecutionDuration(world, TASK_A));
});

test('Purity metricsSelectors: getAckLatency returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getAckLatency(world, TASK_A), getAckLatency(world, TASK_A));
});

test('Purity metricsSelectors: getTaskCounts returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getTaskCounts(world), getTaskCounts(world));
});

// ─── anomalySelectors — idempotency ──────────────────────────────────────────

const FIXED_NOW = 9_999_999_999;

test('Purity anomalySelectors: getStalledAckTasks returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getStalledAckTasks(world, 15000, FIXED_NOW), getStalledAckTasks(world, 15000, FIXED_NOW));
});

test('Purity anomalySelectors: getExecutionMissingFinishTasks returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getExecutionMissingFinishTasks(world), getExecutionMissingFinishTasks(world));
});

test('Purity anomalySelectors: getDuplicateAckTasks returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getDuplicateAckTasks(world), getDuplicateAckTasks(world));
});

test('Purity anomalySelectors: getNotificationSkippedTasks returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getNotificationSkippedTasks(world), getNotificationSkippedTasks(world));
});

test('Purity anomalySelectors: getNotificationFailedTasks returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getNotificationFailedTasks(world), getNotificationFailedTasks(world));
});

test('Purity anomalySelectors: getNotificationSkipReason returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getNotificationSkipReason(world, TASK_A), getNotificationSkipReason(world, TASK_A));
});

test('Purity anomalySelectors: getNotificationFailReason returns same value on repeated calls', () => {
  const world = buildWorld();
  deepEqual(getNotificationFailReason(world, TASK_A), getNotificationFailReason(world, TASK_A));
});

test('Purity anomalySelectors: getIncidentClusters returns same value on repeated calls', () => {
  const world = buildWorld();
  const opts = { now: FIXED_NOW, includeSystemEvents: false };
  deepEqual(getIncidentClusters(world, opts), getIncidentClusters(world, opts));
});

// ─── No mutation of input ─────────────────────────────────────────────────────

test('Purity: selectors do not mutate the events array in eventsByTaskId', () => {
  const world = buildWorld();
  const eventsBefore = JSON.stringify(Array.from(world.eventsByTaskId.get(TASK_A)));

  getTaskStatus(world, TASK_A);
  getTaskEvents(world, TASK_A);
  getTaskSnapshot(world, TASK_A);
  getTaskTransitionTimestamps(world, TASK_A);
  getQueueTime(world, TASK_A);
  getExecutionDuration(world, TASK_A);
  getAckLatency(world, TASK_A);

  const eventsAfter = JSON.stringify(Array.from(world.eventsByTaskId.get(TASK_A)));
  assert.equal(eventsAfter, eventsBefore, 'eventsByTaskId entries must not be mutated by selectors');
});

test('Purity: selectors do not mutate the top-level events array', () => {
  const world = buildWorld();
  const before = JSON.stringify(world.events);

  getAllTasks(world);
  getTaskIds(world);
  getTaskCounts(world);
  getExecutionMissingFinishTasks(world);
  getDuplicateAckTasks(world);
  getIncidentClusters(world, { now: FIXED_NOW, includeSystemEvents: false });

  const after = JSON.stringify(world.events);
  assert.equal(after, before, 'world.events must not be mutated by selectors');
});

test('Purity: selectors do not mutate the eventsByWorkerId map', () => {
  const world = buildWorld();
  const keysBefore = Array.from(world.eventsByWorkerId.keys()).join(',');

  getTaskIds(world);
  getAllTasks(world);
  getTaskCounts(world);

  const keysAfter = Array.from(world.eventsByWorkerId.keys()).join(',');
  assert.equal(keysAfter, keysBefore, 'eventsByWorkerId must not be mutated by selectors');
});

// ─── Isolation from unrelated world changes ───────────────────────────────────

test('Purity: selector result for TASK_A is unaffected by changes to TASK_B events', () => {
  const worldOriginal = buildWorld();
  const statusBefore = getTaskStatus(worldOriginal, TASK_A);
  const countsBefore = getTaskCounts(worldOriginal);

  // Build a new world where TASK_B has progressed further — TASK_A is unchanged.
  const aEvents = Array.from(worldOriginal.eventsByTaskId.get(TASK_A));
  const bEventsExtended = [
    ...Array.from(worldOriginal.eventsByTaskId.get(TASK_B)),
    makeEvent('TASK_CLAIMED', TASK_B),
    makeEvent('TASK_EXECUTE_STARTED', TASK_B)
  ];
  const worldUpdated = {
    events: [...aEvents, ...bEventsExtended],
    eventsByTaskId: new Map([
      [TASK_A, aEvents],
      [TASK_B, bEventsExtended]
    ]),
    eventsByWorkerId: new Map()
  };

  const statusAfter = getTaskStatus(worldUpdated, TASK_A);
  assert.equal(statusAfter, statusBefore, 'TASK_A status must be unaffected by changes to TASK_B');

  // Counts will change (TASK_B moved) but TASK_A's contribution is stable.
  const countsDoneAfter = getTaskCounts(worldUpdated).done;
  assert.equal(countsDoneAfter, countsBefore.done, 'done count must not change when only TASK_B progresses');
});
