// =============================================================================
// main.js — Thin orchestrator.
// =============================================================================

import { startBridgePolling } from './core/task-handling.js';
import { initRenderer, renderFrame } from './rendering/renderer-loop.js';
import { deriveWorldState } from './core/world/deriveWorldState.js';
import { appendRawEvents, getRawEvents } from './core/world/eventStore.js';
import { createInitialEventSeed } from './core/world/initialEventSeed.js';
import { initUI } from './ui/ui-bootstrap.js';
import { exposeWindowAPI } from './ui/window-api.js';
import { buildVisualWorldGraph } from './core/world/buildVisualWorldGraph.js';

function start() {
  // DEV_MODE flag — set before runtime modules use window.DEV_MODE.
  window.DEV_MODE = false;
  window.__DEBUG_MODE__ = false;

  if (getRawEvents().length === 0) {
    appendRawEvents(createInitialEventSeed());
  }

  exposeWindowAPI();
  initRenderer();
  initUI();

  function loop() {
    const worldState = deriveWorldState(getRawEvents());
    const graph = buildVisualWorldGraph(worldState, { now: Date.now() });
    if (window.controlAPI && typeof window.controlAPI.setGraph === 'function') {
      window.controlAPI.setGraph(graph);
    }
    const renderView = {
      nodes:    graph.nodes,
      edges:    graph.edges,
      metadata: { ...graph.metadata, observability: graph.observability },
    };
    renderFrame(renderView);
    window.dispatchEvent(new CustomEvent('slothworld:graph'));
    requestAnimationFrame(loop);
  }

  loop();
  startBridgePolling();
}

start();
