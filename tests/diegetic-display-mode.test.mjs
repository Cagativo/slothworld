/**
 * diegetic-display-mode.test.mjs
 *
 * Contracts for the Diegetic UI pass:
 *
 *  1. Normal mode suppresses debug labels/bounds
 *     - renderZoneLabels(isDebugMode=false) → zero draw calls
 *     - renderAllTaskChips(isDebugMode=false) hides idle/completed chips
 *  2. Debug mode still renders diagnostic labels
 *     - renderZoneLabels(isDebugMode=true) → draw calls for each zone
 *     - renderAllTaskChips(isDebugMode=true) → all chips rendered with ID text
 *  3. Normal mode never renders both lifecycle labels and semantic zone labels
 *  4. Render behaviour is deterministic — same input/mode → same draw log
 *  5. No raw event / payload / world-index access in diegetic-indicator-renderer.js
 *  6. renderDiegeticIndicators — smoke tests on mock canvas (no crash, no events)
 *  7. Task chip ID text hidden in normal mode, visible in debug mode
 */

import { describe, it } from 'node:test';
import assert            from 'node:assert/strict';
import { readFileSync }  from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIFECYCLE_ZONES,
  LIFECYCLE_ZONE_THEMES,
  VISUAL_STATE_MAP,
  buildWorldScene,
} from '../rendering/world-scene.js';
import { toRenderableComponents }  from '../rendering/world-scene-adapter.js';
import { buildEntityPositionMap }  from '../rendering/zone-renderer.js';
import { renderZoneLabels }        from '../rendering/zone-label-renderer.js';
import {
  renderAllTaskChips,
  NORMAL_MODE_CHIP_ALPHA,
} from '../rendering/task-chip-renderer.js';
import {
  renderDiegeticIndicators,
  ZONE_INDICATOR_ANCHORS,
  ENGINE_CRYSTAL_ANCHOR,
  ANOMALY_ANCHOR,
} from '../rendering/diegetic-indicator-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ALL_STATES_GRAPH = Object.freeze({
  nodes: [
    { id: 't-idle',       type: 'task', status: 'created',          metadata: { incidents: [] } },
    { id: 't-waiting',    type: 'task', status: 'enqueued',         metadata: { incidents: [] } },
    { id: 't-working',    type: 'task', status: 'executing',        metadata: { incidents: [] } },
    { id: 't-processing', type: 'task', status: 'execute_finished', metadata: { incidents: [] } },
    { id: 't-completed',  type: 'task', status: 'completed',        metadata: { incidents: [] } },
    { id: 't-error',      type: 'task', status: 'failed',           metadata: { incidents: [{ clusterType: 'failures', severity: 'high' }] } },
    { id: 'w-1',          type: 'worker', status: 'idle', metadata: {} },
  ],
  edges: [],
  metadata: {},
});

function runComponents(graph) {
  return toRenderableComponents(buildWorldScene(graph));
}

/** Mock canvas context that records every method call. */
function makeLogCtx() {
  const log   = [];
  const store = {};
  const ctx   = new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      return (...args) => { log.push({ method: String(p), args }); return 0; };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  return { ctx, log };
}

// ---------------------------------------------------------------------------
// 1. Normal mode — zone labels suppressed
// ---------------------------------------------------------------------------

describe('normal mode — zone labels suppressed', () => {

  it('renderZoneLabels(isDebugMode=false) produces zero draw calls', () => {
    const { ctx, log } = makeLogCtx();
    const components   = runComponents(ALL_STATES_GRAPH);
    renderZoneLabels(ctx, components, false);
    assert.equal(log.length, 0,
      'normal mode must produce zero zone-label draw calls');
  });

  it('renderZoneLabels(isDebugMode=false) is a no-op regardless of component count', () => {
    const { ctx, log } = makeLogCtx();
    // Pass many zone-background components
    const components = LIFECYCLE_ZONES.map((z) => ({
      componentType: 'zone-background',
      id: z.id, x: z.position.x, y: z.position.y,
      width: z.size.width, height: z.size.height,
    }));
    renderZoneLabels(ctx, components, false);
    assert.equal(log.length, 0,
      'normal mode must suppress all zone labels even with populated component list');
  });

});

