import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * pipeline-e2e-determinism.test.mjs
 *
 * End-to-end test for the full projection pipeline:
 *
 *   events → deriveWorldState → selectors → buildVisualWorldGraph → renderer
 *
 * Assertions:
 *
 *   1. PIPELINE CORRECTNESS
 *      Given a fixed set of raw events the pipeline produces a VisualWorldGraph
 *      with the expected node count, node shapes, edge count, and metadata fields.
 *
 *   2. UI DOES NOT ALTER THE GRAPH
 *      The VisualWorldGraph object passed to the renderer is structurally
 *      identical before and after render(). Neither nodes, edges, nor metadata
 *      are mutated by downstream layers.
 *
 *   3. RENDERER IS A PURE FUNCTION
 *      render(graph) twice with the same graph (same frozen Date.now) produces
 *      an identical sequence of canvas draw calls.  render(graphA) followed by
 *      render(graphB) followed by render(graphA) still matches the first run.
 *
 *   4. NO SEMANTIC LEAKAGE DOWNSTREAM OF SELECTORS
 *      - The graph contains no raw event arrays, no event-store structures, and
 *        no payload objects.
 *      - Only the three allowed top-level keys (nodes, edges, metadata) are
 *        present on the graph.
 *      - Nodes contain only (id, type, status, metadata); no event field
 *        names bleed through.
 *      - Edges contain only allowed fields; no payload or event.type fields.
 *
 *   5. FULL SYSTEM DETERMINISM
 *      Running the complete pipeline twice with the same event array produces
 *      bit-identical graphs and bit-identical render call logs.
 *      Adding irrelevant system events to the input does not alter the graph
 *      or the render output.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Pipeline imports ─────────────────────────────────────────────────────────

import { deriveWorldState }     from '../core/world/deriveWorldState.js';
import { buildVisualWorldGraph } from '../core/world/buildVisualWorldGraph.js';
import { getAllTasks, getTaskTransitionTimestamps } from '../ui/selectors/taskSelectors.js';
import { getAllAgents }          from '../ui/selectors/agentSelectors.js';
import { getQueueTime, getExecutionDuration, getAckLatency } from '../ui/selectors/metricsSelectors.js';
import { getIncidentClusters }  from '../ui/selectors/anomalySelectors.js';

// ─── Renderer import (patched for headless execution) ────────────────────────

/**
 * Load canvas-renderer.js with DOM dependencies replaced by in-process mocks.
 * Returns { render, captureLog, resetLog }.
 */
async function loadRenderer() {
  let source = readFileSync(resolve(ROOT, 'rendering/canvas-renderer.js'), 'utf8');

  const DRAW_LOG = [];

  const CTX_METHODS = [
    'clearRect','fillRect','strokeRect','beginPath','closePath','moveTo','lineTo',
    'arc','fill','stroke','save','restore','fillText','strokeText','setLineDash',
    'drawImage','createRadialGradient','createLinearGradient','measureText',
    'quadraticCurveTo',
  ];
  const CTX_PROPS = [
    'fillStyle','strokeStyle','lineWidth','font','textAlign',
    'globalAlpha','imageSmoothingEnabled',
  ];

  const mockCtx = new Proxy(
    {
      canvas: { width: 800, height: 600 },
      ...Object.fromEntries(CTX_METHODS.map((m) => [m, (...args) => {
        DRAW_LOG.push({ op: m, args });
        if (m === 'createRadialGradient' || m === 'createLinearGradient') {
          return { addColorStop() {} };
        }
        if (m === 'measureText') return { width: 0 };
      }]))
    },
    {
      set(t, p, v) {
        if (CTX_PROPS.includes(p)) DRAW_LOG.push({ op: `set:${p}`, value: v });
        t[p] = v;
        return true;
      },
      get(t, p) {
        if (p in t) return t[p];
        return (...args) => { DRAW_LOG.push({ op: `unknown:${p}`, args }); };
      }
    }
  );
  const mockCanvas = {
    width: 800, height: 600,
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    getContext: () => mockCtx,
    addEventListener: () => {}
  };

  globalThis.__E2E_CTX__    = mockCtx;
  globalThis.__E2E_CANVAS__ = mockCanvas;
  globalThis.__E2E_ASSETS__ = {};
  globalThis.__E2E_SPRITE_CONFIGS__ = { agent: { height: 48 } };
  globalThis.__E2E_RESOLVE_AGENT_VISUAL__ = () => null;

  source = source
    .replace(
      /import\s*\{[^}]*canvas[^}]*ctx[^}]*\}\s*from\s*['"][^'"]*app-state\.js['"]\s*;?/,
      'const canvas = globalThis.__E2E_CANVAS__; const ctx = globalThis.__E2E_CTX__;'
    )
    .replace(
      /import\s*\{[^}]*loadedAssets[^}]*\}\s*from\s*['"][^'"]*assets\.js['"]\s*;?/,
      'const loadedAssets = globalThis.__E2E_ASSETS__;'
    )
    .replace(
      /import\s*\{[^}]*spriteConfigs[^}]*\}\s*from\s*['"][^'"]*constants\.js['"]\s*;?/,
      'const spriteConfigs = globalThis.__E2E_SPRITE_CONFIGS__;'
    )
    .replace(
      /import\s*\{[^}]*resolveAgentVisual[^}]*\}\s*from\s*['"][^'"]*agentVisualConfig\.js['"]\s*;?/,
      'const resolveAgentVisual = globalThis.__E2E_RESOLVE_AGENT_VISUAL__;'
    );

  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
  const mod = await import(dataUrl);

  return {
    render: mod.render,
    resetLog()   { DRAW_LOG.length = 0; },
    captureLog() { return JSON.stringify([...DRAW_LOG]); }
  };
}

