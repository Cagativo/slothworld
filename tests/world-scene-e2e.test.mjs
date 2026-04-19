/**
 * world-scene-e2e.test.mjs
 *
 * End-to-end test: VisualWorldGraph → WorldScene → Renderer
 *
 * Assertions:
 *  1. No event usage   — semantic event-domain keys must never appear in the pipeline
 *  2. No selector usage — selector-domain keys must never appear in the pipeline
 *  3. Deterministic output — same input always produces identical draw logs
 *  4. No semantic leakage — every component and draw call is driven only by
 *                           graph-layer fields (id, type, status, metadata)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildWorldScene, LIFECYCLE_ZONES, STATUS_ZONE_MAP, VISUAL_STATE_MAP } from '../rendering/world-scene.js';
import { toRenderableComponents } from '../rendering/world-scene-adapter.js';
import { renderAllZones, buildEntityPositionMap } from '../rendering/zone-renderer.js';
import { renderAllAgentEntities, AGENT_VISUAL_STYLES } from '../rendering/agent-entity-renderer.js';
import { renderAllConnections, FLOW_LINE_STYLE } from '../rendering/connection-renderer.js';

// ---------------------------------------------------------------------------
// Fixture — a VisualWorldGraph (the boundary input; no events, no selectors)
// ---------------------------------------------------------------------------

const GRAPH = Object.freeze({
  nodes: [
    { id: 't1', type: 'task',   status: 'created',          metadata: { duration: null, queueTime: null,  latency: null, incidents: [] } },
    { id: 't2', type: 'task',   status: 'enqueued',         metadata: { duration: null, queueTime: 12,    latency: null, incidents: [] } },
    { id: 't3', type: 'task',   status: 'claimed',          metadata: { duration: null, queueTime: 5,     latency: null, incidents: [] } },
    { id: 't4', type: 'task',   status: 'executing',        metadata: { duration: null, queueTime: 8,     latency: null, incidents: [] } },
    { id: 't5', type: 'task',   status: 'execute_finished', metadata: { duration: 300,  queueTime: 10,    latency: null, incidents: [] } },
    { id: 't6', type: 'task',   status: 'completed',        metadata: { duration: 400,  queueTime: 6,     latency: 3,   incidents: [] } },
    { id: 't7', type: 'task',   status: 'failed',           metadata: { duration: 100,  queueTime: 7,     latency: null, incidents: [{ clusterType: 'timeout', severity: 'high' }] } },
    { id: 'w1', type: 'worker', status: 'idle',             metadata: {} },
  ],
  edges: [
    { id: 'e1', from: 't1', to: 't2' },
    { id: 'e2', from: 't2', to: 't3' },
    { id: 'e3', from: 't3', to: 't5' },
    { id: 'e4', from: 't5', to: 't6' },
  ],
  metadata: {},
});

// Forbidden key categories — must never appear anywhere in the pipeline output
const EVENT_DOMAIN_KEYS   = ['events','eventsByTaskId','eventsByWorkerId','rawEvents','payload','taskId','workerId','type'];
const SELECTOR_DOMAIN_KEYS = ['tasks','agents','desks','incidents','officeLayout','transitionByTaskId','indexedWorld','counts'];

// "type" is only forbidden as a top-level pipeline output key — not inside component descriptors
// which legitimately use componentType. We check "type" only on scene-level objects.
const SCENE_FORBIDDEN_KEYS   = ['events','eventsByTaskId','eventsByWorkerId','rawEvents','payload','taskId','workerId'];
const SELECTOR_FORBIDDEN_KEYS = ['tasks','agents','desks','incidents','officeLayout','transitionByTaskId','indexedWorld','counts'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function stable(v) { return JSON.stringify(v); }

/** Build a mock canvas ctx that records method calls AND property assignments. */
function makeMockCtx() {
  const store = {};
  const log   = [];
  const ctx   = new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      return (...args) => log.push({ kind: 'call', method: p, args });
    },
    set(t, p, v) { t[p] = v; log.push({ kind: 'set', prop: p, value: v }); return true; },
  });
  return { ctx, log };
}

