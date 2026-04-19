import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getQueueTime,
  getExecutionDuration,
  getAckLatency,
  getTaskCounts
} from '../ui/selectors/metricsSelectors.js';

/**
 * metricsSelectors Aggregation Tests
 *
 * Verifies that metrics selectors:
 *   - aggregate only lifecycle-safe data (timestamp deltas from canonical events)
 *   - do not infer task status from payloads or external state
 *   - do not interpret system events semantically
 *   - produce deterministic results from the same input
 */

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const T_CREATED          = 1000;
const T_ENQUEUED         = 1100;
const T_CLAIMED          = 1200;
const T_EXECUTE_STARTED  = 1500;
const T_EXECUTE_FINISHED = 2000;
const T_ACKED            = 2200;

const TASK_ID = 'metrics-test-task';

function makeEvent(type, timestamp, payload = {}) {
  return Object.freeze({ type, taskId: TASK_ID, timestamp, payload: Object.freeze(payload) });
}

const LIFECYCLE_EVENTS = Object.freeze([
  makeEvent('TASK_CREATED',          T_CREATED),
  makeEvent('TASK_ENQUEUED',         T_ENQUEUED),
  makeEvent('TASK_CLAIMED',          T_CLAIMED),
  makeEvent('TASK_EXECUTE_STARTED',  T_EXECUTE_STARTED),
  makeEvent('TASK_EXECUTE_FINISHED', T_EXECUTE_FINISHED),
  makeEvent('TASK_ACKED',            T_ACKED, { status: 'acknowledged' })
]);

const SYSTEM_EVENTS = Object.freeze([
  makeEvent('TASK_NOTIFICATION_SENT',    T_CREATED    + 50),
  makeEvent('TASK_NOTIFICATION_SKIPPED', T_ENQUEUED   + 50),
  makeEvent('TASK_NOTIFICATION_FAILED',  T_CLAIMED    + 50)
]);

function buildWorld(taskId, events) {
  return {
    events: [...events],
    eventsByTaskId: new Map([[taskId, [...events]]]),
    eventsByWorkerId: new Map()
  };
}

/** World with the full lifecycle and no system events. */
const cleanWorld = buildWorld(TASK_ID, LIFECYCLE_EVENTS);

/** World with system events interleaved throughout. */
const mixedWorld = buildWorld(TASK_ID, [
  ...LIFECYCLE_EVENTS,
  ...SYSTEM_EVENTS
]);

// ─── getQueueTime ─────────────────────────────────────────────────────────────

test('getQueueTime: returns EXECUTE_STARTED minus CREATED timestamp', () => {
  const result = getQueueTime(cleanWorld, TASK_ID);
  assert.equal(result, T_EXECUTE_STARTED - T_CREATED,
    'Queue time must equal the delta between EXECUTE_STARTED and CREATED timestamps');
});

test('getQueueTime: returns null when EXECUTE_STARTED is absent', () => {
  const partial = buildWorld(TASK_ID, [
    makeEvent('TASK_CREATED',  T_CREATED),
    makeEvent('TASK_ENQUEUED', T_ENQUEUED)
  ]);
  assert.equal(getQueueTime(partial, TASK_ID), null,
    'Queue time must be null when EXECUTE_STARTED has not occurred');
});

test('getQueueTime: returns null when CREATED is absent', () => {
  const partial = buildWorld(TASK_ID, [
    makeEvent('TASK_EXECUTE_STARTED', T_EXECUTE_STARTED)
  ]);
  assert.equal(getQueueTime(partial, TASK_ID), null,
    'Queue time must be null when CREATED timestamp is unavailable');
});

test('getQueueTime: is unaffected by TASK_NOTIFICATION_SENT', () => {
  const world = buildWorld(TASK_ID, [
    ...LIFECYCLE_EVENTS,
    makeEvent('TASK_NOTIFICATION_SENT', T_CREATED + 50)
  ]);
  assert.equal(getQueueTime(world, TASK_ID), getQueueTime(cleanWorld, TASK_ID),
    'TASK_NOTIFICATION_SENT must not alter queue time');
});

