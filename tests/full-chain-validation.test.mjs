import test from 'node:test';
import assert from 'node:assert/strict';

// ── Layer imports ─────────────────────────────────────────────────────────────
import { deriveWorldState }       from '../core/world/deriveWorldState.js';
import { buildVisualWorldGraph }  from '../core/world/buildVisualWorldGraph.js';

// selectors
import { getAllTasks, getAllDesks, getTaskTransitionTimestamps } from '../ui/selectors/taskSelectors.js';
import { getAllAgents }            from '../ui/selectors/agentSelectors.js';
import { getQueueTime, getExecutionDuration, getAckLatency }    from '../ui/selectors/metricsSelectors.js';
import { getIncidentClusters }    from '../ui/selectors/anomalySelectors.js';

/**
 * full-chain-validation.test.mjs
 *
 * End-to-end contract tests for the complete pipeline:
 *
 *   raw events
 *     → deriveWorldState          (indexing only)
 *     → selectors                 (pure derivation)
 *     → buildVisualWorldGraph     (graph assembly)
 *     → graph output              (renderer input contract)
 *
 * Asserts:
 *  1. Stable output     — identical results across repeated runs
 *  2. Deterministic graph — same events always produce the same graph
 *  3. No layer leakage  — graph output contains no raw event objects or world-state internals
 *  4. No raw event access after selectors — graph fields contain only selector-derived values
 */

// ─── Fixed event corpus ───────────────────────────────────────────────────────

const WORKER_A = 'worker-alpha';
const WORKER_B = 'worker-beta';
const T1 = 'chain-task-1';
const T2 = 'chain-task-2';
const T3 = 'chain-task-3';

const FIXED_NOW = 5_000_000;

/**
 * Canonical event sequence used throughout.
 * All timestamps are literals — no Date.now(), no tick counter.
 */
const FIXED_EVENTS = Object.freeze([
  // T1 — full lifecycle, acknowledged success
  { type: 'TASK_CREATED',          taskId: T1, timestamp: 1000, payload: { title: 'Chain Task One',   type: 'standard' } },
  { type: 'TASK_ENQUEUED',         taskId: T1, timestamp: 1100, payload: {} },
  { type: 'TASK_CLAIMED',          taskId: T1, timestamp: 1200, payload: { workerId: WORKER_A } },
  { type: 'TASK_EXECUTE_STARTED',  taskId: T1, timestamp: 1300, payload: { workerId: WORKER_A } },
  { type: 'TASK_EXECUTE_FINISHED', taskId: T1, timestamp: 1900, payload: { workerId: WORKER_A } },
  { type: 'TASK_ACKED',            taskId: T1, timestamp: 2000, payload: { status: 'acknowledged', success: true } },

  // T2 — failed acknowledgement
  { type: 'TASK_CREATED',          taskId: T2, timestamp: 1050, payload: { title: 'Chain Task Two',   type: 'urgent' } },
  { type: 'TASK_ENQUEUED',         taskId: T2, timestamp: 1150, payload: {} },
  { type: 'TASK_CLAIMED',          taskId: T2, timestamp: 1250, payload: { workerId: WORKER_B } },
  { type: 'TASK_EXECUTE_STARTED',  taskId: T2, timestamp: 1350, payload: { workerId: WORKER_B } },
  { type: 'TASK_EXECUTE_FINISHED', taskId: T2, timestamp: 1800, payload: { workerId: WORKER_B } },
  { type: 'TASK_ACKED',            taskId: T2, timestamp: 1850, payload: { status: 'failed', error: 'timeout' } },

  // T3 — partial: only enqueued, no worker assigned
  { type: 'TASK_CREATED',  taskId: T3, timestamp: 1500, payload: { title: 'Chain Task Three', type: 'standard' } },
  { type: 'TASK_ENQUEUED', taskId: T3, timestamp: 1510, payload: {} }
]);

// System events (must not affect graph structure)
const SYSTEM_EVENTS_RAW = Object.freeze([
  { type: 'TASK_NOTIFICATION_SENT',    taskId: T1, timestamp: 2010, payload: {} },
  { type: 'TASK_NOTIFICATION_FAILED',  taskId: T2, timestamp: 1860, payload: { reason: 'send_error' } },
  { type: 'TASK_NOTIFICATION_SKIPPED', taskId: T3, timestamp: 1520, payload: { reason: 'no_channel' } }
]);

// ─── Pipeline runner ──────────────────────────────────────────────────────────

/**
 * Runs the complete pipeline and returns both the selector layer outputs
 * and the assembled graph. `now` is always a fixed constant.
 */
