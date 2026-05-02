import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * renderer-purity.test.mjs
 *
 * Verifies that the rendering input contract guard is a pure projection:
 *
 *   1. assertGraphShape() validates the VisualWorldGraph contract without
 *      side effects — same input always produces the same outcome.
 *
 *   2. No caching of semantic data — render-guards.js must not store
 *      task-id-keyed or status-keyed data on module-level structures.
 *
 *   3. assertGraphShape() enforces the VisualWorldGraph shape contract,
 *      throwing TypeError on forbidden or unrecognised keys.
 *
 * Strategy
 * --------
 * assertGraphShape is a pure function (no DOM, no canvas) importable directly
 * from rendering/render-guards.js.  Static analysis checks are applied to
 * render-guards.js and renderer-loop.js to verify structural correctness.
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

// ─── Import assertGraphShape directly — it is a pure function (no DOM) ────────

import { assertGraphShape } from '../rendering/render-guards.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

// 1. assertGraphShape is a pure function ───────────────────────────────────────

test('renderer purity: assertGraphShape is exported from render-guards.js', () => {
  assert.equal(typeof assertGraphShape, 'function',
    'assertGraphShape must be an exported function from render-guards.js');
});

test('renderer purity: assertGraphShape does not return a value for valid input', () => {
  const result = assertGraphShape(GRAPH_A);
  assert.equal(result, undefined,
    'assertGraphShape() must return undefined — it is a validation guard, not a data producer');
});

test('renderer purity: assertGraphShape does not throw on empty graph', () => {
  assert.doesNotThrow(() => assertGraphShape(GRAPH_EMPTY),
    'assertGraphShape() must not throw when given an empty graph');
});

test('renderer purity: assertGraphShape does not throw on null/undefined graph', () => {
  assert.doesNotThrow(() => assertGraphShape(null),      'assertGraphShape(null) must not throw');
  assert.doesNotThrow(() => assertGraphShape(undefined), 'assertGraphShape(undefined) must not throw');
});

test('renderer purity: assertGraphShape called twice with same input produces same outcome', () => {
  let threw1 = false; let threw2 = false;
  try { assertGraphShape(GRAPH_A); } catch (_) { threw1 = true; }
  try { assertGraphShape(GRAPH_A); } catch (_) { threw2 = true; }
  assert.equal(threw1, threw2, 'assertGraphShape must be deterministic — same input, same outcome');
});

test('renderer purity: assertGraphShape called with GRAPH_A then GRAPH_B then GRAPH_A is stateless', () => {
  let threw = false;
  assertGraphShape(GRAPH_B);  // should not affect subsequent call
  try { assertGraphShape(GRAPH_A); } catch (_) { threw = true; }
  assert.ok(!threw, 'assertGraphShape(GRAPH_A) after assertGraphShape(GRAPH_B) must still pass');
});

// 2. Static analysis: no module-level semantic caches ─────────────────────────

test('renderer purity: render-guards.js has no module-level cache keyed by taskId or status', () => {
  const source = readFileSync(resolve(ROOT, 'rendering/render-guards.js'), 'utf8');

  const moduleTopLines = source
    .split('\n')
    .filter((line) => /^(?:const|let|var)\s+/.test(line));

  const cachePattern = /\b(?:Map|Set|Object\.create|{}\s*;)\b/;
  const semanticNamePattern = /\b\w*(?:task|status|lifecycle|cache|memo|store|keyed)\w*\b/i;

  const hits = moduleTopLines.filter(
    (line) => cachePattern.test(line) && semanticNamePattern.test(line)
  );

  assert.deepStrictEqual(hits, [],
    `render-guards.js must not declare module-level caches keyed by semantic data:\n${hits.map((l) => '  ' + l.trim()).join('\n')}`);
});

