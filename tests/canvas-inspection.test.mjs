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
  canRenderNormalPopover,
  renderInspectionPopover,
} from '../rendering/inspection-popover-renderer.js';
import {
  FLOW_LINE_STYLE,
  NORMAL_FLOW_LINE_STYLE,
  renderConnection,
} from '../rendering/connection-renderer.js';
import { renderWorldCompositionLayer } from '../rendering/world-background-composition.js';
import {
  computeResearchCardLayout,
  renderUIOverlayLayer,
  wrapResearchCardText,
} from '../rendering/world-scene-asset-renderer.js';
import { BACKGROUND_BOOT_POLICY } from '../rendering/background-config.js';
import { initCanvasCursor } from '../rendering/canvas-cursor.js';
import {
  WORKSTATION_HOTSPOTS,
  buildWorkstationHotspotComponents,
  componentForHotspot,
  buildWorkstationNormalSummaryRows,
  renderWorkstationHotspotDebug,
  renderWorkstationHotspotFeedback,
} from '../rendering/workstation-hotspots.js';
import {
  WORKSTATION_SEMANTICS,
  getWorkstationSemanticMetadata,
} from '../ui/hotspots/workstationSemantics.js';
import {
  buildWorkstationPopoverViewModel,
} from '../ui/selectors/workstationPopoverSelectors.js';
import {
  buildWorkstationVisualStateViewModel,
} from '../ui/selectors/workstationVisualStateSelectors.js';
import {
  buildWorkstationInspectionViewModel,
} from '../ui/selectors/workstationInspectionSelectors.js';
import {
  buildInteractionTargets,
  getInteractionTargetAtPoint,
} from '../ui/interactions/interactionTargets.js';
import {
  buildAgentInspectionViewModel,
} from '../ui/selectors/agentInspectionSelectors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function createEventTargetMock() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      listeners.set(type, handlers.filter((candidate) => candidate !== handler));
    },
    dispatch(type) {
      for (const handler of listeners.get(type) || []) handler({ type });
    },
  };
}

function createCursorCanvasMock() {
  const target = createEventTargetMock();
  const classes = new Set();
  return {
    ...target,
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); },
    },
  };
}

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

test('canvas cursor: toggles custom cursor classes on click lifecycle', () => {
  const canvas = createCursorCanvasMock();
  const win = createEventTargetMock();

  const cleanup = initCanvasCursor(canvas, win);

  assert.equal(canvas.classList.contains('slothworld-cursor'), true);
  assert.equal(canvas.classList.contains('slothworld-cursor-clicking'), false);

  canvas.dispatch('pointerdown');
  assert.equal(canvas.classList.contains('slothworld-cursor-clicking'), true);

  canvas.dispatch('pointerup');
  assert.equal(canvas.classList.contains('slothworld-cursor-clicking'), false);

  canvas.dispatch('mousedown');
  assert.equal(canvas.classList.contains('slothworld-cursor-clicking'), true);

  win.dispatch('blur');
  assert.equal(canvas.classList.contains('slothworld-cursor-clicking'), false);

  cleanup();
});

test('canvas inspection: normal mode hits task-chip but excludes default agent sprites', () => {
  const taskHit = hitTestRenderableComponents(COMPONENTS, { x: 300, y: 260 }, null, { debug: false });
  assert.equal(taskHit.entityId, 'task-1');
  assert.equal(taskHit.componentType, 'task-chip');

  const agentHit = hitTestRenderableComponents(COMPONENTS, { x: 230, y: 225 }, null);
  assert.equal(agentHit.componentType, 'workstation-hotspot');
  assert.notEqual(agentHit.componentType, 'agent-sprite');
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
  assert.equal(zoneHit, null);
});

test('canvas inspection: hover and click state update deterministically', () => {
  const state = createCanvasInspectionState();

  const hover = updateInspectionHover(state, COMPONENTS, { x: 300, y: 260 }, null);
  assert.equal(hover.entityId, 'task-1');
  assert.equal(state.hoveredEntityId, 'task-1');
  assert.equal(state.hoveredComponentType, 'task-chip');

  const selection = updateInspectionSelection(state, COMPONENTS, { x: 230, y: 225 }, null);
  assert.equal(selection.entityId, 'intakeDeskHotspot');
  assert.equal(state.selectedEntityId, 'intakeDeskHotspot');
  assert.equal(resolveInspectionTarget(state).entityId, 'intakeDeskHotspot');
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
  updateInspectionSelection(state, COMPONENTS, { x: 230, y: 225 }, null, { debug: true });

  const updated = COMPONENTS.map((component) => component.id === 'agent-1'
    ? { ...component, visualState: 'idle', currentTaskId: null }
    : component);

  refreshInspectionSelection(state, updated, null, { debug: true });
  assert.equal(state.selectedHit.component.visualState, 'idle');
  assert.equal(state.selectedHit.component.currentTaskId, null);
});

test('canvas inspection: popover normal mode is compact and hides diagnostics', () => {
  const hit = hitTestRenderableComponents(COMPONENTS, { x: 300, y: 260 }, null);
  const model = buildInspectionPopoverRows(hit, { debug: false });

  assert.equal(model.title, 'Task');
  assert.ok(model.rows.length <= 2);
  assert.ok(model.rows.includes('Processing'));
  assert.ok(!model.rows.some((row) => row.startsWith('type:')));
  assert.ok(!model.rows.some((row) => row.startsWith('zone:')));
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

  assert.equal(model, null);
});

test('canvas inspection: workstation popover summarizes render-component data only', () => {
  const components = [
    { componentType: 'task-chip', id: 'task-active', title: 'Trend scan', taskType: 'TREND_RESEARCH', visualState: 'working', worldZoneId: 'researchDesk', zoneId: 'CLAIMED', anomaly: null },
    { componentType: 'task-chip', id: 'task-waiting', title: 'Trend waiting', taskType: 'TREND_RESEARCH', visualState: 'waiting', worldZoneId: 'researchDesk', zoneId: 'CLAIMED', anomaly: null },
    { componentType: 'task-chip', id: 'task-failed', title: 'Trend failure', taskType: 'TREND_RESEARCH', visualState: 'error', worldZoneId: 'researchDesk', zoneId: 'CLAIMED', anomaly: { severity: 'high', type: 'stalled_tasks' } },
    { componentType: 'agent-sprite', id: 'agent-active', visualState: 'working', worldZoneId: 'researchDesk', zoneId: 'CLAIMED', currentTaskId: 'task-active' },
  ];
  const hit = hitTestRenderableComponents(components, { x: 330, y: 210 }, null, { debug: false });
  const model = buildInspectionPopoverRows(hit, { debug: false });

  assert.equal(model.title, 'Research Desk');
  assert.ok(!model.rows.includes('type: workstation'));
  assert.ok(model.rows.includes('1 scan active'));
  assert.ok(model.rows.includes('attention needed'));
  assert.ok(!model.rows.some((row) => row.startsWith('id:')));
  assert.ok(model.rows.length <= 3);
});

