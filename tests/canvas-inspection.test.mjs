import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getComponentHitBounds,
  hitTestRenderableComponents,
} from '../rendering/canvas-hit-test.js';
import {
  createCanvasInspectionState,
  updateInspectionHover,
  updateInspectionSelection,
  refreshInspectionSelection,
  resolveInspectionTarget,
} from '../rendering/canvas-inspection-state.js';
import {
  buildInspectionPopoverRows,
  renderInspectionPopover,
} from '../rendering/inspection-popover-renderer.js';
import {
  FLOW_LINE_STYLE,
  NORMAL_FLOW_LINE_STYLE,
  renderConnection,
} from '../rendering/connection-renderer.js';
import { renderWorldCompositionLayer } from '../rendering/world-background-composition.js';
import { renderUIOverlayLayer } from '../rendering/world-scene-asset-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const COMPONENTS = Object.freeze([
  Object.freeze({
    componentType: 'zone-background',
    id: 'CREATED',
    x: 25,
    y: 55,
    width: 165,
    height: 155,
  }),
  Object.freeze({
    componentType: 'zone-background',
    id: 'ENQUEUED',
    x: 75,
    y: 310,
    width: 120,
    height: 105,
  }),
  Object.freeze({
    componentType: 'agent-sprite',
    id: 'agent-1',
    x: 300,
    y: 260,
    visualState: 'working',
    zoneId: 'CLAIMED',
    worldZoneId: 'workshop-desk',
    deskId: 'desk-0',
    currentTaskId: 'task-1',
  }),
  Object.freeze({
    componentType: 'task-chip',
    id: 'task-1',
    x: 300,
    y: 260,
    visualState: 'processing',
    zoneId: 'EXECUTE_FINISHED',
    worldZoneId: 'delivery-bay',
    metrics: { duration: 1200, queueTime: 200, latency: null },
    anomaly: { severity: 'high', type: 'stalled_tasks' },
  }),
]);

function createMockContext() {
  const calls = [];
  const ctx = {
    canvas: { width: 1060, height: 520 },
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    bezierCurveTo: (...args) => calls.push(['bezierCurveTo', ...args]),
    quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
    closePath: () => calls.push(['closePath']),
    fill: () => calls.push(['fill']),
    stroke: () => calls.push(['stroke']),
    fillText: (...args) => calls.push(['fillText', ...args]),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    strokeRect: (...args) => calls.push(['strokeRect', ...args]),
    arc: (...args) => calls.push(['arc', ...args]),
    ellipse: (...args) => calls.push(['ellipse', ...args]),
    drawImage: (...args) => calls.push(['drawImage', ...args]),
    setLineDash: (...args) => calls.push(['setLineDash', ...args]),
    createLinearGradient: (...args) => {
      const gradient = { addColorStop: (...stopArgs) => calls.push(['addColorStop', ...stopArgs]) };
      calls.push(['createLinearGradient', ...args]);
      return gradient;
    },
    createRadialGradient: (...args) => {
      const gradient = { addColorStop: (...stopArgs) => calls.push(['addColorStop', ...stopArgs]) };
      calls.push(['createRadialGradient', ...args]);
      return gradient;
    },
    measureText: (text) => ({ width: String(text).length * 6 }),
  };

  return ctx;
}

test('canvas inspection: hit-test returns stable result for known component positions', () => {
  const taskBounds = getComponentHitBounds(COMPONENTS[3], null);
  assert.deepStrictEqual(taskBounds, { x: 282, y: 252, width: 36, height: 16 });

  const hit = hitTestRenderableComponents(COMPONENTS, { x: 300, y: 260 }, null);
  assert.equal(hit.entityId, 'task-1');
  assert.equal(hit.componentType, 'task-chip');
  assert.deepStrictEqual(hit.bounds, taskBounds);
});

test('canvas inspection: normal mode still hits task-chip and agent-sprite', () => {
  const taskHit = hitTestRenderableComponents(COMPONENTS, { x: 300, y: 260 }, null, { debug: false });
  assert.equal(taskHit.entityId, 'task-1');
  assert.equal(taskHit.componentType, 'task-chip');

  const agentHit = hitTestRenderableComponents(COMPONENTS, { x: 230, y: 225 }, null);
  assert.equal(agentHit.entityId, 'agent-1');
  assert.equal(agentHit.componentType, 'agent-sprite');
});

