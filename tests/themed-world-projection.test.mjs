/**
 * themed-world-projection.test.mjs
 *
 * Contracts for the Themed World Projection pass:
 *
 *  1. LIFECYCLE_ZONE_THEMES — structure and completeness
 *  2. task-chip components — fields, visualState, zoneId, anomaly derivation
 *  3. renderZoneLabels  — no raw event access; uses LIFECYCLE_ZONE_THEMES only
 *  4. renderAllTaskChips — no raw event access; uses visualState + anomaly only
 *  5. Zone label / task chip renderers — safe on a mock canvas context
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIFECYCLE_ZONES,
  VISUAL_STATE_MAP,
  LIFECYCLE_ZONE_THEMES,
  buildWorldScene,
} from '../rendering/world-scene.js';
import { toRenderableComponents } from '../rendering/world-scene-adapter.js';
import { buildEntityPositionMap }  from '../rendering/zone-renderer.js';
import { renderZoneLabels, ZONE_LABEL_STYLE } from '../rendering/zone-label-renderer.js';
import {
  renderAllTaskChips,
  CHIP_STYLES,
  ANOMALY_BADGE_COLORS,
  PROCESSING_PULSE_COLOR,
} from '../rendering/task-chip-renderer.js';

// ---------------------------------------------------------------------------
// Shared fixture — a VisualWorldGraph with various task states
// ---------------------------------------------------------------------------

const GRAPH = Object.freeze({
  nodes: [
    { id: 't-created',   type: 'task', status: 'created',          metadata: { duration: null, queueTime: null, latency: null, incidents: [] } },
    { id: 't-enqueued',  type: 'task', status: 'enqueued',         metadata: { duration: null, queueTime: 5,   latency: null, incidents: [] } },
    { id: 't-claimed',   type: 'task', status: 'claimed',          metadata: { duration: null, queueTime: 3,   latency: null, incidents: [] } },
    { id: 't-executing', type: 'task', status: 'executing',        metadata: { duration: null, queueTime: 4,   latency: null, incidents: [] } },
    { id: 't-finished',  type: 'task', status: 'execute_finished', metadata: { duration: 200,  queueTime: 6,   latency: null, incidents: [] } },
    { id: 't-completed', type: 'task', status: 'completed',        metadata: { duration: 310,  queueTime: 2,   latency: 1,    incidents: [] } },
    { id: 't-failed',    type: 'task', status: 'failed',           metadata: { duration: 80,   queueTime: 3,   latency: null, incidents: [{ clusterType: 'timeout', severity: 'high' }] } },
    { id: 'w-idle',      type: 'worker', status: 'idle',           metadata: {} },
  ],
  edges: [],
  metadata: {},
});

function cloneGraph() { return JSON.parse(JSON.stringify(GRAPH)); }

/** Run the pipeline up to component list. */
function runComponents(graph) {
  const scene = buildWorldScene(graph);
  return toRenderableComponents(scene);
}

