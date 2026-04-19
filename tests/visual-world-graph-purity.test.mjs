import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVisualWorldGraph } from '../core/world/buildVisualWorldGraph.js';

// ─── Fixed selector output (no Date.now(), no randomness) ────────────────────

const TASKS = Object.freeze([
  { id: 'task-1', status: 'completed', title: 'Alpha', type: 'standard', assignedAgentId: 'w1', deskId: 'desk-0', error: null,       createdAt: 1000, updatedAt: 2000 },
  { id: 'task-2', status: 'queued',    title: 'Beta',  type: 'standard', assignedAgentId: null, deskId: 'desk-1', error: null,       createdAt: 1050, updatedAt: 1150 },
  { id: 'task-3', status: 'failed',    title: 'Gamma', type: 'urgent',   assignedAgentId: 'w2', deskId: 'desk-2', error: 'ack_fail', createdAt: 1100, updatedAt: 1800 }
]);

const TRANSITIONS = new Map([
  ['task-1', { createdAt: 1000, queuedAt: 1100, claimedAt: 1200, executingAt: 1300, awaitingAckAt: 1900, ackedAt: 2000 }],
  ['task-2', { createdAt: 1050, queuedAt: 1150, claimedAt: null,  executingAt: null,  awaitingAckAt: null,  ackedAt: null  }],
  ['task-3', { createdAt: 1100, queuedAt: 1110, claimedAt: 1120, executingAt: 1200, awaitingAckAt: 1700, ackedAt: 1800 }]
]);

const AGENTS = Object.freeze([
  { id: 'w1', role: 'operator', state: 'idle',    currentTaskId: 'task-1', deskId: 'desk-0' },
  { id: 'w2', role: 'operator', state: 'working', currentTaskId: 'task-3', deskId: 'desk-2' }
]);

const METRICS = new Map([
  ['task-1', { queueTime: 300, duration: 600, ackLatency: 100 }],
  ['task-3', { queueTime: 100, duration: 500, ackLatency:  80 }]
]);

const INCIDENTS = Object.freeze([
  { type: 'execution_failures', severity: 'high',   taskIds: ['task-3'], summary: '1 failed.', representativeEvents: [] },
  { type: 'stalled_tasks',      severity: 'medium', taskIds: [],         summary: 'none.',     representativeEvents: [] }
]);

const SYSTEM_EVENTS = new Map([
  ['task-1', [{ type: 'TASK_NOTIFICATION_SENT',   taskId: 'task-1', timestamp: 2010, payload: {} }]],
  ['task-3', [{ type: 'TASK_NOTIFICATION_FAILED', taskId: 'task-3', timestamp: 1810, payload: { reason: 'send_error' } }]]
]);

/** Build the full input object. Each call creates fresh copies to rule out shared-reference cheating. */
function makeInput() {
  return {
    tasks:        TASKS.map((t) => ({ ...t })),
    transitions:  new Map(Array.from(TRANSITIONS.entries()).map(([k, v]) => [k, { ...v }])),
    agents:       AGENTS.map((a) => ({ ...a })),
    metrics:      new Map(Array.from(METRICS.entries()).map(([k, v]) => [k, { ...v }])),
    incidents:    INCIDENTS.map((c) => ({ ...c, taskIds: [...c.taskIds] })),
    systemEvents: new Map(Array.from(SYSTEM_EVENTS.entries()).map(([k, v]) => [k, v.map((e) => ({ ...e }))]))
  };
}

/** Stable serialiser — Maps → sorted arrays so deepStrictEqual works across separate calls. */
function serial(value) {
  return JSON.stringify(value, (_k, v) => {
    if (v instanceof Map) {
      return { __Map__: Array.from(v.entries()).sort(([a], [b]) => String(a).localeCompare(String(b))) };
    }
    return v;
  });
}

// ─── Identity: same input → identical output ──────────────────────────────────

test('purity: two calls with identical inputs return identical nodes', () => {
  const a = buildVisualWorldGraph(makeInput());
  const b = buildVisualWorldGraph(makeInput());
  assert.equal(serial(a.nodes), serial(b.nodes));
});

test('purity: two calls with identical inputs return identical edges', () => {
  const a = buildVisualWorldGraph(makeInput());
  const b = buildVisualWorldGraph(makeInput());
  assert.equal(serial(a.edges), serial(b.edges));
});

test('purity: two calls with identical inputs return identical metadata', () => {
  const a = buildVisualWorldGraph(makeInput());
  const b = buildVisualWorldGraph(makeInput());
  assert.deepStrictEqual(a.metadata, b.metadata);
});

test('purity: ten consecutive calls produce the same serialised output', () => {
  const baseline = serial(buildVisualWorldGraph(makeInput()));
  for (let i = 1; i < 10; i++) {
    assert.equal(serial(buildVisualWorldGraph(makeInput())), baseline,
      `Call ${i + 1} diverged from the baseline`);
  }
});

// ─── No time dependency ───────────────────────────────────────────────────────

test('purity: nodes are identical regardless of wall-clock time', async () => {
  const a = buildVisualWorldGraph(makeInput());
  await new Promise((r) => setTimeout(r, 20)); // let time advance
  const b = buildVisualWorldGraph(makeInput());
  assert.equal(serial(a.nodes), serial(b.nodes),
    'nodes must not vary with wall-clock time');
});