test('canvas inspection: normal mode skips idle agent hit and hits workstation hotspot', () => {
  const components = [
    { componentType: 'agent-sprite', id: 'agent-idle', x: 352, y: 224, visualState: 'idle', deskId: 'desk-0', worldZoneId: 'researchDesk', zoneId: 'CLAIMED' },
  ];
  const hit = hitTestRenderableComponents(components, { x: 330, y: 210 }, null, { debug: false });

  assert.equal(hit.componentType, 'workstation-hotspot');
  assert.equal(hit.entityId, 'researchMonitorHotspot');
});

test('canvas inspection: debug mode still hit-tests idle agents before workstation hotspots', () => {
  const components = [
    { componentType: 'agent-sprite', id: 'agent-idle', x: 352, y: 224, visualState: 'idle', deskId: 'desk-0', worldZoneId: 'researchDesk', zoneId: 'CLAIMED' },
  ];
  const hit = hitTestRenderableComponents(components, { x: 330, y: 210 }, null, { debug: true });

  assert.equal(hit.componentType, 'agent-sprite');
  assert.equal(hit.entityId, 'agent-idle');
});

test('canvas inspection: normal mode does not hit broad zone-background rectangles', () => {
  const zoneHit = hitTestRenderableComponents(COMPONENTS, { x: 60, y: 80 }, null, { debug: false });
  assert.equal(zoneHit, null);
});

test('canvas inspection: debug mode can hit broad zone-background rectangles', () => {
  const zoneHit = hitTestRenderableComponents(COMPONENTS, { x: 60, y: 80 }, null, { debug: true });
  assert.equal(zoneHit.entityId, 'CREATED');
  assert.equal(zoneHit.componentType, 'world-zone-indicator');
});

test('canvas inspection: normal mode hits small diegetic indicator anchors', () => {
  const zoneHit = hitTestRenderableComponents(COMPONENTS, { x: 126, y: 356 }, null, { debug: false });
  assert.equal(zoneHit.entityId, 'ENQUEUED');
  assert.equal(zoneHit.componentType, 'world-zone-indicator');
  assert.deepStrictEqual(zoneHit.bounds, { x: 103, y: 333, width: 46, height: 46 });
});

test('canvas inspection: hover and click state update deterministically', () => {
  const state = createCanvasInspectionState();

  const hover = updateInspectionHover(state, COMPONENTS, { x: 300, y: 260 }, null);
  assert.equal(hover.entityId, 'task-1');
  assert.equal(state.hoveredEntityId, 'task-1');
  assert.equal(state.hoveredComponentType, 'task-chip');

  const selection = updateInspectionSelection(state, COMPONENTS, { x: 230, y: 225 }, null);
  assert.equal(selection.entityId, 'agent-1');
  assert.equal(state.selectedEntityId, 'agent-1');
  assert.equal(resolveInspectionTarget(state).entityId, 'agent-1');
});

test('canvas inspection: background click clears selection', () => {
  const state = createCanvasInspectionState();

  updateInspectionSelection(state, COMPONENTS, { x: 300, y: 260 }, null);
  assert.equal(state.selectedEntityId, 'task-1');

  const selection = updateInspectionSelection(state, COMPONENTS, { x: 60, y: 80 }, null, { debug: false });
  assert.equal(selection, null);
  assert.equal(state.selectedEntityId, null);
  assert.equal(state.selectedComponentType, null);
});

test('canvas inspection: selected component refreshes from latest descriptors', () => {
  const state = createCanvasInspectionState();
  updateInspectionSelection(state, COMPONENTS, { x: 230, y: 225 }, null);

  const updated = COMPONENTS.map((component) => component.id === 'agent-1'
    ? { ...component, visualState: 'idle', currentTaskId: null }
    : component);

  refreshInspectionSelection(state, updated, null);
  assert.equal(state.selectedHit.component.visualState, 'idle');
  assert.equal(state.selectedHit.component.currentTaskId, null);
});

test('canvas inspection: popover normal mode is compact and hides diagnostics', () => {
  const hit = hitTestRenderableComponents(COMPONENTS, { x: 300, y: 260 }, null);
  const model = buildInspectionPopoverRows(hit, { debug: false });

  assert.equal(model.title, 'Task Scroll');
  assert.equal(model.rows.length, 3);
  assert.ok(model.rows.includes('type: task'));
  assert.ok(model.rows.includes('status: processing'));
  assert.ok(model.rows.includes('zone: delivery-bay'));
  assert.ok(!model.rows.some((row) => row.startsWith('duration:')));
  assert.ok(!model.rows.some((row) => row.startsWith('anomaly:')));
  assert.ok(!model.rows.some((row) => row.startsWith('id:')));
  assert.ok(!model.rows.some((row) => row.startsWith('bounds:')));
});

