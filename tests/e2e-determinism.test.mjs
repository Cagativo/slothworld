import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveWorldState } from '../core/world/deriveWorldState.js';
import { buildVisualWorldGraph } from '../core/world/buildVisualWorldGraph.js';

/**
 * End-to-End Determinism Tests
 *
 * Verifies that the complete pipeline
 *
 *   fixed events → deriveWorldState → buildVisualWorldGraph(world, { now })
 *
 * is fully deterministic:
 *   - Same input produces byte-identical selector outputs on every run
 *   - System events do not cause drift
 *   - The renderView shape is stable and predictable
 *   - No hidden mutable state accumulates across repeated invocations
 *
 * The renderer itself requires a real DOM/canvas; determinism is validated at
 * the renderView level — the complete pre-computed object passed to render().
 * That is the correct seam: render() is a stateless projection of renderView,
 * so renderView stability ≡ render output stability.
 */

// ─── Fixed event sequence ─────────────────────────────────────────────────────

const TASK_A = 'e2e-task-alpha';
const TASK_B = 'e2e-task-beta';
const WORKER = 'worker-w1';

/**
 * Fully deterministic event sequence.
 * Timestamps are literal constants — no Date.now(), no tick counter.
 */
const FIXED_EVENTS = Object.freeze([
  // TASK_A — full lifecycle, acknowledged success
  { type: 'TASK_CREATED',          taskId: TASK_A, timestamp: 1000, payload: { title: 'Alpha Task', type: 'standard' } },
  { type: 'TASK_ENQUEUED',         taskId: TASK_A, timestamp: 1100, payload: {} },
  { type: 'TASK_CLAIMED',          taskId: TASK_A, timestamp: 1200, payload: { workerId: WORKER } },
  { type: 'TASK_EXECUTE_STARTED',  taskId: TASK_A, timestamp: 1300, payload: { workerId: WORKER } },
  { type: 'TASK_EXECUTE_FINISHED', taskId: TASK_A, timestamp: 1900, payload: { workerId: WORKER } },
  { type: 'TASK_ACKED',            taskId: TASK_A, timestamp: 2000, payload: { status: 'acknowledged', success: true } },

  // TASK_B — partial lifecycle, still queued
  { type: 'TASK_CREATED',  taskId: TASK_B, timestamp: 1050, payload: { title: 'Beta Task', type: 'standard' } },
  { type: 'TASK_ENQUEUED', taskId: TASK_B, timestamp: 1150, payload: {} }
]);

/** System events to interleave — must not affect selector outputs. */
const SYSTEM_EVENTS = Object.freeze([
  { type: 'TASK_NOTIFICATION_SENT',    taskId: TASK_A, timestamp: 2100, payload: {} },
  { type: 'TASK_NOTIFICATION_SKIPPED', taskId: TASK_B, timestamp: 1160, payload: { reason: 'no_channel' } },
  { type: 'TASK_NOTIFICATION_FAILED',  taskId: TASK_A, timestamp: 2050, payload: { reason: 'send_error' } }
]);

/** Fixed "now" — must never be Date.now() */
const FIXED_NOW = 999_999_999;

// ─── Pipeline helpers ─────────────────────────────────────────────────────────

function runPipeline(events, now = FIXED_NOW) {
  const world = deriveWorldState([...events]);
  return buildVisualWorldGraph(world, { now });
}

/**
 * Serialise a renderView to a comparable JSON string.
 * Maps are converted to sorted arrays of [key, value] pairs so deepStrictEqual works.
 */
function serialise(view) {
  return JSON.stringify(view, (_key, value) => {
    if (value instanceof Map) {
      return { __Map__: Array.from(value.entries()).sort(([a], [b]) => String(a).localeCompare(String(b))) };
    }
    return value;
  });
}

// ─── renderView shape contract ────────────────────────────────────────────────