/** Build a minimal mock canvas context that records draw calls. */
function makeMockCtx() {
  const log  = [];
  const store = {};
  return new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      return (...args) => { log.push({ method: String(p), args }); };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

// ---------------------------------------------------------------------------
// 1. LIFECYCLE_ZONE_THEMES structure
// ---------------------------------------------------------------------------

describe('LIFECYCLE_ZONE_THEMES — structure and completeness', () => {

  it('LIFECYCLE_ZONE_THEMES exists and is frozen', () => {
    assert.ok(LIFECYCLE_ZONE_THEMES && typeof LIFECYCLE_ZONE_THEMES === 'object', 'LIFECYCLE_ZONE_THEMES must be an object');
    assert.ok(Object.isFrozen(LIFECYCLE_ZONE_THEMES), 'LIFECYCLE_ZONE_THEMES must be frozen');
  });

  it('LIFECYCLE_ZONE_THEMES has an entry for every LIFECYCLE_ZONES id', () => {
    for (const zone of LIFECYCLE_ZONES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(LIFECYCLE_ZONE_THEMES, zone.id),
        `LIFECYCLE_ZONE_THEMES must have an entry for lifecycle zone "${zone.id}"`
      );
    }
  });

  it('each LIFECYCLE_ZONE_THEMES entry has a non-empty label string', () => {
    for (const [id, entry] of Object.entries(LIFECYCLE_ZONE_THEMES)) {
      assert.ok(
        typeof entry.label === 'string' && entry.label.length > 0,
        `LIFECYCLE_ZONE_THEMES["${id}"].label must be a non-empty string`
      );
    }
  });

  it('each LIFECYCLE_ZONE_THEMES entry has a non-empty theme string', () => {
    for (const [id, entry] of Object.entries(LIFECYCLE_ZONE_THEMES)) {
      assert.ok(
        typeof entry.theme === 'string' && entry.theme.length > 0,
        `LIFECYCLE_ZONE_THEMES["${id}"].theme must be a non-empty string`
      );
    }
  });

  it('all LIFECYCLE_ZONE_THEMES entries are frozen', () => {
    for (const [id, entry] of Object.entries(LIFECYCLE_ZONE_THEMES)) {
      assert.ok(Object.isFrozen(entry), `LIFECYCLE_ZONE_THEMES["${id}"] entry must be frozen`);
    }
  });

  it('LIFECYCLE_ZONE_THEMES covers exactly the same zone ids as LIFECYCLE_ZONES', () => {
    const lifecycleIds = new Set(LIFECYCLE_ZONES.map((z) => z.id));
    const worldIds     = new Set(Object.keys(LIFECYCLE_ZONE_THEMES));
    for (const id of lifecycleIds) {
      assert.ok(worldIds.has(id), `LIFECYCLE_ZONE_THEMES missing lifecycle zone id "${id}"`);
    }
    for (const id of worldIds) {
      assert.ok(lifecycleIds.has(id), `LIFECYCLE_ZONE_THEMES has unexpected zone id "${id}"`);
    }
  });

});

// ---------------------------------------------------------------------------
// 2. task-chip component contracts
// ---------------------------------------------------------------------------

describe('task-chip components — field contracts', () => {

  it('every task node produces a task-chip component', () => {
    const components = runComponents(cloneGraph());
    const taskNodes  = GRAPH.nodes.filter((n) => n.type === 'task');
    const chips      = components.filter((c) => c.componentType === 'task-chip');
    assert.equal(chips.length, taskNodes.length,
      'number of task-chip components must match number of task nodes');
  });

  it('task-chip components include id, x, y, visualState, zoneId, metrics, anomaly', () => {
    const components = runComponents(cloneGraph());
    const requiredKeys = ['id', 'x', 'y', 'visualState', 'zoneId', 'metrics', 'anomaly'];
    for (const c of components.filter((c) => c.componentType === 'task-chip')) {
      for (const key of requiredKeys) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(c, key),
          `task-chip "${c.id}" must have field "${key}"`
        );
      }
    }
  });

  it('task-chip visualState is always a value from VISUAL_STATE_MAP or "unknown"', () => {
    const components = runComponents(cloneGraph());
    const allowed    = new Set([...Object.values(VISUAL_STATE_MAP), 'unknown']);
    for (const c of components.filter((c) => c.componentType === 'task-chip')) {
      assert.ok(
        allowed.has(c.visualState),
        `task-chip "${c.id}" has unexpected visualState "${c.visualState}"`
      );
    }
  });

  it('task-chip zoneId is always a LIFECYCLE_ZONES id or null', () => {
    const components = runComponents(cloneGraph());
    const allowed    = new Set([null, ...LIFECYCLE_ZONES.map((z) => z.id)]);
    for (const c of components.filter((c) => c.componentType === 'task-chip')) {
      assert.ok(
        allowed.has(c.zoneId),
        `task-chip "${c.id}" has unexpected zoneId "${c.zoneId}"`
      );
    }
  });

  it('anomaly badge derives from the anomaly field — not from raw events', () => {
    const components = runComponents(cloneGraph());
    const failedChip = components.find(
      (c) => c.componentType === 'task-chip' && c.id === 't-failed'
    );
    assert.ok(failedChip, 'failed task must produce a task-chip component');
    // anomaly derives from metadata.incidents via buildWorldScene — not from events
    assert.ok(
      failedChip.anomaly !== null && failedChip.anomaly !== undefined,
      'failed task chip must have a non-null anomaly field'
    );
    assert.equal(typeof failedChip.anomaly.severity, 'string',
      'anomaly.severity must be a string');
  });

  it('non-failed task chips have null anomaly', () => {
    const components  = runComponents(cloneGraph());
    const normalChips = components.filter(
      (c) => c.componentType === 'task-chip' && c.id !== 't-failed'
    );
    for (const c of normalChips) {
      assert.equal(c.anomaly, null,
        `task-chip "${c.id}" without incidents must have null anomaly`);
    }
  });

  it('processing visualState (execute_finished) is used for awaiting-ack marker', () => {
    const components   = runComponents(cloneGraph());
    const finishedChip = components.find(
      (c) => c.componentType === 'task-chip' && c.id === 't-finished'
    );
    assert.ok(finishedChip, 'execute_finished task must produce a task-chip component');
    assert.equal(finishedChip.visualState, 'processing',
      'execute_finished task must map to "processing" visualState');
  });

});

