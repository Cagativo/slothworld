// =============================================================================
// main.js — Thin orchestrator.
// =============================================================================

import { startBridgePolling } from './core/task-handling.js';
import { initSimulation, updateSimulation } from './core/simulation-runner.js';
import { startRenderWorkers } from './integrations/rendering/render-queue.js';
import { initRenderer, renderFrame } from './rendering/renderer-loop.js';
import { initUI } from './ui/ui-bootstrap.js';
import { exposeWindowAPI } from './ui/window-api.js';

function start() {
  // DEV_MODE flag — set before runtime modules use window.DEV_MODE.
  window.DEV_MODE = false;
  window.__DEBUG_MODE__ = false;

  exposeWindowAPI();
  initSimulation();
  initRenderer();
  initUI();
  startRenderWorkers({ workerCount: 2 });

  function loop() {
    updateSimulation();
    renderFrame();
    requestAnimationFrame(loop);
  }

  loop();
  startBridgePolling();
}

start();
