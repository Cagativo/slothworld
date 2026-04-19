import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * renderer-purity.test.mjs
 *
 * Verifies that render() is a pure projection:
 *
 *   1. Same graph input → identical sequence of canvas draw calls (referential
 *      transparency over the draw call log, not over pixels which require a
 *      real GPU surface).
 *
 *   2. No internal state mutation persists between calls — a second render
 *      with the same graph must not be affected by a first render with a
 *      different graph.
 *
 *   3. No caching of semantic data — the render() function must not store
 *      task-id-keyed or status-keyed data on module-level structures that
 *      could survive between calls.
 *
 * Strategy
 * --------
 * render() calls into the canvas 2D API.  We intercept every canvas method
 * call via a recording mock context and compare the resulting call logs.
 *
 * Because render() also imports `canvas` and `ctx` from core/app-state.js
 * at module level (which requires a real DOM), we load canvas-renderer.js
 * as source text and apply targeted static checks for the third assertion,
 * and use a lightweight ESM mock for the runtime assertions.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Fixed graph inputs ───────────────────────────────────────────────────────

/** A fully populated graph — two task nodes, one worker, three lifecycle edges. */
const GRAPH_A = Object.freeze({
  nodes: Object.freeze([
    Object.freeze({ id: 'task-alpha', type: 'task', status: 'completed', metadata: Object.freeze({ title: 'Alpha', taskType: 'standard', assignedAgentId: 'w1', deskId: 'desk-0', error: null, createdAt: 1000, updatedAt: 2000, queueTime: 300, duration: 600, ackLatency: 100, incidents: [] }) }),
    Object.freeze({ id: 'task-beta',  type: 'task', status: 'queued',    metadata: Object.freeze({ title: 'Beta',  taskType: 'standard', assignedAgentId: null, deskId: 'desk-1', error: null, createdAt: 1050, updatedAt: 1150, queueTime: null, duration: null, ackLatency: null, incidents: [] }) }),
    Object.freeze({ id: 'w1', type: 'worker', status: 'idle', metadata: Object.freeze({ role: 'operator', currentTaskId: 'task-alpha', deskId: 'desk-0' }) })
  ]),
  edges: Object.freeze([
    Object.freeze({ id: 'task-alpha:CREATED->ENQUEUED', taskId: 'task-alpha', from: 'CREATED',  to: 'ENQUEUED', fromAt: 1000, toAt: 1100, incidents: [] }),
    Object.freeze({ id: 'task-alpha:ENQUEUED->CLAIMED', taskId: 'task-alpha', from: 'ENQUEUED', to: 'CLAIMED',  fromAt: 1100, toAt: 1200, incidents: [] }),
    Object.freeze({ id: 'task-alpha:EXECUTED->ACKED',   taskId: 'task-alpha', from: 'EXECUTED', to: 'ACKED',    fromAt: 1900, toAt: 2000, incidents: [] })
  ]),
  metadata: Object.freeze({})
});

/** A different graph with a failed task — used to verify state isolation. */
const GRAPH_B = Object.freeze({
  nodes: Object.freeze([
    Object.freeze({ id: 'task-gamma', type: 'task', status: 'failed', metadata: Object.freeze({ title: 'Gamma', taskType: 'urgent', assignedAgentId: 'w2', deskId: 'desk-2', error: 'ack_fail', createdAt: 1100, updatedAt: 1800, queueTime: 100, duration: 500, ackLatency: 80, incidents: Object.freeze([Object.freeze({ clusterType: 'execution_failures', severity: 'high' })]) }) })
  ]),
  edges: Object.freeze([
    Object.freeze({ id: 'task-gamma:CREATED->ENQUEUED', taskId: 'task-gamma', from: 'CREATED', to: 'ENQUEUED', fromAt: 1100, toAt: 1110, incidents: [] })
  ]),
  metadata: Object.freeze({})
});

/** An empty graph — baseline. */
const GRAPH_EMPTY = Object.freeze({ nodes: Object.freeze([]), edges: Object.freeze([]), metadata: Object.freeze({}) });

// ─── Canvas mock ──────────────────────────────────────────────────────────────

// ─── Resettable global mock ───────────────────────────────────────────────────

/**
 * A single mock context whose log can be reset between calls.
 * All render() invocations write to this mock because the patched module
 * reads `canvas` / `ctx` from globalThis at evaluation time and the ESM
 * module is cached after the first import.
 */
const GLOBAL_LOG = [];

const CTX_METHODS = [
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath',
  'moveTo', 'lineTo', 'arc', 'fill', 'stroke', 'save', 'restore',
  'fillText', 'strokeText', 'setLineDash', 'drawImage', 'createRadialGradient',
  'createLinearGradient', 'measureText', 'quadraticCurveTo'
];