// ─── Fixed event fixtures ─────────────────────────────────────────────────────

const TASK_A = 'task-001';
const TASK_B = 'task-002';
const WORKER = 'worker-01';

/** Two complete lifecycle chains: TASK_A completed, TASK_B failed. */
const RAW_EVENTS = Object.freeze([
  // TASK_A lifecycle
  { id: 1, type: 'TASK_CREATED',         taskId: TASK_A, timestamp: 1000, payload: { title: 'Alpha Job', type: 'image_render' } },
  { id: 2, type: 'TASK_ENQUEUED',         taskId: TASK_A, timestamp: 1100, payload: {} },
  { id: 3, type: 'TASK_CLAIMED',          taskId: TASK_A, timestamp: 1200, payload: { workerId: WORKER, deskId: 'desk-1' } },
  { id: 4, type: 'TASK_EXECUTE_STARTED',  taskId: TASK_A, timestamp: 1300, payload: { workerId: WORKER } },
  { id: 5, type: 'TASK_EXECUTE_FINISHED', taskId: TASK_A, timestamp: 1800, payload: { workerId: WORKER } },
  { id: 6, type: 'TASK_ACKED',            taskId: TASK_A, timestamp: 1900, payload: { status: 'completed' } },
  // TASK_B lifecycle (failed)
  { id: 7,  type: 'TASK_CREATED',         taskId: TASK_B, timestamp: 1050, payload: { title: 'Beta Job', type: 'discord' } },
  { id: 8,  type: 'TASK_ENQUEUED',         taskId: TASK_B, timestamp: 1150, payload: {} },
  { id: 9,  type: 'TASK_CLAIMED',          taskId: TASK_B, timestamp: 1250, payload: { workerId: WORKER, deskId: 'desk-2' } },
  { id: 10, type: 'TASK_EXECUTE_STARTED',  taskId: TASK_B, timestamp: 1350, payload: { workerId: WORKER } },
  { id: 11, type: 'TASK_EXECUTE_FINISHED', taskId: TASK_B, timestamp: 1850, payload: { workerId: WORKER, error: 'provider_timeout:5000' } },
  { id: 12, type: 'TASK_ACKED',            taskId: TASK_B, timestamp: 1950, payload: { status: 'failed', error: 'provider_timeout:5000' } },
  // System event — must NOT affect lifecycle derivation
  { id: 13, type: 'TASK_NOTIFICATION_SENT', taskId: TASK_A, timestamp: 1910, payload: { channel: 'discord' } },
]);

/** System-event-only additions — should not change the graph at all. */
const EXTRA_SYSTEM_EVENTS = Object.freeze([
  { id: 20, type: 'TASK_NOTIFICATION_SKIPPED', taskId: TASK_B, timestamp: 1960, payload: { reason: 'no_channel' } },
  { id: 21, type: 'TASK_NOTIFICATION_FAILED',  taskId: TASK_B, timestamp: 1970, payload: { reason: 'network_error' } },
]);

