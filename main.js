// =============================================================================
// main.js — Thin orchestrator.
// =============================================================================

import { startBridgePolling } from './core/task-handling.js';
import { initRenderer, renderFrame, renderErrorState } from './rendering/renderer-loop.js';
import { deriveWorldState } from './core/world/deriveWorldState.js';
import { appendRawEvents, getRawEvents } from './core/world/eventStore.js';
import { createInitialEventSeed } from './core/world/initialEventSeed.js';
import { initUI } from './ui/ui-bootstrap.js';
import { exposeWindowAPI } from './ui/window-api.js';
import { buildVisualWorldGraph } from './core/world/buildVisualWorldGraph.js';
import { getAllAgents }          from './ui/selectors/agentSelectors.js';
import { getAllTasks, getTaskIds, getTaskTransitionTimestamps } from './ui/selectors/taskSelectors.js';
import { buildWorkstationStatusSnapshots } from './ui/selectors/workstationStatusSelectors.js';

let safeTaskProjectionCache = [];
let safeTaskProjectionRefreshStartedAt = 0;
const SAFE_TASK_PROJECTION_REFRESH_MS = 1000;

async function refreshSafeTaskProjection() {
  try {
    const response = await fetch('/tasks');
    if (!response.ok) return;
    const body = await response.json();
    const tasks = Array.isArray(body?.tasks) ? body.tasks : (Array.isArray(body) ? body : []);
    safeTaskProjectionCache = tasks.filter((task) => task && typeof task === 'object');
  } catch {
    // Event-derived snapshots remain the fallback when the bridge is unavailable.
  }
}

function scheduleSafeTaskProjectionRefresh(now) {
  if (!Number.isFinite(now)) return;
  if (now - safeTaskProjectionRefreshStartedAt < SAFE_TASK_PROJECTION_REFRESH_MS) return;
  safeTaskProjectionRefreshStartedAt = now;
  void refreshSafeTaskProjection();
}

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
    try {
      const worldState  = deriveWorldState(getRawEvents());
      const tasks       = getAllTasks(worldState);
      const agents      = getAllAgents(worldState);
      scheduleSafeTaskProjectionRefresh(Date.now());
      const workstationTasks = safeTaskProjectionCache.length > 0 ? safeTaskProjectionCache : tasks;
      const workstationSnapshots = buildWorkstationStatusSnapshots({ tasks: workstationTasks, agents });
      const transitions = Object.fromEntries(
        getTaskIds(worldState).map((id) => [id, getTaskTransitionTimestamps(worldState, id)])
      );
      const graph       = buildVisualWorldGraph(
        { tasks, agents, transitions },
        { now: Date.now(), workstationSnapshots }
      );
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
    } catch (err) {
      console.error('[loop] Render error:', err);
      renderErrorState();
    }
    requestAnimationFrame(loop);
  }

  loop();
  startBridgePolling();
}

start();