const CTX_PROPS = [
  'fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign',
  'globalAlpha', 'imageSmoothingEnabled'
];

const SHARED_CTX = new Proxy(
  {
    canvas: { width: 800, height: 600 },
    ...Object.fromEntries(CTX_METHODS.map((m) => [m, (...args) => {
      GLOBAL_LOG.push({ op: m, args });
      if (m === 'createRadialGradient' || m === 'createLinearGradient') {
        return { addColorStop() {} };
      }
      if (m === 'measureText') { return { width: 0 }; }
      return undefined;
    }]))
  },
  {
    set(target, prop, value) {
      if (CTX_PROPS.includes(prop)) {
        GLOBAL_LOG.push({ op: `set:${prop}`, value });
      }
      target[prop] = value;
      return true;
    },
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => { GLOBAL_LOG.push({ op: `unknown:${prop}`, args }); };
    }
  }
);

const SHARED_CANVAS = {
  width: 800,
  height: 600,
  getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
  getContext: () => SHARED_CTX,
  addEventListener: () => {}
};

function resetLog() { GLOBAL_LOG.length = 0; }

function captureLog() { return serialiseLog([...GLOBAL_LOG]); }

// ─── render() extraction helper ──────────────────────────────────────────────

/**
 * Load canvas-renderer.js with DOM dependencies patched to our shared mock.
 * Because ESM modules are cached by URL, this returns the same module instance
 * on every call — which is what we want: one render function, one canvas mock,
 * one log that we reset between calls.
 */
async function loadRenderFn() {
  const sourcePath = resolve(ROOT, 'rendering/canvas-renderer.js');
  let source = readFileSync(sourcePath, 'utf8');

  globalThis.__MOCK_CANVAS__ = SHARED_CANVAS;
  globalThis.__MOCK_CTX__    = SHARED_CTX;
  globalThis.__MOCK_ASSETS__ = {};
  globalThis.__MOCK_SPRITE_CONFIGS__ = { agent: { height: 48 } };
  globalThis.__MOCK_RESOLVE_AGENT_VISUAL__ = () => null;

  source = source
    .replace(
      /import\s*\{[^}]*canvas[^}]*ctx[^}]*\}\s*from\s*['"][^'"]*app-state\.js['"]\s*;?/,
      'const canvas = globalThis.__MOCK_CANVAS__; const ctx = globalThis.__MOCK_CTX__;'
    )
    .replace(
      /import\s*\{[^}]*loadedAssets[^}]*\}\s*from\s*['"][^'"]*assets\.js['"]\s*;?/,
      'const loadedAssets = globalThis.__MOCK_ASSETS__;'
    )
    .replace(
      /import\s*\{[^}]*spriteConfigs[^}]*\}\s*from\s*['"][^'"]*constants\.js['"]\s*;?/,
      'const spriteConfigs = globalThis.__MOCK_SPRITE_CONFIGS__;'
    )
    .replace(
      /import\s*\{[^}]*resolveAgentVisual[^}]*\}\s*from\s*['"][^'"]*agentVisualConfig\.js['"]\s*;?/,
      'const resolveAgentVisual = globalThis.__MOCK_RESOLVE_AGENT_VISUAL__;'
    );

  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
  const mod = await import(dataUrl);
  return mod.render;
}

// ─── Serialise a call log to a comparable string ─────────────────────────────

function serialiseLog(log) {
  return JSON.stringify(log, (_k, v) => {
    if (typeof v === 'function') { return '__fn__'; }
    return v;
  });
}

