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
    quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
    closePath: () => calls.push(['closePath']),
    fill: () => calls.push(['fill']),
    stroke: () => calls.push(['stroke']),
    fillText: (...args) => calls.push(['fillText', ...args]),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    arc: (...args) => calls.push(['arc', ...args]),
    setLineDash: (...args) => calls.push(['setLineDash', ...args]),
    measureText: (text) => ({ width: String(text).length * 6 }),
  };

  return ctx;
}

test('canvas inspection: hit-test returns stable result for known component positions', () => {
  const taskBounds = getComponentHitBounds(COMPONENTS[2], null);
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
  const zoneHit = hitTestRenderableComponents(COMPONENTS, { x: 107, y: 165 }, null, { debug: false });
  assert.equal(zoneHit.entityId, 'CREATED');
  assert.equal(zoneHit.componentType, 'world-zone-indicator');
  assert.deepStrictEqual(zoneHit.bounds, { x: 83, y: 147, width: 42, height: 42 });
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

test('canvas inspection: zone popover uses friendly zone title without unknown status', () => {
  const hit = hitTestRenderableComponents(COMPONENTS, { x: 107, y: 165 }, null, { debug: false });
  const model = buildInspectionPopoverRows(hit, { debug: false });

  assert.equal(model.title, 'Intake Nook');
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

test('canvas inspection: inspection modules do not access raw event sources', () => {
  const files = [
    'rendering/canvas-hit-test.js',
    'rendering/canvas-inspection-state.js',
    'rendering/inspection-popover-renderer.js',
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