test('getQueueTime: is unaffected by TASK_NOTIFICATION_FAILED', () => {
  const world = buildWorld(TASK_ID, [
    ...LIFECYCLE_EVENTS,
    makeEvent('TASK_NOTIFICATION_FAILED', T_CLAIMED + 50)
  ]);
  assert.equal(getQueueTime(world, TASK_ID), getQueueTime(cleanWorld, TASK_ID),
    'TASK_NOTIFICATION_FAILED must not alter queue time');
});

test('getQueueTime: is unaffected by all three system events combined', () => {
  assert.equal(getQueueTime(mixedWorld, TASK_ID), getQueueTime(cleanWorld, TASK_ID),
    'Any combination of system events must not alter queue time');
});

// ─── getExecutionDuration ─────────────────────────────────────────────────────

test('getExecutionDuration: returns EXECUTE_FINISHED minus EXECUTE_STARTED timestamp', () => {
  const result = getExecutionDuration(cleanWorld, TASK_ID);
  assert.equal(result, T_EXECUTE_FINISHED - T_EXECUTE_STARTED,
    'Execution duration must equal the delta between EXECUTE_FINISHED and EXECUTE_STARTED');
});

test('getExecutionDuration: returns null when EXECUTE_STARTED is absent', () => {
  const partial = buildWorld(TASK_ID, [
    makeEvent('TASK_CREATED',          T_CREATED),
    makeEvent('TASK_EXECUTE_FINISHED', T_EXECUTE_FINISHED)
  ]);
  assert.equal(getExecutionDuration(partial, TASK_ID), null,
    'Execution duration must be null without EXECUTE_STARTED');
});

test('getExecutionDuration: returns null when EXECUTE_FINISHED is absent', () => {
  const partial = buildWorld(TASK_ID, [
    makeEvent('TASK_CREATED',         T_CREATED),
    makeEvent('TASK_EXECUTE_STARTED', T_EXECUTE_STARTED)
  ]);
  assert.equal(getExecutionDuration(partial, TASK_ID), null,
    'Execution duration must be null without EXECUTE_FINISHED');
});

test('getExecutionDuration: is unaffected by TASK_NOTIFICATION_SENT', () => {
  const world = buildWorld(TASK_ID, [
    ...LIFECYCLE_EVENTS,
    makeEvent('TASK_NOTIFICATION_SENT', T_EXECUTE_STARTED + 50)
  ]);
  assert.equal(getExecutionDuration(world, TASK_ID), getExecutionDuration(cleanWorld, TASK_ID),
    'TASK_NOTIFICATION_SENT must not alter execution duration');
});

test('getExecutionDuration: is unaffected by TASK_NOTIFICATION_FAILED', () => {
  const world = buildWorld(TASK_ID, [
    ...LIFECYCLE_EVENTS,
    makeEvent('TASK_NOTIFICATION_FAILED', T_EXECUTE_STARTED + 50)
  ]);
  assert.equal(getExecutionDuration(world, TASK_ID), getExecutionDuration(cleanWorld, TASK_ID),
    'TASK_NOTIFICATION_FAILED must not alter execution duration');
});

test('getExecutionDuration: is unaffected by all three system events combined', () => {
  assert.equal(getExecutionDuration(mixedWorld, TASK_ID), getExecutionDuration(cleanWorld, TASK_ID),
    'Any combination of system events must not alter execution duration');
});

// ─── getAckLatency ────────────────────────────────────────────────────────────

test('getAckLatency: returns TASK_ACKED minus EXECUTE_FINISHED timestamp', () => {
  const result = getAckLatency(cleanWorld, TASK_ID);
  assert.equal(result, T_ACKED - T_EXECUTE_FINISHED,
    'Ack latency must equal the delta between TASK_ACKED and EXECUTE_FINISHED timestamps');
});

test('getAckLatency: returns null when TASK_ACKED is absent', () => {
  const partial = buildWorld(TASK_ID, [
    makeEvent('TASK_CREATED',          T_CREATED),
    makeEvent('TASK_EXECUTE_FINISHED', T_EXECUTE_FINISHED)
  ]);
  assert.equal(getAckLatency(partial, TASK_ID), null,
    'Ack latency must be null without TASK_ACKED');
});