// ---------------------------------------------------------------------------
// 3. CHIP_STYLES and badge constants
// ---------------------------------------------------------------------------

describe('task-chip-renderer — visual style constants', () => {

  it('CHIP_STYLES covers all visual states used by VISUAL_STATE_MAP', () => {
    const usedStates = new Set(Object.values(VISUAL_STATE_MAP));
    for (const state of usedStates) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(CHIP_STYLES, state),
        `CHIP_STYLES must have an entry for visualState "${state}"`
      );
    }
  });

  it('every CHIP_STYLES entry has fill and barColor strings', () => {
    for (const [state, style] of Object.entries(CHIP_STYLES)) {
      assert.ok(typeof style.fill     === 'string', `CHIP_STYLES["${state}"].fill must be a string`);
      assert.ok(typeof style.barColor === 'string', `CHIP_STYLES["${state}"].barColor must be a string`);
    }
  });

  it('ANOMALY_BADGE_COLORS has high and default entries', () => {
    assert.ok(typeof ANOMALY_BADGE_COLORS.high    === 'string', 'ANOMALY_BADGE_COLORS.high must be a string');
    assert.ok(typeof ANOMALY_BADGE_COLORS.default === 'string', 'ANOMALY_BADGE_COLORS.default must be a string');
  });

  it('PROCESSING_PULSE_COLOR is a non-empty string', () => {
    assert.ok(typeof PROCESSING_PULSE_COLOR === 'string' && PROCESSING_PULSE_COLOR.length > 0,
      'PROCESSING_PULSE_COLOR must be a non-empty string');
  });

});

// ---------------------------------------------------------------------------
// 4. ZONE_LABEL_STYLE constants
// ---------------------------------------------------------------------------

describe('zone-label-renderer — visual style constants', () => {

  it('ZONE_LABEL_STYLE has the required visual fields', () => {
    const required = ['bgFill', 'bgStroke', 'textColor', 'font', 'cornerRadius', 'padX', 'padY', 'lineWidth'];
    for (const key of required) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(ZONE_LABEL_STYLE, key),
        `ZONE_LABEL_STYLE must have field "${key}"`
      );
    }
  });

  it('ZONE_LABEL_STYLE is frozen', () => {
    assert.ok(Object.isFrozen(ZONE_LABEL_STYLE), 'ZONE_LABEL_STYLE must be frozen');
  });

});

// ---------------------------------------------------------------------------
// 5. renderZoneLabels — runs on mock ctx without crashing
// ---------------------------------------------------------------------------