test('canvas inspection: baked normal workstation popover omits zero-count and type rows', () => {
  const hit = hitTestRenderableComponents([], { x: 330, y: 210 }, null, { debug: false, bakedBackground: true });
  const model = buildInspectionPopoverRows(hit, { debug: false });

  assert.equal(model.title, 'Research Desk');
  assert.deepStrictEqual(model.rows, ['Ready to scan trends']);
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
  assert.ok(model.rows.includes('created tasks: 0'));
  assert.ok(model.rows.includes('processing tasks: 0'));
  assert.ok(model.rows.includes('completed tasks: 0'));
  assert.ok(model.rows.includes('failed tasks: 0'));
  assert.ok(model.rows.includes('semantic active: 0'));
  assert.ok(model.rows.includes('station active: 0'));
  assert.ok(model.rows.includes('station waiting: 0'));
  assert.ok(model.rows.includes('station processing: 0'));
  assert.ok(model.rows.includes('station completed: 0'));
  assert.ok(model.rows.includes('station failed: 0'));
  assert.ok(model.rows.includes('world zone: researchDesk'));
  assert.ok(model.rows.includes('lifecycle zone: CLAIMED'));
  assert.ok(model.rows.some((row) => row.startsWith('id:')));
});

test('canvas inspection: each workstation returns a friendly normal summary', () => {
  const components = [
    { componentType: 'task-chip', id: 'engine-waiting', title: 'Queue item', taskType: 'standard', visualState: 'waiting', worldZoneId: 'engineCrystal', zoneId: 'ENQUEUED' },
    { componentType: 'task-chip', id: 'intake-created', title: 'Fresh request', taskType: 'standard', visualState: 'idle', worldZoneId: 'intakeDesk', zoneId: 'CREATED' },
    { componentType: 'task-chip', id: 'research-active', title: 'Trend scan', taskType: 'TREND_RESEARCH', visualState: 'working', worldZoneId: 'researchDesk', zoneId: 'CLAIMED' },
    { componentType: 'task-chip', id: 'shopify-active', title: 'Product listing', taskType: 'shopify', visualState: 'working', worldZoneId: 'shopifyDesk', zoneId: 'CLAIMED' },
    { componentType: 'task-chip', id: 'render-active', title: 'Render product image', taskType: 'image_render', visualState: 'processing', worldZoneId: 'renderDesk', zoneId: 'EXECUTE_FINISHED' },
    { componentType: 'task-chip', id: 'support-active', title: 'Discord reply', taskType: 'discord', visualState: 'working', worldZoneId: 'supportDesk', zoneId: 'CLAIMED' },
    { componentType: 'task-chip', id: 'approval-active', title: 'Approve output', taskType: 'standard', visualState: 'processing', worldZoneId: 'approvalDesk', zoneId: 'EXECUTE_FINISHED' },
    { componentType: 'task-chip', id: 'archive-complete', title: 'Finished task', taskType: 'standard', visualState: 'completed', worldZoneId: 'archiveLibrary', zoneId: 'ACKED' },
    { componentType: 'task-chip', id: 'anomaly-failed', title: 'Needs review', taskType: 'standard', visualState: 'error', worldZoneId: 'anomalyShelf', zoneId: 'ACKED', anomaly: { severity: 'high', type: 'timeout' } },
  ];
  const expected = new Map([
    ['engineCrystalHotspot', '1 queued'],
    ['intakeDeskHotspot', '1 waiting'],
    ['researchMonitorHotspot', '1 scan active'],
    ['shopifyMonitorHotspot', '1 listing active'],
    ['renderMonitorHotspot', '1 render active'],
    ['supportMonitorHotspot', '1 message active'],
    ['approvalDeskHotspot', '1 awaiting approval'],
    ['archiveShelfHotspot', 'archive: 1 complete'],
    ['anomalyShelfHotspot', 'attention needed'],
  ]);

  for (const hotspot of WORKSTATION_HOTSPOTS) {
    const component = componentForHotspot(hotspot, components);
    const rows = buildWorkstationNormalSummaryRows(component);
    assert.ok(rows.includes(expected.get(hotspot.id)), `${hotspot.id} missing friendly row`);
    assert.ok(rows.length <= 3, `${hotspot.id} should keep normal rows compact`);
    assert.ok(!rows.some((row) => row.startsWith('type:') || row.startsWith('id:')));
  }
});

test('canvas inspection: workstation normal summary omits zero-count rows', () => {
  const research = WORKSTATION_HOTSPOTS.find((hotspot) => hotspot.id === 'researchMonitorHotspot');
  const component = componentForHotspot(research, []);
  const rows = buildWorkstationNormalSummaryRows(component);

  assert.deepStrictEqual(rows, ['Ready to scan trends']);
  assert.ok(!rows.includes('0 scan active'));
});

test('canvas inspection: workstation semantic summaries use render component descriptors', () => {
  const research = WORKSTATION_HOTSPOTS.find((hotspot) => hotspot.id === 'researchMonitorHotspot');
  const rows = buildWorkstationNormalSummaryRows(componentForHotspot(research, [
    { componentType: 'task-chip', id: 'visible-render-component', title: 'Trend research scan', taskType: 'TREND_RESEARCH', visualState: 'working', worldZoneId: 'researchDesk', zoneId: 'CLAIMED' },
    { componentType: 'task-chip', id: 'wrong-domain', title: 'Discord reply', taskType: 'discord', visualState: 'working', worldZoneId: 'researchDesk', zoneId: 'CLAIMED' },
  ]));

  assert.deepStrictEqual(rows, ['1 scan active']);
});

test('canvas inspection: every hotspot has matching semantic metadata', () => {
  const stationKeys = new Set([
    'engine_core',
    'intake_desk',
    'research_desk',
    'shopify_desk',
    'render_desk',
    'support_desk',
    'approval_desk',
    'archive_shelf',
    'anomaly_shelf',
  ]);

  assert.equal(Object.keys(WORKSTATION_SEMANTICS).length, WORKSTATION_HOTSPOTS.length);
  for (const hotspot of WORKSTATION_HOTSPOTS) {
    const metadata = getWorkstationSemanticMetadata(hotspot.id);
    assert.ok(metadata, `${hotspot.id} is missing semantic metadata`);
    assert.ok(stationKeys.has(metadata.stationKey));
    assert.equal(typeof metadata.title, 'string');
    assert.equal(typeof metadata.purpose, 'string');
    assert.equal(typeof metadata.idleText, 'string');
    assert.equal(typeof metadata.role, 'string');
  }
});