// ---------------------------------------------------------------------------
// 2. Debug mode — zone labels rendered
// ---------------------------------------------------------------------------

describe('debug mode — zone labels rendered', () => {

  it('renderZoneLabels(isDebugMode=true) produces draw calls for each zone', () => {
    const { ctx, log } = makeLogCtx();
    const components   = runComponents(ALL_STATES_GRAPH);
    renderZoneLabels(ctx, components, true);
    assert.ok(log.length > 0,
      'debug mode must produce draw calls for zone labels');
  });

  it('debug mode emits at least one draw call per LIFECYCLE_ZONE_THEMES zone', () => {
    const { ctx, log } = makeLogCtx();
    const components   = LIFECYCLE_ZONES.map((z) => ({
      componentType: 'zone-background',
      id: z.id, x: z.position.x, y: z.position.y,
      width: z.size.width, height: z.size.height,
    }));
    renderZoneLabels(ctx, components, true);
    const themeZoneCount = Object.keys(LIFECYCLE_ZONE_THEMES).length;
    assert.ok(log.length >= themeZoneCount,
      `debug mode must emit at least ${themeZoneCount} draw calls (one per themed zone)`);
  });

});

// ---------------------------------------------------------------------------
// 3. Normal mode never renders both lifecycle labels and semantic zone labels
// ---------------------------------------------------------------------------

describe('normal mode — no dual labeling', () => {

  it('renderZoneLabels in normal mode emits no fillText (no lifecycle label text)', () => {
    const { ctx, log } = makeLogCtx();
    const components   = runComponents(ALL_STATES_GRAPH);
    renderZoneLabels(ctx, components, false);
    const textCalls = log.filter((e) => e.method === 'fillText');
    assert.equal(textCalls.length, 0,
      'normal mode must not render any zone label text (semantic or lifecycle)');
  });

  it('in normal mode the total draw-call count for zone labels is exactly zero', () => {
    const { ctx, log } = makeLogCtx();
    renderZoneLabels(ctx, runComponents(ALL_STATES_GRAPH), false);
    assert.equal(log.length, 0);
  });

});

// ---------------------------------------------------------------------------
// 4. Task-chip visibility in normal mode
// ---------------------------------------------------------------------------

describe('normal mode — task chip visibility', () => {

  it('NORMAL_MODE_CHIP_ALPHA hides idle chips (alpha = 0)', () => {
    assert.equal(NORMAL_MODE_CHIP_ALPHA.idle, 0,
      'idle chips must have alpha 0 in normal mode');
  });

  it('NORMAL_MODE_CHIP_ALPHA hides completed chips (alpha = 0)', () => {
    assert.equal(NORMAL_MODE_CHIP_ALPHA.completed, 0,
      'completed chips must have alpha 0 in normal mode');
  });

  it('NORMAL_MODE_CHIP_ALPHA keeps working/processing/error chips fully visible', () => {
    for (const state of ['working', 'processing', 'error']) {
      assert.equal(NORMAL_MODE_CHIP_ALPHA[state], 1.0,
        `${state} chips must have alpha 1.0 in normal mode`);
    }
  });

  it('normal mode skips idle chips — no draw calls for idle task', () => {
    const idleOnlyGraph = {
      nodes: [{ id: 't-idle', type: 'task', status: 'created', metadata: { incidents: [] } }],
      edges: [], metadata: {},
    };
    const components   = runComponents(idleOnlyGraph);
    const entityPos    = buildEntityPositionMap(components);
    const { ctx, log } = makeLogCtx();
    renderAllTaskChips(ctx, components, entityPos, false);
    assert.equal(log.length, 0,
      'normal mode must skip idle (created) task chips entirely');
  });

  it('normal mode skips completed chips — no draw calls for completed task', () => {
    const doneOnlyGraph = {
      nodes: [{ id: 't-done', type: 'task', status: 'completed', metadata: { incidents: [] } }],
      edges: [], metadata: {},
    };
    const components   = runComponents(doneOnlyGraph);
    const entityPos    = buildEntityPositionMap(components);
    const { ctx, log } = makeLogCtx();
    renderAllTaskChips(ctx, components, entityPos, false);
    assert.equal(log.length, 0,
      'normal mode must skip completed task chips entirely');
  });

  it('normal mode still renders working/processing/error chips', () => {
    const activeGraph = {
      nodes: [
        { id: 't-a', type: 'task', status: 'executing',        metadata: { incidents: [] } },
        { id: 't-b', type: 'task', status: 'execute_finished', metadata: { incidents: [] } },
        { id: 't-c', type: 'task', status: 'failed',           metadata: { incidents: [] } },
      ],
      edges: [], metadata: {},
    };
    const components   = runComponents(activeGraph);
    const entityPos    = buildEntityPositionMap(components);
    const { ctx, log } = makeLogCtx();
    renderAllTaskChips(ctx, components, entityPos, false);
    assert.ok(log.length > 0,
      'normal mode must render working/processing/error chips');
  });

});