test('E2E determinism: renderView has the expected top-level keys', () => {
  const view = runPipeline(FIXED_EVENTS);
  const keys = Object.keys(view).sort();
  assert.deepStrictEqual(keys, [
    'agents',
    'counts',
    'desks',
    'entities',
    'incidents',
    'officeLayout',
    'taskRouteByTaskId',
    'taskVisualTargetByTaskId',
    'tasks',
    'transitionByTaskId'
  ], 'renderView must expose exactly the expected projection keys');
});

test('E2E determinism: entities array contains one entry per task', () => {
  const view = runPipeline(FIXED_EVENTS);
  assert.equal(view.entities.length, 2,
    'One entity per task in the fixed sequence');
});

test('E2E determinism: entity shape has id, type, ref, visualState, isActive', () => {
  const view = runPipeline(FIXED_EVENTS);
  for (const entity of view.entities) {
    assert.ok(typeof entity.id === 'string',          'entity.id must be a string');
    assert.equal(entity.type, 'task',                  'entity.type must be "task"');
    assert.ok(typeof entity.ref === 'string',          'entity.ref must be a string');
    assert.ok(typeof entity.visualState === 'string',  'entity.visualState must be a string');
    assert.ok(typeof entity.isActive === 'boolean',    'entity.isActive must be a boolean');
  }
});

test('E2E determinism: TASK_A entity has visualState "completed" and isActive false', () => {
  const view = runPipeline(FIXED_EVENTS);
  const entity = view.entities.find((e) => e.id === TASK_A);
  assert.ok(entity, 'TASK_A entity must exist in the renderView');
  assert.equal(entity.visualState, 'completed', 'Fully ACKed task must have visualState "completed"');
  assert.equal(entity.isActive, false,           'Completed task must not be active');
});

test('E2E determinism: TASK_B entity has visualState "queued" and isActive false', () => {
  const view = runPipeline(FIXED_EVENTS);
  const entity = view.entities.find((e) => e.id === TASK_B);
  assert.ok(entity, 'TASK_B entity must exist in the renderView');
  assert.equal(entity.visualState, 'queued', 'Enqueued-only task must have visualState "queued"');
  assert.equal(entity.isActive, false,        'Queued task must not be active');
});

test('E2E determinism: counts reflect the two-task world correctly', () => {
  const { counts } = runPipeline(FIXED_EVENTS);
  assert.equal(counts.done,   1, 'TASK_A (completed) must be in the "done" bucket');
  assert.equal(counts.queued, 1, 'TASK_B (queued) must be in the "queued" bucket');
  assert.equal(counts.active, 0);
  assert.equal(counts.failed, 0);
});

test('E2E determinism: transitionByTaskId Map contains an entry for every task', () => {
  const view = runPipeline(FIXED_EVENTS);
  assert.ok(view.transitionByTaskId instanceof Map, 'transitionByTaskId must be a Map');
  assert.ok(view.transitionByTaskId.has(TASK_A), 'Must have transitions for TASK_A');
  assert.ok(view.transitionByTaskId.has(TASK_B), 'Must have transitions for TASK_B');
});

test('E2E determinism: TASK_A transition timestamps match the fixed event timestamps', () => {
  const { transitionByTaskId } = runPipeline(FIXED_EVENTS);
  const t = transitionByTaskId.get(TASK_A);
  assert.equal(t.createdAt,    1000, 'createdAt must equal TASK_CREATED timestamp');
  assert.equal(t.queuedAt,     1100, 'queuedAt must equal TASK_ENQUEUED timestamp');
  assert.equal(t.claimedAt,    1200, 'claimedAt must equal TASK_CLAIMED timestamp');
  assert.equal(t.executingAt,  1300, 'executingAt must equal TASK_EXECUTE_STARTED timestamp');
  assert.equal(t.awaitingAckAt,1900, 'awaitingAckAt must equal TASK_EXECUTE_FINISHED timestamp');
  assert.equal(t.ackedAt,      2000, 'ackedAt must equal TASK_ACKED timestamp');
});

// ─── Identical output across repeated invocations ─────────────────────────────

