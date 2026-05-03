import { canvas, ctx, agents } from '../core/app-state.js';
import { buildWorldScene } from './world-scene.js';
import { toRenderableComponents } from './world-scene-adapter.js';
import { renderAllLayers } from './world-scene-layer-renderer.js';
import { assertGraphShape, assertEventDriven } from './render-guards.js';
import { drawTrendResultCard } from './overlays.js';

let _frame = 0;

export function initRenderer() {
  // Reserved for future renderer bootstrapping.
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
  for (const agent of agents) {
    drawTrendResultCard(ctx, agent);
  }
  _frame += 1;
}