describe('renderZoneLabels — mock-canvas execution', () => {

  it('does not throw on a valid component list', () => {
    const components = runComponents(cloneGraph());
    const ctx        = makeMockCtx();
    assert.doesNotThrow(() => renderZoneLabels(ctx, components, false));
  });

  it('does not throw when isDebugMode is false (no-op in normal mode)', () => {
    const components = runComponents(cloneGraph());
    const ctx        = makeMockCtx();
    assert.doesNotThrow(() => renderZoneLabels(ctx, components, false));
  });

  it('does not throw on an empty component list', () => {
    const ctx = makeMockCtx();
    assert.doesNotThrow(() => renderZoneLabels(ctx, [], false));
  });

  it('does not throw when ctx is null', () => {
    const components = runComponents(cloneGraph());
    assert.doesNotThrow(() => renderZoneLabels(null, components, false));
  });

  it('makes no draw calls in normal mode (isDebugMode=false)', () => {
    const components = runComponents(cloneGraph());
    const log        = [];
    const ctx        = new Proxy({}, {
      get(t, p) {
        if (p in t) return t[p];
        return (...args) => log.push({ method: String(p), args });
      },
      set(t, p, v) { t[p] = v; return true; },
    });
    renderZoneLabels(ctx, components, false);
    assert.equal(log.length, 0,
      'normal mode (isDebugMode=false) must produce zero zone-label draw calls');
  });

  it('produces draw calls for each zone-background in debug mode (isDebugMode=true)', () => {
    const components = runComponents(cloneGraph());
    const zoneBgs    = components.filter((c) => c.componentType === 'zone-background');
    const log        = [];
    const ctx        = new Proxy({ canvas: { width: 1060, height: 520 } }, {
      get(t, p) {
        if (p in t) return t[p];
        return (...args) => { log.push({ method: String(p), args }); return 0; };
      },
      set(t, p, v) { t[p] = v; return true; },
    });
    renderZoneLabels(ctx, components, true);
    // Each zone that has a LIFECYCLE_ZONE_THEMES entry should produce at least one draw call
    const zonesWithLabels = zoneBgs.filter((c) => Object.prototype.hasOwnProperty.call(LIFECYCLE_ZONE_THEMES, c.id));
    assert.ok(log.length > 0 || zonesWithLabels.length === 0,
      'debug mode (isDebugMode=true) must produce draw calls for zones with LIFECYCLE_ZONE_THEMES entries');
  });

});

// ---------------------------------------------------------------------------
// 6. renderAllTaskChips — runs on mock ctx without crashing
// ---------------------------------------------------------------------------

