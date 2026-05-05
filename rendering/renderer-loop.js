import { canvas, ctx, agents } from '../core/app-state.js';
import { buildWorldScene } from './world-scene.js';
import { toRenderableComponents } from './world-scene-adapter.js';
import { renderAllLayers } from './world-scene-layer-renderer.js';
import { assertGraphShape, assertEventDriven } from './render-guards.js';
import { buildEntityPositionMap } from './zone-renderer.js';
import {
  canvasInspectionState,
  updateInspectionHover,
  updateInspectionSelection,
  refreshInspectionSelection,
  resolveInspectionTarget,
} from './canvas-inspection-state.js';
import { renderInspectionPopover } from './inspection-popover-renderer.js';
import { isRenderDebugEnabled } from './debug.js';

let _frame = 0;
let _inspectionBindingsAttached = false;
let _latestComponents = [];
let _latestEntityPositions = new Map();

function eventToCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

export function initRenderer() {
  if (_inspectionBindingsAttached || !canvas) {
    return;
  }

  canvas.addEventListener('mousemove', (event) => {
    const point = eventToCanvasPoint(event);
    const hitTestOptions = { debug: isRenderDebugEnabled() };
    const hit = updateInspectionHover(
      canvasInspectionState,
      _latestComponents,
      point,
      _latestEntityPositions,
      hitTestOptions
    );
    canvas.style.cursor = hit ? 'pointer' : 'default';
  });

  canvas.addEventListener('mouseleave', () => {
    updateInspectionHover(
      canvasInspectionState,
      _latestComponents,
      null,
      _latestEntityPositions,
      { debug: isRenderDebugEnabled() }
    );
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('click', (event) => {
    const point = eventToCanvasPoint(event);
    updateInspectionSelection(
      canvasInspectionState,
      _latestComponents,
      point,
      _latestEntityPositions,
      { debug: isRenderDebugEnabled() }
    );
  });

  _inspectionBindingsAttached = true;
}

export function renderErrorState() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'red';
  ctx.font = 'bold 16px monospace';
  ctx.fillText('Render error \u2014 check console', 20, canvas.height / 2);
}

export function renderFrame(renderView) {
  assertGraphShape(renderView);
  const scene      = buildWorldScene(renderView);
  assertEventDriven(scene);
  const components = toRenderableComponents(scene);
  const entityPositions = buildEntityPositionMap(components);
  _latestComponents = components;
  _latestEntityPositions = entityPositions;
  const hitTestOptions = { debug: isRenderDebugEnabled() };
  refreshInspectionSelection(canvasInspectionState, components, entityPositions, hitTestOptions);

  if (canvasInspectionState.pointer.inside) {
    updateInspectionHover(
      canvasInspectionState,
      components,
      canvasInspectionState.pointer,
      entityPositions,
      hitTestOptions
    );
  }

  // Targeted debug — logs once per second (~60 frames) when DEV_MODE is on
  if (window.DEV_MODE && _frame % 60 === 0) {
    const byType = {};
    for (const c of components) { byType[c.componentType] = (byType[c.componentType] || 0) + 1; }
    console.log('[WorldScene] frame:', _frame,
      '| zones:', scene.zones.length,
      '| entities:', scene.entities.length,
      '| connections:', scene.connections.length);
    console.log('[WorldScene] components:', byType);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderAllLayers(ctx, components, _frame);
  renderInspectionPopover(ctx, resolveInspectionTarget(canvasInspectionState), {
    debug: isRenderDebugEnabled(),
  });
  _frame += 1;
}