test('canvas inspection: popover normal mode hides unknown status', () => {
  const hit = {
    entityId: 'mystery',
    componentType: 'task-chip',
    component: { componentType: 'task-chip', id: 'mystery', visualState: 'unknown', worldZoneId: 'nook' },
    bounds: { x: 10, y: 10, width: 36, height: 16 },
  };
  const model = buildInspectionPopoverRows(hit, { debug: false });

  assert.deepStrictEqual(model.rows, ['type: task', 'zone: nook']);
});

test('canvas inspection: workstation popover summarizes render-component data only', () => {
  const components = [
    { componentType: 'task-chip', id: 'task-active', visualState: 'working', worldZoneId: 'researchDesk', zoneId: 'CLAIMED', anomaly: null },
    { componentType: 'task-chip', id: 'task-waiting', visualState: 'waiting', worldZoneId: 'researchDesk', zoneId: 'CLAIMED', anomaly: null },
    { componentType: 'task-chip', id: 'task-failed', visualState: 'error', worldZoneId: 'researchDesk', zoneId: 'CLAIMED', anomaly: { severity: 'high', type: 'stalled_tasks' } },
    { componentType: 'agent-sprite', id: 'agent-active', visualState: 'working', worldZoneId: 'researchDesk', zoneId: 'CLAIMED', currentTaskId: 'task-active' },
  ];
  const hit = hitTestRenderableComponents(components, { x: 330, y: 210 }, null, { debug: false });
  const model = buildInspectionPopoverRows(hit, { debug: false });

  assert.equal(model.title, 'Research Desk');
  assert.ok(!model.rows.includes('type: workstation'));
  assert.ok(model.rows.includes('active tasks: 1'));
  assert.ok(model.rows.includes('waiting tasks: 1'));
  assert.ok(model.rows.includes('attention: yes'));
  assert.ok(model.rows.includes('assigned agents: 1'));
  assert.ok(!model.rows.some((row) => row.startsWith('id:')));
});

test('canvas inspection: baked normal workstation popover omits zero-count and type rows', () => {
  const hit = hitTestRenderableComponents([], { x: 330, y: 210 }, null, { debug: false, bakedBackground: true });
  const model = buildInspectionPopoverRows(hit, { debug: false });

  assert.equal(model.title, 'Research Desk');
  assert.ok(!model.rows.includes('type: workstation'));
  assert.ok(!model.rows.includes('active tasks: 0'));
  assert.ok(!model.rows.includes('waiting tasks: 0'));
});

test('canvas inspection: debug workstation popover keeps detailed rows', () => {
  const hit = hitTestRenderableComponents([], { x: 330, y: 210 }, null, { debug: true, bakedBackground: true });
  const model = buildInspectionPopoverRows(hit, { debug: true });

  assert.ok(model.rows.includes('type: workstation'));
  assert.ok(model.rows.includes('active tasks: 0'));
  assert.ok(model.rows.includes('waiting tasks: 0'));
  assert.ok(model.rows.some((row) => row.startsWith('id:')));
});

test('canvas inspection: zone popover uses friendly zone title without unknown status', () => {
  const hit = hitTestRenderableComponents(COMPONENTS, { x: 126, y: 356 }, null, { debug: false });
  const model = buildInspectionPopoverRows(hit, { debug: false });

  assert.equal(model.title, 'Task Engine');
  assert.ok(model.rows.includes('type: world-zone'));
  assert.ok(!model.rows.includes('status: unknown'));
});

test('canvas inspection: popover debug mode shows full diagnostics', () => {
  const hit = hitTestRenderableComponents(COMPONENTS, { x: 300, y: 260 }, null);
  const model = buildInspectionPopoverRows(hit, { debug: true });

  assert.ok(model.rows.includes('duration: 1200'));
  assert.ok(model.rows.includes('anomaly: high stalled_tasks'));
  assert.ok(model.rows.includes('id: task-1'));
  assert.ok(model.rows.some((row) => row.startsWith('bounds: ')));
});