test('getAckLatency: returns null when EXECUTE_FINISHED is absent', () => {
  const partial = buildWorld(TASK_ID, [
    makeEvent('TASK_CREATED', T_CREATED),
    makeEvent('TASK_ACKED',   T_ACKED, { status: 'acknowledged' })
  ]);
  assert.equal(getAckLatency(partial, TASK_ID), null,
    'Ack latency must be null without EXECUTE_FINISHED');
});

test('getAckLatency: is unaffected by TASK_NOTIFICATION_SENT', () => {
  const world = buildWorld(TASK_ID, [
    ...LIFECYCLE_EVENTS,
    makeEvent('TASK_NOTIFICATION_SENT', T_EXECUTE_FINISHED + 50)
  ]);
  assert.equal(getAckLatency(world, TASK_ID), getAckLatency(cleanWorld, TASK_ID),
    'TASK_NOTIFICATION_SENT must not alter ack latency');
});

test('getAckLatency: is unaffected by TASK_NOTIFICATION_FAILED', () => {
  const world = buildWorld(TASK_ID, [
    ...LIFECYCLE_EVENTS,
    makeEvent('TASK_NOTIFICATION_FAILED', T_EXECUTE_FINISHED + 50)
  ]);
  assert.equal(getAckLatency(world, TASK_ID), getAckLatency(cleanWorld, TASK_ID),
    'TASK_NOTIFICATION_FAILED must not alter ack latency');
});

test('getAckLatency: is unaffected by all three system events combined', () => {
  assert.equal(getAckLatency(mixedWorld, TASK_ID), getAckLatency(cleanWorld, TASK_ID),
    'Any combination of system events must not alter ack latency');
});

// ─── Metrics do not interpret TASK_ACKED payload semantics ───────────────────
// getQueueTime / getExecutionDuration / getAckLatency are timestamp-delta functions.
// They must return the same value regardless of what payload.status says —
// interpreting 'failed' vs 'acknowledged' is strictly status derivation territory.

test('getQueueTime: result is identical whether TASK_ACKED payload.status is "failed" or "acknowledged"', () => {
  const worldFailed = buildWorld(TASK_ID, [
    ...LIFECYCLE_EVENTS.slice(0, -1),
    makeEvent('TASK_ACKED', T_ACKED, { status: 'failed', error: 'timeout' })
  ]);
  assert.equal(getQueueTime(worldFailed, TASK_ID), getQueueTime(cleanWorld, TASK_ID),
    'getQueueTime must not vary based on TASK_ACKED payload.status');
});

test('getExecutionDuration: result is identical whether TASK_ACKED payload.status is "failed" or "acknowledged"', () => {
  const worldFailed = buildWorld(TASK_ID, [
    ...LIFECYCLE_EVENTS.slice(0, -1),
    makeEvent('TASK_ACKED', T_ACKED, { status: 'failed', error: 'timeout' })
  ]);
  assert.equal(getExecutionDuration(worldFailed, TASK_ID), getExecutionDuration(cleanWorld, TASK_ID),
    'getExecutionDuration must not vary based on TASK_ACKED payload.status');
});

test('getAckLatency: result is identical whether TASK_ACKED payload.status is "failed" or "acknowledged"', () => {
  const worldFailed = buildWorld(TASK_ID, [
    ...LIFECYCLE_EVENTS.slice(0, -1),
    makeEvent('TASK_ACKED', T_ACKED, { status: 'failed', error: 'timeout' })
  ]);
  assert.equal(getAckLatency(worldFailed, TASK_ID), getAckLatency(cleanWorld, TASK_ID),
    'getAckLatency must not vary based on TASK_ACKED payload.status');
});

// ─── getTaskCounts ────────────────────────────────────────────────────────────

test('getTaskCounts: counts a fully-acked task in the "done" bucket', () => {
  const counts = getTaskCounts(cleanWorld);
  assert.equal(counts.done, 1, 'Completed task must be counted in the "done" bucket');
  assert.equal(counts.active, 0);
  assert.equal(counts.queued, 0);
  assert.equal(counts.failed, 0);
});