// ---------------------------------------------------------------------------
// 5. Task-chip ID text: hidden in normal mode, visible in debug mode
// ---------------------------------------------------------------------------

describe('task chip ID text visibility', () => {

  const singleWorkingGraph = {
    nodes: [{ id: 'task-abc123', type: 'task', status: 'executing', metadata: { incidents: [] } }],
    edges: [], metadata: {},
  };

  it('normal mode does not emit fillText for task ID', () => {
    const components   = runComponents(singleWorkingGraph);
    const entityPos    = buildEntityPositionMap(components);
    const { ctx, log } = makeLogCtx();
    renderAllTaskChips(ctx, components, entityPos, false);
    const textCalls = log.filter((e) => e.method === 'fillText');
    assert.equal(textCalls.length, 0,
      'normal mode must not render task ID text on chips');
  });

  it('debug mode emits fillText for task ID', () => {
    const components   = runComponents(singleWorkingGraph);
    const entityPos    = buildEntityPositionMap(components);
    const { ctx, log } = makeLogCtx();
    renderAllTaskChips(ctx, components, entityPos, true);
    const textCalls = log.filter((e) => e.method === 'fillText');
    assert.ok(textCalls.length > 0,
      'debug mode must render task ID text via fillText');
    // Text should contain the last-6-char shortId of 'task-abc123'
    const texts = textCalls.map((e) => e.args[0]);
    assert.ok(texts.some((t) => String(t).includes('bc123')),
      'debug mode task ID text must include the short ID fragment');
  });

  it('debug mode shows all chips including idle and completed', () => {
    const components   = runComponents(ALL_STATES_GRAPH);
    const entityPos    = buildEntityPositionMap(components);
    const { ctx: ctxNormal, log: logNormal } = makeLogCtx();
    const { ctx: ctxDebug,  log: logDebug  } = makeLogCtx();
    renderAllTaskChips(ctxNormal, components, entityPos, false);
    renderAllTaskChips(ctxDebug,  components, entityPos, true);
    assert.ok(logDebug.length > logNormal.length,
      'debug mode must produce more draw calls than normal mode (hidden chips included)');
  });

});

// ---------------------------------------------------------------------------
// 6. Render determinism — same input+mode → same draw log
// ---------------------------------------------------------------------------

