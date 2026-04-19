import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ui-rendering-determinism.test.mjs
 *
 * Verifies that UI rendering is a deterministic function of VisualWorldGraph:
 *
 *   1. No randomness — Math.random() is absent from all panel files.
 *
 *   2. No time dependency — Date.now() is absent from pure display paths;
 *      every pure helper function uses only the graph data it receives.
 *
 *   3. No hidden state — pure display helpers produce the same output
 *      regardless of call history.
 *
 *   4. Same VisualWorldGraph → same UI output — all functions that drive
 *      the visible DOM content (bucket classification, incident aggregation,
 *      error messages, icons, tones) are referentially transparent.
 *
 * Method
 * ------
 * Static analysis for properties 1–2 (no DOM required).
 * Source extraction via data: URL for runtime properties 3–4:
 *   - UI panel source files are patched to suppress DOM-dependent init
 *     functions and to export their pure display helpers.
 *   - Helpers are called with fixed VisualWorldGraph fixtures and the
 *     outputs are compared for deep equality.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── VisualWorldGraph fixtures ────────────────────────────────────────────────

const NODE_COMPLETED = Object.freeze({
  id: 'task-1', type: 'task', status: 'completed',
  metadata: Object.freeze({
    title: 'Alpha Task', taskType: 'standard', assignedAgentId: 'w1',
    deskId: 'desk-0', error: null, createdAt: 1000, updatedAt: 2000,
    queueTime: 300, duration: 600, ackLatency: 100, incidents: Object.freeze([])
  })
});

const NODE_FAILED = Object.freeze({
  id: 'task-2', type: 'task', status: 'failed',
  metadata: Object.freeze({
    title: 'Beta Task', taskType: 'image_render', assignedAgentId: null,
    deskId: 'desk-1', error: 'ack_fail', createdAt: 1050, updatedAt: 1800,
    queueTime: null, duration: null, ackLatency: null,
    incidents: Object.freeze([Object.freeze({ clusterType: 'execution_failures', severity: 'high' })])
  })
});

const NODE_EXECUTING = Object.freeze({
  id: 'task-3', type: 'task', status: 'executing',
  metadata: Object.freeze({
    title: 'Gamma Task', taskType: 'discord', assignedAgentId: 'w2',
    deskId: 'desk-2', error: null, createdAt: 2000, updatedAt: 2500,
    queueTime: 200, duration: null, ackLatency: null, incidents: Object.freeze([])
  })
});

const NODE_QUEUED = Object.freeze({
  id: 'task-4', type: 'task', status: 'queued',
  metadata: Object.freeze({
    title: 'Delta Task', taskType: 'standard', assignedAgentId: null,
    deskId: 'desk-3', error: null, createdAt: 3000, updatedAt: 3100,
    queueTime: null, duration: null, ackLatency: null, incidents: Object.freeze([])
  })
});

const NODE_AWAITING_ACK = Object.freeze({
  id: 'task-5', type: 'task', status: 'awaiting_ack',
  metadata: Object.freeze({
    title: 'Epsilon Task', taskType: 'standard', assignedAgentId: 'w1',
    deskId: 'desk-0', error: null, createdAt: 4000, updatedAt: 4800,
    queueTime: 100, duration: 700, ackLatency: null,
    incidents: Object.freeze([Object.freeze({ clusterType: 'stalled_tasks', severity: 'medium' })])
  })
});

/** Graph A — two task nodes with incidents, one worker. */
const GRAPH_A = Object.freeze({
  nodes: Object.freeze([
    NODE_COMPLETED, NODE_FAILED,
    Object.freeze({
      id: 'w1', type: 'worker', status: 'idle',
      metadata: Object.freeze({ role: 'operator', currentTaskId: 'task-1', deskId: 'desk-0' })
    })
  ]),
  edges: Object.freeze([
    Object.freeze({ id: 'task-1:CREATED->ENQUEUED', taskId: 'task-1', from: 'CREATED',  to: 'ENQUEUED', fromAt: 1000, toAt: 1100, incidents: [] }),
    Object.freeze({ id: 'task-1:ENQUEUED->CLAIMED', taskId: 'task-1', from: 'ENQUEUED', to: 'CLAIMED',  fromAt: 1100, toAt: 1200, incidents: [] })
  ]),
  metadata: Object.freeze({})
});

/** Graph B — different set of nodes, no incidents. */
const GRAPH_B = Object.freeze({
  nodes: Object.freeze([NODE_EXECUTING, NODE_QUEUED]),
  edges: Object.freeze([]),
  metadata: Object.freeze({})
});