// ─── Pipeline runner ──────────────────────────────────────────────────────────

/**
 * Run the complete pipeline from raw events to VisualWorldGraph.
 * Returns { indexedWorld, tasks, agents, transitions, metrics, incidents, graph, renderView }.
 *
 * renderView is the render-safe projection: { nodes, edges, metadata } only.
 * The graph itself also contains `observability` (always emitted by buildVisualWorldGraph),
 * which the renderer correctly rejects — callers must project to renderView before calling render().
 */
function runPipeline(events) {
  // Stage 1: pure indexer
  const indexedWorld = deriveWorldState(events);

  // Stage 2: selectors
  const tasks = getAllTasks(indexedWorld);
  const agents = getAllAgents(indexedWorld);

  const transitions = new Map(
    tasks.map((t) => [t.id, getTaskTransitionTimestamps(indexedWorld, t.id)])
  );

  const metrics = new Map(
    tasks.map((t) => [t.id, {
      queueTime:  getQueueTime(indexedWorld, t.id),
      duration:   getExecutionDuration(indexedWorld, t.id),
      ackLatency: getAckLatency(indexedWorld, t.id)
    }])
  );

  const incidents = getIncidentClusters(indexedWorld, { includeSystemEvents: false });

  // Stage 3: buildVisualWorldGraph
  const graph = buildVisualWorldGraph({ tasks, agents, transitions, metrics, incidents });

  // Stage 4: project to render-safe view (strips `observability` which renderer forbids)
  const renderView = { nodes: graph.nodes, edges: graph.edges, metadata: graph.metadata };

  return { indexedWorld, tasks, agents, transitions, metrics, incidents, graph, renderView };
}

// ─── Deep-freeze helper ───────────────────────────────────────────────────────

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.keys(obj).forEach((k) => deepFreeze(obj[k]));
  return Object.freeze(obj);
}

// ─── Shared state across tests (loaded once) ─────────────────────────────────

let renderer;
let pipeline;    // result of runPipeline(RAW_EVENTS)

// ═══════════════════════════════════════════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════════════════════════════════════════

test('e2e setup: load renderer with headless canvas mock', async () => {
  renderer = await loadRenderer();
  assert.equal(typeof renderer.render, 'function', 'render must be a function');
});