describe('renderAllTaskChips — mock-canvas execution', () => {

  it('does not throw on a valid component list', () => {
    const components    = runComponents(cloneGraph());
    const entityPos     = buildEntityPositionMap(components);
    const ctx           = makeMockCtx();
    assert.doesNotThrow(() => renderAllTaskChips(ctx, components, entityPos));
  });

  it('does not throw on an empty component list', () => {
    const ctx = makeMockCtx();
    assert.doesNotThrow(() => renderAllTaskChips(ctx, [], new Map()));
  });

  it('does not throw when ctx is null', () => {
    const components = runComponents(cloneGraph());
    assert.doesNotThrow(() => renderAllTaskChips(null, components, new Map()));
  });

  it('does not throw with a null entity position map', () => {
    const components = runComponents(cloneGraph());
    const ctx        = makeMockCtx();
    assert.doesNotThrow(() => renderAllTaskChips(ctx, components, null));
  });

  it('produces draw calls for task-chip components', () => {
    const components = runComponents(cloneGraph());
    const entityPos  = buildEntityPositionMap(components);
    const log        = [];
    const ctx        = new Proxy({ canvas: { width: 1060, height: 520 } }, {
      get(t, p) {
        if (p in t) return t[p];
        return (...args) => { log.push({ method: String(p), args }); return 0; };
      },
      set(t, p, v) { t[p] = v; return true; },
    });
    renderAllTaskChips(ctx, components, entityPos);
    const taskChips = components.filter((c) => c.componentType === 'task-chip');
    assert.ok(taskChips.length > 0, 'fixture must have task-chip components');
    assert.ok(log.length > 0, 'rendering task chips must produce canvas draw calls');
  });

  it('processing pulse is drawn for processing visualState chips only', () => {
    // Build a minimal scene with one processing chip only
    const processingGraph = {
      nodes: [
        { id: 't-proc', type: 'task', status: 'execute_finished',
          metadata: { duration: 100, queueTime: 2, latency: null, incidents: [] } },
      ],
      edges: [],
      metadata: {},
    };
    const components = runComponents(processingGraph);
    const entityPos  = buildEntityPositionMap(components);

    // Count ellipse calls (used by drawProcessingPulse)
    let ellipseCalls = 0;
    const ctx = new Proxy({ canvas: { width: 1060, height: 520 } }, {
      get(t, p) {
        if (p in t) return t[p];
        return (...args) => {
          if (String(p) === 'ellipse') ellipseCalls++;
          return 0;
        };
      },
      set(t, p, v) { t[p] = v; return true; },
    });

    renderAllTaskChips(ctx, components, entityPos);
    assert.ok(ellipseCalls > 0, 'processing task chip must invoke ellipse (processing pulse ring)');
  });

  it('anomaly badge draw calls occur for chips with anomaly data', () => {
    const components = runComponents(cloneGraph());
    const entityPos  = buildEntityPositionMap(components);
    const failedChip = components.find(
      (c) => c.componentType === 'task-chip' && c.id === 't-failed'
    );
    assert.ok(failedChip && failedChip.anomaly, 'failed chip must have anomaly set');

    // Count fillRect calls — anomaly badge draws two fillRect (exclamation + dot)
    let fillRectCalls = 0;
    const ctx = new Proxy({ canvas: { width: 1060, height: 520 } }, {
      get(t, p) {
        if (p in t) return t[p];
        return (...args) => {
          if (String(p) === 'fillRect') fillRectCalls++;
          return 0;
        };
      },
      set(t, p, v) { t[p] = v; return true; },
    });

    renderAllTaskChips(ctx, components, entityPos);
    assert.ok(fillRectCalls > 0,
      'chips with anomaly must trigger fillRect draw calls for the anomaly badge');
  });

  it('no raw event keys appear in render call arguments', () => {
    const components = runComponents(cloneGraph());
    const entityPos  = buildEntityPositionMap(components);
    const log        = [];
    const ctx        = new Proxy({ canvas: { width: 1060, height: 520 } }, {
      get(t, p) {
        if (p in t) return t[p];
        return (...args) => { log.push({ method: String(p), args }); return 0; };
      },
      set(t, p, v) { t[p] = v; return true; },
    });

    renderAllTaskChips(ctx, components, entityPos);

    const argsStr = JSON.stringify(log.map((e) => e.args));
    const forbidden = ['eventsByTaskId', 'eventsByWorkerId', 'rawEvents', 'TASK_CREATED', 'TASK_ACKED'];
    for (const key of forbidden) {
      assert.ok(!argsStr.includes(key),
        `render call arguments must not contain "${key}" — rendering must not access raw events`);
    }
  });

});

// ---------------------------------------------------------------------------
// 7. Two-pass determinism — same input → same task-chip output
// ---------------------------------------------------------------------------

describe('task-chip projection — determinism', () => {

  it('two runs with the same graph produce identical task-chip component lists', () => {
    const a = runComponents(cloneGraph()).filter((c) => c.componentType === 'task-chip');
    const b = runComponents(cloneGraph()).filter((c) => c.componentType === 'task-chip');
    assert.equal(JSON.stringify(a), JSON.stringify(b),
      'task-chip component lists must be identical across runs');
  });

  it('zone-background component list is stable across runs', () => {
    const a = runComponents(cloneGraph()).filter((c) => c.componentType === 'zone-background');
    const b = runComponents(cloneGraph()).filter((c) => c.componentType === 'zone-background');
    assert.equal(JSON.stringify(a), JSON.stringify(b),
      'zone-background component lists must be identical across runs');
  });

});