test('renderer purity: render-guards.js does not write graph data back to module-level state', () => {
  const source = readFileSync(resolve(ROOT, 'rendering/render-guards.js'), 'utf8');

  const suspiciousWrite = /\b(?:nodes|edges|node|edge|task)\s*(?:\.\s*\w+)*\s*[=\[]/;

  const moduleTopLines = source
    .split('\n')
    .filter((line) => /^(?:const|let|var)\s+/.test(line) && suspiciousWrite.test(line));

  assert.deepStrictEqual(moduleTopLines, [],
    `render-guards.js must not write graph data into module-level variables at declaration:\n${moduleTopLines.map((l) => '  ' + l.trim()).join('\n')}`);
});

test('renderer purity: render-guards.js does not import from world or selector modules', () => {
  const source = readFileSync(resolve(ROOT, 'rendering/render-guards.js'), 'utf8');

  const forbidden = [
    { label: 'core/world/', re: /from\s+['"][^'"]*core\/world\// },
    { label: 'ui/selectors/', re: /from\s+['"][^'"]*ui\/selectors\// },
    { label: 'deriveWorldState', re: /\bderiveWorldState\b/ },
    { label: 'getRawEvents', re: /\bgetRawEvents\b/ }
  ];

  for (const { label, re } of forbidden) {
    assert.ok(!re.test(source),
      `render-guards.js must not import "${label}" — it is a pure projection guard`);
  }
});

// 3. Input contract — assertGraphShape() must reject non-graph arguments ────────

test('renderer purity: assertGraphShape() accepts a valid { nodes, edges, metadata } graph', () => {
  assert.doesNotThrow(
    () => assertGraphShape({ nodes: [], edges: [], metadata: {} }),
    'assertGraphShape() must accept a valid VisualWorldGraph'
  );
});

test('renderer purity: assertGraphShape() accepts a graph with only some optional keys present', () => {
  assert.doesNotThrow(() => assertGraphShape({ nodes: [] }),          'nodes-only graph must be accepted');
  assert.doesNotThrow(() => assertGraphShape({ edges: [] }),          'edges-only graph must be accepted');
  assert.doesNotThrow(() => assertGraphShape({ metadata: {} }),       'metadata-only graph must be accepted');
  assert.doesNotThrow(() => assertGraphShape({ nodes: [], edges: [] }), 'nodes+edges graph must be accepted');
});

test('renderer purity: assertGraphShape() rejects a selector-domain object (tasks/agents/desks)', () => {
  assert.throws(
    () => assertGraphShape({ tasks: [], agents: [], desks: [] }),
    TypeError,
    'assertGraphShape() must throw TypeError when passed a selector-domain object'
  );
});

test('renderer purity: assertGraphShape() rejects an object with "tasks" key', () => {
  assert.throws(
    () => assertGraphShape({ tasks: [], nodes: [], edges: [] }),
    TypeError,
    'assertGraphShape() must throw TypeError when "tasks" key is present'
  );
});

test('renderer purity: assertGraphShape() rejects an object with "agents" key', () => {
  assert.throws(
    () => assertGraphShape({ agents: [], nodes: [], edges: [] }),
    TypeError,
    'assertGraphShape() must throw TypeError when "agents" key is present'
  );
});

test('renderer purity: assertGraphShape() rejects a raw events object (events key)', () => {
  assert.throws(
    () => assertGraphShape({ events: [], nodes: [], edges: [] }),
    TypeError,
    'assertGraphShape() must throw TypeError when "events" key is present'
  );
});

test('renderer purity: assertGraphShape() rejects an object with "eventsByTaskId" key', () => {
  assert.throws(
    () => assertGraphShape({ eventsByTaskId: new Map(), nodes: [], edges: [] }),
    TypeError,
    'assertGraphShape() must throw TypeError when "eventsByTaskId" key is present'
  );
});

test('renderer purity: assertGraphShape() rejects an object with "rawEvents" key', () => {
  assert.throws(
    () => assertGraphShape({ rawEvents: [], nodes: [], edges: [] }),
    TypeError,
    'assertGraphShape() must throw TypeError when "rawEvents" key is present'
  );
});

test('renderer purity: assertGraphShape() rejects an object with "payload" key', () => {
  assert.throws(
    () => assertGraphShape({ payload: { status: 'completed' }, nodes: [] }),
    TypeError,
    'assertGraphShape() must throw TypeError when "payload" key is present (event payload shape)'
  );
});

test('renderer purity: assertGraphShape() rejects a mixed source object (graph + selector keys)', () => {
  assert.throws(
    () => assertGraphShape({ nodes: [], edges: [], metadata: {}, counts: { queued: 0 }, incidents: [] }),
    TypeError,
    'assertGraphShape() must throw TypeError when graph keys are mixed with selector-domain keys'
  );
});

test('renderer purity: assertGraphShape() rejects a mixed source object (graph + event keys)', () => {
  assert.throws(
    () => assertGraphShape({ nodes: [], edges: [], metadata: {}, events: [], taskId: 'x' }),
    TypeError,
    'assertGraphShape() must throw TypeError when graph keys are mixed with event-domain keys'
  );
});

test('renderer purity: assertGraphShape() rejects any unrecognised key even if not explicitly forbidden', () => {
  assert.throws(
    () => assertGraphShape({ nodes: [], edges: [], metadata: {}, unknownField: true }),
    TypeError,
    'assertGraphShape() must throw TypeError for any unrecognised top-level key'
  );
});

test('renderer purity: assertGraphShape() TypeError message names the offending keys', () => {
  let err;
  try { assertGraphShape({ tasks: [], agents: [] }); }
  catch (e) { err = e; }
  assert.ok(err instanceof TypeError, 'must throw TypeError');
  assert.ok(
    err.message.includes('tasks') || err.message.includes('agents'),
    `TypeError message must name the offending key(s) — got: "${err.message}"`
  );
});