test('canvas inspection: workstation popover view models stay compact and friendly', () => {
  const rawPatterns = [
    /\btask-[\w-]+\b/,
    /\bagent-[\w-]+\b/,
    /\bCREATED\b/,
    /\bENQUEUED\b/,
    /\bCLAIMED\b/,
    /\bEXECUTE_FINISHED\b/,
    /\bACKED\b/,
    /\bbounds\b/,
    /\bworld zone\b/,
    /\bevent\b/i,
  ];

  for (const hotspot of WORKSTATION_HOTSPOTS) {
    const viewModel = buildWorkstationPopoverViewModel(componentForHotspot(hotspot, []));
    assert.equal(viewModel.hotspotId, hotspot.id);
    assert.equal(typeof viewModel.title, 'string');
    assert.ok(viewModel.lines.length >= 1);
    assert.ok(viewModel.lines.length <= 2);
    assert.equal(viewModel.maxLines, 2);
    for (const text of [viewModel.title, ...viewModel.lines]) {
      assert.ok(!rawPatterns.some((pattern) => pattern.test(text)), `${hotspot.id} leaked raw text: ${text}`);
    }
  }
});

test('canvas inspection: renderer consumes workstation popover view model copy', () => {
  const hit = hitTestRenderableComponents([], { x: 330, y: 210 }, null, { debug: false, bakedBackground: true });
  const model = buildInspectionPopoverRows(hit, { debug: false });
  const viewModel = buildWorkstationPopoverViewModel(hit.component);

  assert.equal(model.title, viewModel.title);
  assert.deepStrictEqual(model.rows, viewModel.lines);
  assert.ok(model.rows.length <= viewModel.maxLines);
});

test('canvas inspection: every workstation render component gets a visualState model', () => {
  const components = buildWorkstationHotspotComponents(WORKSTATION_HOTSPOTS, []);
  const allowedStates = new Set(['idle', 'queued', 'working', 'awaiting', 'completed', 'failed']);
  const allowedEffects = new Set(['none', 'pulse', 'shimmer', 'sparkle', 'glint']);

  assert.equal(components.length, WORKSTATION_HOTSPOTS.length);
  for (const component of components) {
    assert.equal(component.visualStateViewModel.hotspotId, component.id);
    assert.ok(allowedStates.has(component.visualStateViewModel.visualState));
    assert.ok(allowedEffects.has(component.visualStateViewModel.effect));
    assert.equal(typeof component.visualStateViewModel.tone, 'string');
    assert.equal(typeof component.visualStateViewModel.intensity, 'number');
  }
});

test('canvas inspection: workstation visualState selector falls back to idle without safe data', () => {
  for (const hotspot of WORKSTATION_HOTSPOTS) {
    const component = componentForHotspot(hotspot, []);
    const model = buildWorkstationVisualStateViewModel(component);
    assert.equal(model.visualState, 'idle', `${hotspot.id} should be idle without render data`);
    assert.equal(model.effect, 'none');
  }
});

test('canvas inspection: workstation visualState selector maps safe station summaries', () => {
  const components = [
    { componentType: 'task-chip', id: 'engine-waiting', title: 'Queue item', taskType: 'standard', visualState: 'waiting', worldZoneId: 'engineCrystal', zoneId: 'ENQUEUED' },
    { componentType: 'task-chip', id: 'research-active', title: 'Trend scan', taskType: 'TREND_RESEARCH', visualState: 'working', worldZoneId: 'researchDesk', zoneId: 'CLAIMED' },
    { componentType: 'task-chip', id: 'shopify-publish', title: 'Publish listing', taskType: 'shopify', visualState: 'processing', worldZoneId: 'shopifyDesk', zoneId: 'CLAIMED' },
    { componentType: 'task-chip', id: 'render-active', title: 'Image render', taskType: 'image_render', visualState: 'working', worldZoneId: 'renderDesk', zoneId: 'EXECUTE_FINISHED' },
    { componentType: 'task-chip', id: 'approval-active', title: 'Approve output', taskType: 'standard', visualState: 'processing', worldZoneId: 'approvalDesk', zoneId: 'EXECUTE_FINISHED' },
    { componentType: 'task-chip', id: 'archive-complete', title: 'Finished task', taskType: 'standard', visualState: 'completed', worldZoneId: 'archiveLibrary', zoneId: 'ACKED' },
    { componentType: 'task-chip', id: 'support-active', title: 'Discord reply', taskType: 'discord', visualState: 'working', worldZoneId: 'supportDesk', zoneId: 'CLAIMED' },
  ];
  const expected = new Map([
    ['engineCrystalHotspot', 'queued'],
    ['researchMonitorHotspot', 'working'],
    ['shopifyMonitorHotspot', 'awaiting'],
    ['renderMonitorHotspot', 'working'],
    ['approvalDeskHotspot', 'awaiting'],
    ['archiveShelfHotspot', 'completed'],
    ['supportMonitorHotspot', 'working'],
  ]);

  for (const hotspot of WORKSTATION_HOTSPOTS) {
    if (!expected.has(hotspot.id)) continue;
    const model = componentForHotspot(hotspot, components).visualStateViewModel;
    assert.equal(model.visualState, expected.get(hotspot.id));
    assert.notEqual(model.effect, 'none');
  }
});

test('canvas inspection: anomaly station visualState maps to failed from safe anomaly data', () => {
  const hotspot = WORKSTATION_HOTSPOTS.find((candidate) => candidate.id === 'anomalyShelfHotspot');
  const component = componentForHotspot(hotspot, [
    { componentType: 'task-chip', id: 'task-anomaly', title: 'Needs review', taskType: 'standard', visualState: 'error', worldZoneId: 'anomalyShelf', zoneId: 'ACKED', anomaly: { severity: 'high', type: 'timeout' } },
  ]);

  assert.equal(component.visualStateViewModel.visualState, 'failed');
  assert.equal(component.visualStateViewModel.effect, 'glint');
});

test('canvas inspection: every workstation render component gets an inspectionViewModel', () => {
  const components = buildWorkstationHotspotComponents(WORKSTATION_HOTSPOTS, []);

  assert.equal(components.length, WORKSTATION_HOTSPOTS.length);
  for (const component of components) {
    assert.equal(component.inspectionViewModel.hotspotId, component.id);
    assert.equal(typeof component.inspectionViewModel.stationId, 'string');
    assert.equal(typeof component.inspectionViewModel.title, 'string');
    assert.equal(typeof component.inspectionViewModel.statusLabel, 'string');
    assert.ok(Array.isArray(component.inspectionViewModel.lines));
    assert.ok(Array.isArray(component.inspectionViewModel.taskSummaries));
  }
});

test('canvas inspection: workstation inspection has idle fallback for every station', () => {
  for (const hotspot of WORKSTATION_HOTSPOTS) {
    const model = componentForHotspot(hotspot, []).inspectionViewModel;
    assert.equal(model.statusLabel, 'Idle');
    assert.ok(model.lines.length >= 1, `${hotspot.id} needs idle copy`);
    assert.deepStrictEqual(model.taskSummaries, []);
  }
});