test('getTaskCounts: counts a queued task in the "queued" bucket', () => {
  const world = buildWorld(TASK_ID, [
    makeEvent('TASK_CREATED',  T_CREATED),
    makeEvent('TASK_ENQUEUED', T_ENQUEUED)
  ]);
  const counts = getTaskCounts(world);
  assert.equal(counts.queued, 1, 'Enqueued task must be counted in the "queued" bucket');
  assert.equal(counts.active, 0);
  assert.equal(counts.done,   0);
  assert.equal(counts.failed, 0);
});

test('getTaskCounts: counts an executing task in the "active" bucket', () => {
  const world = buildWorld(TASK_ID, [
    makeEvent('TASK_CREATED',         T_CREATED),
    makeEvent('TASK_ENQUEUED',        T_ENQUEUED),
    makeEvent('TASK_CLAIMED',         T_CLAIMED),
    makeEvent('TASK_EXECUTE_STARTED', T_EXECUTE_STARTED)
  ]);
  const counts = getTaskCounts(world);
  assert.equal(counts.active, 1, 'Executing task must be counted in the "active" bucket');
  assert.equal(counts.queued, 0);
  assert.equal(counts.done,   0);
  assert.equal(counts.failed, 0);
});

test('getTaskCounts: counts a failed task in the "failed" bucket', () => {
  const world = buildWorld(TASK_ID, [
    makeEvent('TASK_CREATED',          T_CREATED),
    makeEvent('TASK_ENQUEUED',         T_ENQUEUED),
    makeEvent('TASK_CLAIMED',          T_CLAIMED),
    makeEvent('TASK_EXECUTE_STARTED',  T_EXECUTE_STARTED),
    makeEvent('TASK_EXECUTE_FINISHED', T_EXECUTE_FINISHED),
    makeEvent('TASK_ACKED',            T_ACKED, { status: 'failed', error: 'timeout' })
  ]);
  const counts = getTaskCounts(world);
  assert.equal(counts.failed, 1, 'Failed task must be counted in the "failed" bucket');
  assert.equal(counts.active, 0);
  assert.equal(counts.queued, 0);
  assert.equal(counts.done,   0);
});

test('getTaskCounts: is unaffected by system events mixed into the world', () => {
  const countClean = getTaskCounts(cleanWorld);
  const countMixed = getTaskCounts(mixedWorld);
  assert.deepStrictEqual(countMixed, countClean,
    'System events must not alter task count buckets');
});

test('getTaskCounts: result keys are always queued, active, done, failed and nothing else', () => {
  const counts = getTaskCounts(cleanWorld);
  assert.deepStrictEqual(
    Object.keys(counts).sort(),
    ['active', 'done', 'failed', 'queued'],
    'getTaskCounts must only expose the four defined buckets'
  );
});

// ─── Deterministic aggregation ────────────────────────────────────────────────

test('Determinism: all metrics return identical values on repeated calls with the same world', () => {
  assert.equal(getQueueTime(cleanWorld, TASK_ID),        getQueueTime(cleanWorld, TASK_ID));
  assert.equal(getExecutionDuration(cleanWorld, TASK_ID), getExecutionDuration(cleanWorld, TASK_ID));
  assert.equal(getAckLatency(cleanWorld, TASK_ID),       getAckLatency(cleanWorld, TASK_ID));
  assert.deepStrictEqual(getTaskCounts(cleanWorld),      getTaskCounts(cleanWorld));
});

test('Determinism: event order within the same type does not affect timestamp-based metrics', () => {
  // A world where events arrive out of wall-clock order but canonical type order is intact.
  // Selectors use firstTimestamp(), which finds the first matching type — order of *types*
  // in the array is what matters, not the timestamp values being monotone.
  const world = buildWorld(TASK_ID, [
    makeEvent('TASK_CREATED',          100),
    makeEvent('TASK_ENQUEUED',         200),
    makeEvent('TASK_CLAIMED',          300),
    makeEvent('TASK_EXECUTE_STARTED',  400),
    makeEvent('TASK_EXECUTE_FINISHED', 500),
    makeEvent('TASK_ACKED',            600, { status: 'acknowledged' })
  ]);
  assert.equal(getQueueTime(world, TASK_ID),         400 - 100);
  assert.equal(getExecutionDuration(world, TASK_ID), 500 - 400);
  assert.equal(getAckLatency(world, TASK_ID),        600 - 500);
});