test('E2E determinism: running the pipeline twice with the same input yields identical renderViews', () => {
  const run1 = serialise(runPipeline(FIXED_EVENTS));
  const run2 = serialise(runPipeline(FIXED_EVENTS));
  assert.equal(run1, run2,
    'renderView must be byte-identical on every invocation with the same input');
});

test('E2E determinism: running the pipeline ten times produces the same serialised output each time', () => {
  const baseline = serialise(runPipeline(FIXED_EVENTS));
  for (let i = 0; i < 9; i++) {
    assert.equal(serialise(runPipeline(FIXED_EVENTS)), baseline,
      `Run ${i + 2} diverged from the baseline renderView`);
  }
});

test('E2E determinism: deriveWorldState is idempotent — same events produce the same indexed world', () => {
  const w1 = deriveWorldState([...FIXED_EVENTS]);
  const w2 = deriveWorldState([...FIXED_EVENTS]);

  assert.deepStrictEqual(w1.events, w2.events,
    'Sorted events array must be identical');
  assert.deepStrictEqual(
    Array.from(w1.eventsByTaskId.entries()),
    Array.from(w2.eventsByTaskId.entries()),
    'eventsByTaskId must be identical'
  );
  assert.deepStrictEqual(
    Array.from(w1.eventsByWorkerId.entries()),
    Array.from(w2.eventsByWorkerId.entries()),
    'eventsByWorkerId must be identical'
  );
});

// ─── System events do not cause drift ────────────────────────────────────────

test('E2E determinism: adding system events does not change entities', () => {
  const clean  = runPipeline(FIXED_EVENTS);
  const mixed  = runPipeline([...FIXED_EVENTS, ...SYSTEM_EVENTS]);

  assert.deepStrictEqual(
    clean.entities.map((e) => ({ id: e.id, visualState: e.visualState, isActive: e.isActive })),
    mixed.entities.map((e) => ({ id: e.id, visualState: e.visualState, isActive: e.isActive })),
    'System events must not alter entity visualState or isActive'
  );
});

test('E2E determinism: adding system events does not change counts', () => {
  const clean = runPipeline(FIXED_EVENTS);
  const mixed = runPipeline([...FIXED_EVENTS, ...SYSTEM_EVENTS]);
  assert.deepStrictEqual(clean.counts, mixed.counts,
    'System events must not affect task count buckets');
});

test('E2E determinism: adding system events does not change transition timestamps', () => {
  const clean = runPipeline(FIXED_EVENTS);
  const mixed = runPipeline([...FIXED_EVENTS, ...SYSTEM_EVENTS]);

  for (const taskId of [TASK_A, TASK_B]) {
    assert.deepStrictEqual(
      clean.transitionByTaskId.get(taskId),
      mixed.transitionByTaskId.get(taskId),
      `System events must not alter transition timestamps for ${taskId}`
    );
  }
});

test('E2E determinism: adding system events does not change task routes or visual targets', () => {
  const clean = runPipeline(FIXED_EVENTS);
  const mixed = runPipeline([...FIXED_EVENTS, ...SYSTEM_EVENTS]);

  assert.equal(serialise({ r: clean.taskRouteByTaskId }),
               serialise({ r: mixed.taskRouteByTaskId }),
    'System events must not alter taskRouteByTaskId');

  assert.equal(serialise({ t: clean.taskVisualTargetByTaskId }),
               serialise({ t: mixed.taskVisualTargetByTaskId }),
    'System events must not alter taskVisualTargetByTaskId');
});

// ─── Input mutation isolation ─────────────────────────────────────────────────

test('E2E determinism: pipeline does not mutate the input events array', () => {
  const input = FIXED_EVENTS.map((e) => ({ ...e, payload: { ...e.payload } }));
  const snapshot = JSON.stringify(input);

  runPipeline(input);

  assert.equal(JSON.stringify(input), snapshot,
    'The pipeline must not mutate the caller\'s event array or event objects');
});

