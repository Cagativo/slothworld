import { update } from './agent-logic.js';
import { addTaskToDesk } from './task-handling.js';

export function initSimulation() {
  // Dev-only seed tasks — disabled by default; enable with window.DEV_MODE = true
  if (window.DEV_MODE) {
    addTaskToDesk({ id: 'discord-1', type: 'discord', title: 'Moderate alerts', required: 140, progress: 0, status: 'pending' });
    addTaskToDesk({ id: 'shopify-1', type: 'shopify', title: 'Sync order tags', required: 180, progress: 0, status: 'pending' });
    addTaskToDesk({ id: 'discord-2', type: 'discord', title: 'Ticket triage', required: 120, progress: 0, status: 'pending' });
  }
}

export function updateSimulation() {
  update();
}