test('canvas inspection: popover renderer runs on a mock canvas context', () => {
  const hit = hitTestRenderableComponents(COMPONENTS, { x: 230, y: 225 }, null);
  const ctx = createMockContext();

  assert.doesNotThrow(() => renderInspectionPopover(ctx, hit, { debug: false }));
  assert.ok(ctx.calls.some((call) => call[0] === 'fillText' && call[1] === 'Agent Desk'));
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillText' && call[1] === 'current task: task-1'));
  assert.ok(ctx.calls.some((call) => call[0] === 'fill'));
});

test('canvas inspection: connection stream is softer in normal mode and full in debug mode', () => {
  const normalCtx = createMockContext();
  renderConnection(normalCtx, { x: 10, y: 10 }, { x: 90, y: 30 }, 12, false);
  assert.equal(normalCtx.strokeStyle, NORMAL_FLOW_LINE_STYLE.stroke);
  assert.equal(normalCtx.lineWidth, NORMAL_FLOW_LINE_STYLE.width);

  const debugCtx = createMockContext();
  renderConnection(debugCtx, { x: 10, y: 10 }, { x: 90, y: 30 }, 12, true);
  assert.equal(debugCtx.strokeStyle, FLOW_LINE_STYLE.stroke);
  assert.equal(debugCtx.lineWidth, FLOW_LINE_STYLE.width);
});

test('canvas inspection: baked normal mode suppresses large world composition overlays', () => {
  const ctx = createMockContext();

  renderWorldCompositionLayer(ctx, { bakedBackground: true, debug: false, frame: 12 });

  assert.equal(ctx.calls.length, 0);
});

test('canvas inspection: debug mode still renders world composition diagnostics over baked background', () => {
  const ctx = createMockContext();

  renderWorldCompositionLayer(ctx, { bakedBackground: true, debug: true, frame: 12 });

  assert.ok(ctx.calls.length > 0);
  assert.ok(ctx.calls.some((call) => call[0] === 'fillText'));
});

test('canvas inspection: fallback background mode still renders world composition layers', () => {
  const ctx = createMockContext();

  renderWorldCompositionLayer(ctx, { bakedBackground: false, debug: false, frame: 12 });

  assert.ok(ctx.calls.length > 0);
  assert.ok(ctx.calls.some((call) => call[0] === 'fillRect' || call[0] === 'arc' || call[0] === 'ellipse'));
});

test('canvas inspection: baked normal mode renders trend data as compact monitor glow', () => {
  const originalNow = Date.now;
  let fakeNow = 10_000;
  Date.now = () => fakeNow;
  try {
    const ctx = createMockContext();
    const components = [{
      componentType: 'agent-sprite',
      id: 'trend-agent-compact',
      trendPanelState: {
        taskId: 'trend-task-compact',
        keyword: 'cozy',
        status: 'done',
        results: [{ item: 'treehouse', score: 0.98 }],
      },
    }];
    const positions = new Map([['trend-agent-compact', { x: 420, y: 280 }]]);

    renderUIOverlayLayer(ctx, components, positions, { bakedBackground: true, debug: false });
    fakeNow += 300;
    renderUIOverlayLayer(ctx, components, positions, { bakedBackground: true, debug: false });

    assert.ok(ctx.calls.some((call) => call[0] === 'fillRect'));
    assert.ok(!ctx.calls.some((call) => call[0] === 'fillText'));
  } finally {
    Date.now = originalNow;
  }
});

test('canvas inspection: debug mode keeps full trend panel diagnostics', () => {
  const originalNow = Date.now;
  let fakeNow = 20_000;
  Date.now = () => fakeNow;
  try {
    const ctx = createMockContext();
    const components = [{
      componentType: 'agent-sprite',
      id: 'trend-agent-debug',
      trendPanelState: {
        taskId: 'trend-task-debug',
        keyword: 'cozy',
        status: 'done',
        results: [{ item: 'treehouse', score: 0.98 }],
      },
    }];
    const positions = new Map([['trend-agent-debug', { x: 420, y: 280 }]]);

    renderUIOverlayLayer(ctx, components, positions, { bakedBackground: true, debug: true });
    fakeNow += 300;
    renderUIOverlayLayer(ctx, components, positions, { bakedBackground: true, debug: true });

    assert.ok(ctx.calls.some((call) => call[0] === 'fillText'));
  } finally {
    Date.now = originalNow;
  }
});