test('canvas inspection: workstation inspection stays compact and avoids raw task/event text', () => {
  const components = [
    { componentType: 'task-chip', id: 'task-raw-123', title: 'Render product image', taskType: 'image_render', visualState: 'working', worldZoneId: 'renderDesk', zoneId: 'EXECUTE_FINISHED' },
    { componentType: 'task-chip', id: 'task-event-456', title: 'Discord reply', taskType: 'discord', visualState: 'working', worldZoneId: 'supportDesk', zoneId: 'CLAIMED' },
    { componentType: 'task-chip', id: 'task-error-789', title: 'Needs review', taskType: 'standard', visualState: 'error', worldZoneId: 'anomalyShelf', zoneId: 'ACKED', anomaly: { severity: 'high', type: 'timeout' } },
  ];
  const rawPatterns = [
    /\btask-[\w-]+\b/,
    /\bCREATED\b/,
    /\bENQUEUED\b/,
    /\bCLAIMED\b/,
    /\bEXECUTE_FINISHED\b/,
    /\bACKED\b/,
    /\bevent\b/i,
    /\bbounds\b/i,
  ];

  for (const hotspot of WORKSTATION_HOTSPOTS) {
    const model = componentForHotspot(hotspot, components).inspectionViewModel;
    assert.ok(model.lines.length <= 3);
    assert.ok(model.taskSummaries.length <= 3);
    for (const text of [model.title, model.statusLabel, ...model.lines, ...model.taskSummaries]) {
      assert.ok(!rawPatterns.some((pattern) => pattern.test(text)), `${hotspot.id} leaked raw text: ${text}`);
    }
  }
});

test('canvas inspection: workstation inspection summarizes active attached work', () => {
  const renderHotspot = WORKSTATION_HOTSPOTS.find((hotspot) => hotspot.id === 'renderMonitorHotspot');
  const model = componentForHotspot(renderHotspot, [
    { componentType: 'task-chip', id: 'task-render-active', title: 'Render product image', taskType: 'image_render', visualState: 'working', worldZoneId: 'renderDesk', zoneId: 'EXECUTE_FINISHED' },
  ]).inspectionViewModel;

  assert.equal(model.title, 'Render Desk');
  assert.equal(model.statusLabel, 'Active');
  assert.ok(model.lines.includes('1 active'));
  assert.ok(model.taskSummaries.includes('Image render: active'));
});

test('canvas inspection: selected station prefers inspectionViewModel while hover uses semantic popover', () => {
  const components = [
    { componentType: 'task-chip', id: 'task-render-active', title: 'Render product image', taskType: 'image_render', visualState: 'working', worldZoneId: 'renderDesk', zoneId: 'EXECUTE_FINISHED' },
  ];
  const hit = hitTestRenderableComponents(components, { x: 620, y: 455 }, null, { debug: false, bakedBackground: true });
  const hoverModel = buildInspectionPopoverRows(hit, { debug: false, selected: false });
  const selectedModel = buildInspectionPopoverRows(hit, { debug: false, selected: true });

  assert.equal(hit.component.inspectionViewModel.statusLabel, 'Active');
  assert.ok(hoverModel.rows.includes('1 render active'));
  assert.ok(!hoverModel.rows.includes('Active'));
  assert.ok(selectedModel.rows.includes('Active'));
  assert.ok(selectedModel.rows.includes('Image render: active'));
});

test('canvas inspection: task result interaction target beats overlapping station', () => {
  const components = [{
    componentType: 'agent-sprite',
    id: 'agent-result',
    x: 700,
    y: 430,
    visualState: 'working',
    worldZoneId: 'renderDesk',
    deskId: 'desk-4',
    currentTaskId: 'task-result',
    trendPanelState: {
      taskId: 'task-result',
      keyword: 'cozy',
      status: 'done',
      results: [{ item: 'Tree lamp', score: 0.95 }],
    },
  }];
  const stationComponents = buildWorkstationHotspotComponents(WORKSTATION_HOTSPOTS, components);
  const targets = buildInteractionTargets(components, { hotspots: WORKSTATION_HOTSPOTS, stationComponents, bakedBackground: true });
  const hit = getInteractionTargetAtPoint(targets, { x: 700, y: 386 });

  assert.equal(hit.type, 'taskResult');
});

test('canvas inspection: Research Desk trend result suppresses generic taskResult target', () => {
  const components = [{
    componentType: 'agent-sprite',
    id: 'agent-result',
    x: 700,
    y: 430,
    visualState: 'working',
    worldZoneId: 'researchDesk',
    deskId: 'desk-0',
    currentTaskId: 'task-result',
    trendPanelState: {
      taskId: 'task-result',
      keyword: 'cozy',
      status: 'done',
      results: [{ item: 'Tree lamp', score: 0.95 }],
    },
  }];
  const stationComponents = buildWorkstationHotspotComponents(WORKSTATION_HOTSPOTS, components, {
    stationSnapshots: {
      research_desk: {
        stationId: 'research_desk',
        label: 'Research Desk',
        currentWork: { count: 0, items: [] },
        lastResult: null,
        latestFailure: null,
        trendResult: {
          taskId: 'task-result',
          keyword: 'cozy',
          rows: [{ item: 'Tree lamp', score: 0.95 }],
        },
      },
    },
  });
  const targets = buildInteractionTargets(components, {
    hotspots: WORKSTATION_HOTSPOTS,
    stationComponents,
    bakedBackground: true,
  });

  assert.equal(targets.some((target) => target.type === 'taskResult'), false);
});

test('canvas inspection: task marker interaction target beats overlapping station', () => {
  const components = [{
    componentType: 'task-chip',
    id: 'task-marker',
    title: 'Render product image',
    taskType: 'image_render',
    x: 700,
    y: 420,
    visualState: 'working',
    worldZoneId: 'renderDesk',
    zoneId: 'EXECUTE_FINISHED',
  }];
  const stationComponents = buildWorkstationHotspotComponents(WORKSTATION_HOTSPOTS, components);
  const hit = getInteractionTargetAtPoint(
    buildInteractionTargets(components, { hotspots: WORKSTATION_HOTSPOTS, stationComponents }),
    { x: 700, y: 420 }
  );

  assert.equal(hit.type, 'taskMarker');
});

test('canvas inspection: debug agent interaction target beats overlapping station', () => {
  const components = [{
    componentType: 'agent-sprite',
    id: 'agent-active',
    x: 700,
    y: 420,
    visualState: 'working',
    worldZoneId: 'renderDesk',
    deskId: 'desk-4',
    currentTaskId: 'task-active',
  }];
  const stationComponents = buildWorkstationHotspotComponents(WORKSTATION_HOTSPOTS, components);
  const hit = getInteractionTargetAtPoint(
    buildInteractionTargets(components, { hotspots: WORKSTATION_HOTSPOTS, stationComponents, bakedBackground: false, debug: true }),
    { x: 620, y: 455 }
  );

  assert.equal(hit.type, 'agent');
});

test('canvas inspection: normal mode excludes default agent targets from hit testing', () => {
  const components = [{
    componentType: 'agent-sprite',
    id: 'agent-default',
    x: 620,
    y: 455,
    visualState: 'working',
    worldZoneId: 'renderDesk',
    deskId: 'desk-4',
    currentTaskId: 'task-active',
  }];
  const stationComponents = buildWorkstationHotspotComponents(WORKSTATION_HOTSPOTS, components);
  const targets = buildInteractionTargets(components, {
    hotspots: WORKSTATION_HOTSPOTS,
    stationComponents,
    bakedBackground: false,
    debug: false,
  });

  assert.ok(!targets.some((target) => target.type === 'agent'));
});

