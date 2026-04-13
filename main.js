// =============================================================================
// main.js — Thin orchestrator.
// All logic lives in core/, rendering/, and ui/. This file wires everything
// together, exposes the window debug API (identical surface to the original),
// and starts the game loop + bridge polling.
// =============================================================================

import { agents, desks, workflows, commandHistory, eventStream } from './core/app-state.js';
import { addTaskToDesk, ingestTask, startBridgePolling } from './core/task-handling.js';
import { createWorkflow, getWorkflow, listWorkflows } from './core/workflow.js';
import { update } from './core/agent-logic.js';
import { render } from './rendering/canvas-renderer.js';
import { controlAPI, dispatchCommand, inspectAgent, inspectDesk, inspectWorkflow } from './ui/control-api.js';
import { bindKeyboard } from './ui/keyboard-input.js';

// DEV_MODE flag — set before any module reads it via window.DEV_MODE
window.DEV_MODE = false;

// Preserve the original window debug API surface exactly
window.addTaskToDesk  = addTaskToDesk;
window.ingestTask     = ingestTask;
window.createWorkflow = createWorkflow;
window.workflows      = workflows;
window.getWorkflow    = getWorkflow;
window.listWorkflows  = listWorkflows;
window.inspectAgent   = inspectAgent;
window.inspectDesk    = inspectDesk;
window.inspectWorkflow = inspectWorkflow;
window.controlAPI     = controlAPI;
window.dispatchCommand = dispatchCommand;
window.commandHistory = commandHistory;
window.eventStream    = eventStream;

// Dev-only seed tasks — disabled by default; enable with window.DEV_MODE = true
if (window.DEV_MODE) {
  addTaskToDesk({ id: 'discord-1', type: 'discord', title: 'Moderate alerts',  required: 140, progress: 0, status: 'pending' });
  addTaskToDesk({ id: 'shopify-1', type: 'shopify', title: 'Sync order tags',   required: 180, progress: 0, status: 'pending' });
  addTaskToDesk({ id: 'discord-2', type: 'discord', title: 'Ticket triage',     required: 120, progress: 0, status: 'pending' });
}

bindKeyboard();

// --- Game loop ---
function loop() {
  update();
  render();
  requestAnimationFrame(loop);
}

loop();
startBridgePolling();
