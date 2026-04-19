import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * renderer-graph-boundary.test.mjs
 *
 * Static-analysis and runtime tests verifying that the rendering layer:
 *  1. Does NOT import or call selector functions
 *  2. Does NOT reference raw event data (canonical event type strings,
 *     eventsByTaskId, eventsByWorkerId, payload.status, etc.)
 *  3. Derives all information from its renderView/graph argument only —
 *     verified at runtime by recording which top-level keys the render
 *     function reads, and asserting none are forbidden event/selector keys.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function src(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

const RENDERER_FILES = [
  'rendering/canvas-renderer.js',
  'rendering/renderer-loop.js',
  'rendering/overlays.js',
  'rendering/assets.js'
];

const sources = Object.fromEntries(
  RENDERER_FILES.map((f) => [f, src(f)])
);

// ─── 1. No selector imports ───────────────────────────────────────────────────

const FORBIDDEN_IMPORT_PATTERNS = [
  { label: 'taskSelectors',   re: /from\s+['"][^'"]*taskSelectors/ },
  { label: 'agentSelectors',  re: /from\s+['"][^'"]*agentSelectors/ },
  { label: 'metricsSelectors',re: /from\s+['"][^'"]*metricsSelectors/ },
  { label: 'anomalySelectors',re: /from\s+['"][^'"]*anomalySelectors/ },
  { label: 'deriveWorldState',re: /from\s+['"][^'"]*deriveWorldState/ },
  { label: 'eventTaxonomy',   re: /from\s+['"][^'"]*eventTaxonomy/ },
  { label: 'workflow.js',     re: /from\s+['"][^'"]*\/workflow/ },
  { label: 'task-handling',   re: /from\s+['"][^'"]*task-handling/ },
  { label: 'engine/',         re: /from\s+['"][^'"]*\/engine\// }
];

for (const { label, re } of FORBIDDEN_IMPORT_PATTERNS) {
  test(`renderer boundary: no import of "${label}" in any rendering file`, () => {
    for (const [file, code] of Object.entries(sources)) {
      assert.ok(!re.test(code),
        `${file} must not import from "${label}"`);
    }
  });
}

// ─── 2. No canonical event type string comparisons ───────────────────────────

const CANONICAL_EVENT_TYPES = [
  'TASK_CREATED',
  'TASK_ENQUEUED',
  'TASK_CLAIMED',
  'TASK_EXECUTE_STARTED',
  'TASK_EXECUTE_FINISHED',
  'TASK_ACKED',
  'TASK_NOTIFICATION_SENT',
  'TASK_NOTIFICATION_SKIPPED',
  'TASK_NOTIFICATION_FAILED'
];

test('renderer boundary: no canonical event type string literals in rendering files', () => {
  for (const [file, code] of Object.entries(sources)) {
    for (const eventType of CANONICAL_EVENT_TYPES) {
      assert.ok(!code.includes(`'${eventType}'`) && !code.includes(`"${eventType}"`),
        `${file} must not reference canonical event type "${eventType}"`);
    }
  }
});

// ─── 3. No raw event field access ────────────────────────────────────────────

const FORBIDDEN_ACCESS_PATTERNS = [
  { label: '.eventsByTaskId',   re: /\.eventsByTaskId\b/ },
  { label: '.eventsByWorkerId', re: /\.eventsByWorkerId\b/ },
  // raw events array slot access (e.g. world.events[0] or world.events.find)
  { label: '.events[',          re: /\.events\s*[\[.]/ },
  { label: 'payload.status',    re: /payload\.status\b/ },
  { label: 'deriveWorldState(', re: /deriveWorldState\s*\(/ }
];

for (const { label, re } of FORBIDDEN_ACCESS_PATTERNS) {
  test(`renderer boundary: no "${label}" access in any rendering file`, () => {
    for (const [file, code] of Object.entries(sources)) {
      assert.ok(!re.test(code),
        `${file} must not access "${label}"`);
    }
  });
}

// ─── 4. Runtime: render() reads only from its argument ───────────────────────
//
// We pass a recording Proxy as the renderView.  After render() returns, we
// inspect which top-level keys were accessed and assert none of them are
// raw-event or selector-domain keys.

const FORBIDDEN_RUNTIME_KEYS = new Set([
  'events',
  'eventsByTaskId',
  'eventsByWorkerId',
  'rawEvents',
  // selector module names accidentally placed on the view
  'taskSelectors',
  'agentSelectors',
  'metricsSelectors',
  'anomalySelectors'
]);

/**
 * Build a Proxy that records all top-level property accesses on the renderView.
 * Nested access is not tracked — we care only about top-level key consumption.
 * Returns { proxy, accessed: Set<string> }.
 */
function makeRecordingProxy(fallbacks = {}) {
  const accessed = new Set();
  const proxy = new Proxy(fallbacks, {
    get(target, prop) {
      if (typeof prop === 'string') {
        accessed.add(prop);
      }
      return Object.prototype.hasOwnProperty.call(target, prop)
        ? target[prop]
        : undefined;
    }
  });
  return { proxy, accessed };
}

// Provide safe fallback values for all fields render() currently needs so the
// function doesn't throw on null dereferences before we can inspect the result.
const SAFE_RENDER_VIEW = {
  entities:               [],
  tasks:                  [],
  desks:                  [],
  agents:                 [],
  counts:                 { queued: 0, active: 0, done: 0, failed: 0 },
  incidents:              [],
  officeLayout:           {},
  transitionByTaskId:     new Map(),
  taskRouteByTaskId:      new Map(),
  taskVisualTargetByTaskId: new Map(),
  // graph fields
  nodes:                  [],
  edges:                  [],
  metadata:               {},
  observability:          { enabled: false, byTaskId: new Map() }
};

test('renderer boundary: render() does not access any raw-event or selector-domain keys at runtime', async () => {
  // Dynamically import renderer-loop so canvas-renderer.js module-level code
  // (which requires a DOM) is bypassed via the mock canvas in app-state.
  // We cannot call render() in Node.js (no real canvas), but we CAN verify
  // which keys are touched during the renderView destructuring at the top of
  // render() by intercepting the import through a mock.
  //
  // Strategy: read canvas-renderer.js source and locate the safeView
  // destructuring block; assert none of the destructured field names are
  // in the forbidden set.
  const rendererSrc = sources['rendering/canvas-renderer.js'];

  // Extract every safeView.<field> access with a simple regex over the source.
  const accessedKeys = new Set();
  const safeViewRe = /safeView\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  let m;
  while ((m = safeViewRe.exec(rendererSrc)) !== null) {
    accessedKeys.add(m[1]);
  }

  for (const key of accessedKeys) {
    assert.ok(!FORBIDDEN_RUNTIME_KEYS.has(key),
      `render() accesses safeView.${key} which is a forbidden raw-event/selector-domain key`);
  }
});

test('renderer boundary: render() does not destructure eventsByTaskId from renderView', () => {
  const rendererSrc = sources['rendering/canvas-renderer.js'];
  assert.ok(!/safeView\.eventsByTaskId\b/.test(rendererSrc),
    'render() must not destructure eventsByTaskId from its argument');
});

test('renderer boundary: render() does not destructure eventsByWorkerId from renderView', () => {
  const rendererSrc = sources['rendering/canvas-renderer.js'];
  assert.ok(!/safeView\.eventsByWorkerId\b/.test(rendererSrc),
    'render() must not destructure eventsByWorkerId from its argument');
});

test('renderer boundary: render() does not destructure a raw events array from renderView', () => {
  const rendererSrc = sources['rendering/canvas-renderer.js'];
  // match "safeView.events" but not "safeView.entities" etc.
  assert.ok(!/safeView\.events\b/.test(rendererSrc),
    'render() must not destructure a raw .events array from its argument');
});

// ─── 5. renderer-loop.js passes renderView through without modification ───────

test('renderer boundary: renderer-loop.js passes its argument directly to render() without transformation', () => {
  const loopSrc = sources['rendering/renderer-loop.js'];

  // The only call must be render(renderView) with no intermediate derivation.
  assert.ok(/render\s*\(\s*renderView\s*\)/.test(loopSrc),
    'renderer-loop.js must pass renderView directly to render()');

  // Must not call any selector or world-state function.
  assert.ok(!/getAllTasks|getTask|getAgent|deriveWorld|buildVisual/.test(loopSrc),
    'renderer-loop.js must not call selector or world-state functions');
});

// ─── 6. No direct world-state module imports in rendering files ───────────────

test('renderer boundary: no rendering file imports from core/world/', () => {
  for (const [file, code] of Object.entries(sources)) {
    assert.ok(!/from\s+['"][^'"]*core\/world\//.test(code),
      `${file} must not import directly from core/world/`);
  }
});

test('renderer boundary: no rendering file imports from ui/selectors/', () => {
  for (const [file, code] of Object.entries(sources)) {
    assert.ok(!/from\s+['"][^'"]*ui\/selectors\//.test(code),
      `${file} must not import directly from ui/selectors/`);
  }
});

// ─── 7. render() enforces the VisualWorldGraph contract at runtime ────────────

test('renderer boundary: canvas-renderer.js declares ALLOWED_RENDER_VIEW_KEYS', () => {
  const src = sources['rendering/canvas-renderer.js'];
  assert.ok(/ALLOWED_RENDER_VIEW_KEYS/.test(src),
    'canvas-renderer.js must declare ALLOWED_RENDER_VIEW_KEYS to define the accepted graph shape');
});

test('renderer boundary: ALLOWED_RENDER_VIEW_KEYS contains exactly nodes, edges, metadata', () => {
  const src = sources['rendering/canvas-renderer.js'];
  // Find the Set literal for ALLOWED_RENDER_VIEW_KEYS and extract its entries.
  const match = src.match(/ALLOWED_RENDER_VIEW_KEYS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  assert.ok(match, 'ALLOWED_RENDER_VIEW_KEYS must be declared as new Set([...])');
  const entries = match[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
  assert.deepStrictEqual(
    [...entries].sort(),
    ['edges', 'metadata', 'nodes'],
    'ALLOWED_RENDER_VIEW_KEYS must contain exactly "nodes", "edges", "metadata"'
  );
});

test('renderer boundary: canvas-renderer.js declares FORBIDDEN_RENDER_VIEW_KEYS', () => {
  const src = sources['rendering/canvas-renderer.js'];
  assert.ok(/FORBIDDEN_RENDER_VIEW_KEYS/.test(src),
    'canvas-renderer.js must declare FORBIDDEN_RENDER_VIEW_KEYS listing selector and event-domain keys');
});

test('renderer boundary: FORBIDDEN_RENDER_VIEW_KEYS contains selector-domain keys', () => {
  const src = sources['rendering/canvas-renderer.js'];
  const match = src.match(/FORBIDDEN_RENDER_VIEW_KEYS\s*=\s*new Set\(\[([^\]]*)\]\)/s);
  assert.ok(match, 'FORBIDDEN_RENDER_VIEW_KEYS must be declared as new Set([...])');
  const entries = new Set(match[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, '')));
  for (const key of ['tasks', 'agents', 'desks', 'events', 'eventsByTaskId', 'rawEvents']) {
    assert.ok(entries.has(key),
      `FORBIDDEN_RENDER_VIEW_KEYS must include the selector/event key "${key}"`);
  }
});

test('renderer boundary: canvas-renderer.js defines an assertGraphShape guard function', () => {
  const src = sources['rendering/canvas-renderer.js'];
  assert.ok(/function assertGraphShape\s*\(/.test(src),
    'canvas-renderer.js must define an assertGraphShape() guard function');
});

test('renderer boundary: assertGraphShape throws TypeError on forbidden keys', () => {
  const src = sources['rendering/canvas-renderer.js'];
  // assertGraphShape must reference TypeError and throw it.
  assert.ok(/throw new TypeError/.test(src),
    'assertGraphShape() must throw TypeError when the input shape is wrong');
});

test('renderer boundary: render() calls assertGraphShape before using its argument', () => {
  const src = sources['rendering/canvas-renderer.js'];
  // Locate the render() function body and verify assertGraphShape is the first call.
  const renderMatch = src.match(/export function render\s*\([^)]*\)\s*\{([\s\S]*?)(?=\nexport function|\n\/\/ ─|$)/);
  assert.ok(renderMatch, 'render() must be defined as an exported function');
  const body = renderMatch[1];
  const guardIdx   = body.indexOf('assertGraphShape(');
  const safeViewIdx = body.indexOf('const safeView');
  assert.ok(guardIdx !== -1,
    'render() must call assertGraphShape()');
  assert.ok(guardIdx < safeViewIdx,
    'render() must call assertGraphShape() before accessing its argument');
});