test('purity: edges are identical regardless of wall-clock time', async () => {
  const a = buildVisualWorldGraph(makeInput());
  await new Promise((r) => setTimeout(r, 20));
  const b = buildVisualWorldGraph(makeInput());
  assert.equal(serial(a.edges), serial(b.edges),
    'edges must not vary with wall-clock time');
});

test('purity: observability overlay is identical regardless of wall-clock time', async () => {
  const opts = { observability: true };
  const a = buildVisualWorldGraph(makeInput(), opts);
  await new Promise((r) => setTimeout(r, 20));
  const b = buildVisualWorldGraph(makeInput(), opts);
  assert.equal(serial(a.observability), serial(b.observability),
    'observability overlay must not vary with wall-clock time');
});

// ─── No randomness ────────────────────────────────────────────────────────────

test('purity: node order is deterministic across calls', () => {
  const a = buildVisualWorldGraph(makeInput()).nodes.map((n) => n.id);
  const b = buildVisualWorldGraph(makeInput()).nodes.map((n) => n.id);
  assert.deepStrictEqual(a, b, 'node order must not be random');
});

test('purity: edge order is deterministic across calls', () => {
  const a = buildVisualWorldGraph(makeInput()).edges.map((e) => e.id);
  const b = buildVisualWorldGraph(makeInput()).edges.map((e) => e.id);
  assert.deepStrictEqual(a, b, 'edge order must not be random');
});

test('purity: node ids are stable across calls', () => {
  const ids = (call) => new Set(buildVisualWorldGraph(makeInput()).nodes.map((n) => n.id));
  const a = ids();
  const b = ids();
  assert.deepStrictEqual([...a].sort(), [...b].sort());
});

// ─── Input is not mutated ─────────────────────────────────────────────────────

test('purity: tasks array is not mutated by the function', () => {
  const input = makeInput();
  const snapshot = serial(input.tasks);
  buildVisualWorldGraph(input);
  assert.equal(serial(input.tasks), snapshot, 'input.tasks must not be mutated');
});

test('purity: transitions Map is not mutated by the function', () => {
  const input = makeInput();
  const snapshot = serial(input.transitions);
  buildVisualWorldGraph(input);
  assert.equal(serial(input.transitions), snapshot, 'input.transitions must not be mutated');
});

test('purity: agents array is not mutated by the function', () => {
  const input = makeInput();
  const snapshot = serial(input.agents);
  buildVisualWorldGraph(input);
  assert.equal(serial(input.agents), snapshot, 'input.agents must not be mutated');
});

test('purity: incidents array is not mutated by the function', () => {
  const input = makeInput();
  const snapshot = serial(input.incidents);
  buildVisualWorldGraph(input);
  assert.equal(serial(input.incidents), snapshot, 'input.incidents must not be mutated');
});

// ─── Observability toggle does not affect graph structure ─────────────────────

test('purity: nodes are identical with and without observability overlay', () => {
  const lifecycle    = buildVisualWorldGraph(makeInput());
  const withOverlay  = buildVisualWorldGraph(makeInput(), { observability: true });
  assert.equal(serial(lifecycle.nodes), serial(withOverlay.nodes),
    'observability toggle must not change nodes');
});

test('purity: edges are identical with and without observability overlay', () => {
  const lifecycle    = buildVisualWorldGraph(makeInput());
  const withOverlay  = buildVisualWorldGraph(makeInput(), { observability: true });
  assert.equal(serial(lifecycle.edges), serial(withOverlay.edges),
    'observability toggle must not change edges');
});

test('purity: metadata is identical with and without observability overlay', () => {
  const lifecycle    = buildVisualWorldGraph(makeInput());
  const withOverlay  = buildVisualWorldGraph(makeInput(), { observability: true });
  assert.deepStrictEqual(lifecycle.metadata, withOverlay.metadata,
    'observability toggle must not change metadata');
});

// ─── Observability overlay internal consistency ───────────────────────────────

test('purity: overlay.enabled is false when observability option is absent', () => {
  const { observability } = buildVisualWorldGraph(makeInput());
  assert.equal(observability.enabled, false);
});

test('purity: overlay.enabled is true when observability option is true', () => {
  const { observability } = buildVisualWorldGraph(makeInput(), { observability: true });
  assert.equal(observability.enabled, true);
});

test('purity: overlay.byTaskId contains only tasks that have system events', () => {
  const { observability } = buildVisualWorldGraph(makeInput(), { observability: true });
  const keys = [...observability.byTaskId.keys()].sort();
  assert.deepStrictEqual(keys, ['task-1', 'task-3'],
    'byTaskId must contain exactly the tasks with system events');
});

test('purity: overlay.byTaskId is empty when observability is disabled', () => {
  const { observability } = buildVisualWorldGraph(makeInput());
  assert.equal(observability.byTaskId.size, 0,
    'byTaskId must be empty in lifecycle-only mode');
});

test('purity: overlay content is identical across repeated calls', () => {
  const opts = { observability: true };
  const a = buildVisualWorldGraph(makeInput(), opts).observability;
  const b = buildVisualWorldGraph(makeInput(), opts).observability;
  assert.equal(serial(a), serial(b));
});
