import { randomInRange } from './utils.js';
import { spriteConfigs } from './constants.js';

// --- Canvas setup (rendering surface only; not a world-state source of truth) ---
export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');
canvas.width = 800;
canvas.height = 600;

// --- Shared mutable collections ---
export const eventStream = [];
export const commandHistory = [];
export const workflows = new Map();
export const agentStateTracker = new Map();

// --- Event emitter ---
export function emitEvent(type, payload) {
  const event = {
    type,
    timestamp: Date.now(),
    payload: payload || {}
  };

  eventStream.push(event);
  if (eventStream.length > 2000) {
    eventStream.shift();
  }

  return event;
}

// --- Desk helpers ---
export function isDeskAvailableForAgent(desk, agent) {
  return !desk.occupied || desk.occupant === agent;
}

export function getDeskLoadScore(desk) {
  return desk.queue.length + (desk.currentTask ? 1 : 0);
}

export function getDeskSlotPosition(desk, slotName) {
  const slot = desk.slots[slotName];
  return {
    x: desk.x + slot.offsetX,
    y: desk.y + slot.offsetY
  };
}

function toCenterPosition(topLeftX, topLeftY, config) {
  return {
    x: topLeftX + config.width / 2,
    y: topLeftY + config.height / 2
  };
}

function createDesk(x, y) {
  return {
    x,
    y,
    type: 'desk',
    occupied: false,
    slots: {
      seat: { offsetX: 0, offsetY: 40 },
      computer: { offsetX: 0, offsetY: -20 }
    },
    occupant: null,
    queue: [],
    currentTask: null,
    paused: false,
    completedTasks: 0,
    failedTasks: 0,
    lastFailedTask: null,
    computer: {
      offsetX: 0,
      offsetY: -20
    }
  };
}

function createDeskFromTopLeft(topLeftX, topLeftY) {
  const centerPosition = toCenterPosition(topLeftX, topLeftY, spriteConfigs.desk);
  return createDesk(centerPosition.x, centerPosition.y);
}

// --- Agent factory ---
function createRandomAgent() {
  return {
    x: randomInRange(0, canvas.width),
    y: randomInRange(0, canvas.height),
    targetX: null,
    targetY: null,
    targetDesk: null,
    targetSlot: null,
    role: 'other',
    direction: 'down',
    animationFrame: 0,
    animationTimer: 0,
    stateTimer: 0,
    wanderTimer: 0,
    targetRetryTimer: 0,
    productivity: randomInRange(0.6, 1.3),
    skills: {
      discord: 1,
      shopify: 1
    },
    state: 'idle',
    speed: randomInRange(0.8, 2.2)
  };
}

// --- Initial agents ---
const roles = ['researcher', 'executor', 'other', 'other'];
export const agents = roles.map((role, index) => {
  const agent = createRandomAgent();
  agent.id = index;
  agent.role = role;

  if (role === 'researcher') {
    agent.skills.discord = 1.5;
    agent.skills.shopify = 0.9;
  } else if (role === 'executor') {
    agent.skills.discord = 0.9;
    agent.skills.shopify = 1.5;
  }

  return agent;
});

// --- Initial desks ---
export const desks = [
  createDeskFromTopLeft(160, 150),
  createDeskFromTopLeft(300, 150),
  createDeskFromTopLeft(440, 150),
  createDeskFromTopLeft(160, 300),
  createDeskFromTopLeft(300, 300),
  createDeskFromTopLeft(440, 300)
];