describe('render determinism', () => {

  it('renderZoneLabels normal mode is deterministic', () => {
    const components = runComponents(ALL_STATES_GRAPH);
    const { ctx: c1, log: l1 } = makeLogCtx();
    const { ctx: c2, log: l2 } = makeLogCtx();
    renderZoneLabels(c1, components, false);
    renderZoneLabels(c2, components, false);
    assert.equal(JSON.stringify(l1), JSON.stringify(l2),
      'renderZoneLabels normal must be deterministic');
  });

  it('renderZoneLabels debug mode is deterministic', () => {
    const components = runComponents(ALL_STATES_GRAPH);
    const { ctx: c1, log: l1 } = makeLogCtx();
    const { ctx: c2, log: l2 } = makeLogCtx();
    renderZoneLabels(c1, components, true);
    renderZoneLabels(c2, components, true);
    assert.equal(JSON.stringify(l1), JSON.stringify(l2),
      'renderZoneLabels debug must be deterministic');
  });

  it('renderAllTaskChips normal mode is deterministic', () => {
    const originalNow = Date.now;
    Date.now = () => 42_000;
    const components = runComponents(ALL_STATES_GRAPH);
    const entityPos  = buildEntityPositionMap(components);
    const { ctx: c1, log: l1 } = makeLogCtx();
    const { ctx: c2, log: l2 } = makeLogCtx();
    try {
      renderAllTaskChips(c1, components, entityPos, false);
      renderAllTaskChips(c2, components, entityPos, false);
      assert.equal(JSON.stringify(l1), JSON.stringify(l2),
        'renderAllTaskChips normal must be deterministic');
    } finally {
      Date.now = originalNow;
    }
  });

  it('renderAllTaskChips debug mode produces deterministic method sequence', () => {
    // Processing pulse uses Date.now() so float args differ between runs;
    // we verify the draw-call method sequence is stable (same calls, same order).
    const components = runComponents(ALL_STATES_GRAPH);
    const entityPos  = buildEntityPositionMap(components);
    const { ctx: c1, log: l1 } = makeLogCtx();
    const { ctx: c2, log: l2 } = makeLogCtx();
    renderAllTaskChips(c1, components, entityPos, true);
    renderAllTaskChips(c2, components, entityPos, true);
    assert.deepStrictEqual(
      l1.map((e) => e.method),
      l2.map((e) => e.method),
      'renderAllTaskChips debug must produce the same draw-call method sequence'
    );
  });

  it('renderDiegeticIndicators is deterministic for a fixed timestamp', () => {
    const components = runComponents(ALL_STATES_GRAPH);
    const fixedNow   = 1_000_000;
    const { ctx: c1, log: l1 } = makeLogCtx();
    const { ctx: c2, log: l2 } = makeLogCtx();
    renderDiegeticIndicators(c1, components, fixedNow);
    renderDiegeticIndicators(c2, components, fixedNow);
    assert.equal(JSON.stringify(l1), JSON.stringify(l2),
      'renderDiegeticIndicators must produce identical output for the same timestamp');
  });

});

// ---------------------------------------------------------------------------
// 7. diegetic-indicator-renderer.js — source purity
// ---------------------------------------------------------------------------

describe('diegetic-indicator-renderer — no raw event/payload access', () => {

  const FORBIDDEN = [
    'eventsByTaskId', 'eventsByWorkerId', 'rawEvents',
    'events.', 'payload.', '.payload', 'TASK_CREATED', 'TASK_ACKED',
    'getEvents', 'deriveWorldState',
  ];

  it('source file does not reference forbidden event/world-index identifiers', () => {
    const src = readFileSync(
      resolve(ROOT, 'rendering/diegetic-indicator-renderer.js'), 'utf8'
    );
    // Strip both // line comments and * JSDoc comment lines before scanning
    const lines = src.split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l));
    for (const forbidden of FORBIDDEN) {
      const hits = lines.filter((l) => l.includes(forbidden));
      assert.deepStrictEqual(hits, [],
        `diegetic-indicator-renderer.js must not reference "${forbidden}"`);
    }
  });

  it('source file only reads component.visualState, component.zoneId, and component.anomaly', () => {
    const src = readFileSync(
      resolve(ROOT, 'rendering/diegetic-indicator-renderer.js'), 'utf8'
    );
    // Must not read taskType, status, payload, events, or lifecycle fields from component
    const bannedComponentFields = [
      'component.status', 'component.taskType', 'component.payload',
      'component.events', 'c.status', 'c.taskType', 'c.payload', 'c.events',
    ];
    for (const field of bannedComponentFields) {
      assert.ok(!src.includes(field),
        `diegetic-indicator-renderer.js must not access "${field}"`);
    }
  });

});

// ---------------------------------------------------------------------------
// 8. renderDiegeticIndicators — smoke tests
// ---------------------------------------------------------------------------

