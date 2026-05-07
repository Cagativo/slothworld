import test from 'node:test';
import assert from 'node:assert/strict';

import { BACKGROUND_BOOT_POLICY } from '../rendering/background-config.js';
import { loadedAssets } from '../rendering/assets.js';
import {
  renderBackgroundLayer,
  renderUIOverlayLayer,
} from '../rendering/world-scene-asset-renderer.js';
import { renderWorldCompositionLayer } from '../rendering/world-background-composition.js';

function clearBackgroundAssets() {
  delete loadedAssets['scene_background_02.png'];
  delete loadedAssets['scene_background_02.jpg'];
  delete loadedAssets['scene_background_01.jpg'];
}

function makeGradient(log, kind) {
  return {
    addColorStop(offset, color) {
      log.push({ method: `${kind}.addColorStop`, args: [offset, color] });
    },
  };
}

function makeMockCtx() {
  const log = [];
  const store = {
    canvas: { width: 1060, height: 520 },
    createLinearGradient(...args) {
      log.push({ method: 'createLinearGradient', args });
      return makeGradient(log, 'linearGradient');
    },
    createRadialGradient(...args) {
      log.push({ method: 'createRadialGradient', args });
      return makeGradient(log, 'radialGradient');
    },
    measureText(text) {
      log.push({ method: 'measureText', args: [text] });
      return { width: String(text).length * 6 };
    },
  };

  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        log.push({ method: String(prop), args });
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      log.push({ method: 'set', prop: String(prop), value });
      return true;
    },
  });

  return { ctx, log };
}

function makePanelComponents() {
  return [
    {
      componentType: 'agent-sprite',
      id: 'agent-1',
      x: 300,
      y: 260,
      trendPanelState: {
        taskId: 'task-trends-1',
        keyword: 'hats',
        status: 'done',
        results: [{ item: 'hats-green', score: 0.91 }],
      },
    },
  ];
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

test('background boot gate: normal baked-pending does not call procedural fallback', () => {
  clearBackgroundAssets();
  const { ctx, log } = makeMockCtx();

  renderBackgroundLayer(ctx, 1);

  assert.equal(log.some((entry) => entry.method === 'bezierCurveTo'), false);
});

test('background boot gate: normal baked-pending draws neutral boot background', () => {
  clearBackgroundAssets();
  const { ctx, log } = makeMockCtx();

  renderBackgroundLayer(ctx, 1);

  assert.ok(log.some((entry) => entry.method === 'createLinearGradient'));
  assert.ok(log.some((entry) => entry.method === 'fillRect'));
});

test('background boot gate: fallback flag allows procedural fallback', () => {
  clearBackgroundAssets();
  const { ctx, log } = makeMockCtx();
  const localStorage = {
    getItem(key) {
      return key === 'slothworld.allowProceduralFallback' ? '1' : null;
    },
  };

  withWindow({ localStorage }, () => renderBackgroundLayer(ctx, 2));

  assert.ok(log.some((entry) => entry.method === 'bezierCurveTo'));
});

test('background boot gate: debug and calibration allow procedural fallback', () => {
  clearBackgroundAssets();
  const debug = makeMockCtx();
  const calibration = makeMockCtx();

  renderBackgroundLayer(debug.ctx, 3, { debug: true });
  renderBackgroundLayer(calibration.ctx, 3, { calibration: true });

  assert.ok(debug.log.some((entry) => entry.method === 'bezierCurveTo'));
  assert.ok(calibration.log.some((entry) => entry.method === 'bezierCurveTo'));
});

test('background boot gate: baked-ready draws baked background', () => {
  clearBackgroundAssets();
  const image = { width: 1376, height: 768 };
  loadedAssets['scene_background_02.png'] = image;
  const { ctx, log } = makeMockCtx();

  renderBackgroundLayer(ctx, 4);

  assert.ok(log.some((entry) => entry.method === 'drawImage' && entry.args[0] === image));
  assert.equal(log.some((entry) => entry.method === 'bezierCurveTo'), false);
  clearBackgroundAssets();
});

test('background boot gate: world composition skips semantic props during baked-pending', () => {
  const { ctx, log } = makeMockCtx();

  renderWorldCompositionLayer(ctx, {
    bootPolicy: BACKGROUND_BOOT_POLICY.BAKED_PENDING,
    debug: false,
    frame: 0,
  });

  assert.equal(log.some((entry) => entry.method === 'fillRect'), false);
  assert.equal(log.some((entry) => entry.method === 'fillText'), false);
});

test('background boot gate: render boot trace reports selected path', () => {
  clearBackgroundAssets();
  const { ctx } = makeMockCtx();
  const logs = [];
  const previousLog = console.log;
  console.log = (...args) => logs.push(args);

  try {
    withWindow({ __SLOTHWORLD_TRACE_RENDER_BOOT__: true }, () => renderBackgroundLayer(ctx, 5));
  } finally {
    console.log = previousLog;
  }

  const payload = logs.find((entry) => entry[0] === '[Slothworld render boot trace]')?.[1];
  assert.equal(payload?.path, 'baked-pending-blank');
});

test('background boot gate: UI overlay is suppressed during baked-pending blank background', () => {
  clearBackgroundAssets();
  const { ctx, log } = makeMockCtx();

  renderUIOverlayLayer(ctx, makePanelComponents(), new Map(), {
    bootPolicy: BACKGROUND_BOOT_POLICY.BAKED_PENDING,
    debug: false,
  });

  assert.equal(log.some((entry) => entry.method === 'fillText'), false);
  assert.equal(log.some((entry) => entry.method === 'fillRect'), false);
});

test('background boot gate: UI overlay can be explicitly allowed during baked-pending', () => {
  clearBackgroundAssets();
  const { ctx, log } = makeMockCtx();
  const previousNow = Date.now;
  let now = 1000;
  Date.now = () => now;

  try {
    renderUIOverlayLayer(ctx, makePanelComponents(), new Map(), {
      bootPolicy: BACKGROUND_BOOT_POLICY.BAKED_PENDING,
      debug: false,
      allowOverlayDuringBakedPending: true,
    });
    now = 1300;
    renderUIOverlayLayer(ctx, makePanelComponents(), new Map(), {
      bootPolicy: BACKGROUND_BOOT_POLICY.BAKED_PENDING,
      debug: false,
      allowOverlayDuringBakedPending: true,
    });
  } finally {
    Date.now = previousNow;
  }

  assert.ok(log.some((entry) => entry.method === 'fillText'));
});
