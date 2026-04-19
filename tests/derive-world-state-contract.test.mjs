import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorldState } from '../core/world/deriveWorldState.js';

/**
 * deriveWorldState Index-Only Contract Tests
 *
 * Strict guarantee: the function is a pure indexing layer.
 *
 * Must return exactly:
 *   - events          — sorted, cloned flat array of all events
 *   - eventsByTaskId  — Map<taskId, event[]>
 *   - eventsByWorkerId — Map<workerId, event[]>
 *
 * Must NOT include:
 *   - lifecycle derivation (status, transitions, snapshots)
 *   - metrics (timings, durations, counts)
 *   - anomaly processing (incidents, clusters, stalled tasks)
 *   - any computed, inferred, or aggregated field
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ev(type, taskId, timestamp = 1, extra = {}) {
  return { type, taskId, timestamp, payload: {}, ...extra };
}

// All known lifecycle + system event types — used to verify no type inspection
// is happening inside deriveWorldState.
const ALL_EVENT_TYPES = [
  'TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED',
  'TASK_EXECUTE_STARTED', 'TASK_EXECUTE_FINISHED', 'TASK_ACKED',
  'TASK_NOTIFICATION_SENT', 'TASK_NOTIFICATION_SKIPPED', 'TASK_NOTIFICATION_FAILED'
];

// ─── Exact output shape ───────────────────────────────────────────────────────

test('deriveWorldState: output keys are exactly ["events", "eventsByTaskId", "eventsByWorkerId"]', () => {
  const result = deriveWorldState([ev('TASK_CREATED', 't1', 1)]);
  assert.deepStrictEqual(
    Object.keys(result).sort(),
    ['events', 'eventsByTaskId', 'eventsByWorkerId'],
    'Output must have exactly three keys — no extra fields of any kind'
  );
});

test('deriveWorldState: no lifecycle fields present on output', () => {
  const result = deriveWorldState([
    ev('TASK_CREATED', 't1', 1),
    ev('TASK_ACKED',   't1', 2, { payload: { status: 'failed' } })
  ]);
  const forbidden = [
    'status', 'taskStatus', 'lifecycle', 'state',
    'failedTasks', 'completedTasks', 'activeTasks',
    'transitions', 'snapshot', 'timeline'
  ];
  for (const key of forbidden) {
    assert.ok(!(key in result), `Output must not contain lifecycle field "${key}"`);
  }
});

test('deriveWorldState: no metrics fields present on output', () => {
  const result = deriveWorldState([ev('TASK_CREATED', 't1', 1)]);
  const forbidden = [
    'queueTime', 'executionDuration', 'ackLatency',
    'metrics', 'timings', 'durations', 'counts',
    'throughput', 'latency'
  ];
  for (const key of forbidden) {
    assert.ok(!(key in result), `Output must not contain metrics field "${key}"`);
  }
});

test('deriveWorldState: no anomaly fields present on output', () => {
  const result = deriveWorldState([ev('TASK_CREATED', 't1', 1)]);
  const forbidden = [
    'anomalies', 'incidents', 'clusters', 'stalledTasks',
    'duplicateAcks', 'notificationIssues', 'executionFailures'
  ];
  for (const key of forbidden) {
    assert.ok(!(key in result), `Output must not contain anomaly field "${key}"`);
  }
});

// ─── events array contract ────────────────────────────────────────────────────

test('deriveWorldState: events is an array', () => {
  const result = deriveWorldState([ev('TASK_CREATED', 't1', 1)]);
  assert.ok(Array.isArray(result.events), 'events must be an array');
});

test('deriveWorldState: events length matches the number of valid input events', () => {
  const input = [
    ev('TASK_CREATED', 't1', 1),
    ev('TASK_ENQUEUED', 't1', 2),
    ev('TASK_CLAIMED',  't1', 3)
  ];
  const result = deriveWorldState(input);
  assert.equal(result.events.length, 3,
    'events array must contain exactly as many entries as valid input events');
});

test('deriveWorldState: events are sorted ascending by timestamp', () => {
  const input = [
    ev('TASK_CLAIMED',  't1', 300),
    ev('TASK_CREATED',  't1', 100),
    ev('TASK_ENQUEUED', 't1', 200)
  ];
  const result = deriveWorldState(input);
  assert.equal(result.events[0].type, 'TASK_CREATED');
  assert.equal(result.events[1].type, 'TASK_ENQUEUED');
  assert.equal(result.events[2].type, 'TASK_CLAIMED');
});

test('deriveWorldState: events are deep-cloned (mutating input does not affect output)', () => {
  const source = ev('TASK_CREATED', 't1', 1);
  source.payload = { title: 'original' };
  const result = deriveWorldState([source]);

  source.payload.title = 'mutated';

  assert.equal(result.events[0].payload.title, 'original',
    'Mutating the input event must not affect the cloned event in result.events');
});

test('deriveWorldState: pushing to the input array after the call does not affect result.events', () => {
  const input = [ev('TASK_CREATED', 't1', 1)];
  const result = deriveWorldState(input);

  input.push(ev('TASK_ENQUEUED', 't1', 2));

  assert.equal(result.events.length, 1,
    'Appending to the input array after the call must not affect result.events');
  assert.equal(result.eventsByTaskId.get('t1').length, 1,
    'Appending to the input array after the call must not affect eventsByTaskId');
});

// ─── eventsByTaskId contract ──────────────────────────────────────────────────

test('deriveWorldState: eventsByTaskId is a Map', () => {
  const result = deriveWorldState([ev('TASK_CREATED', 't1', 1)]);
  assert.ok(result.eventsByTaskId instanceof Map,
    'eventsByTaskId must be a Map instance');
});

test('deriveWorldState: eventsByTaskId groups events by their taskId', () => {
  const result = deriveWorldState([
    ev('TASK_CREATED',  'task-a', 1),
    ev('TASK_ENQUEUED', 'task-a', 2),
    ev('TASK_CREATED',  'task-b', 3)
  ]);
  assert.equal(result.eventsByTaskId.get('task-a').length, 2,
    'task-a must have 2 grouped events');
  assert.equal(result.eventsByTaskId.get('task-b').length, 1,
    'task-b must have 1 grouped event');
});

test('deriveWorldState: eventsByTaskId keys are strings', () => {
  const result = deriveWorldState([
    ev('TASK_CREATED', 'task-x', 1)
  ]);
  for (const key of result.eventsByTaskId.keys()) {
    assert.equal(typeof key, 'string',
      `eventsByTaskId key must be a string, got ${typeof key}`);
  }
});

test('deriveWorldState: eventsByTaskId events preserve the original event data', () => {
  const result = deriveWorldState([
    ev('TASK_CREATED', 'task-a', 42, { payload: { title: 'hello' } })
  ]);
  const grouped = result.eventsByTaskId.get('task-a');
  assert.ok(Array.isArray(grouped) && grouped.length === 1);
  assert.equal(grouped[0].type, 'TASK_CREATED');
  assert.equal(grouped[0].taskId, 'task-a');
  assert.equal(grouped[0].timestamp, 42);
});

test('deriveWorldState: eventsByTaskId accepts all canonical event types without filtering', () => {
  // Every canonical event type — regardless of lifecycle vs system — must appear
  // in the index. deriveWorldState must not filter by event type.
  const input = ALL_EVENT_TYPES.map((type, i) =>
    ev(type, 'task-all', i + 1)
  );
  const result = deriveWorldState(input);
  assert.equal(
    result.eventsByTaskId.get('task-all').length,
    ALL_EVENT_TYPES.length,
    'eventsByTaskId must index all event types, including system events — no type-based filtering'
  );
});

test('deriveWorldState: system events are stored in eventsByTaskId without interpretation', () => {
  const input = [
    ev('TASK_CREATED',              'task-s', 1),
    ev('TASK_NOTIFICATION_SENT',    'task-s', 2),
    ev('TASK_NOTIFICATION_SKIPPED', 'task-s', 3, { payload: { reason: 'no_channel' } }),
    ev('TASK_NOTIFICATION_FAILED',  'task-s', 4, { payload: { reason: 'send_error' } })
  ];
  const result = deriveWorldState(input);
  const stored = result.eventsByTaskId.get('task-s');

  assert.equal(stored.length, 4,
    'System events must be stored in eventsByTaskId without being filtered or interpreted');

  const types = stored.map((e) => e.type);
  assert.ok(types.includes('TASK_NOTIFICATION_SENT'),    'NOTIFICATION_SENT must be indexed');
  assert.ok(types.includes('TASK_NOTIFICATION_SKIPPED'), 'NOTIFICATION_SKIPPED must be indexed');
  assert.ok(types.includes('TASK_NOTIFICATION_FAILED'),  'NOTIFICATION_FAILED must be indexed');
});

// ─── eventsByWorkerId contract ────────────────────────────────────────────────

test('deriveWorldState: eventsByWorkerId is a Map', () => {
  const result = deriveWorldState([ev('TASK_CREATED', 't1', 1)]);
  assert.ok(result.eventsByWorkerId instanceof Map,
    'eventsByWorkerId must be a Map instance');
});

test('deriveWorldState: eventsByWorkerId groups events by workerId from payload', () => {
  const input = [
    { type: 'TASK_CLAIMED', taskId: 't1', timestamp: 1, payload: { workerId: 'worker-1' } },
    { type: 'TASK_CLAIMED', taskId: 't2', timestamp: 2, payload: { workerId: 'worker-1' } },
    { type: 'TASK_CLAIMED', taskId: 't3', timestamp: 3, payload: { workerId: 'worker-2' } }
  ];
  const result = deriveWorldState(input);
  assert.equal(result.eventsByWorkerId.get('worker-1').length, 2,
    'worker-1 must have 2 grouped events');
  assert.equal(result.eventsByWorkerId.get('worker-2').length, 1,
    'worker-2 must have 1 grouped event');
});

test('deriveWorldState: eventsByWorkerId is empty when no events carry a workerId', () => {
  const result = deriveWorldState([
    ev('TASK_CREATED',  't1', 1),
    ev('TASK_ENQUEUED', 't1', 2)
  ]);
  assert.equal(result.eventsByWorkerId.size, 0,
    'eventsByWorkerId must be empty when no events carry workerId or agentId');
});

// ─── No computation on event contents ────────────────────────────────────────

test('deriveWorldState: TASK_ACKED with status "failed" is stored as-is, status field not propagated', () => {
  const result = deriveWorldState([
    ev('TASK_CREATED', 't1', 1),
    { type: 'TASK_ACKED', taskId: 't1', timestamp: 2, payload: { status: 'failed', error: 'timeout' } }
  ]);
  // The failure payload must be stored raw. No derived field on the output.
  assert.ok(!('status' in result), 'status must not be a top-level field');
  assert.ok(!('failedTasks' in result), 'failedTasks must not be computed on the output');

  const ackedEvent = result.eventsByTaskId.get('t1').find((e) => e.type === 'TASK_ACKED');
  assert.equal(ackedEvent.payload.status, 'failed',
    'TASK_ACKED payload must be stored verbatim without transformation');
});

test('deriveWorldState: output does not vary based on payload content of any event type', () => {
  // Two worlds: one where TASK_ACKED signals success, one where it signals failure.
  // The shape of the deriveWorldState output must be structurally identical.
  const success = deriveWorldState([
    ev('TASK_CREATED', 'tx', 1),
    { type: 'TASK_ACKED', taskId: 'tx', timestamp: 2, payload: { status: 'acknowledged' } }
  ]);
  const failure = deriveWorldState([
    ev('TASK_CREATED', 'tx', 1),
    { type: 'TASK_ACKED', taskId: 'tx', timestamp: 2, payload: { status: 'failed' } }
  ]);

  assert.deepStrictEqual(
    Object.keys(success).sort(),
    Object.keys(failure).sort(),
    'Output shape must be identical regardless of payload content'
  );
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

test('deriveWorldState: returns valid empty structure for empty input', () => {
  const result = deriveWorldState([]);
  assert.deepStrictEqual(Object.keys(result).sort(),
    ['events', 'eventsByTaskId', 'eventsByWorkerId']);
  assert.deepStrictEqual(result.events, []);
  assert.equal(result.eventsByTaskId.size, 0);
  assert.equal(result.eventsByWorkerId.size, 0);
});

test('deriveWorldState: returns valid empty structure for null input', () => {
  const result = deriveWorldState(null);
  assert.deepStrictEqual(Object.keys(result).sort(),
    ['events', 'eventsByTaskId', 'eventsByWorkerId']);
  assert.deepStrictEqual(result.events, []);
});

test('deriveWorldState: events with identical timestamps are both preserved', () => {
  const result = deriveWorldState([
    ev('TASK_CREATED',  't1', 100),
    ev('TASK_ENQUEUED', 't1', 100)
  ]);
  assert.equal(result.events.length, 2,
    'Both events at the same timestamp must be preserved — no deduplication');
});