describe('renderDiegeticIndicators — smoke tests', () => {

  it('does not throw on a valid component list', () => {
    const { ctx }  = makeLogCtx();
    const components = runComponents(ALL_STATES_GRAPH);
    assert.doesNotThrow(() => renderDiegeticIndicators(ctx, components, 1_000_000));
  });

  it('does not throw on an empty component list', () => {
    const { ctx } = makeLogCtx();
    assert.doesNotThrow(() => renderDiegeticIndicators(ctx, [], 0));
  });

  it('does not throw when ctx is null', () => {
    const components = runComponents(ALL_STATES_GRAPH);
    assert.doesNotThrow(() => renderDiegeticIndicators(null, components, 0));
  });

  it('produces canvas draw calls', () => {
    const { ctx, log } = makeLogCtx();
    renderDiegeticIndicators(ctx, runComponents(ALL_STATES_GRAPH), 1_000_000);
    assert.ok(log.length > 0, 'diegetic indicators must produce canvas draw calls');
  });

  it('produces draw calls even for an empty component list (engine crystal always drawn)', () => {
    const { ctx, log } = makeLogCtx();
    renderDiegeticIndicators(ctx, [], 1_000_000);
    assert.ok(log.length > 0,
      'engine crystal indicator must always emit draw calls regardless of task count');
  });

  it('anomaly glint fires when chips carry anomaly data', () => {
    const anomalyGraph = {
      nodes: [
        { id: 't-err', type: 'task', status: 'failed',
          metadata: { incidents: [{ clusterType: 'x', severity: 'high' }] } },
      ],
      edges: [], metadata: {},
    };
    const components = runComponents(anomalyGraph);
    const { ctx: ctxWith,    log: logWith    } = makeLogCtx();
    const { ctx: ctxWithout, log: logWithout } = makeLogCtx();
    renderDiegeticIndicators(ctxWith,    components,           1_000_000);
    renderDiegeticIndicators(ctxWithout, runComponents({ nodes: [], edges: [], metadata: {} }), 1_000_000);
    assert.ok(logWith.length > logWithout.length,
      'anomaly glint must add extra draw calls when anomaly chips are present');
  });

  it('ZONE_INDICATOR_ANCHORS covers every LIFECYCLE_ZONES id', () => {
    for (const zone of LIFECYCLE_ZONES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(ZONE_INDICATOR_ANCHORS, zone.id),
        `ZONE_INDICATOR_ANCHORS must have an entry for lifecycle zone "${zone.id}"`
      );
    }
  });

  it('ENGINE_CRYSTAL_ANCHOR and ANOMALY_ANCHOR have numeric x and y', () => {
    assert.equal(typeof ENGINE_CRYSTAL_ANCHOR.x, 'number');
    assert.equal(typeof ENGINE_CRYSTAL_ANCHOR.y, 'number');
    assert.equal(typeof ANOMALY_ANCHOR.x, 'number');
    assert.equal(typeof ANOMALY_ANCHOR.y, 'number');
  });

});

// ---------------------------------------------------------------------------
// 9. NORMAL_MODE_CHIP_ALPHA completeness
// ---------------------------------------------------------------------------

describe('NORMAL_MODE_CHIP_ALPHA — completeness', () => {

  it('is a frozen object', () => {
    assert.ok(Object.isFrozen(NORMAL_MODE_CHIP_ALPHA),
      'NORMAL_MODE_CHIP_ALPHA must be frozen');
  });

  it('has a numeric alpha for every visualState used by VISUAL_STATE_MAP', () => {
    const usedStates = new Set(Object.values(VISUAL_STATE_MAP));
    for (const state of usedStates) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(NORMAL_MODE_CHIP_ALPHA, state),
        `NORMAL_MODE_CHIP_ALPHA must have an entry for visualState "${state}"`
      );
      assert.equal(typeof NORMAL_MODE_CHIP_ALPHA[state], 'number',
        `NORMAL_MODE_CHIP_ALPHA["${state}"] must be a number`);
      assert.ok(NORMAL_MODE_CHIP_ALPHA[state] >= 0 && NORMAL_MODE_CHIP_ALPHA[state] <= 1,
        `NORMAL_MODE_CHIP_ALPHA["${state}"] must be in [0, 1]`);
    }
  });

});