test('canvas inspection: normal mode station wins over overlapping default agent geometry', () => {
  const components = [{
    componentType: 'agent-sprite',
    id: 'agent-default',
    x: 620,
    y: 455,
    visualState: 'working',
    worldZoneId: 'renderDesk',
    deskId: 'desk-4',
    currentTaskId: 'task-active',
  }];
  const hit = hitTestRenderableComponents(components, { x: 620, y: 455 }, null, {
    debug: false,
    bakedBackground: false,
    hotspots: WORKSTATION_HOTSPOTS,
  });
  const model = buildInspectionPopoverRows(hit, { debug: false, selected: true });

  assert.equal(hit.componentType, 'workstation-hotspot');
  assert.equal(hit.interactionTarget.type, 'station');
  assert.equal(model.title, 'Render Desk');
  assert.ok(!model.rows.some((row) => /type:|target:|priority:|zone:|id:|bounds:/i.test(row)));
});

test('canvas inspection: station interaction target works as fallback', () => {
  const stationComponents = buildWorkstationHotspotComponents(WORKSTATION_HOTSPOTS, []);
  const hit = getInteractionTargetAtPoint(
    buildInteractionTargets([], { hotspots: WORKSTATION_HOTSPOTS, stationComponents }),
    { x: 620, y: 455 }
  );

  assert.equal(hit.type, 'station');
});

test('canvas inspection: unified interaction hit testing clears on empty background', () => {
  const stationComponents = buildWorkstationHotspotComponents(WORKSTATION_HOTSPOTS, []);
  const hit = getInteractionTargetAtPoint(
    buildInteractionTargets([], { hotspots: WORKSTATION_HOTSPOTS, stationComponents }),
    { x: 20, y: 500 }
  );

  assert.equal(hit, null);
});

test('canvas inspection: task result selection routes to result popover view model', () => {
  const components = [{
    componentType: 'agent-sprite',
    id: 'agent-result',
    x: 700,
    y: 430,
    visualState: 'working',
    worldZoneId: 'renderDesk',
    deskId: 'desk-4',
    currentTaskId: 'task-result',
    trendPanelState: {
      taskId: 'task-result',
      keyword: 'cozy',
      status: 'done',
      results: [{ item: 'Tree lamp', score: 0.95 }],
    },
  }];
  const hit = hitTestRenderableComponents(components, { x: 700, y: 386 }, null, {
    debug: false,
    bakedBackground: true,
    hotspots: WORKSTATION_HOTSPOTS,
  });
  const model = buildInspectionPopoverRows(hit, { debug: false, selected: true });

  assert.equal(hit.componentType, 'task-result');
  assert.equal(model.title, 'Task Result');
  assert.ok(model.rows.includes('Trend: cozy'));
  assert.ok(model.rows.includes('Tree lamp'));
});

test('canvas inspection: normal selected agent uses friendly agent inspection view model', () => {
  const components = [{
    componentType: 'agent-sprite',
    id: 'agent-render',
    x: 620,
    y: 455,
    visualState: 'working',
    deskId: 'desk-4',
    worldZoneId: 'renderDesk',
    currentTaskId: 'task-secret-123',
    normalInteractive: true,
  }];
  const hit = hitTestRenderableComponents(components, { x: 620, y: 455 }, null, {
    debug: false,
    bakedBackground: false,
    hotspots: WORKSTATION_HOTSPOTS,
  });
  const model = buildInspectionPopoverRows(hit, { debug: false, selected: true });

  assert.equal(hit.componentType, 'agent-sprite');
  assert.equal(model.title, 'Render Sloth');
  assert.ok(model.rows.includes('Working'));
  assert.ok(model.rows.includes('Assigned to a task'));
  assert.ok(!model.rows.includes('type: agent'));
  assert.ok(!model.rows.some((row) => row.startsWith('zone:')));
  assert.ok(![model.title, ...model.rows].some((row) => /engineCrystal|renderDesk|task-secret|currentTaskId/.test(row)));
});

test('canvas inspection: normal mode does not show Agent Desk diagnostic popover for default agent', () => {
  const components = [{
    componentType: 'agent-sprite',
    id: 'sloth-3',
    x: 620,
    y: 455,
    visualState: 'unknown',
    deskId: 'desk-4',
    worldZoneId: 'engineCrystal',
  }];
  const hit = hitTestRenderableComponents(components, { x: 620, y: 455 }, null, {
    debug: false,
    bakedBackground: false,
    hotspots: WORKSTATION_HOTSPOTS,
  });
  const model = buildInspectionPopoverRows(hit, { debug: false, selected: true });
  const text = [model?.title, ...(model?.rows || [])].filter(Boolean).join('\n');

  assert.equal(hit.componentType, 'workstation-hotspot');
  assert.ok(!/Agent Desk|type: agent|target: agent|priority: 70|zone: engineCrystal|id: sloth-3|bounds:/i.test(text));
});

test('canvas inspection: missing agent data falls back to friendly idle sloth copy', () => {
  const model = buildAgentInspectionViewModel({});

  assert.equal(model.title, 'Sloth Worker');
  assert.equal(model.statusLabel, 'Idle');
  assert.deepStrictEqual(model.lines, ['Waiting for work']);
});

test('canvas inspection: normal agent popover hides raw zone and camelCase internals', () => {
  const hit = {
    entityId: 'agent-core',
    componentType: 'agent-sprite',
    component: {
      componentType: 'agent-sprite',
      id: 'agent-core',
      visualState: 'idle',
      worldZoneId: 'engineCrystal',
      normalInteractive: true,
      agentInspectionViewModel: buildAgentInspectionViewModel({ visualState: 'idle', worldZoneId: 'engineCrystal' }),
    },
    bounds: { x: 450, y: 220, width: 50, height: 50 },
  };
  const model = buildInspectionPopoverRows(hit, { debug: false, selected: true });

  assert.equal(model.title, 'Engine Sloth');
  assert.ok(!model.rows.includes('type: agent'));
  assert.ok(!model.rows.some((row) => row.startsWith('zone:')));
  assert.ok(![model.title, ...model.rows].some((row) => /engineCrystal|worldZoneId|zoneId/.test(row)));
});

test('canvas inspection: debug agent popover can show target diagnostics', () => {
  const components = [{
    componentType: 'agent-sprite',
    id: 'agent-debug',
    x: 700,
    y: 420,
    visualState: 'working',
    deskId: 'desk-4',
    worldZoneId: 'renderDesk',
    currentTaskId: 'task-debug',
  }];
  const hit = hitTestRenderableComponents(components, { x: 700, y: 420 }, null, {
    debug: true,
    bakedBackground: false,
    hotspots: WORKSTATION_HOTSPOTS,
  });
  const model = buildInspectionPopoverRows(hit, { debug: true, selected: true });

  assert.ok(model.rows.includes('type: agent'));
  assert.ok(model.rows.includes('target: agent'));
  assert.ok(model.rows.includes('priority: 70'));
  assert.ok(model.rows.includes('zone: renderDesk'));
});