test('canvas inspection: agent raw IDs are hidden in normal mode and visible in debug mode', async () => {
  const canvas = {
    width: 1060,
    height: 520,
    getContext: () => createMockContext(),
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1060, height: 520 }),
  };
  globalThis.document = { getElementById: () => canvas };
  globalThis.window = { __SLOTHWORLD_RENDER_DEBUG__: false, location: { search: '' } };

  const moduleUrl = `../rendering/agent-entity-renderer.js?inspection-test=${Date.now()}`;
  const { renderAgentEntity } = await import(moduleUrl);
  const component = { componentType: 'agent-sprite', id: 'agent-raw-123', x: 100, y: 120, visualState: 'idle' };

  const normalCtx = createMockContext();
  renderAgentEntity(normalCtx, component, 0);
  assert.ok(!normalCtx.calls.some((call) => call[0] === 'fillText' && call[1] === 'agent-raw-123'));

  globalThis.window.__SLOTHWORLD_RENDER_DEBUG__ = true;
  const debugCtx = createMockContext();
  renderAgentEntity(debugCtx, component, 0);
  assert.ok(debugCtx.calls.some((call) => call[0] === 'fillText' && call[1] === 'agent-raw-123'));
});

test('canvas inspection: baked normal mode suppresses all dynamic agent sprites', async () => {
  globalThis.window = { __SLOTHWORLD_RENDER_DEBUG__: false, location: { search: '' } };
  const moduleUrl = `../rendering/agent-entity-renderer.js?baked-agent-test=${Date.now()}`;
  const { renderAgentEntity } = await import(moduleUrl);
  for (const visualState of ['idle', 'working', 'processing', 'error']) {
    const ctx = createMockContext();
    renderAgentEntity(ctx, { componentType: 'agent-sprite', id: `${visualState}-agent`, x: 100, y: 120, visualState, currentTaskId: 'task-active' }, 0, {
      bakedBackground: true,
      debug: false,
    });
    assert.equal(ctx.calls.length, 0, `${visualState} agent should be hidden over baked background`);
  }
});

test('canvas inspection: baked normal mode routes active agent hits to workstation hotspots', () => {
  const components = [
    { componentType: 'agent-sprite', id: 'agent-active', x: 352, y: 224, visualState: 'working', deskId: 'desk-0', worldZoneId: 'researchDesk', zoneId: 'CLAIMED', currentTaskId: 'task-active' },
  ];
  const hit = hitTestRenderableComponents(components, { x: 330, y: 210 }, null, { debug: false, bakedBackground: true });

  assert.equal(hit.componentType, 'workstation-hotspot');
  assert.equal(hit.entityId, 'researchMonitorHotspot');
});

test('canvas inspection: fallback normal mode still renders dynamic agents', async () => {
  globalThis.window = { __SLOTHWORLD_RENDER_DEBUG__: false, location: { search: '' } };
  const moduleUrl = `../rendering/agent-entity-renderer.js?fallback-agent-test=${Date.now()}`;
  const { renderAgentEntity } = await import(moduleUrl);

  const workingCtx = createMockContext();
  renderAgentEntity(workingCtx, { componentType: 'agent-sprite', id: 'working-agent', x: 100, y: 120, visualState: 'working' }, 0, {
    bakedBackground: false,
    debug: false,
  });
  assert.ok(workingCtx.calls.length > 0);
});

test('canvas inspection: debug mode still renders dynamic agents over baked background', async () => {
  globalThis.window = { __SLOTHWORLD_RENDER_DEBUG__: false, location: { search: '' } };
  const moduleUrl = `../rendering/agent-entity-renderer.js?debug-baked-agent-test=${Date.now()}`;
  const { renderAgentEntity } = await import(moduleUrl);
  const debugCtx = createMockContext();

  renderAgentEntity(debugCtx, { componentType: 'agent-sprite', id: 'debug-agent', x: 100, y: 120, visualState: 'idle' }, 0, {
    bakedBackground: true,
    debug: true,
  });
  assert.ok(debugCtx.calls.length > 0);
});

test('canvas inspection: inspection modules do not access raw event sources', () => {
  const files = [
    'rendering/canvas-hit-test.js',
    'rendering/canvas-inspection-state.js',
    'rendering/inspection-popover-renderer.js',
    'rendering/workstation-hotspots.js',
  ];
  const forbidden = [
    /\beventsByTaskId\b/,
    /\beventsByWorkerId\b/,
    /\bgetRawEvents\b/,
    /\bpayload\s*\./,
    /\bindexedWorldSnapshot\b/,
    /\bworldIndex\b/,
    /\bworld-index\b/,
  ];

  for (const file of files) {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    for (const re of forbidden) {
      assert.ok(!re.test(source), `${file} must not match ${re}`);
    }
  }
});
