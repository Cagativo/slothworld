/**
 * Selector Missing Contract Tests
 *
 * Covers lifecycle derivations not yet exercised in existing selector test files:
 * - getTaskById
 * - getTaskBuckets
 * - filterTasks (activeOnly, recentSeconds)
 * - getTaskCounts
 * - getTaskTransitionTimestamps
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorldState } from '../core/world/deriveWorldState.js';
import {
  getTaskById,
  getTaskBuckets,
  filterTasks,
  getTaskSnapshot,
  getTaskTransitionTimestamps
} from '../ui/selectors/taskSelectors.js';
import { getTaskCounts } from '../ui/selectors/metricsSelectors.js';

function ev(type, taskId, timestamp, payload = {}) {
  return { type, taskId, timestamp, payload };
}

function world(...events) {
  return deriveWorldState(events);
}

// ─── getTaskById ──────────────────────────────────────────────────────────────

test('getTaskById returns null for unknown task', () => {
  const indexed = world(ev('TASK_CREATED', 'task-a', 1000, { title: 'Alpha' }));
  const result = getTaskById(indexed, 'unknown-id');
  assert.equal(result, null);
});

test('getTaskById returns null for null or empty taskId', () => {
  const indexed = world(ev('TASK_CREATED', 'task-b', 1000, {}));
  assert.equal(getTaskById(indexed, null), null);
  assert.equal(getTaskById(indexed, ''), null);
  assert.equal(getTaskById(indexed, undefined), null);
});

test('getTaskById returns the correct task snapshot', () => {
  const indexed = world(
    ev('TASK_CREATED', 'task-c', 1000, { title: 'Charlie', type: 'discord' }),
    ev('TASK_ENQUEUED', 'task-c', 1100, {}),
    ev('TASK_EXECUTE_STARTED', 'task-c', 2000, {}),
    ev('TASK_EXECUTE_FINISHED', 'task-c', 3000, { success: true }),
    ev('TASK_ACKED', 'task-c', 3100, { status: 'completed' })
  );

  const task = getTaskById(indexed, 'task-c');
  assert.ok(task, 'task should be found');
  assert.equal(task.id, 'task-c');
  assert.equal(task.status, 'completed');
  assert.equal(task.title, 'Charlie');
  assert.equal(task.type, 'discord');
});

test('getTaskById returns a snapshot consistent with getTaskSnapshot', () => {
  const indexed = world(
    ev('TASK_CREATED', 'task-d', 1000, { title: 'Delta' }),
    ev('TASK_ACKED', 'task-d', 2000, { status: 'failed', error: 'timeout' })
  );

  const byId = getTaskById(indexed, 'task-d');
  const bySnapshot = getTaskSnapshot(indexed, 'task-d');

  assert.deepEqual(byId, bySnapshot, 'getTaskById and getTaskSnapshot should return identical results');
});

// ─── getTaskBuckets ───────────────────────────────────────────────────────────

test('getTaskBuckets returns queued, active, done, and failed buckets', () => {
  const buckets = getTaskBuckets(world());
  assert.ok(Array.isArray(buckets.queued), 'queued should be an array');
  assert.ok(Array.isArray(buckets.active), 'active should be an array');
  assert.ok(Array.isArray(buckets.done), 'done should be an array');
  assert.ok(Array.isArray(buckets.failed), 'failed should be an array');
});

test('getTaskBuckets places completed task in done bucket', () => {
  const indexed = world(
    ev('TASK_CREATED', 'bucket-done', 1000, {}),
    ev('TASK_EXECUTE_STARTED', 'bucket-done', 2000, {}),
    ev('TASK_EXECUTE_FINISHED', 'bucket-done', 3000, { success: true }),
    ev('TASK_ACKED', 'bucket-done', 3100, { status: 'completed' })
  );

  const buckets = getTaskBuckets(indexed);
  const taskInDone = buckets.done.find((t) => t.id === 'bucket-done');
  assert.ok(taskInDone, 'completed task should appear in done bucket');
  assert.equal(buckets.failed.find((t) => t.id === 'bucket-done'), undefined, 'completed task must not appear in failed');
});

test('getTaskBuckets places failed task in failed bucket', () => {
  const indexed = world(
    ev('TASK_CREATED', 'bucket-fail', 1000, {}),
    ev('TASK_EXECUTE_STARTED', 'bucket-fail', 2000, {}),
    ev('TASK_EXECUTE_FINISHED', 'bucket-fail', 3000, { success: false }),
    ev('TASK_ACKED', 'bucket-fail', 3100, { status: 'failed' })
  );

  const buckets = getTaskBuckets(indexed);
  const taskInFailed = buckets.failed.find((t) => t.id === 'bucket-fail');
  assert.ok(taskInFailed, 'failed task should appear in failed bucket');
  assert.equal(buckets.done.find((t) => t.id === 'bucket-fail'), undefined, 'failed task must not appear in done');
});

test('getTaskBuckets places executing task in active bucket', () => {
  const indexed = world(
    ev('TASK_CREATED', 'bucket-active', 1000, {}),
    ev('TASK_EXECUTE_STARTED', 'bucket-active', 2000, {})
  );

  const buckets = getTaskBuckets(indexed);
  const taskInActive = buckets.active.find((t) => t.id === 'bucket-active');
  assert.ok(taskInActive, 'executing task should appear in active bucket');
});

test('getTaskBuckets places created task in queued bucket', () => {
  const indexed = world(
    ev('TASK_CREATED', 'bucket-queue', 1000, {})
  );

  const buckets = getTaskBuckets(indexed);
  const taskInQueued = buckets.queued.find((t) => t.id === 'bucket-queue');
  assert.ok(taskInQueued, 'created task should appear in queued bucket');
});

// ─── filterTasks ──────────────────────────────────────────────────────────────

test('filterTasks with activeOnly=false returns all tasks', () => {
  const indexed = world(
    ev('TASK_CREATED', 'filter-1', 1000, {}),
    ev('TASK_ACKED', 'filter-1', 2000, { status: 'completed' }),
    ev('TASK_CREATED', 'filter-2', 3000, {}),
    ev('TASK_EXECUTE_STARTED', 'filter-2', 4000, {})
  );

  const all = filterTasks(indexed, { activeOnly: false });
  assert.ok(all.length >= 2, 'should return all tasks when activeOnly=false');
});

test('filterTasks with activeOnly=true returns only active tasks', () => {
  const now = 100000;
  const indexed = world(
    ev('TASK_CREATED', 'filter-done', 1000, {}),
    ev('TASK_ACKED', 'filter-done', 2000, { status: 'completed' }),
    ev('TASK_CREATED', 'filter-executing', 3000, {}),
    ev('TASK_EXECUTE_STARTED', 'filter-executing', 4000, {})
  );

  const active = filterTasks(indexed, { activeOnly: true, now });
  const hasTerminal = active.some((t) => t.status === 'completed' || t.status === 'failed');
  assert.equal(hasTerminal, false, 'activeOnly=true must exclude completed/failed tasks');

  const hasExecuting = active.some((t) => t.id === 'filter-executing');
  assert.ok(hasExecuting, 'activeOnly=true must include executing tasks');
});

test('filterTasks with recentSeconds excludes old completed tasks', () => {
  const now = 100000;
  const old = now - 60000;

  const indexed = world(
    ev('TASK_CREATED', 'filter-old', old - 1000, {}),
    ev('TASK_ACKED', 'filter-old', old, { status: 'completed' }),
    ev('TASK_CREATED', 'filter-new', now - 500, {}),
    ev('TASK_ACKED', 'filter-new', now - 100, { status: 'completed' })
  );

  const recent = filterTasks(indexed, { recentSeconds: 5, now });
  const hasOld = recent.some((t) => t.id === 'filter-old');
  const hasNew = recent.some((t) => t.id === 'filter-new');

  assert.equal(hasOld, false, 'old completed task should be excluded by recentSeconds');
  assert.ok(hasNew, 'recently completed task should be included');
});

// ─── getTaskCounts ────────────────────────────────────────────────────────────

test('getTaskCounts returns correct counts for mixed task states', () => {
  const indexed = world(
    // completed (done)
    ev('TASK_CREATED', 'cnt-done', 1000, {}),
    ev('TASK_EXECUTE_STARTED', 'cnt-done', 2000, {}),
    ev('TASK_EXECUTE_FINISHED', 'cnt-done', 3000, { success: true }),
    ev('TASK_ACKED', 'cnt-done', 3100, { status: 'completed' }),

    // failed
    ev('TASK_CREATED', 'cnt-failed', 1000, {}),
    ev('TASK_EXECUTE_STARTED', 'cnt-failed', 2000, {}),
    ev('TASK_EXECUTE_FINISHED', 'cnt-failed', 3000, { success: false }),
    ev('TASK_ACKED', 'cnt-failed', 3100, { status: 'failed' }),

    // active (executing)
    ev('TASK_CREATED', 'cnt-active', 1000, {}),
    ev('TASK_EXECUTE_STARTED', 'cnt-active', 2000, {}),

    // queued (created only)
    ev('TASK_CREATED', 'cnt-queued', 1000, {})
  );

  const counts = getTaskCounts(indexed);
  assert.ok(typeof counts === 'object', 'getTaskCounts should return an object');
  assert.equal(counts.done, 1, 'done count should be 1');
  assert.equal(counts.failed, 1, 'failed count should be 1');
  assert.equal(counts.active, 1, 'active count should be 1');
  assert.equal(counts.queued, 1, 'queued count should be 1');
});

test('getTaskCounts returns zero counts for empty world', () => {
  const indexed = world();
  const counts = getTaskCounts(indexed);
  assert.equal(counts.done, 0);
  assert.equal(counts.failed, 0);
  assert.equal(counts.active, 0);
  assert.equal(counts.queued, 0);
});

// ─── getTaskTransitionTimestamps ──────────────────────────────────────────────

test('getTaskTransitionTimestamps extracts all lifecycle transition timestamps', () => {
  const indexed = world(
    ev('TASK_CREATED', 'ts-1', 1000, {}),
    ev('TASK_ENQUEUED', 'ts-1', 1100, {}),
    ev('TASK_CLAIMED', 'ts-1', 1200, {}),
    ev('TASK_EXECUTE_STARTED', 'ts-1', 2000, {}),
    ev('TASK_EXECUTE_FINISHED', 'ts-1', 3000, { success: true }),
    ev('TASK_ACKED', 'ts-1', 3100, { status: 'completed' })
  );

  const timestamps = getTaskTransitionTimestamps(indexed, 'ts-1');
  assert.equal(timestamps.createdAt, 1000);
  assert.equal(timestamps.queuedAt, 1100);
  assert.equal(timestamps.claimedAt, 1200);
  assert.equal(timestamps.executingAt, 2000);
  assert.equal(timestamps.awaitingAckAt, 3000);
  assert.equal(timestamps.ackedAt, 3100);
});

test('getTaskTransitionTimestamps returns null for missing lifecycle events', () => {
  const indexed = world(
    ev('TASK_CREATED', 'ts-2', 1000, {}),
    ev('TASK_ACKED', 'ts-2', 2000, { status: 'completed' })
  );

  const timestamps = getTaskTransitionTimestamps(indexed, 'ts-2');
  assert.equal(timestamps.createdAt, 1000, 'createdAt should be set');
  assert.equal(timestamps.ackedAt, 2000, 'ackedAt should be set');
  assert.equal(timestamps.queuedAt, null, 'queuedAt should be null when TASK_ENQUEUED is absent');
  assert.equal(timestamps.claimedAt, null, 'claimedAt should be null when TASK_CLAIMED is absent');
  assert.equal(timestamps.executingAt, null, 'executingAt should be null when TASK_EXECUTE_STARTED is absent');
  assert.equal(timestamps.awaitingAckAt, null, 'awaitingAckAt should be null when TASK_EXECUTE_FINISHED is absent');
});

test('getTaskTransitionTimestamps returns all null fields for unknown task', () => {
  const indexed = world(ev('TASK_CREATED', 'ts-3', 1000, {}));
  const timestamps = getTaskTransitionTimestamps(indexed, 'unknown-task-id');
  assert.equal(timestamps.createdAt, null);
  assert.equal(timestamps.queuedAt, null);
  assert.equal(timestamps.claimedAt, null);
  assert.equal(timestamps.executingAt, null);
  assert.equal(timestamps.awaitingAckAt, null);
  assert.equal(timestamps.ackedAt, null);
});

test('getTaskTransitionTimestamps is invariant to system events', () => {
  const lifecycle = [
    ev('TASK_CREATED', 'ts-4', 1000, {}),
    ev('TASK_EXECUTE_STARTED', 'ts-4', 2000, {}),
    ev('TASK_EXECUTE_FINISHED', 'ts-4', 3000, {}),
    ev('TASK_ACKED', 'ts-4', 3100, { status: 'completed' })
  ];

  const withSystem = [
    ...lifecycle,
    ev('TASK_NOTIFICATION_SENT', 'ts-4', 3200, {}),
    ev('TASK_NOTIFICATION_FAILED', 'ts-4', 3300, { reason: 'send_failed' })
  ];

  const w1 = deriveWorldState(lifecycle);
  const w2 = deriveWorldState(withSystem);

  const ts1 = getTaskTransitionTimestamps(w1, 'ts-4');
  const ts2 = getTaskTransitionTimestamps(w2, 'ts-4');

  assert.deepEqual(ts1, ts2, 'system events must not affect transition timestamps');
});