function runChain(opts = {}) {
  const events = Array.isArray(opts.events) ? opts.events : FIXED_EVENTS;
  const now = FIXED_NOW;

  // Layer 1 — indexing
  const world = deriveWorldState([...events]);

  // Layer 2 — selectors
  const tasks       = getAllTasks(world);
  const agents      = getAllAgents(world);
  const transitions = new Map(tasks.map((t) => [t.id, getTaskTransitionTimestamps(world, t.id)]));
  const metrics     = new Map(tasks.map((t) => [t.id, {
    queueTime:   getQueueTime(world, t.id),
    duration:    getExecutionDuration(world, t.id),
    ackLatency:  getAckLatency(world, t.id)
  }]));
  const incidents   = getIncidentClusters(world, { now, includeSystemEvents: false });

  // System events (for observability overlay only)
  const systemEventsAll = [...events, ...(opts.withSystemEvents ? SYSTEM_EVENTS_RAW : [])];
  const systemEventsByTaskId = new Map();
  for (const ev of systemEventsAll) {
    const isSystem = ['TASK_NOTIFICATION_SENT', 'TASK_NOTIFICATION_FAILED', 'TASK_NOTIFICATION_SKIPPED'].includes(ev.type);
    if (!isSystem) { continue; }
    if (!systemEventsByTaskId.has(ev.taskId)) { systemEventsByTaskId.set(ev.taskId, []); }
    systemEventsByTaskId.get(ev.taskId).push(ev);
  }

  // Layer 3 — graph assembly
  const input = { tasks, agents, transitions, metrics, incidents, systemEvents: systemEventsByTaskId };
  const graph = buildVisualWorldGraph(input, { observability: !!opts.observability });

  return { world, tasks, agents, transitions, metrics, incidents, graph };
}

