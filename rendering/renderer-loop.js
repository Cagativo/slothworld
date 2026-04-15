import { render } from './canvas-renderer.js';

export function initRenderer() {
  // Reserved for future renderer bootstrapping.
}

export function renderFrame(worldState) {
  render(worldState);
}
