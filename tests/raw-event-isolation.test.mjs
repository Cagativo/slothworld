import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVisualWorldGraph } from '../core/world/buildVisualWorldGraph.js';

/**
 * raw-event-isolation.test.mjs
 *
 * Verifies that buildVisualWorldGraph never reads raw event data,
 * even when an attacker (or a misconfigured caller) injects it into the input.
 *
 * Strategy:
 *  1. Poison trap — use a Proxy that throws on any property access to verify a
 *     field is truly never touched.
 *  2. Alternate-value injection — place deceptive values in raw-event slots and
 *     assert they never surface in the output.
 *  3. Structural completeness — assert the graph is fully built from selector
 *     fields alone, even when raw-event fields are absent.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a Proxy that throws if any property is accessed. */
function poisonProxy(label) {
  return new Proxy({}, {
    get(_t, prop) {
      throw new Error(`buildVisualWorldGraph must not access raw event field "${label}.${String(prop)}"`);
    },
    has(_t, prop) {
      throw new Error(`buildVisualWorldGraph must not probe raw event field "${label}.${String(prop)}"`);
    }
  });
}

/** Returns a frozen array-like Proxy that throws on any index or method access. */
function poisonArray(label) {
  return new Proxy([], {
    get(_t, prop) {
      // Allow Array.isArray duck-typing check via Symbol.iterator / length only if
      // we want to tolerate the Array.isArray fast-path. Instead, we intentionally
      // do NOT expose those — buildVisualWorldGraph must not iterate this array.
      throw new Error(`buildVisualWorldGraph must not access raw event array "${label}[${String(prop)}]"`);
    }
  });
}

function serial(v) {
  return JSON.stringify(v, (_k, val) => {
    if (val instanceof Map) {
      return { __Map__: Array.from(val.entries()).sort(([a], [b]) => String(a).localeCompare(String(b))) };
    }
    return val;
  });
}

// ─── Baseline selector-only input (no raw events) ────────────────────────────

function makeCleanInput() {
  return {
    tasks: [
      { id: 't1', status: 'completed', title: 'Alpha', type: 'standard', assignedAgentId: 'w1', deskId: 'desk-0', error: null, createdAt: 1000, updatedAt: 2000 },
      { id: 't2', status: 'queued',    title: 'Beta',  type: 'standard', assignedAgentId: null, deskId: 'desk-1', error: null, createdAt: 1050, updatedAt: 1150 }
    ],
    transitions: new Map([
      ['t1', { createdAt: 1000, queuedAt: 1100, claimedAt: 1200, executingAt: 1300, awaitingAckAt: 1900, ackedAt: 2000 }],
      ['t2', { createdAt: 1050, queuedAt: 1150, claimedAt: null,  executingAt: null,  awaitingAckAt: null,  ackedAt: null  }]
    ]),
    agents:    [{ id: 'w1', role: 'operator', state: 'idle', currentTaskId: 't1', deskId: 'desk-0' }],
    metrics:   new Map([['t1', { queueTime: 300, duration: 600, ackLatency: 100 }]]),
    incidents: [{ type: 'execution_failures', severity: 'low', taskIds: [], summary: 'none.', representativeEvents: [] }],
    systemEvents: new Map()
  };
}

// ─── 1. Poison trap: raw event fields on input object ────────────────────────

test('event isolation: input.events is never accessed (poison proxy)', () => {
  const input = { ...makeCleanInput(), events: poisonProxy('input.events') };
  assert.doesNotThrow(() => buildVisualWorldGraph(input),
    'buildVisualWorldGraph must not access input.events');
});

test('event isolation: input.eventsByTaskId is never accessed (poison proxy)', () => {
  const input = { ...makeCleanInput(), eventsByTaskId: poisonProxy('input.eventsByTaskId') };
  assert.doesNotThrow(() => buildVisualWorldGraph(input),
    'buildVisualWorldGraph must not access input.eventsByTaskId');
});

test('event isolation: input.eventsByWorkerId is never accessed (poison proxy)', () => {
  const input = { ...makeCleanInput(), eventsByWorkerId: poisonProxy('input.eventsByWorkerId') };
  assert.doesNotThrow(() => buildVisualWorldGraph(input),
    'buildVisualWorldGraph must not access input.eventsByWorkerId');
});

test('event isolation: input.rawEvents is never accessed (poison proxy)', () => {
  const input = { ...makeCleanInput(), rawEvents: poisonProxy('input.rawEvents') };
  assert.doesNotThrow(() => buildVisualWorldGraph(input),
    'buildVisualWorldGraph must not access input.rawEvents');
});

// ─── 2. Deceptive value injection: raw event arrays with alternate data ───────

/**
 * Inject raw events that carry DIFFERENT status/title/assignedAgentId values
 * from what the selector snapshots say.  The graph must reflect the selector
 * values, not the injected raw events.
 */
const DECEPTIVE_EVENTS = [
  { type: 'TASK_CREATED',  taskId: 't1', timestamp: 500,  payload: { title: 'INJECTED_TITLE', type: 'injected' } },
  { type: 'TASK_ENQUEUED', taskId: 't1', timestamp: 600,  payload: {} },
  { type: 'TASK_CLAIMED',  taskId: 't1', timestamp: 700,  payload: { workerId: 'injected-worker' } },
  { type: 'TASK_ACKED',    taskId: 't1', timestamp: 900,  payload: { status: 'failed' } }  // contradicts snapshot status:'completed'
];