/** Stable serialiser for deep-equality comparisons across runs. */
function serial(v) {
  return JSON.stringify(v, (_k, val) => {
    if (val instanceof Map) {
      return { __Map__: Array.from(val.entries()).sort(([a], [b]) => String(a).localeCompare(String(b))) };
    }
    return val;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. STABLE OUTPUT — identical results across repeated runs
// ═══════════════════════════════════════════════════════════════════════════════

test('chain: graph nodes are identical across two independent pipeline runs', () => {
  const a = runChain();
  const b = runChain();
  assert.equal(serial(a.graph.nodes), serial(b.graph.nodes));
});

test('chain: graph edges are identical across two independent pipeline runs', () => {
  const a = runChain();
  const b = runChain();
  assert.equal(serial(a.graph.edges), serial(b.graph.edges));
});

test('chain: selector outputs are identical across two independent runs', () => {
  const a = runChain();
  const b = runChain();
  assert.equal(serial(a.tasks),    serial(b.tasks),    'tasks must be stable');
  assert.equal(serial(a.agents),   serial(b.agents),   'agents must be stable');
  assert.equal(serial(a.metrics),  serial(b.metrics),  'metrics must be stable');
  assert.equal(serial(a.incidents),serial(b.incidents),'incidents must be stable');
});

test('chain: running the pipeline ten times produces the same graph each time', () => {
  const baseline = serial(runChain().graph);
  for (let i = 1; i < 10; i++) {
    assert.equal(serial(runChain().graph), baseline, `Run ${i + 1} diverged`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DETERMINISTIC GRAPH — correct values derived from fixed events
// ═══════════════════════════════════════════════════════════════════════════════

test('chain: graph contains exactly one node per task plus one per agent', () => {
  const { graph } = runChain();
  const taskNodes   = graph.nodes.filter((n) => n.type === 'task');
  const workerNodes = graph.nodes.filter((n) => n.type === 'worker');
  assert.equal(taskNodes.length,   3, '3 task nodes from 3 tasks');
  assert.equal(workerNodes.length, 2, '2 worker nodes from 2 workers');
});

test('chain: T1 node has status "completed" after full acknowledged lifecycle', () => {
  const { graph } = runChain();
  const node = graph.nodes.find((n) => n.id === T1);
  assert.equal(node.status, 'completed');
});

test('chain: T2 node has status "failed" after failed acknowledgement', () => {
  const { graph } = runChain();
  const node = graph.nodes.find((n) => n.id === T2);
  assert.equal(node.status, 'failed');
});

test('chain: T3 node has status "queued" with only CREATED+ENQUEUED', () => {
  const { graph } = runChain();
  const node = graph.nodes.find((n) => n.id === T3);
  assert.equal(node.status, 'queued');
});

test('chain: T1 has all 4 lifecycle edges plus 1 assignment edge', () => {
  const { graph } = runChain();
  const t1Edges = graph.edges.filter((e) => e.taskId === T1);
  const lifecycle   = t1Edges.filter((e) => !e.type);
  const assignment  = t1Edges.filter((e) => e.type === 'assignment');
  assert.equal(lifecycle.length,  4, 'T1 must have 4 lifecycle edges');
  assert.equal(assignment.length, 1, 'T1 must have 1 assignment edge');
});

test('chain: T3 has exactly 1 lifecycle edge (CREATED→ENQUEUED) and no assignment edge', () => {
  const { graph } = runChain();
  const t3Edges = graph.edges.filter((e) => e.taskId === T3);
  assert.equal(t3Edges.length, 1, 'T3 must have exactly 1 edge');
  assert.equal(t3Edges[0].from, 'CREATED');
  assert.equal(t3Edges[0].to,   'ENQUEUED');
});

test('chain: T1 lifecycle edge timestamps match FIXED_EVENTS literals', () => {
  const { graph } = runChain();
  const t1Edges = graph.edges.filter((e) => e.taskId === T1 && !e.type);
  const byStep = Object.fromEntries(t1Edges.map((e) => [`${e.from}->${e.to}`, e]));
  assert.equal(byStep['CREATED->ENQUEUED'].fromAt,  1000);
  assert.equal(byStep['CREATED->ENQUEUED'].toAt,    1100);
  assert.equal(byStep['ENQUEUED->CLAIMED'].fromAt,  1100);
  assert.equal(byStep['ENQUEUED->CLAIMED'].toAt,    1200);
  assert.equal(byStep['CLAIMED->EXECUTED'].fromAt,  1200);
  assert.equal(byStep['CLAIMED->EXECUTED'].toAt,    1300);
  assert.equal(byStep['EXECUTED->ACKED'].fromAt,    1900);
  assert.equal(byStep['EXECUTED->ACKED'].toAt,      2000);
});

test('chain: T1 node metrics are correctly derived from selector layer', () => {
  const { graph } = runChain();
  const node = graph.nodes.find((n) => n.id === T1);
  // queueTime = EXECUTE_STARTED - CREATED = 1300 - 1000 = 300
  assert.equal(node.metadata.queueTime,  300);
  // duration  = EXECUTE_FINISHED - EXECUTE_STARTED = 1900 - 1300 = 600
  assert.equal(node.metadata.duration,   600);
  // ackLatency = TASK_ACKED - EXECUTE_FINISHED = 2000 - 1900 = 100
  assert.equal(node.metadata.ackLatency, 100);
});

test('chain: T3 node metrics are all null (lifecycle incomplete)', () => {
  const { graph } = runChain();
  const node = graph.nodes.find((n) => n.id === T3);
  assert.equal(node.metadata.queueTime,  null);
  assert.equal(node.metadata.duration,   null);
  assert.equal(node.metadata.ackLatency, null);
});

test('chain: T2 failure is reflected in incident cluster on its node', () => {
  const { graph } = runChain();
  const node = graph.nodes.find((n) => n.id === T2);
  const failureCluster = node.metadata.incidents.find((c) => c.clusterType === 'execution_failures');
  assert.ok(failureCluster, 'T2 node must carry an execution_failures incident reference');
  assert.equal(failureCluster.severity, 'high');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. NO LAYER LEAKAGE — graph contains no raw event objects or world internals
// ═══════════════════════════════════════════════════════════════════════════════

test('chain: no node carries a raw event object', () => {
  const { graph } = runChain();
  const graphStr = serial(graph);
  // A raw event always has a canonical "type" that starts with TASK_
  assert.ok(!/\"TASK_CREATED\"|\"TASK_ENQUEUED\"|\"TASK_CLAIMED\"|\"TASK_EXECUTE_STARTED\"|\"TASK_EXECUTE_FINISHED\"|\"TASK_ACKED\"/.test(graphStr),
    'graph serialisation must not contain canonical event type strings');
});

test('chain: no graph field is or contains an eventsByTaskId Map', () => {
  const { graph } = runChain();
  function walk(obj, path) {
    if (obj === null || typeof obj !== 'object') { return; }
    if (obj instanceof Map) {
      for (const [k, v] of obj) { walk(v, `${path}[${k}]`); }
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      assert.ok(k !== 'eventsByTaskId',  `graph path "${path}.${k}" must not expose eventsByTaskId`);
      assert.ok(k !== 'eventsByWorkerId',`graph path "${path}.${k}" must not expose eventsByWorkerId`);
      assert.ok(k !== 'events' || !Array.isArray(v) || v.length === 0 || typeof v[0].type !== 'string',
        `graph path "${path}.${k}" must not contain raw event arrays`);
      walk(v, `${path}.${k}`);
    }
  }
  walk(graph, 'graph');
});

test('chain: no graph node metadata contains a raw events array', () => {
  const { graph } = runChain();
  for (const node of graph.nodes) {
    for (const [key, value] of Object.entries(node.metadata)) {
      if (Array.isArray(value) && value.length > 0) {
        for (const item of value) {
          assert.ok(
            typeof item !== 'object' || item === null || !('type' in item && 'timestamp' in item && 'payload' in item),
            `node "${node.id}" metadata.${key} must not contain raw event objects`
          );
        }
      }
    }
  }
});

test('chain: world-state internals (eventsByTaskId/eventsByWorkerId) are absent from graph', () => {
  const { graph } = runChain();
  assert.ok(!('eventsByTaskId'   in graph), 'graph must not expose eventsByTaskId');
  assert.ok(!('eventsByWorkerId' in graph), 'graph must not expose eventsByWorkerId');
  assert.ok(!('events'           in graph), 'graph must not expose raw events array');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. NO RAW EVENT ACCESS AFTER SELECTORS — observability overlay boundary
// ═══════════════════════════════════════════════════════════════════════════════

test('chain: system events present in overlay do not affect nodes', () => {
  const clean   = runChain({ withSystemEvents: false });
  const overlay = runChain({ withSystemEvents: true, observability: true });
  assert.equal(serial(clean.graph.nodes), serial(overlay.graph.nodes),
    'system events in overlay must not alter nodes');
});

test('chain: system events present in overlay do not affect edges', () => {
  const clean   = runChain({ withSystemEvents: false });
  const overlay = runChain({ withSystemEvents: true, observability: true });
  assert.equal(serial(clean.graph.edges), serial(overlay.graph.edges),
    'system events in overlay must not alter edges');
});

test('chain: observability overlay contains only system events, not lifecycle events', () => {
  const LIFECYCLE_TYPES = new Set([
    'TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED',
    'TASK_EXECUTE_STARTED', 'TASK_EXECUTE_FINISHED', 'TASK_ACKED'
  ]);
  const { graph } = runChain({ withSystemEvents: true, observability: true });
  for (const [, evts] of graph.observability.byTaskId) {
    for (const ev of evts) {
      assert.ok(!LIFECYCLE_TYPES.has(ev.type),
        `overlay must not contain lifecycle event "${ev.type}"`);
    }
  }
});

test('chain: observability overlay is empty when disabled, even with system events in input', () => {
  const { graph } = runChain({ withSystemEvents: true, observability: false });
  assert.equal(graph.observability.enabled, false);
  assert.equal(graph.observability.byTaskId.size, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. CROSS-LAYER CONSISTENCY — selector outputs are reflected accurately in graph
// ═══════════════════════════════════════════════════════════════════════════════

test('chain: every task returned by getAllTasks() has a corresponding graph node', () => {
  const { tasks, graph } = runChain();
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const task of tasks) {
    assert.ok(nodeIds.has(task.id), `task "${task.id}" from selector has no graph node`);
  }
});

test('chain: every agent returned by getAllAgents() has a corresponding graph node', () => {
  const { agents, graph } = runChain();
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const agent of agents) {
    assert.ok(nodeIds.has(agent.id), `agent "${agent.id}" from selector has no graph node`);
  }
});

test('chain: graph node status matches selector-derived task status', () => {
  const { tasks, graph } = runChain();
  for (const task of tasks) {
    const node = graph.nodes.find((n) => n.id === task.id);
    assert.ok(node, `node for task "${task.id}" must exist`);
    assert.equal(node.status, task.status,
      `node.status for "${task.id}" must equal selector task.status`);
  }
});

test('chain: graph edge count for T1 matches transition timestamps populated by selector', () => {
  const { transitions, graph } = runChain();
  const t1trans = transitions.get(T1);
  // Count how many LIFECYCLE_STEPS have both timestamps non-null in selector output
  const STEPS = [
    ['createdAt', 'queuedAt'],
    ['queuedAt',  'claimedAt'],
    ['claimedAt', 'executingAt'],
    ['awaitingAckAt', 'ackedAt']
  ];
  const expectedLifecycleEdges = STEPS.filter(([f, t]) => t1trans[f] != null && t1trans[t] != null).length;
  const actualLifecycleEdges   = graph.edges.filter((e) => e.taskId === T1 && !e.type).length;
  assert.equal(actualLifecycleEdges, expectedLifecycleEdges,
    'lifecycle edge count must match populated selector transition slots');
});

test('chain: adding extra unrelated events does not affect existing task nodes', () => {
  const base    = runChain();
  const extra   = [
    ...FIXED_EVENTS,
    { type: 'TASK_CREATED',  taskId: 'extra-99', timestamp: 9000, payload: { title: 'Extra' } },
    { type: 'TASK_ENQUEUED', taskId: 'extra-99', timestamp: 9100, payload: {} }
  ];
  const augmented = runChain({ events: extra });

  for (const taskId of [T1, T2, T3]) {
    const baseNode = base.graph.nodes.find((n) => n.id === taskId);
    const augNode  = augmented.graph.nodes.find((n) => n.id === taskId);
    assert.equal(serial(baseNode), serial(augNode),
      `node for "${taskId}" must be unchanged when unrelated tasks are added`);
  }
});
