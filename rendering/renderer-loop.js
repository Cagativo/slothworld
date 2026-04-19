import { canvas, ctx } from '../core/app-state.js';
import { buildWorldScene } from './world-scene.js';
import { toRenderableComponents } from './world-scene-adapter.js';
import { renderAllLayers } from './world-scene-layer-renderer.js';

let _frame = 0;

export function initRenderer() {
  // Reserved for future renderer bootstrapping.
}

export function renderFrame(renderView) {
  const scene      = buildWorldScene(renderView);
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
  _frame += 1;
}