test('canvas inspection: hover tracks unified interaction target for pointer routing', () => {
  const state = createCanvasInspectionState();
  const components = [{
    componentType: 'agent-sprite',
    id: 'agent-result',
    x: 700,
    y: 430,
    visualState: 'working',
    worldZoneId: 'renderDesk',
    deskId: 'desk-4',
    currentTaskId: 'task-result',
    trendPanelState: {
      taskId: 'task-result',
      keyword: 'cozy',
      status: 'done',
      results: [{ item: 'Tree lamp', score: 0.95 }],
    },
  }];

  const hit = updateInspectionHover(state, components, { x: 700, y: 386 }, null, {
    debug: false,
    bakedBackground: true,
    hotspots: WORKSTATION_HOTSPOTS,
  });

  assert.equal(hit.componentType, 'task-result');
  assert.equal(state.hoveredTargetType, 'taskResult');
  assert.equal(state.hoveredHotspotId, null);
});

test('canvas inspection: renderer consumes workstation inspection view model copy', () => {
  const hit = hitTestRenderableComponents([], { x: 330, y: 210 }, null, { debug: false, bakedBackground: true });
  const model = buildInspectionPopoverRows(hit, { debug: false, selected: true });
  const viewModel = buildWorkstationInspectionViewModel(hit.component);

  assert.equal(model.title, viewModel.title);
  assert.equal(model.rows[0], viewModel.statusLabel);
  assert.ok(model.rows.includes(viewModel.lines[0]));
});

test('canvas inspection: zone popover uses friendly zone title without unknown status', () => {
  const hit = hitTestRenderableComponents(COMPONENTS, { x: 126, y: 356 }, null, { debug: false });
  const model = buildInspectionPopoverRows(hit, { debug: false });

  assert.equal(hit, null);
  assert.equal(model, null);
});

test('canvas inspection: normal mode does not render popover for world-zone-only target', () => {
  const hit = {
    entityId: 'ENQUEUED',
    componentType: 'world-zone-indicator',
    component: { componentType: 'zone-background', id: 'ENQUEUED', visualState: 'unknown' },
    bounds: { x: 103, y: 333, width: 46, height: 46 },
  };
  const ctx = createMockContext();

  assert.equal(buildInspectionPopoverRows(hit, { debug: false }), null);
  renderInspectionPopover(ctx, hit, { debug: false });

  assert.ok(!ctx.calls.some((call) => call[0] === 'fillText'));
});

test('canvas inspection: normal mode never renders raw target metadata rows', () => {
  const hits = [
    hitTestRenderableComponents(COMPONENTS, { x: 300, y: 260 }, null, { debug: false }),
    hitTestRenderableComponents([], { x: 330, y: 210 }, null, { debug: false, bakedBackground: true }),
    {
      entityId: 'agent-safe',
      componentType: 'agent-sprite',
      component: {
        componentType: 'agent-sprite',
        id: 'agent-safe',
        visualState: 'working',
        worldZoneId: 'engineCrystal',
        normalInteractive: true,
        agentInspectionViewModel: buildAgentInspectionViewModel({
          componentType: 'agent-sprite',
          id: 'agent-safe',
          visualState: 'working',
          worldZoneId: 'engineCrystal',
        }),
      },
      bounds: { x: 450, y: 220, width: 50, height: 50 },
    },
  ];
  const forbidden = [/type:/i, /zone:/i, /priority:/i, /bounds:/i, /world-zone/i, /engineCrystal/];

  for (const hit of hits) {
    const model = buildInspectionPopoverRows(hit, { debug: false, selected: true });
    assert.ok(model, `expected friendly model for ${hit?.componentType}`);
    const text = [model.title, ...model.rows].join('\n');
    assert.ok(!forbidden.some((pattern) => pattern.test(text)), text);
  }
});

test('canvas inspection: normal mode has no generic target fallback popover', () => {
  const rawTargetHit = {
    entityId: 'raw-target',
    componentType: 'debug-target',
    component: { componentType: 'debug-target', id: 'raw-target', type: 'agent', worldZoneId: 'engineCrystal' },
    interactionTarget: {
      id: 'debug:raw-target',
      type: 'debug',
      priority: 5,
      viewModel: null,
      source: { id: 'raw-target' },
    },
    bounds: { x: 1, y: 2, width: 3, height: 4 },
  };

  assert.equal(canRenderNormalPopover(rawTargetHit), false);
  assert.equal(buildInspectionPopoverRows(rawTargetHit, { debug: false, selected: true }), null);
});

test('canvas inspection: normal-mode popover draw output has no legacy diagnostic text', () => {
  const taskMarkerHit = hitTestRenderableComponents([{
    componentType: 'task-chip',
    id: 'sloth-task-marker',
    title: 'Pack listing draft',
    taskType: 'shopify',
    x: 620,
    y: 455,
    visualState: 'working',
    worldZoneId: 'engineCrystal',
    zoneId: 'CLAIMED',
  }], { x: 620, y: 455 }, null, { debug: false, hotspots: WORKSTATION_HOTSPOTS });
  const taskResultHit = hitTestRenderableComponents([{
    componentType: 'agent-sprite',
    id: 'sloth-result',
    x: 700,
    y: 430,
    visualState: 'working',
    worldZoneId: 'engineCrystal',
    deskId: 'desk-4',
    trendPanelState: {
      taskId: 'TASK_INTERNAL_1',
      keyword: 'cozy lamp',
      status: 'done',
      results: [{ item: 'Moss lamp' }],
    },
  }], { x: 700, y: 386 }, null, { debug: false, bakedBackground: true, hotspots: WORKSTATION_HOTSPOTS });
  const stationHit = hitTestRenderableComponents([], { x: 620, y: 455 }, null, {
    debug: false,
    bakedBackground: true,
    hotspots: WORKSTATION_HOTSPOTS,
  });
  const explicitAgentHit = hitTestRenderableComponents([{
    componentType: 'agent-sprite',
    id: 'sloth-explicit',
    x: 620,
    y: 455,
    visualState: 'working',
    worldZoneId: 'engineCrystal',
    deskId: 'desk-4',
    normalInteractive: true,
    agentInspectionViewModel: buildAgentInspectionViewModel({
      componentType: 'agent-sprite',
      id: 'sloth-explicit',
      visualState: 'working',
      worldZoneId: 'engineCrystal',
      deskId: 'desk-4',
      normalInteractive: true,
    }),
  }], { x: 620, y: 455 }, null, { debug: false, hotspots: WORKSTATION_HOTSPOTS });
  const hits = [taskMarkerHit, taskResultHit, stationHit, explicitAgentHit];
  const forbidden = /Agent Desk|World Zone|type:|target:|priority:|zone:|bounds:|world-zone|sloth-|engineCrystal|TASK_|AGENT_/i;

  for (const hit of hits) {
    assert.equal(canRenderNormalPopover(hit), true, `expected normal-eligible ${hit?.componentType}`);
    const ctx = createMockContext();
    renderInspectionPopover(ctx, hit, { debug: false, selected: true });
    const text = ctx.calls
      .filter((call) => call[0] === 'fillText')
      .map((call) => call[1])
      .join('\n');
    assert.ok(text.length > 0, `expected popover text for ${hit?.componentType}`);
    assert.ok(!forbidden.test(text), text);
  }
});