test('event isolation: injected raw events on input do not alter node status', () => {
  const input = { ...makeCleanInput(), events: DECEPTIVE_EVENTS, eventsByTaskId: new Map([['t1', DECEPTIVE_EVENTS]]) };
  const { nodes } = buildVisualWorldGraph(input);
  const t1 = nodes.find((n) => n.id === 't1');
  assert.equal(t1.status, 'completed',
    'node status must come from the task snapshot, not from injected raw events');
});

test('event isolation: injected raw events do not alter node title', () => {
  const input = { ...makeCleanInput(), events: DECEPTIVE_EVENTS, eventsByTaskId: new Map([['t1', DECEPTIVE_EVENTS]]) };
  const { nodes } = buildVisualWorldGraph(input);
  const t1 = nodes.find((n) => n.id === 't1');
  assert.equal(t1.metadata.title, 'Alpha',
    'node title must come from the task snapshot, not from injected TASK_CREATED payload');
});

test('event isolation: injected raw events do not alter assignedAgentId', () => {
  const input = { ...makeCleanInput(), events: DECEPTIVE_EVENTS, eventsByTaskId: new Map([['t1', DECEPTIVE_EVENTS]]) };
  const { nodes } = buildVisualWorldGraph(input);
  const t1 = nodes.find((n) => n.id === 't1');
  assert.equal(t1.metadata.assignedAgentId, 'w1',
    'assignedAgentId must come from the task snapshot, not from injected TASK_CLAIMED payload');
});

test('event isolation: injected raw events do not create extra nodes', () => {
  const input = {
    ...makeCleanInput(),
    events: [
      ...DECEPTIVE_EVENTS,
      { type: 'TASK_CREATED', taskId: 'injected-task-99', timestamp: 100, payload: {} }
    ]
  };
  const { nodes } = buildVisualWorldGraph(input);
  const ids = nodes.map((n) => n.id);
  assert.ok(!ids.includes('injected-task-99'),
    'raw event taskIds must not produce new nodes');
});

test('event isolation: injected raw events do not create extra edges', () => {
  const input = { ...makeCleanInput(), events: DECEPTIVE_EVENTS };
  const clean  = buildVisualWorldGraph(makeCleanInput());
  const tainted = buildVisualWorldGraph(input);
  assert.equal(serial(clean.edges), serial(tainted.edges),
    'edges must be identical regardless of raw event injection');
});

// ─── 3. Raw event fields inside task/transition objects do not leak out ───────

test('event isolation: raw _events field on task snapshot does not appear in node output', () => {
  const input = makeCleanInput();
  // Smuggle a raw event array inside the task snapshot object
  input.tasks[0]._events = DECEPTIVE_EVENTS;
  input.tasks[0].events  = DECEPTIVE_EVENTS;
  const { nodes } = buildVisualWorldGraph(input);
  const t1 = nodes.find((n) => n.id === 't1');
  assert.ok(!('_events' in t1),         'node must not expose _events');
  assert.ok(!('events' in t1),          'node must not expose events');
  assert.ok(!('_events' in t1.metadata),'node.metadata must not expose _events');
  assert.ok(!('events' in t1.metadata), 'node.metadata must not expose events');
});

test('event isolation: raw events inside transition object do not appear in edge output', () => {
  const input = makeCleanInput();
  // Smuggle raw events into the transition object alongside valid timestamps
  const t1trans = input.transitions.get('t1');
  t1trans._events = DECEPTIVE_EVENTS;
  t1trans.events  = DECEPTIVE_EVENTS;
  const { edges } = buildVisualWorldGraph(input);
  for (const edge of edges.filter((e) => e.taskId === 't1')) {
    assert.ok(!('_events' in edge), `edge "${edge.id}" must not expose _events`);
    assert.ok(!('events' in edge),  `edge "${edge.id}" must not expose events`);
  }
});

// ─── 4. Graph is fully built with selector fields only — no raw events needed ─

test('event isolation: graph is complete and correct with no raw event fields at all', () => {
  const input = makeCleanInput();
  // Explicitly confirm no raw event fields are present
  assert.ok(!('events' in input));
  assert.ok(!('eventsByTaskId' in input));
  assert.ok(!('eventsByWorkerId' in input));

  const { nodes, edges } = buildVisualWorldGraph(input);

  assert.equal(nodes.filter((n) => n.type === 'task').length, 2,  'both task nodes present');
  assert.equal(nodes.filter((n) => n.type === 'worker').length, 1, 'worker node present');
  // t1 has full lifecycle → 4 lifecycle edges + 1 assignment edge
  const t1Edges = edges.filter((e) => e.taskId === 't1');
  assert.equal(t1Edges.length, 5, 't1 must have 4 lifecycle + 1 assignment edge');
  // t2 only created+enqueued → 1 lifecycle edge, no assignment
  const t2Edges = edges.filter((e) => e.taskId === 't2');
  assert.equal(t2Edges.length, 1, 't2 must have exactly 1 lifecycle edge');
});

test('event isolation: graph output is identical whether raw event fields are present or absent', () => {
  const clean   = buildVisualWorldGraph(makeCleanInput());
  const tainted = buildVisualWorldGraph({
    ...makeCleanInput(),
    events:          DECEPTIVE_EVENTS,
    eventsByTaskId:  new Map([['t1', DECEPTIVE_EVENTS]]),
    eventsByWorkerId: new Map([['w1', DECEPTIVE_EVENTS]])
  });
  assert.equal(serial(clean.nodes),  serial(tainted.nodes),  'nodes must be identical');
  assert.equal(serial(clean.edges),  serial(tainted.edges),  'edges must be identical');
  assert.deepStrictEqual(clean.metadata, tainted.metadata,   'metadata must be identical');
});