/** Run fn with Date.now frozen to a fixed value for deterministic animation. */
function withFixedTime(fn, t = 1_000_000) {
  const orig = Date.now;
  Date.now = () => t;
  try { return fn(); } finally { Date.now = orig; }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let renderFn;

test('renderer purity: setup — load render function with shared mock canvas', async () => {
  renderFn = await loadRenderFn();
  assert.equal(typeof renderFn, 'function',
    'render must be an exported function from canvas-renderer.js');
});

// 1. Same input → identical draw call sequence ─────────────────────────────────

test('renderer purity: identical graph input produces identical draw call sequence (run 1 vs run 2)', () => {
  resetLog();
  withFixedTime(() => renderFn(GRAPH_A));
  const log1 = captureLog();

  resetLog();
  withFixedTime(() => renderFn(GRAPH_A));
  const log2 = captureLog();

  assert.ok(log1.length > 2, 'render(GRAPH_A) must produce draw calls');
  assert.equal(log1, log2,
    'render(GRAPH_A) must produce the same draw calls on every invocation');
});

test('renderer purity: five calls with the same graph produce the same draw call sequence', () => {
  resetLog();
  withFixedTime(() => renderFn(GRAPH_A));
  const baseline = captureLog();

  for (let i = 1; i < 5; i++) {
    resetLog();
    withFixedTime(() => renderFn(GRAPH_A));
    assert.equal(captureLog(), baseline,
      `Call ${i + 1} with GRAPH_A diverged from baseline draw call sequence`);
  }
});

test('renderer purity: empty graph always produces same draw call sequence', () => {
  resetLog();
  withFixedTime(() => renderFn(GRAPH_EMPTY));
  const log1 = captureLog();

  resetLog();
  withFixedTime(() => renderFn(GRAPH_EMPTY));
  const log2 = captureLog();

  assert.equal(log1, log2,
    'render(GRAPH_EMPTY) must produce identical draw calls on every invocation');
});

test('renderer purity: different graph inputs produce different draw call sequences', () => {
  resetLog();
  withFixedTime(() => renderFn(GRAPH_A));
  const logA = captureLog();

  resetLog();
  withFixedTime(() => renderFn(GRAPH_B));
  const logB = captureLog();

  assert.notEqual(logA, logB,
    'GRAPH_A and GRAPH_B must produce different draw calls (sanity: inputs differ)');
});

// 2. No internal state mutation between calls ──────────────────────────────────

test('renderer purity: rendering GRAPH_B first does not affect a subsequent render of GRAPH_A', () => {
  // Establish reference for GRAPH_A on a clean log.
  resetLog();
  withFixedTime(() => renderFn(GRAPH_A));
  const logAReference = captureLog();

  // Now render GRAPH_B to simulate a different previous frame.
  resetLog();
  withFixedTime(() => renderFn(GRAPH_B));

  // Then render GRAPH_A again — must match the reference.
  resetLog();
  withFixedTime(() => renderFn(GRAPH_A));
  const logAAfterB = captureLog();

  assert.equal(logAAfterB, logAReference,
    'render(GRAPH_A) after render(GRAPH_B) must produce the same draw calls as a fresh render(GRAPH_A)');
});

test('renderer purity: rendering the same graph ten times in sequence never drifts', () => {
  resetLog();
  withFixedTime(() => renderFn(GRAPH_A));
  const baseline = captureLog();

  for (let i = 0; i < 9; i++) {
    resetLog();
    withFixedTime(() => renderFn(GRAPH_A));
    assert.equal(captureLog(), baseline,
      `Sequence call ${i + 2} drifted from baseline — suggests stateful accumulation`);
  }
});

test('renderer purity: render() does not return a value (stateless per-call contract)', () => {
  resetLog();
  const result = renderFn(GRAPH_A);
  assert.equal(result, undefined,
    'render() must return undefined — it is a side-effect projection, not a data producer');
});

test('renderer purity: render() does not throw on empty graph', () => {
  resetLog();
  assert.doesNotThrow(() => renderFn(GRAPH_EMPTY),
    'render() must not throw when given an empty graph');
});

test('renderer purity: render() does not throw on null/undefined graph', () => {
  resetLog();
  assert.doesNotThrow(() => renderFn(null),      'render(null) must not throw');
  resetLog();
  assert.doesNotThrow(() => renderFn(undefined), 'render(undefined) must not throw');
});

// 3. No caching of semantic data (static analysis) ────────────────────────────

test('renderer purity: canvas-renderer.js has no module-level cache keyed by taskId or status', () => {
  const source = readFileSync(resolve(ROOT, 'rendering/canvas-renderer.js'), 'utf8');

  const moduleTopLines = source
    .split('\n')
    .filter((line) => /^(?:const|let|var)\s+/.test(line));

  const cachePattern = /\b(?:Map|Set|Object\.create|{}\s*;)\b/;
  const semanticNamePattern = /\b\w*(?:task|status|lifecycle|cache|memo|store|keyed)\w*\b/i;

  const hits = moduleTopLines.filter(
    (line) => cachePattern.test(line) && semanticNamePattern.test(line)
  );

  assert.deepStrictEqual(hits, [],
    `canvas-renderer.js must not declare module-level caches keyed by semantic data:\n${hits.map((l) => '  ' + l.trim()).join('\n')}`);
});

test('renderer purity: canvas-renderer.js does not write graph data back to module-level state', () => {
  const source = readFileSync(resolve(ROOT, 'rendering/canvas-renderer.js'), 'utf8');

  const suspiciousWrite = /\b(?:nodes|edges|node|edge|task)\s*(?:\.\s*\w+)*\s*[=\[]/;

  const moduleTopLines = source
    .split('\n')
    .filter((line) => /^(?:const|let|var)\s+/.test(line) && suspiciousWrite.test(line));

  assert.deepStrictEqual(moduleTopLines, [],
    `canvas-renderer.js must not write graph data into module-level variables at declaration:\n${moduleTopLines.map((l) => '  ' + l.trim()).join('\n')}`);
});

test('renderer purity: canvas-renderer.js does not import from world or selector modules', () => {
  const source = readFileSync(resolve(ROOT, 'rendering/canvas-renderer.js'), 'utf8');

  const forbidden = [
    { label: 'core/world/', re: /from\s+['"][^'"]*core\/world\// },
    { label: 'ui/selectors/', re: /from\s+['"][^'"]*ui\/selectors\// },
    { label: 'deriveWorldState', re: /\bderiveWorldState\b/ },
    { label: 'getRawEvents', re: /\bgetRawEvents\b/ }
  ];

  for (const { label, re } of forbidden) {
    assert.ok(!re.test(source),
      `canvas-renderer.js must not import "${label}" — renderer is a pure projection layer`);
  }
});

// 4. Input contract — render() must reject non-graph arguments ─────────────────

test('renderer purity: render() accepts a valid { nodes, edges, metadata } graph', () => {
  resetLog();
  assert.doesNotThrow(
    () => renderFn({ nodes: [], edges: [], metadata: {} }),
    'render() must accept a valid VisualWorldGraph'
  );
});

test('renderer purity: render() accepts a graph with only some optional keys present', () => {
  resetLog();
  assert.doesNotThrow(() => renderFn({ nodes: [] }),          'nodes-only graph must be accepted');
  assert.doesNotThrow(() => renderFn({ edges: [] }),          'edges-only graph must be accepted');
  assert.doesNotThrow(() => renderFn({ metadata: {} }),       'metadata-only graph must be accepted');
  assert.doesNotThrow(() => renderFn({ nodes: [], edges: [] }), 'nodes+edges graph must be accepted');
});

test('renderer purity: render() rejects a selector-domain object (tasks/agents/desks)', () => {
  assert.throws(
    () => renderFn({ tasks: [], agents: [], desks: [] }),
    TypeError,
    'render() must throw TypeError when passed a selector-domain object'
  );
});

test('renderer purity: render() rejects an object with "tasks" key', () => {
  assert.throws(
    () => renderFn({ tasks: [], nodes: [], edges: [] }),
    TypeError,
    'render() must throw TypeError when "tasks" key is present'
  );
});

test('renderer purity: render() rejects an object with "agents" key', () => {
  assert.throws(
    () => renderFn({ agents: [], nodes: [], edges: [] }),
    TypeError,
    'render() must throw TypeError when "agents" key is present'
  );
});

test('renderer purity: render() rejects a raw events object (events key)', () => {
  assert.throws(
    () => renderFn({ events: [], nodes: [], edges: [] }),
    TypeError,
    'render() must throw TypeError when "events" key is present'
  );
});

test('renderer purity: render() rejects an object with "eventsByTaskId" key', () => {
  assert.throws(
    () => renderFn({ eventsByTaskId: new Map(), nodes: [], edges: [] }),
    TypeError,
    'render() must throw TypeError when "eventsByTaskId" key is present'
  );
});

test('renderer purity: render() rejects an object with "rawEvents" key', () => {
  assert.throws(
    () => renderFn({ rawEvents: [], nodes: [], edges: [] }),
    TypeError,
    'render() must throw TypeError when "rawEvents" key is present'
  );
});

test('renderer purity: render() rejects an object with "payload" key', () => {
  assert.throws(
    () => renderFn({ payload: { status: 'completed' }, nodes: [] }),
    TypeError,
    'render() must throw TypeError when "payload" key is present (event payload shape)'
  );
});

test('renderer purity: render() rejects a mixed source object (graph + selector keys)', () => {
  assert.throws(
    () => renderFn({ nodes: [], edges: [], metadata: {}, counts: { queued: 0 }, incidents: [] }),
    TypeError,
    'render() must throw TypeError when graph keys are mixed with selector-domain keys'
  );
});

test('renderer purity: render() rejects a mixed source object (graph + event keys)', () => {
  assert.throws(
    () => renderFn({ nodes: [], edges: [], metadata: {}, events: [], taskId: 'x' }),
    TypeError,
    'render() must throw TypeError when graph keys are mixed with event-domain keys'
  );
});

test('renderer purity: render() rejects any unrecognised key even if not explicitly forbidden', () => {
  assert.throws(
    () => renderFn({ nodes: [], edges: [], metadata: {}, unknownField: true }),
    TypeError,
    'render() must throw TypeError for any unrecognised top-level key'
  );
});

test('renderer purity: render() TypeError message names the offending keys', () => {
  let err;
  try { renderFn({ tasks: [], agents: [] }); }
  catch (e) { err = e; }
  assert.ok(err instanceof TypeError, 'must throw TypeError');
  assert.ok(
    err.message.includes('tasks') || err.message.includes('agents'),
    `TypeError message must name the offending key(s) — got: "${err.message}"`
  );
});