test('canvas inspection: debug mode still renders world-zone diagnostics', () => {
  const hit = hitTestRenderableComponents(COMPONENTS, { x: 126, y: 356 }, null, { debug: true });
  const model = buildInspectionPopoverRows(hit, { debug: true });

  assert.equal(hit.componentType, 'world-zone-indicator');
  assert.equal(model.title, 'Task Engine');
  assert.ok(model.rows.includes('type: world-zone'));
  assert.ok(model.rows.some((row) => row.startsWith('bounds: ')));
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
  const hit = {
    entityId: 'agent-1',
    componentType: 'agent-sprite',
    component: {
      componentType: 'agent-sprite',
      id: 'agent-1',
      visualState: 'working',
      deskId: 'desk-0',
      worldZoneId: 'researchDesk',
      currentTaskId: 'task-1',
      normalInteractive: true,
      agentInspectionViewModel: buildAgentInspectionViewModel({
        componentType: 'agent-sprite',
        id: 'agent-1',
        visualState: 'working',
        deskId: 'desk-0',
        worldZoneId: 'researchDesk',
        currentTaskId: 'task-1',
      }),
    },
    bounds: { x: 210, y: 175, width: 180, height: 170 },
  };
  const ctx = createMockContext();

  assert.doesNotThrow(() => renderInspectionPopover(ctx, hit, { debug: false }));
  assert.ok(ctx.calls.some((call) => call[0] === 'fillText' && call[1] === 'Research Sloth'));
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

test('canvas inspection: Research Desk result card wraps and clamps row text', () => {
  const ctx = createMockContext();
  ctx.font = '20px sans-serif';
  const lines = wrapResearchCardText(
    ctx,
    'Trend results: This is a deliberately long research summary that should wrap safely without overflowing the polished card surface.',
    210,
    2
  );

  assert.ok(lines.length <= 2);
  assert.ok(lines.every((line) => ctx.measureText(line).width <= 210));
});

test('canvas inspection: Research Desk result card stays popover sized', () => {
  const ctx = createMockContext();
  const layout = computeResearchCardLayout(ctx, {
    title: 'Research Desk',
    rows: [
      { label: 'Trend results', text: 'Mixed trends in fitness and nutrition.' },
      { label: 'Recommendation', text: 'Monitor growth and habits.' },
      { label: 'Top signal', text: 'Long descriptive top signal that still needs to wrap cleanly inside the smaller workstation card.' },
    ],
  });

  assert.ok(layout.cardW >= 420);
  assert.ok(layout.cardW <= 520);
  assert.ok(layout.cardH >= 180);
  assert.ok(layout.cardH <= 260);
  assert.ok(layout.titleFontPx >= 24 && layout.titleFontPx <= 30);
  assert.ok(layout.bodyFontPx >= 16 && layout.bodyFontPx <= 20);
  assert.ok(layout.wrappedRows.length <= 3);
  assert.ok(layout.wrappedRows.every((row) => row.lines.length <= 2));
  assert.ok(layout.cardX < 220, 'card should anchor near the Research Desk side of the scene');
});

function makeResearchDeskCardComponent() {
  return {
    componentType: 'workstation-hotspot',
    id: 'researchMonitorHotspot',
    resultCardViewModel: {
      title: 'Research Desk',
      rows: [
        { label: 'Trend results', text: 'Mixed trends in fitness and nutrition.' },
        { label: 'Recommendation', text: 'Monitor growth and habits.' },
        { label: 'Top signal', text: 'Fitness routine 0.91' },
      ],
    },
  };
}

test('canvas inspection: Research Desk card VM does not draw without hover or selection', () => {
  const ctx = createMockContext();
  const components = [makeResearchDeskCardComponent()];

  renderUIOverlayLayer(ctx, components, new Map(), {
    bakedBackground: true,
    debug: false,
    bootPolicy: BACKGROUND_BOOT_POLICY.BAKED_READY,
  });

  const textCalls = ctx.calls.filter((call) => call[0] === 'fillText').map((call) => call[1]);
  assert.ok(!textCalls.includes('Research Desk'));
  assert.ok(!textCalls.some((text) => String(text).startsWith('Trend results:')));
});

test('canvas inspection: hovered Research Desk renders polished analysis card', () => {
  const ctx = createMockContext();
  const components = [makeResearchDeskCardComponent()];

  renderUIOverlayLayer(ctx, components, new Map(), {
    bakedBackground: true,
    debug: false,
    bootPolicy: BACKGROUND_BOOT_POLICY.BAKED_READY,
    hoveredHotspotId: 'researchMonitorHotspot',
  });

  const textCalls = ctx.calls.filter((call) => call[0] === 'fillText').map((call) => call[1]);
  assert.ok(textCalls.includes('Research Desk'));
  assert.ok(textCalls.some((text) => String(text).startsWith('Trend results:')));
  assert.ok(textCalls.some((text) => String(text).startsWith('Recommendation:')));
  assert.ok(textCalls.some((text) => String(text).startsWith('Top signal:')));
  assert.ok(!textCalls.some((text) => /TASK_|task-research|ollama_timeout/.test(String(text))));
  assert.ok(ctx.calls.some((call) => call[0] === 'ellipse'), 'leaf/bullet accents should render');
});

test('canvas inspection: selected Research Desk renders polished analysis card', () => {
  const ctx = createMockContext();
  const components = [makeResearchDeskCardComponent()];

  renderUIOverlayLayer(ctx, components, new Map(), {
    bakedBackground: true,
    debug: false,
    bootPolicy: BACKGROUND_BOOT_POLICY.BAKED_READY,
    selectedHotspotId: 'researchMonitorHotspot',
  });

  const textCalls = ctx.calls.filter((call) => call[0] === 'fillText').map((call) => call[1]);
  assert.ok(textCalls.includes('Research Desk'));
  assert.ok(textCalls.some((text) => String(text).startsWith('Trend results:')));
  assert.ok(textCalls.some((text) => String(text).startsWith('Recommendation:')));
  assert.ok(textCalls.some((text) => String(text).startsWith('Top signal:')));
  assert.ok(!textCalls.some((text) => /TASK_|task-research|ollama_timeout/.test(String(text))));
  assert.ok(ctx.calls.some((call) => call[0] === 'ellipse'), 'leaf/bullet accents should render');
});

test('canvas inspection: Research Desk card suppresses raw trend overlay text in normal mode', () => {
  const ctx = createMockContext();
  const components = [
    {
      componentType: 'agent-sprite',
      id: 'agent-research',
      x: 540,
      y: 360,
      visualState: 'working',
      trendPanelState: {
        taskId: 'task-raw-overlay',
        keyword: 'raw keyword',
        status: 'done',
        results: [{ item: 'Raw overlay candidate', score: 0.77 }],
      },
    },
    {
      componentType: 'workstation-hotspot',
      id: 'researchMonitorHotspot',
      resultCardViewModel: {
        title: 'Research Desk',
        rows: [
          { label: 'Trend results', text: 'Polished summary is ready.' },
          { label: 'Recommendation', text: 'Use the card result.' },
        ],
      },
    },
  ];

  renderUIOverlayLayer(ctx, components, new Map([['agent-research', { x: 540, y: 360 }]]), {
    bakedBackground: false,
    debug: false,
    bootPolicy: BACKGROUND_BOOT_POLICY.BAKED_READY,
    hoveredHotspotId: 'researchMonitorHotspot',
  });

  const textCalls = ctx.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1]));
  assert.ok(textCalls.includes('Research Desk'));
  assert.ok(textCalls.some((text) => text.startsWith('Trend results: Polished summary is ready.')));
  assert.ok(!textCalls.some((text) => text.startsWith('Top Trends: raw keyword')));
  assert.ok(!textCalls.some((text) => text.includes('Raw overlay candidate')));
});