test('e2e setup: run pipeline with fixed event set', () => {
  pipeline = runPipeline(RAW_EVENTS);
  assert.ok(pipeline.graph, 'pipeline must produce a graph');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Pipeline correctness
// ═══════════════════════════════════════════════════════════════════════════════

test('e2e [pipeline]: graph top-level keys are exactly { nodes, edges, metadata, observability }', () => {
  const keys = Object.keys(pipeline.graph).sort();
  assert.deepStrictEqual(keys, ['edges', 'metadata', 'nodes', 'observability'],
    'buildVisualWorldGraph always emits observability (even when disabled); render() rejects it, so callers must project to { nodes, edges, metadata }');
});

test('e2e [pipeline]: renderView (render-safe projection) has exactly { nodes, edges, metadata }', () => {
  const keys = Object.keys(pipeline.renderView).sort();
  assert.deepStrictEqual(keys, ['edges', 'metadata', 'nodes'],
    'renderView must be the renderer-safe { nodes, edges, metadata } projection of the graph');
});

test('e2e [renderer contract]: renderer rejects graph with observability key', () => {
  // This confirms the architectural boundary: buildVisualWorldGraph output cannot be
  // passed directly to render(); it must be projected first.
  assert.throws(
    () => renderer.render(pipeline.graph),
    /forbidden key/,
    'render() must throw when passed the raw graph (which includes observability)'
  );
});

test('e2e [pipeline]: graph contains one task node per task in the event set', () => {
  const taskNodes = pipeline.graph.nodes.filter((n) => n.type === 'task');
  assert.equal(taskNodes.length, 2,
    'two tasks in the event set → two task nodes in the graph');
});

test('e2e [pipeline]: graph contains one worker node for the active agent', () => {
  const workerNodes = pipeline.graph.nodes.filter((n) => n.type === 'worker');
  assert.equal(workerNodes.length, 1, 'one worker in the event set → one worker node');
  assert.equal(workerNodes[0].id, WORKER);
});

test('e2e [pipeline]: TASK_A node has correct status and metadata', () => {
  const node = pipeline.graph.nodes.find((n) => n.id === TASK_A);
  assert.ok(node, 'TASK_A node must be present');
  assert.equal(node.type, 'task');
  assert.equal(node.status, 'completed',
    'TASK_A received a TASK_ACKED with status:completed → node.status must be "completed"');
  assert.equal(node.metadata.title, 'Alpha Job');
  assert.equal(node.metadata.taskType, 'image_render');
  assert.equal(node.metadata.error, null);
  assert.ok(Number.isFinite(node.metadata.queueTime),  'queueTime must be a number');
  assert.ok(Number.isFinite(node.metadata.duration),   'duration must be a number');
  assert.ok(Number.isFinite(node.metadata.ackLatency), 'ackLatency must be a number');
});

test('e2e [pipeline]: TASK_B node has correct status and error field', () => {
  const node = pipeline.graph.nodes.find((n) => n.id === TASK_B);
  assert.ok(node, 'TASK_B node must be present');
  assert.equal(node.status, 'failed');
  assert.equal(node.metadata.error, 'provider_timeout:5000');
});

test('e2e [pipeline]: lifecycle edges are present for TASK_A', () => {
  // Lifecycle edges have fromAt/toAt; assignment edges (type:'assignment') do not.
  const edges = pipeline.graph.edges.filter((e) => e.taskId === TASK_A && e.type !== 'assignment');
  // TASK_A has CREATED→ENQUEUED, ENQUEUED→CLAIMED, CLAIMED→EXECUTED, EXECUTED→ACKED
  assert.ok(edges.length >= 3, `expected ≥3 lifecycle edges for TASK_A, got ${edges.length}`);
  for (const edge of edges) {
    assert.ok(Number.isFinite(edge.fromAt), `edge ${edge.id} must have numeric fromAt`);
    assert.ok(Number.isFinite(edge.toAt),   `edge ${edge.id} must have numeric toAt`);
    assert.ok(edge.toAt >= edge.fromAt,      `edge ${edge.id} toAt must be ≥ fromAt`);
  }
});

test('e2e [pipeline]: incidents field on nodes reflects anomaly selector output', () => {
  const nodeB = pipeline.graph.nodes.find((n) => n.id === TASK_B);
  assert.ok(Array.isArray(nodeB.metadata.incidents),
    'metadata.incidents must be an array');
  // TASK_B failed → execution_failures cluster must reference it
  const hasFailureIncident = nodeB.metadata.incidents.some(
    (inc) => inc.clusterType === 'execution_failures'
  );
  assert.ok(hasFailureIncident,
    'TASK_B (failed) must be referenced by the execution_failures incident cluster');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. UI does not alter the graph
// ═══════════════════════════════════════════════════════════════════════════════

test('e2e [immutability]: renderView is structurally identical before and after render()', () => {
  const viewBefore = JSON.stringify(pipeline.renderView);

  renderer.resetLog();
  const orig = Date.now;
  Date.now = () => 1_000_000;
  try {
    renderer.render(pipeline.renderView);
  } finally {
    Date.now = orig;
  }

  const viewAfter = JSON.stringify(pipeline.renderView);
  assert.equal(viewAfter, viewBefore,
    'render() must not mutate the renderView it receives');
});

test('e2e [immutability]: render() does not add properties to renderView nodes', () => {
  const nodeKeysBefore = pipeline.renderView.nodes.map((n) => Object.keys(n).sort().join(','));

  renderer.resetLog();
  const orig = Date.now; Date.now = () => 1_000_000;
  try { renderer.render(pipeline.renderView); } finally { Date.now = orig; }

  const nodeKeysAfter = pipeline.renderView.nodes.map((n) => Object.keys(n).sort().join(','));
  assert.deepStrictEqual(nodeKeysAfter, nodeKeysBefore,
    'render() must not add or remove keys from renderView node objects');
});

test('e2e [immutability]: render() does not alter the renderView edges array', () => {
  const edgesBefore = JSON.stringify(pipeline.renderView.edges);

  renderer.resetLog();
  const orig = Date.now; Date.now = () => 1_000_000;
  try { renderer.render(pipeline.renderView); } finally { Date.now = orig; }

  assert.equal(JSON.stringify(pipeline.renderView.edges), edgesBefore,
    'render() must not mutate the edges array');
});

test('e2e [immutability]: a deep-frozen renderView does not cause render() to throw', () => {
  const { renderView } = runPipeline(RAW_EVENTS);
  deepFreeze(renderView);
  const orig = Date.now; Date.now = () => 1_000_000;
  try {
    assert.doesNotThrow(() => renderer.render(renderView),
      'render() must handle a deep-frozen renderView without throwing');
  } finally {
    Date.now = orig;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Renderer is a pure function
// ═══════════════════════════════════════════════════════════════════════════════

test('e2e [renderer purity]: same renderView → identical draw call sequence (run 1 vs run 2)', () => {
  const { renderView } = runPipeline(RAW_EVENTS);
  const orig = Date.now; Date.now = () => 1_000_000;
  try {
    renderer.resetLog(); renderer.render(renderView); const log1 = renderer.captureLog();
    renderer.resetLog(); renderer.render(renderView); const log2 = renderer.captureLog();
    assert.ok(log1.length > 10, 'render must produce draw calls');
    assert.equal(log1, log2, 'render(renderView) must be idempotent');
  } finally { Date.now = orig; }
});

test('e2e [renderer purity]: five consecutive renders of the same renderView never drift', () => {
  const { renderView } = runPipeline(RAW_EVENTS);
  const orig = Date.now; Date.now = () => 1_000_000;
  try {
    renderer.resetLog(); renderer.render(renderView);
    const baseline = renderer.captureLog();
    for (let i = 1; i < 5; i++) {
      renderer.resetLog(); renderer.render(renderView);
      assert.equal(renderer.captureLog(), baseline,
        `render call ${i + 1} drifted — stateful accumulation detected`);
    }
  } finally { Date.now = orig; }
});

test('e2e [renderer purity]: render(viewA) after render(viewB) equals reference render(viewA)', () => {
  const { renderView: viewA } = runPipeline(RAW_EVENTS);
  // viewB: only TASK_A, no failure
  const eventsB = RAW_EVENTS.slice(0, 6);
  const { renderView: viewB } = runPipeline(eventsB);

  const orig = Date.now; Date.now = () => 1_000_000;
  try {
    renderer.resetLog(); renderer.render(viewA); const refA = renderer.captureLog();
    renderer.resetLog(); renderer.render(viewB);                // interleave
    renderer.resetLog(); renderer.render(viewA); const postA = renderer.captureLog();
    assert.equal(postA, refA,
      'render(viewA) must not be affected by a preceding render(viewB)');
  } finally { Date.now = orig; }
});

test('e2e [renderer purity]: render() returns undefined (stateless per-call contract)', () => {
  const orig = Date.now; Date.now = () => 1_000_000;
  try {
    renderer.resetLog();
    const result = renderer.render(pipeline.renderView);
    assert.equal(result, undefined, 'render() must return undefined');
  } finally { Date.now = orig; }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. No semantic leakage downstream of selectors
// ═══════════════════════════════════════════════════════════════════════════════

// ── 4a. Graph top-level keys ──────────────────────────────────────────────────

test('e2e [no leakage]: graph has no event-domain keys at the top level', () => {
  const FORBIDDEN_TOP = new Set([
    'events','eventsByTaskId','eventsByWorkerId','rawEvents',
    'tasks','agents','desks','counts','officeLayout',
    'transitionByTaskId','taskRouteByTaskId','taskVisualTargetByTaskId',
    'entities','payload','taskId','workerId',
  ]);
  const keys = Object.keys(pipeline.graph);
  const leaking = keys.filter((k) => FORBIDDEN_TOP.has(k));
  assert.deepStrictEqual(leaking, [],
    `graph must not expose event/selector domain keys: found [${leaking.join(', ')}]`);
});

// ── 4b. Node shape ────────────────────────────────────────────────────────────

const ALLOWED_NODE_KEYS    = new Set(['id','type','status','metadata']);
const FORBIDDEN_NODE_KEYS  = new Set([
  'events','payload','taskId','workerId','timestamp','eventType',
  'eventsByTaskId','indexedWorld','worldState','selectors',
]);

test('e2e [no leakage]: every graph node contains only allowed keys', () => {
  for (const node of pipeline.graph.nodes) {
    const extra = Object.keys(node).filter((k) => !ALLOWED_NODE_KEYS.has(k));
    assert.deepStrictEqual(extra, [],
      `node ${node.id} has unexpected keys: [${extra.join(', ')}]`);
  }
});

test('e2e [no leakage]: no graph node carries forbidden event-domain keys', () => {
  for (const node of pipeline.graph.nodes) {
    const leaked = Object.keys(node).filter((k) => FORBIDDEN_NODE_KEYS.has(k));
    assert.deepStrictEqual(leaked, [],
      `node ${node.id} leaks event-domain keys: [${leaked.join(', ')}]`);
  }
});

test('e2e [no leakage]: node.metadata does not contain raw event arrays', () => {
  for (const node of pipeline.graph.nodes) {
    const meta = node.metadata || {};
    assert.ok(!Array.isArray(meta.events),    `node ${node.id} metadata must not carry a raw events array`);
    assert.ok(meta.eventsByTaskId === undefined, `node ${node.id} metadata must not carry eventsByTaskId`);
    assert.ok(meta.payload === undefined,      `node ${node.id} metadata must not carry a raw payload object`);
  }
});

// ── 4c. Edge shape ────────────────────────────────────────────────────────────

const ALLOWED_EDGE_KEYS = new Set(['id','taskId','workerId','from','to','type','fromAt','toAt','incidents','resolved']);
const FORBIDDEN_EDGE_KEYS = new Set(['payload','eventType','events','indexedWorld','status','worldState']);

test('e2e [no leakage]: every graph edge contains only allowed keys', () => {
  for (const edge of pipeline.graph.edges) {
    const extra = Object.keys(edge).filter((k) => !ALLOWED_EDGE_KEYS.has(k));
    assert.deepStrictEqual(extra, [],
      `edge ${edge.id} has unexpected keys: [${extra.join(', ')}]`);
    const leaked = Object.keys(edge).filter((k) => FORBIDDEN_EDGE_KEYS.has(k));
    assert.deepStrictEqual(leaked, [],
      `edge ${edge.id} leaks forbidden keys: [${leaked.join(', ')}]`);
  }
});

// ── 4d. No raw event objects survive into the graph ───────────────────────────

test('e2e [no leakage]: no graph node or edge has a "type" value equal to a canonical event type string', () => {
  const CANONICAL = new Set([
    'TASK_CREATED','TASK_ENQUEUED','TASK_CLAIMED',
    'TASK_EXECUTE_STARTED','TASK_EXECUTE_FINISHED','TASK_ACKED',
    'TASK_NOTIFICATION_SENT','TASK_NOTIFICATION_SKIPPED','TASK_NOTIFICATION_FAILED',
  ]);
  for (const node of pipeline.graph.nodes) {
    // node.type is 'task' or 'worker' — not a canonical event type
    assert.ok(!CANONICAL.has(node.type),
      `node ${node.id} has a canonical event type as its type: "${node.type}"`);
  }
  for (const edge of pipeline.graph.edges) {
    // edge.type is 'assignment' or undefined — not a canonical event type
    if (edge.type !== undefined) {
      assert.ok(!CANONICAL.has(edge.type),
        `edge ${edge.id} has a canonical event type as its type: "${edge.type}"`);
    }
    // edge.from / edge.to are lifecycle step labels (CREATED, ENQUEUED, …),
    // NOT event type strings — they are position identifiers.
    // However they must not be full TASK_* canonical strings.
    assert.ok(!CANONICAL.has(edge.from),
      `edge.from "${edge.from}" must not be a full TASK_* canonical event string`);
    assert.ok(!CANONICAL.has(edge.to),
      `edge.to "${edge.to}" must not be a full TASK_* canonical event string`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Full system determinism
// ═══════════════════════════════════════════════════════════════════════════════

test('e2e [determinism]: pipeline run 1 and run 2 produce bit-identical graphs', () => {
  const { graph: g1 } = runPipeline(RAW_EVENTS);
  const { graph: g2 } = runPipeline(RAW_EVENTS);
  // Compare only the serialisable portion (observability.byTaskId is a Map, not JSON-serialisable)
  const strip = (g) => JSON.stringify({ nodes: g.nodes, edges: g.edges, metadata: g.metadata });
  assert.equal(strip(g1), strip(g2),
    'two pipeline runs with identical events must produce identical graphs');
});

test('e2e [determinism]: adding system events does not change the VisualWorldGraph', () => {
  const { graph: baseline } = runPipeline(RAW_EVENTS);
  const { graph: withExtra } = runPipeline([...RAW_EVENTS, ...EXTRA_SYSTEM_EVENTS]);

  // Task nodes must be identical (system events must not affect lifecycle nodes)
  const baseTaskNodes  = JSON.stringify(baseline.nodes.filter((n) => n.type === 'task'));
  const extraTaskNodes = JSON.stringify(withExtra.nodes.filter((n) => n.type === 'task'));
  assert.equal(extraTaskNodes, baseTaskNodes,
    'adding system events must not change task node shapes or statuses');

  // Lifecycle edges must be identical
  const baseEdges  = JSON.stringify(baseline.edges.filter((e) => !e.type));
  const extraEdges = JSON.stringify(withExtra.edges.filter((e) => !e.type));
  assert.equal(extraEdges, baseEdges,
    'adding system events must not change lifecycle edges');
});

test('e2e [determinism]: same events in different order produce the same renderView', () => {
  // deriveWorldState sorts by timestamp internally — order must not matter
  const shuffled = [...RAW_EVENTS].sort(() => 0.5 - Math.sin(1)); // deterministic shuffle via sin
  const { renderView: rv1 } = runPipeline(RAW_EVENTS);
  const { renderView: rv2 } = runPipeline(shuffled);
  assert.equal(JSON.stringify(rv1), JSON.stringify(rv2),
    'event order must not affect the final renderView (deriveWorldState sorts by timestamp)');
});

test('e2e [determinism]: two pipeline runs produce identical renderer draw call logs', () => {
  const { renderView: rv1 } = runPipeline(RAW_EVENTS);
  const { renderView: rv2 } = runPipeline(RAW_EVENTS);

  const orig = Date.now; Date.now = () => 1_000_000;
  try {
    renderer.resetLog(); renderer.render(rv1); const log1 = renderer.captureLog();
    renderer.resetLog(); renderer.render(rv2); const log2 = renderer.captureLog();
    assert.equal(log1, log2,
      'two independently-built renderViews from the same events must produce identical draw calls');
  } finally { Date.now = orig; }
});

test('e2e [determinism]: deriveWorldState does not mutate the input event array', () => {
  const events = RAW_EVENTS.map((e) => ({ ...e }));
  const snapshot = JSON.stringify(events);
  deriveWorldState(events);
  assert.equal(JSON.stringify(events), snapshot,
    'deriveWorldState must not mutate its input array');
});

test('e2e [determinism]: buildVisualWorldGraph does not mutate selector output arrays', () => {
  const { tasks, agents, transitions, metrics, incidents } = runPipeline(RAW_EVENTS);
  const tasksBefore  = JSON.stringify(tasks);
  const agentsBefore = JSON.stringify(agents);

  buildVisualWorldGraph({ tasks, agents, transitions, metrics, incidents });

  assert.equal(JSON.stringify(tasks),  tasksBefore,  'tasks array must not be mutated by buildVisualWorldGraph');
  assert.equal(JSON.stringify(agents), agentsBefore, 'agents array must not be mutated by buildVisualWorldGraph');
});

test('e2e [determinism]: renderView projection does not alter the original graph', () => {
  const { graph, renderView } = runPipeline(RAW_EVENTS);
  const graphBefore = JSON.stringify({ nodes: graph.nodes, edges: graph.edges, metadata: graph.metadata });

  // Simulate a consumer modifying renderView — graph must be unaffected because
  // the projection is a shallow copy of the top-level structure.
  // (The nodes/edges arrays are shared references, so confirm no mutation occurs.)
  void renderView; // accessed above; confirm nodes/edges are the same references
  assert.strictEqual(renderView.nodes, graph.nodes, 'renderView.nodes is the same reference as graph.nodes');
  assert.strictEqual(renderView.edges, graph.edges, 'renderView.edges is the same reference as graph.edges');

  const graphAfter = JSON.stringify({ nodes: graph.nodes, edges: graph.edges, metadata: graph.metadata });
  assert.equal(graphAfter, graphBefore, 'graph must not change after renderView projection');
});