test('E2E determinism: running the pipeline does not affect a subsequent independent pipeline run', () => {
  // First run with a partial sequence.
  const partial = FIXED_EVENTS.filter((e) => e.taskId === TASK_A);
  runPipeline(partial);

  // Second run with the full sequence — must not be polluted by the first run.
  const full = runPipeline(FIXED_EVENTS);
  assert.equal(full.entities.length, 2,
    'Full-sequence run after a partial run must still produce 2 entities — no state leakage');
  assert.equal(full.counts.done, 1);
  assert.equal(full.counts.queued, 1);
});

// ─── now parameter isolation ──────────────────────────────────────────────────

test('E2E determinism: lifecycle-derived fields are identical regardless of the "now" value', () => {
  // Lifecycle state (visualState, isActive, transitions) must not depend on `now`.
  // Only stall detection in incidents uses `now`; entity state must be stable.
  const view1 = runPipeline(FIXED_EVENTS, FIXED_NOW);
  const view2 = runPipeline(FIXED_EVENTS, FIXED_NOW + 1_000_000);

  for (const taskId of [TASK_A, TASK_B]) {
    const e1 = view1.entities.find((e) => e.id === taskId);
    const e2 = view2.entities.find((e) => e.id === taskId);
    assert.equal(e1.visualState, e2.visualState,
      `${taskId} visualState must not vary with "now"`);
    assert.equal(e1.isActive, e2.isActive,
      `${taskId} isActive must not vary with "now"`);
    assert.deepStrictEqual(
      view1.transitionByTaskId.get(taskId),
      view2.transitionByTaskId.get(taskId),
      `${taskId} transition timestamps must not vary with "now"`);
  }

  assert.deepStrictEqual(view1.counts, view2.counts,
    'Task counts must not vary with "now"');
});

// ─── Render-layer stability (renderView as the render contract) ───────────────

test('E2E determinism: renderView serialisation is stable — same hash each time', () => {
  // A simple deterministic "hash": XOR-reduce the char codes of the JSON string.
  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h ^ s.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  const h1 = hashStr(serialise(runPipeline(FIXED_EVENTS)));
  const h2 = hashStr(serialise(runPipeline(FIXED_EVENTS)));
  const h3 = hashStr(serialise(runPipeline(FIXED_EVENTS)));

  assert.equal(h1, h2, 'renderView hash must be identical on run 2');
  assert.equal(h1, h3, 'renderView hash must be identical on run 3');
});

test('E2E determinism: Map-typed fields in renderView contain the same keys as the tasks array', () => {
  const view = runPipeline(FIXED_EVENTS);
  const taskIds = new Set(view.tasks.map((t) => t.id));

  for (const [key] of view.transitionByTaskId) {
    assert.ok(taskIds.has(key),
      `transitionByTaskId key "${key}" has no corresponding task`);
  }
  for (const [key] of view.taskRouteByTaskId) {
    assert.ok(taskIds.has(key),
      `taskRouteByTaskId key "${key}" has no corresponding task`);
  }
  for (const [key] of view.taskVisualTargetByTaskId) {
    assert.ok(taskIds.has(key),
      `taskVisualTargetByTaskId key "${key}" has no corresponding task`);
  }
});

test('E2E determinism: incident clusters in renderView are arrays with valid schema', () => {
  const { incidents } = runPipeline(FIXED_EVENTS);
  assert.ok(Array.isArray(incidents), 'incidents must be an array');
  for (const cluster of incidents) {
    assert.ok(typeof cluster.type === 'string',       'cluster.type must be a string');
    assert.ok(typeof cluster.severity === 'string',    'cluster.severity must be a string');
    assert.ok(Array.isArray(cluster.taskIds),          'cluster.taskIds must be an array');
    assert.ok(typeof cluster.summary === 'string',     'cluster.summary must be a string');
    assert.ok(Array.isArray(cluster.representativeEvents), 'cluster.representativeEvents must be an array');
  }
});