test('canvas inspection: Research Desk result card suppresses legacy normal popover', () => {
  const ctx = createMockContext();
  const component = {
    ...makeResearchDeskCardComponent(),
    label: 'Research Desk',
    popoverViewModel: {
      title: 'Research Desk',
      lines: ['Trend results: legacy popover text'],
    },
  };

  renderInspectionPopover(ctx, {
    componentType: 'workstation-hotspot',
    entityId: 'researchMonitorHotspot',
    component,
    bounds: { x: 100, y: 100, width: 80, height: 60 },
  }, { debug: false, selected: true });

  const textCalls = ctx.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1]));
  assert.ok(!textCalls.includes('Research Desk'));
  assert.ok(!textCalls.some((text) => text.includes('legacy popover text')));
});

test('canvas inspection: other workstation popovers still render normally', () => {
  const ctx = createMockContext();
  const component = {
    componentType: 'workstation-hotspot',
    id: 'renderMonitorHotspot',
    label: 'Render Desk',
    inspectionViewModel: {
      title: 'Render Desk',
      statusLabel: 'Idle',
      lines: ['Render table is idle'],
      taskSummaries: [],
    },
    popoverViewModel: {
      title: 'Render Desk',
      lines: ['Render table is idle'],
    },
  };

  renderInspectionPopover(ctx, {
    componentType: 'workstation-hotspot',
    entityId: 'renderMonitorHotspot',
    component,
    bounds: { x: 100, y: 100, width: 80, height: 60 },
  }, { debug: false, selected: true });

  const textCalls = ctx.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1]));
  assert.ok(textCalls.includes('Render Desk'));
  assert.ok(textCalls.some((text) => text.startsWith('Render table')));
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

test('canvas inspection: baked normal inactive workstation hotspots do not draw rectangles', () => {
  const ctx = createMockContext();
  const inspectionState = createCanvasInspectionState();

  renderWorkstationHotspotFeedback(ctx, [], inspectionState, { bakedBackground: true, debug: false });

  assert.equal(ctx.calls.length, 2);
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillRect' || call[0] === 'strokeRect'));
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillText'));
});

test('canvas inspection: baked normal hovered workstation draws subtle feedback without labels', () => {
  const ctx = createMockContext();
  const inspectionState = createCanvasInspectionState();
  inspectionState.hoveredEntityId = 'researchMonitorHotspot';
  inspectionState.hoveredComponentType = 'workstation-hotspot';

  renderWorkstationHotspotFeedback(ctx, [], inspectionState, { bakedBackground: true, debug: false });

  assert.ok(ctx.calls.some((call) => call[0] === 'ellipse'));
  assert.ok(ctx.calls.some((call) => call[0] === 'stroke'));
  assert.ok(ctx.calls.some((call) => call[0] === 'arc'));
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillRect' || call[0] === 'strokeRect'));
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillText'));
});

test('canvas inspection: baked normal active and anomaly hotspots draw state feedback', () => {
  const activeCtx = createMockContext();
  const activeComponents = [
    { componentType: 'agent-sprite', id: 'agent-active', visualState: 'working', worldZoneId: 'researchDesk', zoneId: 'CLAIMED', currentTaskId: 'task-active' },
  ];

  renderWorkstationHotspotFeedback(activeCtx, activeComponents, createCanvasInspectionState(), {
    bakedBackground: true,
    debug: false,
  });

  assert.ok(activeCtx.calls.some((call) => call[0] === 'arc'));
  assert.ok(!activeCtx.calls.some((call) => call[0] === 'fillRect' || call[0] === 'strokeRect'));

  const anomalyCtx = createMockContext();
  const anomalyComponents = [
    { componentType: 'task-chip', id: 'task-anomaly', visualState: 'error', worldZoneId: 'anomalyShelf', zoneId: 'ACKED', anomaly: { severity: 'high', type: 'stalled_tasks' } },
  ];

  renderWorkstationHotspotFeedback(anomalyCtx, anomalyComponents, createCanvasInspectionState(), {
    bakedBackground: true,
    debug: false,
  });

  assert.ok(anomalyCtx.calls.some((call) => call[0] === 'arc'));
  assert.ok(anomalyCtx.calls.some((call) => call[0] === 'createRadialGradient'));
  assert.ok(!anomalyCtx.calls.some((call) => call[0] === 'fillText'));
});

test('canvas inspection: debug mode still renders workstation hotspot bounds and IDs', () => {
  const ctx = createMockContext();

  renderWorkstationHotspotDebug(ctx);

  assert.ok(ctx.calls.some((call) => call[0] === 'strokeRect'));
  assert.ok(ctx.calls.some((call) => call[0] === 'fillRect'));
  assert.ok(ctx.calls.some((call) => call[0] === 'fillText' && call[1] === 'researchMonitorHotspot'));
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
    'rendering/world-scene.js',
    'rendering/world-scene-adapter.js',
    'rendering/hotspot-highlight-renderer.js',
    'ui/hotspots/workstationHotspots.js',
    'ui/hotspots/hitTestHotspots.js',
    'ui/hotspots/hotspotGeometry.js',
    'ui/hotspots/hotspotCalibration.js',
    'ui/hotspots/workstationSemantics.js',
    'ui/selectors/workstationPopoverSelectors.js',
    'ui/selectors/workstationVisualStateSelectors.js',
    'ui/selectors/workstationInspectionSelectors.js',
    'ui/selectors/agentInspectionSelectors.js',
    'ui/interactions/interactionTargets.js',
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
