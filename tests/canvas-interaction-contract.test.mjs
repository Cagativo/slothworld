import test from 'node:test';
import assert from 'node:assert/strict';

import { hitTestRenderableComponents } from '../rendering/canvas-hit-test.js';
import {
  buildInspectionPopoverRows,
  canRenderNormalPopover,
  renderInspectionPopover,
} from '../rendering/inspection-popover-renderer.js';
import { renderBackgroundLayer } from '../rendering/world-scene-asset-renderer.js';
import { loadedAssets } from '../rendering/assets.js';
import { traceRenderBoot } from '../rendering/debug.js';

function makeGradient(log, kind) {
  return {
    addColorStop(offset, color) {
      log.push([`${kind}.addColorStop`, offset, color]);
    },
  };
}

function createMockContext() {
  const calls = [];
  const ctx = {
    canvas: { width: 1060, height: 520 },
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    closePath: () => calls.push(['closePath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
    bezierCurveTo: (...args) => calls.push(['bezierCurveTo', ...args]),
    arc: (...args) => calls.push(['arc', ...args]),
    ellipse: (...args) => calls.push(['ellipse', ...args]),
    fill: () => calls.push(['fill']),
    stroke: () => calls.push(['stroke']),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    strokeRect: (...args) => calls.push(['strokeRect', ...args]),
    drawImage: (...args) => calls.push(['drawImage', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
    setLineDash: (...args) => calls.push(['setLineDash', ...args]),
    createLinearGradient: (...args) => {
      calls.push(['createLinearGradient', ...args]);
      return makeGradient(calls, 'linearGradient');
    },
    createRadialGradient: (...args) => {
      calls.push(['createRadialGradient', ...args]);
      return makeGradient(calls, 'radialGradient');
    },
    measureText: (text) => ({ width: String(text).length * 6 }),
  };
  return ctx;
}

function clearBackgroundAssets() {
  delete loadedAssets['scene_background_02.png'];
  delete loadedAssets['scene_background_02.jpg'];
  delete loadedAssets['scene_background_01.jpg'];
}

function textFrom(ctx) {
  return ctx.calls
    .filter((call) => call[0] === 'fillText')
    .map((call) => String(call[1]))
    .join('\n');
}

function withWindow(fakeWindow, fn) {
  const previousWindow = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    return fn();
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
}

const DEFAULT_AGENT = Object.freeze({
  componentType: 'agent-sprite',
  id: 'sloth-default-1',
  x: 352,
  y: 224,
  visualState: 'working',
  deskId: 'desk-0',
  worldZoneId: 'researchDesk',
  zoneId: 'CLAIMED',
  currentTaskId: 'TASK_INTERNAL_1',
});

test('canvas interaction contract: normal mode target priority excludes default agents', () => {
  const hit = hitTestRenderableComponents([DEFAULT_AGENT], { x: 330, y: 210 }, null, {
    debug: false,
    bakedBackground: true,
  });

  assert.equal(hit.componentType, 'workstation-hotspot');
  assert.notEqual(hit.componentType, 'agent-sprite');
});

test('canvas interaction contract: taskResult beats station hotspot', () => {
  const hit = hitTestRenderableComponents([{
    componentType: 'agent-sprite',
    id: 'trend-agent-contract',
    x: 330,
    y: 258,
    visualState: 'working',
    trendPanelState: {
      taskId: 'trend-task-contract',
      keyword: 'cozy',
      status: 'done',
      results: [{ item: 'treehouse', score: 0.98 }],
    },
  }], { x: 330, y: 215 }, null, { debug: false });

  assert.equal(hit.componentType, 'task-result');
  assert.equal(hit.interactionTarget.type, 'taskResult');
});

test('canvas interaction contract: taskMarker beats station hotspot', () => {
  const hit = hitTestRenderableComponents([{
    componentType: 'task-chip',
    id: 'TASK_MARKER_CONTRACT',
    x: 330,
    y: 210,
    visualState: 'working',
    title: 'Active task',
  }], { x: 330, y: 210 }, null, { debug: false });

  assert.equal(hit.componentType, 'task-chip');
  assert.equal(hit.interactionTarget.type, 'taskMarker');
});

test('canvas interaction contract: station works as forgiving fallback', () => {
  const hit = hitTestRenderableComponents([], { x: 330, y: 210 }, null, { debug: false });

  assert.equal(hit.componentType, 'workstation-hotspot');
  assert.equal(hit.interactionTarget.type, 'station');
});

test('canvas interaction contract: world-zone/debug target does not render normal popover', () => {
  const hit = {
    componentType: 'world-zone-indicator',
    component: { componentType: 'zone-background', id: 'ENQUEUED', zoneId: 'ENQUEUED' },
    bounds: { x: 102, y: 332, width: 48, height: 48 },
  };

  assert.equal(canRenderNormalPopover(hit), false);
  assert.equal(buildInspectionPopoverRows(hit, { debug: false }), null);
});

test('canvas interaction contract: normal popover guard rejects raw fields', () => {
  const banned = [
    'type: workstation',
    'target: station',
    'priority: 40',
    'zone: CLAIMED',
    'bounds: 1,2 3x4',
    'world-zone',
    'sloth-raw-1',
    'engineCrystal',
    'TASK_CREATED',
    'AGENT_ASSIGNED',
  ];

  for (const text of banned) {
    const ctx = createMockContext();
    const hit = {
      componentType: 'workstation-hotspot',
      component: {
        componentType: 'workstation-hotspot',
        id: 'researchMonitorHotspot',
        inspectionViewModel: {
          title: 'Research Desk',
          statusLabel: 'Ready',
          lines: [text],
          taskSummaries: [],
          tone: 'quiet',
        },
      },
      bounds: { x: 300, y: 190, width: 120, height: 80 },
    };

    assert.equal(canRenderNormalPopover(hit), true);
    renderInspectionPopover(ctx, hit, { debug: false, selected: true });
    assert.equal(textFrom(ctx), '', `normal popover leaked ${text}`);
  }
});

test('canvas interaction contract: debug mode can still show diagnostics', () => {
  const hit = hitTestRenderableComponents([{
    componentType: 'task-chip',
    id: 'TASK_DEBUG_CONTRACT',
    x: 330,
    y: 210,
    visualState: 'processing',
    metrics: { duration: 1200 },
  }], { x: 330, y: 210 }, null, { debug: true });
  const model = buildInspectionPopoverRows(hit, { debug: true });

  assert.ok(model.rows.includes('type: task'));
  assert.ok(model.rows.includes('target: taskMarker'));
  assert.ok(model.rows.some((row) => row.startsWith('priority: ')));
  assert.ok(model.rows.includes('id: TASK_DEBUG_CONTRACT'));
});

test('canvas interaction contract: baked-pending normal mode uses blank boot background', () => {
  clearBackgroundAssets();
  const ctx = createMockContext();

  renderBackgroundLayer(ctx, 1);

  assert.ok(ctx.calls.some((call) => call[0] === 'fillRect'));
  assert.equal(ctx.calls.some((call) => call[0] === 'bezierCurveTo'), false);
});

test('canvas interaction contract: procedural fallback allowed by debug, calibration, or explicit flag', () => {
  clearBackgroundAssets();

  const debugCtx = createMockContext();
  renderBackgroundLayer(debugCtx, 2, { debug: true });
  assert.ok(debugCtx.calls.some((call) => call[0] === 'bezierCurveTo'));

  const calibrationCtx = createMockContext();
  renderBackgroundLayer(calibrationCtx, 2, { calibration: true });
  assert.ok(calibrationCtx.calls.some((call) => call[0] === 'bezierCurveTo'));

  const explicitCtx = createMockContext();
  withWindow({ __SLOTHWORLD_ALLOW_PROCEDURAL_FALLBACK__: true }, () => {
    renderBackgroundLayer(explicitCtx, 2);
  });
  assert.ok(explicitCtx.calls.some((call) => call[0] === 'bezierCurveTo'));
});

test('canvas interaction contract: render boot tracing remains gated off by default', () => {
  const previousLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args);

  try {
    withWindow({}, () => {
      traceRenderBoot('contract-test-path', { frame: 1, canvasSize: { width: 1, height: 1 } });
    });
  } finally {
    console.log = previousLog;
  }

  assert.deepStrictEqual(logs, []);
});