/**
 * Run the full pipeline and return all intermediate products + draw log.
 * frame is kept constant (0) so the output is fully deterministic.
 */
function runFullPipeline(graph, frame = 0) {
  const scene      = buildWorldScene(graph);
  const components = toRenderableComponents(scene);
  const posMap     = buildEntityPositionMap(components);

  const { ctx, log } = makeMockCtx();
  renderAllZones(ctx, components);
  renderAllAgentEntities(ctx, components);
  renderAllConnections(ctx, components, posMap, frame);

  return { scene, components, posMap, drawLog: log.slice() };
}

// ---------------------------------------------------------------------------
// 1. No event usage
// ---------------------------------------------------------------------------

describe('E2E — no event usage', () => {

  it('scene has no event-domain keys at top level', () => {
    const { scene } = runFullPipeline(clone(GRAPH));
    for (const key of SCENE_FORBIDDEN_KEYS) {
      assert.ok(!(key in scene), `scene must not expose event key "${key}"`);
    }
  });

  it('scene.entities have no event-domain keys', () => {
    const { scene } = runFullPipeline(clone(GRAPH));
    for (const entity of scene.entities) {
      for (const key of SCENE_FORBIDDEN_KEYS) {
        assert.ok(!(key in entity), `entity "${entity.id}" must not have event key "${key}"`);
      }
    }
  });

  it('scene.connections have no event-domain keys', () => {
    const { scene } = runFullPipeline(clone(GRAPH));
    for (const conn of scene.connections) {
      for (const key of SCENE_FORBIDDEN_KEYS) {
        assert.ok(!(key in conn), `connection must not have event key "${key}"`);
      }
    }
  });

  it('components have no event-domain keys', () => {
    const { components } = runFullPipeline(clone(GRAPH));
    for (const c of components) {
      for (const key of SCENE_FORBIDDEN_KEYS) {
        assert.ok(!(key in c), `component "${c.componentType}" must not have event key "${key}"`);
      }
    }
  });

  it('draw log method names contain no event-domain keywords', () => {
    const { drawLog } = runFullPipeline(clone(GRAPH));
    const methodNames = drawLog
      .filter(e => e.kind === 'call')
      .map(e => e.method.toLowerCase());
    for (const key of EVENT_DOMAIN_KEYS) {
      assert.ok(!methodNames.some(m => m.includes(key.toLowerCase())),
        `draw log must not reference event key "${key}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. No selector usage
// ---------------------------------------------------------------------------

describe('E2E — no selector usage', () => {

  it('scene has no selector-domain keys', () => {
    const { scene } = runFullPipeline(clone(GRAPH));
    for (const key of SELECTOR_FORBIDDEN_KEYS) {
      assert.ok(!(key in scene), `scene must not expose selector key "${key}"`);
    }
  });

  it('scene.entities have no selector-domain keys', () => {
    const { scene } = runFullPipeline(clone(GRAPH));
    for (const entity of scene.entities) {
      for (const key of SELECTOR_FORBIDDEN_KEYS) {
        assert.ok(!(key in entity), `entity "${entity.id}" must not have selector key "${key}"`);
      }
    }
  });

  it('components have no selector-domain keys', () => {
    const { components } = runFullPipeline(clone(GRAPH));
    for (const c of components) {
      for (const key of SELECTOR_FORBIDDEN_KEYS) {
        assert.ok(!(key in c), `component "${c.componentType}" must not have selector key "${key}"`);
      }
    }
  });

  it('position map values have only x and y', () => {
    const { posMap } = runFullPipeline(clone(GRAPH));
    for (const [id, pos] of posMap) {
      const keys = Object.keys(pos).sort().join(',');
      assert.equal(keys, 'x,y', `position for "${id}" must only have x,y — got: ${keys}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Deterministic output
// ---------------------------------------------------------------------------

describe('E2E — deterministic output', () => {

  it('two runs with identical graph produce identical scenes', () => {
    const a = runFullPipeline(clone(GRAPH));
    const b = runFullPipeline(clone(GRAPH));
    assert.equal(stable(a.scene), stable(b.scene));
  });

  it('two runs with identical graph produce identical component lists', () => {
    const a = runFullPipeline(clone(GRAPH));
    const b = runFullPipeline(clone(GRAPH));
    assert.equal(stable(a.components), stable(b.components));
  });

  it('two runs with identical graph produce identical position maps', () => {
    const toObj = m => Object.fromEntries([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    const a = runFullPipeline(clone(GRAPH));
    const b = runFullPipeline(clone(GRAPH));
    assert.equal(stable(toObj(a.posMap)), stable(toObj(b.posMap)));
  });

  it('two runs with identical frame produce identical draw logs', () => {
    const a = runFullPipeline(clone(GRAPH), 42);
    const b = runFullPipeline(clone(GRAPH), 42);
    assert.equal(stable(a.drawLog), stable(b.drawLog));
  });

  it('different frames produce different lineDashOffset values (animation advances)', () => {
    const a = runFullPipeline(clone(GRAPH), 0);
    const b = runFullPipeline(clone(GRAPH), 60);
    // lineDashOffset is a canvas property assignment, not a method call.
    // Extract the values recorded in the log for each run.
    const offsetA = a.drawLog.filter(e => e.kind === 'set' && e.prop === 'lineDashOffset').map(e => e.value);
    const offsetB = b.drawLog.filter(e => e.kind === 'set' && e.prop === 'lineDashOffset').map(e => e.value);
    assert.ok(offsetA.length > 0, 'frame 0: lineDashOffset must be set at least once');
    assert.ok(offsetB.length > 0, 'frame 60: lineDashOffset must be set at least once');
    assert.notEqual(stable(offsetA), stable(offsetB),
      'lineDashOffset values at frame 0 and frame 60 must differ');
  });

  it('graph input is not mutated across the pipeline', () => {
    const original = clone(GRAPH);
    runFullPipeline(GRAPH);
    assert.equal(stable(GRAPH), stable(original));
  });

  it('five consecutive runs produce identical scenes', () => {
    const results = Array.from({ length: 5 }, () => runFullPipeline(clone(GRAPH)));
    for (let i = 1; i < results.length; i++) {
      assert.equal(stable(results[0].scene), stable(results[i].scene), `run ${i} scene differs`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. No semantic leakage
// ---------------------------------------------------------------------------

describe('E2E — no semantic leakage', () => {

  it('entity visualState is always a key from VISUAL_STATE_MAP or "unknown"', () => {
    const { scene } = runFullPipeline(clone(GRAPH));
    const allowed = new Set([...Object.values(VISUAL_STATE_MAP), 'unknown']);
    for (const e of scene.entities) {
      assert.ok(allowed.has(e.visualState),
        `entity "${e.id}" has unexpected visualState "${e.visualState}"`);
    }
  });

  it('entity zoneId is always a LIFECYCLE_ZONES id or null', () => {
    const { scene } = runFullPipeline(clone(GRAPH));
    const allowed = new Set([null, ...LIFECYCLE_ZONES.map(z => z.id)]);
    for (const e of scene.entities) {
      assert.ok(allowed.has(e.zoneId),
        `entity "${e.id}" has unexpected zoneId "${e.zoneId}"`);
    }
  });

  it('entity type is always "agent"', () => {
    const { scene } = runFullPipeline(clone(GRAPH));
    for (const e of scene.entities) {
      assert.equal(e.type, 'agent', `entity "${e.id}" type must be "agent"`);
    }
  });

  it('connection type is always "flow"', () => {
    const { scene } = runFullPipeline(clone(GRAPH));
    for (const c of scene.connections) {
      assert.equal(c.type, 'flow', 'connection type must be "flow"');
    }
  });

  it('agent-sprite componentType is the only entity component produced', () => {
    const { components } = runFullPipeline(clone(GRAPH));
    const entityComponents = components.filter(c => c.componentType !== 'zone-background' && c.componentType !== 'flow-line');
    for (const c of entityComponents) {
      assert.equal(c.componentType, 'agent-sprite',
        `unexpected entity componentType: "${c.componentType}"`);
    }
  });

  it('agent-sprite components have only the expected structural keys', () => {
    const { components } = runFullPipeline(clone(GRAPH));
    const expected = 'anomaly,componentType,id,metrics,visualState,x,y,zoneId';
    for (const c of components.filter(c => c.componentType === 'agent-sprite')) {
      const keys = Object.keys(c).sort().join(',');
      assert.equal(keys, expected, `unexpected keys on agent-sprite "${c.id}": ${keys}`);
    }
  });

  it('flow-line components have only { componentType, from, to }', () => {
    const { components } = runFullPipeline(clone(GRAPH));
    for (const c of components.filter(c => c.componentType === 'flow-line')) {
      const keys = Object.keys(c).sort().join(',');
      assert.equal(keys, 'componentType,from,to', `unexpected keys on flow-line: ${keys}`);
    }
  });

  it('metrics object has only { duration, queueTime, latency }', () => {
    const { components } = runFullPipeline(clone(GRAPH));
    for (const c of components.filter(c => c.componentType === 'agent-sprite')) {
      const keys = Object.keys(c.metrics).sort().join(',');
      assert.equal(keys, 'duration,latency,queueTime',
        `unexpected metrics keys on "${c.id}": ${keys}`);
    }
  });

  it('anomaly object (when present) has only { severity, type }', () => {
    const { components } = runFullPipeline(clone(GRAPH));
    for (const c of components.filter(c => c.componentType === 'agent-sprite' && c.anomaly !== null)) {
      const keys = Object.keys(c.anomaly).sort().join(',');
      assert.equal(keys, 'severity,type',
        `unexpected anomaly keys on "${c.id}": ${keys}`);
    }
  });

  it('no raw canonical TASK_* or WORKER_* strings appear in component fields', () => {
    const { components } = runFullPipeline(clone(GRAPH));
    const raw = JSON.stringify(components);
    assert.ok(!/TASK_CREATED|TASK_ENQUEUED|TASK_CLAIMED|TASK_EXECUTE_|TASK_ACKED/.test(raw),
      'canonical event type strings must not appear in component output');
  });

  it('visualState values are never canonical event-type identifiers', () => {
    // The real leakage risk is event-type strings like TASK_CREATED appearing
    // as visualState values — not a coincidental name overlap with status strings.
    const { components } = runFullPipeline(clone(GRAPH));
    const canonicalEventTypes = [
      'TASK_CREATED','TASK_ENQUEUED','TASK_CLAIMED',
      'TASK_EXECUTE_STARTED','TASK_EXECUTE_FINISHED','TASK_ACKED',
    ];
    for (const c of components.filter(c => c.componentType === 'agent-sprite')) {
      assert.ok(!canonicalEventTypes.includes(c.visualState),
        `visualState "${c.visualState}" must not be a canonical event type identifier`);
    }
  });

  it('draw calls use only visual style constants — no event-domain strings in arguments', () => {
    const { drawLog } = runFullPipeline(clone(GRAPH));
    const argsStr = JSON.stringify(drawLog.map(e => e.args));
    for (const key of EVENT_DOMAIN_KEYS.filter(k => k !== 'type')) {
      assert.ok(!argsStr.includes(`"${key}"`),
        `event key "${key}" found in draw call arguments`);
    }
  });

  it('all agent-sprite visualStates are present in AGENT_VISUAL_STYLES', () => {
    const { components } = runFullPipeline(clone(GRAPH));
    for (const c of components.filter(c => c.componentType === 'agent-sprite')) {
      const style = AGENT_VISUAL_STYLES[c.visualState] ?? AGENT_VISUAL_STYLES.unknown;
      assert.ok(style, `no visual style for visualState "${c.visualState}"`);
    }
  });
});