/** Graph C — multi-incident, multiple cluster types. */
const GRAPH_C = Object.freeze({
  nodes: Object.freeze([NODE_FAILED, NODE_AWAITING_ACK]),
  edges: Object.freeze([]),
  metadata: Object.freeze({})
});

const GRAPH_EMPTY = Object.freeze({
  nodes: Object.freeze([]), edges: Object.freeze([]), metadata: Object.freeze({})
});

// ─── Source extraction helper ─────────────────────────────────────────────────

/**
 * Load a UI panel source file as an ESM module with:
 *   - window / document references replaced with no-op stubs
 *   - the DOM-dependent init export suppressed
 *   - explicit exports added for the named pure functions
 *
 * Each call produces a fresh module instance (via a unique data: URL salt)
 * so there is no cross-test module caching.
 */
let _salt = 0;

async function loadPureFns(relPath, exportNames) {
  let src = readFileSync(resolve(ROOT, relPath), 'utf8');

  // Prepend no-op stubs for window and document so the module evaluates
  // without a DOM while every named function remains intact.
  const preamble = [
    'const __w = {',
    '  addEventListener: () => {},',
    '  controlAPI: { getGraph: () => ({ nodes: [], edges: [], metadata: {} }) }',
    '};',
    'const __d = {',
    '  createElement: () => ({',
    '    classList: { add: () => {}, remove: () => {} },',
    '    dataset: {},',
    '    appendChild: () => {},',
    '    addEventListener: () => {},',
    '    get innerHTML() { return ""; },',
    '    set innerHTML(_) {},',
    '    get textContent() { return ""; },',
    '    set textContent(_) {}',
    '  }),',
    '  getElementById: () => null,',
    '  body: { appendChild: () => {} }',
    '};',
  ].join('\n');

  src = src
    .replace(/\bwindow\b/g, '__w')
    .replace(/\bdocument\b/g, '__d')
    // Suppress the exported init function so the module has no side effects
    .replace(/^export function (init\w+)\s*\(/m, 'function $1(');

  src = `${preamble}\n${src}\nexport { ${exportNames.join(', ')} };\n// salt:${++_salt}`;

  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`;
  return import(url);
}

// ─── Module handles (populated in setup tests) ────────────────────────────────

let opFns;  // operator-control-panel pure helpers
let rfFns;  // raccoon-feeder-panel pure helpers

// ═══════════════════════════════════════════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════════════════════════════════════════

test('ui-rendering-determinism: setup — load operator-control-panel pure functions', async () => {
  opFns = await loadPureFns('ui/operator-control-panel.js', [
    'taskTone', 'taskIcon', 'formatTaskErrorMessage',
    'buildExecutionTrace', 'isActiveNodeStatus', 'bucketNodesByStatus'
  ]);
  for (const name of ['taskTone', 'taskIcon', 'formatTaskErrorMessage',
                       'buildExecutionTrace', 'isActiveNodeStatus', 'bucketNodesByStatus']) {
    assert.equal(typeof opFns[name], 'function', `${name} must be a function`);
  }
});

test('ui-rendering-determinism: setup — load raccoon-feeder-panel pure functions', async () => {
  rfFns = await loadPureFns('ui/raccoon-feeder-panel.js', ['severityRank', 'collectIncidents']);
  assert.equal(typeof rfFns.severityRank, 'function', 'severityRank must be a function');
  assert.equal(typeof rfFns.collectIncidents, 'function', 'collectIncidents must be a function');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. No randomness
// ═══════════════════════════════════════════════════════════════════════════════

test('ui-rendering-determinism: no Math.random() calls in any UI panel file', () => {
  const panelFiles = [
    'ui/operator-control-panel.js',
    'ui/raccoon-feeder-panel.js',
    'ui/task-creator-panel.js',
  ];
  for (const rel of panelFiles) {
    const src = readFileSync(resolve(ROOT, rel), 'utf8');
    const hits = src.split('\n').filter((l) => /Math\.random\s*\(/.test(l) && !/^\s*\/\//.test(l));
    assert.deepStrictEqual(hits, [], `${rel} must not call Math.random()`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. No time dependency in pure display paths
// ═══════════════════════════════════════════════════════════════════════════════

test('ui-rendering-determinism: Date.now() in operator-control-panel only appears inside the recentSeconds filter guard', () => {
  const src = readFileSync(resolve(ROOT, 'ui/operator-control-panel.js'), 'utf8');
  const live = src.split('\n').filter((l) => /\bDate\.now\s*\(\)/.test(l) && !/^\s*\/\//.test(l));

  for (const line of live) {
    // Allowed only inside the time-bounded filter — must reference 'recentSeconds' or 'cutoff'
    assert.ok(
      /recentSeconds/.test(line) || /cutoff/.test(line),
      `Date.now() found outside the recentSeconds filter guard: "${line.trim()}"`
    );
  }
});

test('ui-rendering-determinism: raccoon-feeder-panel.js has no Date.now() calls', () => {
  const src = readFileSync(resolve(ROOT, 'ui/raccoon-feeder-panel.js'), 'utf8');
  const hits = src.split('\n').filter((l) => /\bDate\.now\s*\(\)/.test(l) && !/^\s*\/\//.test(l));
  assert.deepStrictEqual(hits, [], 'raccoon-feeder-panel must not call Date.now()');
});

test('ui-rendering-determinism: task-creator-panel.js has no Date.now() calls', () => {
  const src = readFileSync(resolve(ROOT, 'ui/task-creator-panel.js'), 'utf8');
  const hits = src.split('\n').filter((l) => /\bDate\.now\s*\(\)/.test(l) && !/^\s*\/\//.test(l));
  assert.deepStrictEqual(hits, [], 'task-creator-panel must not call Date.now()');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. No hidden state — module-level cache check
// ═══════════════════════════════════════════════════════════════════════════════

test('ui-rendering-determinism: no module-level mutable semantic caches in panel files', () => {
  const panelFiles = [
    'ui/operator-control-panel.js',
    'ui/raccoon-feeder-panel.js',
  ];
  // A cache is a module-level `new Map(` or `new Set(` whose variable name
  // references a semantic domain word.
  const cacheRe = /\bnew (?:Map|Set)\s*\(/;
  const semanticRe = /\b(?:task|status|lifecycle|incident|agent|worker|event)\b/i;

  for (const rel of panelFiles) {
    const src = readFileSync(resolve(ROOT, rel), 'utf8');
    const topLevelDecls = src.split('\n').filter((l) => /^(?:const|let|var)\s+/.test(l));
    const hits = topLevelDecls.filter((l) => cacheRe.test(l) && semanticRe.test(l));
    assert.deepStrictEqual(hits, [],
      `${rel} must not declare module-level caches keyed by semantic names:\n${hits.join('\n')}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Same VisualWorldGraph → same UI output — pure helper determinism
// ═══════════════════════════════════════════════════════════════════════════════

// ── taskTone: status string → CSS modifier ────────────────────────────────────

test('ui-rendering-determinism: taskTone is a total deterministic function of status', () => {
  const table = [
    ['failed',       'failed'],
    ['awaiting_ack', 'pending'],
    ['claimed',      'active'],
    ['executing',    'active'],
    ['completed',    'done'],
    ['acknowledged', 'done'],
    ['queued',       'queued'],
    ['created',      'queued'],
    ['unknown',      'queued'],
    ['',             'queued'],
  ];
  for (const [status, expected] of table) {
    assert.equal(opFns.taskTone(status), expected,
      `taskTone('${status}') must return '${expected}'`);
    // Second call — no hidden state must have been mutated
    assert.equal(opFns.taskTone(status), expected,
      `taskTone('${status}') must be stable across repeated calls`);
  }
});

// ── taskIcon: status string → icon character ──────────────────────────────────

test('ui-rendering-determinism: taskIcon is a total deterministic function of status', () => {
  const statuses = ['failed', 'awaiting_ack', 'claimed', 'executing', 'completed', 'acknowledged', 'queued', ''];
  const icons = new Map();
  for (const s of statuses) {
    const icon = opFns.taskIcon(s);
    assert.equal(typeof icon, 'string', `taskIcon('${s}') must return a string`);
    assert.ok(icon.length >= 1, `taskIcon('${s}') must be non-empty`);
    icons.set(s, icon);
  }
  // Verify stability — no hidden mutation between calls
  for (const [s, icon] of icons) {
    assert.equal(opFns.taskIcon(s), icon, `taskIcon('${s}') must be idempotent`);
  }
});

// ── isActiveNodeStatus: pure predicate ────────────────────────────────────────

test('ui-rendering-determinism: isActiveNodeStatus is a pure deterministic predicate', () => {
  for (const s of ['claimed', 'executing', 'awaiting_ack']) {
    assert.equal(opFns.isActiveNodeStatus(s), true,  `isActiveNodeStatus('${s}') must be true`);
    assert.equal(opFns.isActiveNodeStatus(s), true,  `isActiveNodeStatus('${s}') must be stable`);
  }
  for (const s of ['queued', 'created', 'completed', 'acknowledged', 'failed', 'error', 'unknown', '']) {
    assert.equal(opFns.isActiveNodeStatus(s), false, `isActiveNodeStatus('${s}') must be false`);
    assert.equal(opFns.isActiveNodeStatus(s), false, `isActiveNodeStatus('${s}') must be stable`);
  }
});

// ── bucketNodesByStatus: same nodes → same buckets ────────────────────────────

test('ui-rendering-determinism: bucketNodesByStatus places each node in exactly one correct bucket', () => {
  const nodes = [NODE_COMPLETED, NODE_FAILED, NODE_EXECUTING, NODE_QUEUED];
  const { queued, active, done, failed } = opFns.bucketNodesByStatus(nodes);

  assert.equal(done.length,   1);  assert.equal(done[0].id,   'task-1');
  assert.equal(failed.length, 1);  assert.equal(failed[0].id, 'task-2');
  assert.equal(active.length, 1);  assert.equal(active[0].id, 'task-3');
  assert.equal(queued.length, 1);  assert.equal(queued[0].id, 'task-4');
});

test('ui-rendering-determinism: bucketNodesByStatus produces identical output on repeated calls', () => {
  const nodes = GRAPH_A.nodes.filter((n) => n.type === 'task');
  const r1 = JSON.stringify(opFns.bucketNodesByStatus(nodes));
  const r2 = JSON.stringify(opFns.bucketNodesByStatus(nodes));
  assert.equal(r1, r2, 'bucketNodesByStatus must be referentially transparent');
});

test('ui-rendering-determinism: bucketNodesByStatus result is unaffected by prior calls with different data', () => {
  const nodesA = GRAPH_A.nodes.filter((n) => n.type === 'task');
  const ref = JSON.stringify(opFns.bucketNodesByStatus(nodesA));

  // Process a completely different set of nodes
  const nodesB = GRAPH_B.nodes.filter((n) => n.type === 'task');
  opFns.bucketNodesByStatus(nodesB);

  assert.equal(JSON.stringify(opFns.bucketNodesByStatus(nodesA)), ref,
    'bucketNodesByStatus must not retain state between calls');
});

// ── formatTaskErrorMessage: deterministic error display text ──────────────────

test('ui-rendering-determinism: formatTaskErrorMessage returns fixed display text for all known inputs', () => {
  const table = [
    [null,           null,                        null],
    ['standard',     null,                        null],
    ['standard',     'some error',                'some error'],
    ['image_render', 'some error',                'image render failed: some error'],
    ['standard',     'openai_api_key_missing',    'OpenAI API key missing'],
    ['standard',     'huggingface_api_key_missing', 'HuggingFace API key missing'],
    ['standard',     'provider_timeout:3000',     'provider timeout (3000ms)'],
    ['standard',     'provider_timeout:',         'provider timeout (unknownms)'],
  ];
  for (const [taskType, rawError, expected] of table) {
    const r1 = opFns.formatTaskErrorMessage(taskType, rawError);
    const r2 = opFns.formatTaskErrorMessage(taskType, rawError);
    assert.equal(r1, expected,
      `formatTaskErrorMessage(${JSON.stringify(taskType)}, ${JSON.stringify(rawError)}) must equal ${JSON.stringify(expected)}`);
    assert.equal(r1, r2, 'formatTaskErrorMessage must be stable across repeated calls');
  }
});

// ── buildExecutionTrace: deterministic edge serialization (no wall-clock dep) ─

test('ui-rendering-determinism: buildExecutionTrace is deterministic and wall-clock independent', () => {
  const edges = GRAPH_A.edges;

  const t1 = opFns.buildExecutionTrace(edges);
  const t2 = opFns.buildExecutionTrace(edges);
  assert.deepStrictEqual(t1, t2, 'buildExecutionTrace must produce identical output on repeated calls');
  assert.equal(t1.length, 2, 'must produce one entry per edge');

  // All timestamp fields are derived from the fixed edge timestamps, not Date.now().
  // new Date(1000).toISOString() is always "1970-01-01T00:00:01.000Z".
  assert.equal(t1[0].fromAt, new Date(1000).toISOString());
  assert.equal(t1[0].toAt,   new Date(1100).toISOString());
  assert.equal(t1[1].fromAt, new Date(1100).toISOString());
  assert.equal(t1[1].toAt,   new Date(1200).toISOString());
});

// ── severityRank: stable total order ─────────────────────────────────────────

test('ui-rendering-determinism: severityRank produces a stable total order', () => {
  const high   = rfFns.severityRank('high');
  const medium = rfFns.severityRank('medium');
  const low    = rfFns.severityRank('low');

  assert.ok(high > medium,   'high must rank above medium');
  assert.ok(medium > low,    'medium must rank above low');

  // Idempotent
  assert.equal(rfFns.severityRank('high'),   high);
  assert.equal(rfFns.severityRank('medium'), medium);
  assert.equal(rfFns.severityRank('low'),    low);
});

// ── collectIncidents: same graph → same incidents ────────────────────────────

test('ui-rendering-determinism: collectIncidents is referentially transparent', () => {
  const r1 = JSON.stringify(rfFns.collectIncidents(GRAPH_A));
  const r2 = JSON.stringify(rfFns.collectIncidents(GRAPH_A));
  assert.equal(r1, r2, 'collectIncidents must return identical output on repeated calls');
});

test('ui-rendering-determinism: collectIncidents aggregates node.metadata.incidents correctly', () => {
  const result = rfFns.collectIncidents(GRAPH_A);
  assert.equal(result.length, 1, 'GRAPH_A has one distinct cluster type');
  assert.equal(result[0].type, 'execution_failures');
  assert.equal(result[0].severity, 'high');
  assert.deepStrictEqual(result[0].taskIds, ['task-2']);
});

test('ui-rendering-determinism: collectIncidents returns empty array for a graph with no incidents', () => {
  assert.deepStrictEqual(rfFns.collectIncidents(GRAPH_EMPTY), []);
  assert.deepStrictEqual(rfFns.collectIncidents(GRAPH_B),     []);
});

test('ui-rendering-determinism: collectIncidents merges multiple cluster types from different nodes', () => {
  const result = rfFns.collectIncidents(GRAPH_C);
  const types = result.map((r) => r.type).sort();
  assert.deepStrictEqual(types, ['execution_failures', 'stalled_tasks'].sort(),
    'GRAPH_C must yield two distinct incident clusters');
  const exec = result.find((r) => r.type === 'execution_failures');
  assert.equal(exec.severity, 'high');
  assert.deepStrictEqual(exec.taskIds, ['task-2']);
  const stall = result.find((r) => r.type === 'stalled_tasks');
  assert.equal(stall.severity, 'medium');
  assert.deepStrictEqual(stall.taskIds, ['task-5']);
});

test('ui-rendering-determinism: collectIncidents result is unaffected by prior calls with different graph', () => {
  const ref = JSON.stringify(rfFns.collectIncidents(GRAPH_C));
  rfFns.collectIncidents(GRAPH_EMPTY);
  rfFns.collectIncidents(GRAPH_B);
  assert.equal(JSON.stringify(rfFns.collectIncidents(GRAPH_C)), ref,
    'collectIncidents must not accumulate state between calls');
});

test('ui-rendering-determinism: collectIncidents promotes severity to highest seen across nodes', () => {
  const lowFirst = Object.freeze({
    nodes: Object.freeze([
      Object.freeze({
        id: 'n1', type: 'task', status: 'failed',
        metadata: Object.freeze({
          incidents: Object.freeze([Object.freeze({ clusterType: 'x', severity: 'low' })])
        })
      }),
      Object.freeze({
        id: 'n2', type: 'task', status: 'failed',
        metadata: Object.freeze({
          incidents: Object.freeze([Object.freeze({ clusterType: 'x', severity: 'high' })])
        })
      })
    ]),
    edges: Object.freeze([]),
    metadata: Object.freeze({})
  });
  const result = rfFns.collectIncidents(lowFirst);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, 'high',
    'cluster severity must be promoted to the highest severity seen across all nodes');
  assert.deepStrictEqual(result[0].taskIds, ['n1', 'n2']);
});

// ── provider_timeout edge-case correction (determinism of split behavior) ─────

test('ui-rendering-determinism: formatTaskErrorMessage provider_timeout is deterministic regardless of timeout value', () => {
  assert.equal(opFns.formatTaskErrorMessage('any', 'provider_timeout:500'),  'provider timeout (500ms)');
  assert.equal(opFns.formatTaskErrorMessage('any', 'provider_timeout:9999'), 'provider timeout (9999ms)');
  // Same input always gives same output
  assert.equal(
    opFns.formatTaskErrorMessage('any', 'provider_timeout:500'),
    opFns.formatTaskErrorMessage('any', 'provider_timeout:500')
  );
});
