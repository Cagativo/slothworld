import {
  TARGET_RETRY_DELAY,
  IDLE_WANDER_REASSIGN_DELAY,
  WANDER_TARGET_INTERVAL,
  TASK_TYPE_DISCORD,
  TASK_TYPE_SHOPIFY,
  TASK_TYPE_IMAGE_RENDER,
  TASK_STATUS_FAILED,
  TASK_STATUS_AWAITING_ACK,
  AGENT_STATE_IDLE,
  AGENT_STATE_MOVING,
  AGENT_STATE_SITTING,
  AGENT_STATE_WORKING,
  TASK_PROGRESS_ACK_THRESHOLD
} from './constants.js';
import { canvas, agents, desks, agentStateTracker, emitEvent, eventStream, isDeskAvailableForAgent, getDeskSlotPosition } from './app-state.js';
import { syncTaskStart, handleTaskExecutionResult } from './task-handling.js';

const SPEECH_DURATION_MS = 7000;

/**
 * @typedef {Object} IdleCycle
 * @description Idle behaviour control block initialised and maintained by `ensureIdleStateFields`.
 * @property {number} timer - Countdown frames remaining before the next idle action triggers.
 * @property {boolean} walking - True while the agent is on a roam walk.
 * @property {{x: number, y: number}|null} walkTarget - Destination of the current roam walk, or null.
 * @property {boolean} returning - True while the agent is walking back toward the idle anchor.
 * @property {number} pauseTimer - Pause frames remaining before starting the next idle action.
 */

/**
 * @typedef {Object} CoffeeAnim
 * @description Coffee-sipping animation state block.
 * @property {number} frame - Current animation frame index (0–2).
 * @property {number} timer - Simulation tick counter controlling frame advancement.
 * @property {number} speed - Seconds per animation frame step.
 * @property {'idle'|'sipping'|'returning'} phase - Current animation phase.
 */

/**
 * @typedef {Object} Agent
 * @description Runtime agent object; the central entity driven by the simulation {@link update} loop.
 * @property {number} id - Unique agent index assigned at initialisation.
 * @property {number} x - Current canvas X position (centre of sprite).
 * @property {number} y - Current canvas Y position (centre of sprite).
 * @property {number|null} targetX - Destination X, or null when stationary.
 * @property {number|null} targetY - Destination Y, or null when stationary.
 * @property {import('./task-handling.js').Desk|null} targetDesk - Desk the agent is assigned to, or null.
 * @property {Object|null} targetSlot - Desk slot object the agent is moving toward, or null.
 * @property {string} role - Agent role: `'researcher'`, `'executor'`, or `'other'`.
 * @property {'up'|'down'|'left'|'right'} direction - Facing direction used for sprite selection.
 * @property {number} animationFrame - Current sprite animation frame index.
 * @property {number} animationTimer - Tick counter controlling animation frame advancement.
 * @property {number} stateTimer - Ticks spent in the current state.
 * @property {number} wanderTimer - Countdown before picking a new wander target.
 * @property {number} targetRetryTimer - Countdown before retrying desk assignment.
 * @property {number} productivity - Work increment added per tick (range 0.6–1.3).
 * @property {{ discord: number, shopify: number }} skills - Per-task-type productivity multipliers.
 * @property {string} state - Simulation state-machine state (AGENT_STATE_* or `'waiting'` / `'complete_react'`).
 * @property {string} visualState - Rendering state (may differ from `state` during transitions).
 * @property {number} speed - Movement pixels per simulation tick.
 * @property {number} idleTime - Ticks accumulated in the idle state.
 * @property {{x: number, y: number}|null} idleAnchor - Return anchor for roam walks, or null.
 * @property {{x: number, y: number}|null} roamTarget - Current roam destination, or null.
 * @property {IdleCycle} idleCycle - Idle behaviour control block.
 * @property {{ text: string, duration: number, timer: number }|null} speech - Active speech bubble, or null.
 * @property {string|null} lastSpeechText - Text of the most recent speech bubble, or null.
 * @property {string|null} lastProgressPhase - Last emitted progress phase (`'starting'`, `'working'`, or `'finishing'`), or null.
 * @property {string|null} lastTaskStatus - Last observed task status string, or null.
 * @property {number} lastSpeechTime - Unix timestamp (ms) of the last speech emission.
 * @property {CoffeeAnim} coffeeAnim - Coffee-sipping animation state.
 * @property {number} completeReactTimer - Remaining milliseconds for the task-completion reaction animation.
 * @property {boolean} awaitingTaskCompletion - True while the agent is waiting for an ACK after execution.
 * @property {import('./task-handling.js').Task|null} currentTask - Task currently being worked on, or null.
 * @property {string|null} currentTaskId - ID of the current task, or null.
 */

const FRAME_RATE = 60;
const FRAME_TIME_MS = 1000 / FRAME_RATE;
const COMPLETE_REACT_DURATION_MS = 1200;
const IDLE_WAIT_MIN_FRAMES = 5 * FRAME_RATE;
const IDLE_WAIT_MAX_FRAMES = 10 * FRAME_RATE;
const IDLE_COOLDOWN_MIN_FRAMES = 5 * FRAME_RATE;
const IDLE_COOLDOWN_MAX_FRAMES = 10 * FRAME_RATE;
const ROAM_PAUSE_MIN_FRAMES = 40;
const ROAM_PAUSE_MAX_FRAMES = 90;
const ROAM_PADDING = 26;
const ROAM_TARGET_MIN_DISTANCE = 58;
let completionEventCursor = 0;
const completionStatusByTaskId = new Map();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomIdleWaitFrames() {
  return randomInt(IDLE_WAIT_MIN_FRAMES, IDLE_WAIT_MAX_FRAMES);
}

function randomIdleCooldownFrames() {
  return randomInt(IDLE_COOLDOWN_MIN_FRAMES, IDLE_COOLDOWN_MAX_FRAMES);
}

function randomRoamPauseFrames() {
  return randomInt(ROAM_PAUSE_MIN_FRAMES, ROAM_PAUSE_MAX_FRAMES);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ensureIdleStateFields(agent) {
  if (typeof agent.idleTime !== 'number') {
    agent.idleTime = 0;
  }

  if (!agent.idleAnchor || typeof agent.idleAnchor.x !== 'number' || typeof agent.idleAnchor.y !== 'number') {
    agent.idleAnchor = null;
  }

  if (!agent.roamTarget || typeof agent.roamTarget.x !== 'number' || typeof agent.roamTarget.y !== 'number') {
    agent.roamTarget = null;
  }

  if (!agent.idleCycle || typeof agent.idleCycle !== 'object') {
    agent.idleCycle = {
      timer: randomIdleWaitFrames(),
      walking: false,
      walkTarget: null,
      returning: false,
      pauseTimer: 0
    };
  } else {
    if (typeof agent.idleCycle.timer !== 'number') {
      agent.idleCycle.timer = randomIdleWaitFrames();
    }

    if (typeof agent.idleCycle.walking !== 'boolean') {
      agent.idleCycle.walking = false;
    }

    if (typeof agent.idleCycle.returning !== 'boolean') {
      agent.idleCycle.returning = false;
    }

    if (typeof agent.idleCycle.pauseTimer !== 'number') {
      agent.idleCycle.pauseTimer = 0;
    }

    if (!agent.idleCycle.walkTarget || typeof agent.idleCycle.walkTarget.x !== 'number' || typeof agent.idleCycle.walkTarget.y !== 'number') {
      agent.idleCycle.walkTarget = null;
    }
  }

  if (!agent.speech || typeof agent.speech !== 'object') {
    agent.speech = null;
  } else {
    if (typeof agent.speech.text !== 'string') {
      agent.speech.text = '';
    }

    if (typeof agent.speech.timer !== 'number') {
      agent.speech.timer = 0;
    }

    if (typeof agent.speech.duration !== 'number') {
      agent.speech.duration = 2000;
    }
  }

  if (agent.visualState !== AGENT_STATE_IDLE && agent.visualState !== AGENT_STATE_WORKING && agent.visualState !== 'waiting' && agent.visualState !== 'complete_react') {
    agent.visualState = AGENT_STATE_IDLE;
  }

  if (typeof agent.completeReactTimer !== 'number') {
    agent.completeReactTimer = 0;
  }

  if (typeof agent.awaitingTaskCompletion !== 'boolean') {
    agent.awaitingTaskCompletion = false;
  }

  if (agent.currentTask !== null && typeof agent.currentTask !== 'object') {
    agent.currentTask = null;
  }

  if (agent.currentTaskId !== null && typeof agent.currentTaskId !== 'string') {
    agent.currentTaskId = null;
  }

  if (agent.lastSpeechText !== null && typeof agent.lastSpeechText !== 'string') {
    agent.lastSpeechText = null;
  }

  if (agent.lastProgressPhase !== null && typeof agent.lastProgressPhase !== 'string') {
    agent.lastProgressPhase = null;
  }

  if (agent.lastTaskStatus !== null && typeof agent.lastTaskStatus !== 'string') {
    agent.lastTaskStatus = null;
  }

  if (typeof agent.lastSpeechTime !== 'number') {
    agent.lastSpeechTime = 0;
  }

  if (!agent.coffeeAnim || typeof agent.coffeeAnim !== 'object') {
    agent.coffeeAnim = {
      frame: 0,
      timer: 0,
      speed: 0.25,
      phase: 'idle'
    };
  } else {
    if (typeof agent.coffeeAnim.frame !== 'number') {
      agent.coffeeAnim.frame = 0;
    }

    if (typeof agent.coffeeAnim.timer !== 'number') {
      agent.coffeeAnim.timer = 0;
    }

    if (typeof agent.coffeeAnim.speed !== 'number' || agent.coffeeAnim.speed <= 0) {
      agent.coffeeAnim.speed = 0.25;
    }

    if (agent.coffeeAnim.phase !== 'idle' && agent.coffeeAnim.phase !== 'sipping' && agent.coffeeAnim.phase !== 'returning') {
      agent.coffeeAnim.phase = 'idle';
    }
  }
}

function setAgentSpeech(agent, text, duration = SPEECH_DURATION_MS, { force = false } = {}) {
  if (!agent) {
    return;
  }

  const normalized = String(text || '');
  if (!force && normalized === agent.lastSpeechText) {
    return;
  }

  agent.speech = {
    text: normalized,
    duration,
    timer: duration
  };
  agent.lastSpeechText = normalized;
  agent.lastSpeechTime = Date.now();
}

function canSpeak(agent, now = Date.now()) {
  if (!agent) {
    return false;
  }

  return (now - (agent.lastSpeechTime || 0)) > SPEECH_DURATION_MS;
}

function pickSpeechLine(lines, fallback) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return fallback;
  }

  const index = Math.floor(Math.random() * lines.length);
  return lines[index] || fallback;
}

function getWorkingSpeechText(task) {
  if (!task) {
    return 'Working...';
  }

  const hasProgress = typeof task.progress === 'number' && typeof task.required === 'number' && task.required > 0;
  if (hasProgress) {
    const ratio = clamp(task.progress / task.required, 0, 1);
    if (ratio < 0.3) {
      return 'Starting...';
    }

    if (ratio < 0.8) {
      return 'Working...';
    }

    return 'Finishing...';
  }

  if (task.type === TASK_TYPE_IMAGE_RENDER) {
    return 'Generating image...';
  }

  if (task.type === TASK_TYPE_DISCORD) {
    return 'Replying...';
  }

  if (task.type === TASK_TYPE_SHOPIFY) {
    return 'Processing order...';
  }

  return 'Working...';
}

function beginCompletionReaction(agent, text = 'Done!') {
  agent.awaitingTaskCompletion = false;
  agent.completeReactTimer = COMPLETE_REACT_DURATION_MS;
  agent.visualState = 'complete_react';
  agent.state = 'complete_react';
  agent.stateTimer = 0;
  agent.animationFrame = 0;
  agent.animationTimer = 0;
  setAgentSpeech(agent, text, SPEECH_DURATION_MS, { force: true });
}

function syncCompletionStatuses() {
  while (completionEventCursor < eventStream.length) {
    const event = eventStream[completionEventCursor];
    completionEventCursor += 1;

    if (!event || event.type !== 'TASK_ACKED' || !event.payload || !event.payload.taskId) {
      continue;
    }

    completionStatusByTaskId.set(String(event.payload.taskId), event.payload.success === false ? TASK_STATUS_FAILED : 'done');
  }
}

function syncAgentTaskStatus(agent) {
  if (!agent || !agent.currentTask || !agent.currentTask.id) {
    return;
  }

  const syncedStatus = completionStatusByTaskId.get(String(agent.currentTask.id));
  if (syncedStatus && getTaskStatus(agent.currentTask) !== syncedStatus) {
    agent.currentTask.localLifecycleStatus = syncedStatus;
  }
}

function shouldLogAgentStatus(agent, now) {
  if (!agent) {
    return false;
  }

  const isActive = !!agent.currentTask || agent.visualState !== AGENT_STATE_IDLE;
  if (!isActive) {
    return false;
  }

  if (typeof agent.lastStatusLogTime !== 'number') {
    agent.lastStatusLogTime = 0;
  }

  if (now - agent.lastStatusLogTime < 1000) {
    return false;
  }

  agent.lastStatusLogTime = now;
  return true;
}

function tickSpeech(agent) {
  if (!agent || !agent.speech || agent.speech.timer <= 0) {
    return;
  }

  agent.speech.timer = Math.max(0, agent.speech.timer - FRAME_TIME_MS);
  if (agent.speech.timer <= 0) {
    agent.speech = null;
    agent.lastSpeechText = null;
  }
}

function getTaskStatus(task) {
  if (!task) {
    return 'in_progress';
  }

  if (typeof task.localLifecycleStatus === 'string') {
    return task.localLifecycleStatus;
  }

  if (typeof task.runtimeStatus === 'string') {
    return task.runtimeStatus;
  }

  if (typeof task.status !== 'string') {
    return 'in_progress';
  }

  return task.status;
}

function deriveTaskProgressRatio(task) {
  if (!task) {
    return 0;
  }

  const status = getTaskStatus(task);
  const rawRatio = typeof task.progress === 'number' && typeof task.required === 'number' && task.required > 0
    ? clamp(task.progress / task.required, 0, 1)
    : 0;

  if (status === 'done' || status === TASK_STATUS_FAILED) {
    return 1;
  }

  if (status === TASK_STATUS_AWAITING_ACK) {
    return TASK_PROGRESS_ACK_THRESHOLD;
  }

  return Math.min(0.9, rawRatio);
}

function getProgressPhaseFromRatio(ratio) {
  if (ratio < 0.3) {
    return 'starting';
  }

  if (ratio < 0.8) {
    return 'working';
  }

  return 'finishing';
}

function getPhaseSpeech(phase) {
  if (phase === 'starting') {
    return 'Starting...';
  }

  if (phase === 'working') {
    return 'Working...';
  }

  return 'Finishing...';
}

function syncAgentTaskSpeech(agent, task) {
  const status = getTaskStatus(task);
  if (status !== agent.lastTaskStatus) {
    agent.lastTaskStatus = status;
  }

  if (status === 'done' || status === TASK_STATUS_FAILED) {
    return;
  }

  if (status === TASK_STATUS_AWAITING_ACK) {
    agent.lastProgressPhase = 'finishing';
    return;
  }

  const ratio = deriveTaskProgressRatio(task);
  const phase = ratio < 0.3 ? 'starting' : 'working';
  if (phase !== agent.lastProgressPhase) {
    agent.lastProgressPhase = phase;
    setAgentSpeech(agent, getPhaseSpeech(phase), SPEECH_DURATION_MS);
  }
}

function resetIdleBehavior(agent) {
  ensureIdleStateFields(agent);
  agent.idleTime = 0;
  agent.idleCycle.timer = randomIdleWaitFrames();
  agent.idleCycle.walking = false;
  agent.idleCycle.walkTarget = null;
  agent.idleCycle.returning = false;
  agent.idleCycle.pauseTimer = 0;
  agent.roamTarget = null;
  agent.coffeeAnim.frame = 0;
  agent.coffeeAnim.timer = 0;
  agent.coffeeAnim.phase = 'idle';
}

function updateCoffeeAnimation(agent) {
  if (!agent.coffeeAnim) {
    return;
  }

  if (agent.coffeeAnim.phase !== 'sipping' && agent.coffeeAnim.phase !== 'returning') {
    return;
  }

  const secondsPerFrame = agent.coffeeAnim.speed;
  const framesPerStep = Math.max(1, Math.round(secondsPerFrame * FRAME_RATE));
  agent.coffeeAnim.timer += 1;

  if (agent.coffeeAnim.timer < framesPerStep) {
    return;
  }

  agent.coffeeAnim.timer = 0;

  if (agent.coffeeAnim.phase === 'sipping') {
    if (agent.coffeeAnim.frame < 2) {
      agent.coffeeAnim.frame += 1;
      return;
    }

    agent.coffeeAnim.phase = 'returning';
    return;
  }

  if (agent.coffeeAnim.frame > 0) {
    agent.coffeeAnim.frame -= 1;
    return;
  }

  agent.coffeeAnim.phase = 'idle';
  agent.idleCycle.timer = randomIdleCooldownFrames();
}

function startCoffeeSequence(agent) {
  agent.coffeeAnim.phase = 'sipping';
  agent.coffeeAnim.frame = 0;
  agent.coffeeAnim.timer = 0;
}

function ensureIdleAnchor(agent) {
  if (agent.idleAnchor) {
    return;
  }

  const nearestDesk = findNearestAvailableDesk(agent, { requireTasks: false });
  if (!nearestDesk) {
    return;
  }

  const seatPosition = getDeskSlotPosition(nearestDesk, 'seat');
  agent.idleAnchor = {
    x: seatPosition.x,
    y: seatPosition.y
  }
}

function pickGlobalRoamTarget(agent) {
  const minX = ROAM_PADDING;
  const maxX = canvas.width - ROAM_PADDING;
  const minY = ROAM_PADDING;
  const maxY = canvas.height - ROAM_PADDING;

  let bestTarget = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = {
      x: randomInt(minX, maxX),
      y: randomInt(minY, maxY)
    };

    const selfDistance = Math.hypot(candidate.x - agent.x, candidate.y - agent.y);
    if (selfDistance < ROAM_TARGET_MIN_DISTANCE) {
      continue;
    }

    let nearestOther = Number.POSITIVE_INFINITY;
    for (const other of agents) {
      if (other === agent) {
        continue;
      }

      const ox = other.roamTarget ? other.roamTarget.x : other.x;
      const oy = other.roamTarget ? other.roamTarget.y : other.y;
      nearestOther = Math.min(nearestOther, Math.hypot(candidate.x - ox, candidate.y - oy));
    }

    if (nearestOther > bestScore) {
      bestScore = nearestOther;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}

function startIdleRoam(agent) {
  const roamTarget = pickGlobalRoamTarget(agent);
  if (!roamTarget) {
    return false;
  }

  agent.idleCycle.walking = true;
  agent.idleCycle.returning = false;
  agent.idleCycle.pauseTimer = 0;
  agent.idleCycle.walkTarget = {
    x: roamTarget.x,
    y: roamTarget.y
  };
  agent.idleCycle.timer = 0;
  agent.roamTarget = {
    x: roamTarget.x,
    y: roamTarget.y
  };
  agent.targetDesk = null;
  agent.targetSlot = null;
  agent.targetX = roamTarget.x;
  agent.targetY = roamTarget.y;
  agent.state = AGENT_STATE_MOVING;
  agent.stateTimer = 0;
  agent.animationTimer = 0;

  return true;
}

/**
 * @description Returns true if any desk currently has a queued or active task.
 * @returns {boolean} True when at least one desk has work available; false when all desks are idle.
 */
export function hasAnyDeskTasks() {
  return desks.some((desk) => desk.currentTask || desk.queue.length > 0);
}

/**
 * @description Releases a desk's occupancy if the given agent is the current occupant.
 * @param {import('./task-handling.js').Desk} desk - The desk to release.
 * @param {Agent} agent - The agent relinquishing the desk.
 * @returns {void}
 */
export function releaseDesk(desk, agent) {
  if (desk.occupant === agent) {
    desk.occupied = false;
    desk.occupant = null;
  }
}

/**
 * @description Clears an agent's movement target and optionally releases desk occupancy, updating the idle anchor to the desk's seat position.
 * @param {Agent} agent - The agent whose target should be cleared.
 * @param {{ releaseDesk?: boolean }} [options={}] - Options object; set `releaseDesk: false` to keep desk occupancy.
 * @returns {void}
 */
export function clearAgentTarget(agent, { releaseDesk: shouldReleaseDesk = true } = {}) {
  if (agent.targetDesk) {
    const seatPosition = getDeskSlotPosition(agent.targetDesk, 'seat');
    agent.idleAnchor = {
      x: seatPosition.x,
      y: seatPosition.y
    };
  }

  if (shouldReleaseDesk && agent.targetDesk && agent.targetDesk.occupant === agent) {
    releaseDesk(agent.targetDesk, agent);
  }

  agent.targetDesk = null;
  agent.targetSlot = null;
  agent.targetX = null;
  agent.targetY = null;
}

/**
 * @description Clears an agent's target, resets movement timers, and schedules a retry after TARGET_RETRY_DELAY frames.
 * @param {Agent} agent - The agent for which a target retry should be scheduled.
 * @returns {void}
 */
export function scheduleTargetRetry(agent) {
  clearAgentTarget(agent);
  agent.targetRetryTimer = TARGET_RETRY_DELAY;
  agent.wanderTimer = 0;
  agent.stateTimer = 0;
  agent.animationFrame = 0;
  agent.animationTimer = 0;
  agent.state = AGENT_STATE_IDLE;
}

/**
 * @description Assigns a random canvas position as the agent's wander target, clearing any desk assignment.
 * @param {Agent} agent - The agent to assign a wander target to.
 * @returns {void}
 */
export function setRandomWanderTarget(agent) {
  agent.targetDesk = null;
  agent.targetSlot = null;
  agent.targetX = Math.random() * (canvas.width - 48) + 24;
  agent.targetY = Math.random() * (canvas.height - 48) + 24;
  agent.wanderTimer = WANDER_TARGET_INTERVAL;
}

/**
 * @description Pops the highest-priority task from a desk's queue, sets it as the current task, and emits TASK_STARTED.
 * Does nothing if the desk is paused, already has a current task, or has an empty queue.
 * @param {import('./task-handling.js').Desk} desk - The desk from which to claim the next task.
 * @returns {import('./task-handling.js').Task|null} The newly claimed task, or the existing current task (or null if the queue is empty).
 */
export function claimNextTask(desk) {
  if (desk.paused) {
    return desk.currentTask;
  }

  if (desk.currentTask || desk.queue.length === 0) {
    return desk.currentTask;
  }

  const nextTask = desk.queue.shift();
  nextTask.runtimeStatus = 'processing';
  syncTaskStart(nextTask);
  desk.currentTask = nextTask;
  if (desk.occupant) {
    desk.occupant.currentTask = nextTask;
    desk.occupant.currentTaskId = nextTask.id;
    desk.occupant.awaitingTaskCompletion = false;
    desk.occupant.lastProgressPhase = null;
    desk.occupant.lastTaskStatus = getTaskStatus(nextTask);
    desk.occupant.visualState = AGENT_STATE_WORKING;
    syncAgentTaskSpeech(desk.occupant, nextTask);
  }
  console.log('[TASK][CURRENT]', nextTask.id, {
    hasPayload: !!nextTask.payload,
    channelId: nextTask.payload && nextTask.payload.channelId ? nextTask.payload.channelId : null,
    content: nextTask.payload && typeof nextTask.payload.content === 'string' ? nextTask.payload.content : null
  });
  console.log('[TASK]', 'started', nextTask.type, nextTask.title);
  emitEvent('TASK_STARTED', {
    taskId: nextTask.id,
    taskType: nextTask.type,
    deskIndex: desks.indexOf(desk),
    workflowId: nextTask.workflowId || null
  });

  return nextTask;
}

/**
 * @description Iterates all agents and emits AGENT_STATE_CHANGED for any agent whose state has changed since the last tick.
 * @returns {void}
 */
export function observeAgentStateChanges() {
  for (const agent of agents) {
    const previousState = agentStateTracker.get(agent.id);
    if (previousState !== agent.state) {
      emitEvent('AGENT_STATE_CHANGED', {
        agentId: agent.id,
        previousState: previousState || null,
        state: agent.state
      });
      agentStateTracker.set(agent.id, agent.state);
    }
  }
}

/**
 * @description Finds the nearest desk that is available for the given agent, optionally filtering to desks that have tasks.
 * @param {Agent} agent - The agent looking for a desk.
 * @param {{ requireTasks?: boolean }} [options={}] - Options; set `requireTasks: true` to skip desks with no queued work.
 * @returns {import('./task-handling.js').Desk|null} The closest available desk, or null if none is found.
 */
export function findNearestAvailableDesk(agent, { requireTasks = false } = {}) {
  let nearest = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const desk of desks) {
    if (!isDeskAvailableForAgent(desk, agent)) {
      continue;
    }

    if (requireTasks && !desk.currentTask && desk.queue.length === 0) {
      continue;
    }

    const seatPosition = getDeskSlotPosition(desk, 'seat');
    const dx = seatPosition.x - agent.x;
    const dy = seatPosition.y - agent.y;
    const distance = Math.hypot(dx, dy);

    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = desk;
    }
  }

  return nearest;
}

/**
 * @description Attempts to snap an agent into the seated position at their target desk, transitioning state to SITTING on success.
 * @param {Agent} agent - The agent attempting to sit down.
 * @returns {boolean} True if the agent successfully sat down; false if they are not close enough or the desk is not theirs.
 */
export function trySit(agent) {
  const desk = agent.targetDesk;
  if (!desk || desk.occupant !== agent) {
    scheduleTargetRetry(agent);
    return false;
  }

  const seatPosition = getDeskSlotPosition(desk, 'seat');
  const distance = Math.hypot(agent.x - seatPosition.x, agent.y - seatPosition.y);
  if (distance > 3) {
    return false;
  }

  agent.x = seatPosition.x;
  agent.y = seatPosition.y;
  agent.state = AGENT_STATE_SITTING;
  agent.stateTimer = 0;
  agent.animationFrame = 0;
  agent.animationTimer = 0;
  return true;
}

/**
 * @description Assigns the nearest available desk with tasks to an agent, starting the MOVING state toward the desk's seat.
 * Falls back to scheduling a retry if no suitable desk is found.
 * @param {Agent} agent - The agent to assign a desk target to.
 * @returns {boolean} True if a desk was successfully assigned; false if the agent must wait and retry.
 */
export function assignAgentTarget(agent) {
  const desk = findNearestAvailableDesk(agent, { requireTasks: true });
  if (desk) {
    desk.occupied = true;
    desk.occupant = agent;
    agent.targetDesk = desk;
    agent.targetSlot = desk.slots.seat;

    const seatPosition = getDeskSlotPosition(desk, 'seat');
    agent.targetX = seatPosition.x;
    agent.targetY = seatPosition.y;
    agent.state = AGENT_STATE_MOVING;
    agent.stateTimer = 0;
    agent.wanderTimer = 0;
    agent.targetRetryTimer = 0;
    return true;
  }

  const anyTasks = hasAnyDeskTasks();
  if (anyTasks) {
    agent.targetRetryTimer = TARGET_RETRY_DELAY;
    agent.state = AGENT_STATE_IDLE;
    return false;
  }

  scheduleTargetRetry(agent);
  return false;
}

// --- Simulation update tick ---
/**
 * @description Advances all agents by one simulation tick, processing state transitions, movement, task claiming, and speech.
 * This is the main per-frame update loop called by the rendering engine.
 * @returns {void}
 */
export function update() {
  syncCompletionStatuses();

  for (const agent of agents) {
    ensureIdleStateFields(agent);
    tickSpeech(agent);
    syncAgentTaskStatus(agent);

    const task = agent.currentTask;
    if (shouldLogAgentStatus(agent, Date.now())) {
      console.log('[Agent Status]', agent.id, task ? task.id : null, task ? getTaskStatus(task) : null);
    }
    const taskStatus = getTaskStatus(task);
    if (task && (taskStatus === 'done' || taskStatus === TASK_STATUS_FAILED) && agent.state !== 'complete_react') {
      beginCompletionReaction(agent, taskStatus === 'done' ? 'Done!' : 'Finished.');
      continue;
    }

    if (agent.state === 'complete_react') {
      resetIdleBehavior(agent);
      agent.visualState = 'complete_react';
      agent.completeReactTimer = Math.max(0, agent.completeReactTimer - FRAME_TIME_MS);
      agent.stateTimer += 1;

      agent.animationTimer += 1;
      if (agent.animationTimer >= 10) {
        agent.animationTimer = 0;
        agent.animationFrame = (agent.animationFrame + 1) % 2;
      }

      if (agent.completeReactTimer <= 0) {
        agent.currentTask = null;
        agent.currentTaskId = null;
        agent.state = AGENT_STATE_IDLE;
        agent.visualState = AGENT_STATE_IDLE;
        agent.stateTimer = 0;
        agent.awaitingTaskCompletion = false;
        agent.lastProgressPhase = null;
        agent.lastTaskStatus = null;
        agent.lastSpeechText = null;
        clearAgentTarget(agent);
      }
      continue;
    }

    if (agent.state === 'waiting') {
      resetIdleBehavior(agent);
      agent.visualState = 'waiting';

      const trackedTask = agent.currentTask;
      if (!trackedTask) {
        continue;
      }

      const trackedStatus = getTaskStatus(trackedTask);

      if (trackedStatus === 'done' || trackedStatus === TASK_STATUS_FAILED) {
        beginCompletionReaction(agent, trackedStatus === 'done' ? 'Done!' : 'Finished.');
        continue;
      }

      if (trackedStatus !== TASK_STATUS_AWAITING_ACK) {
        trackedTask.runtimeStatus = TASK_STATUS_AWAITING_ACK;
      }

      if (typeof trackedTask.required === 'number' && trackedTask.required > 0) {
        trackedTask.progress = Math.max(trackedTask.progress || 0, trackedTask.required * TASK_PROGRESS_ACK_THRESHOLD);
      }

      if (getTaskStatus(trackedTask) === TASK_STATUS_AWAITING_ACK && canSpeak(agent)) {
        setAgentSpeech(agent, pickSpeechLine([
          'Sending it off...',
          'Almost done...',
          'Waiting for confirmation...'
        ], 'Waiting for confirmation...'), SPEECH_DURATION_MS);
      }

      syncAgentTaskSpeech(agent, trackedTask);
      continue;
    }

    if (agent.state === AGENT_STATE_SITTING) {
      resetIdleBehavior(agent);
      agent.visualState = AGENT_STATE_WORKING;
      const desk = agent.targetDesk;
      if (desk && desk.occupant === agent && !desk.currentTask) {
        claimNextTask(desk);
      }

      if (desk && desk.currentTask) {
        agent.state = AGENT_STATE_WORKING;
        agent.stateTimer = 0;
      }

      agent.animationFrame = 0;
      agent.animationTimer = 0;
      continue;
    }

    if (agent.state === AGENT_STATE_WORKING) {
      resetIdleBehavior(agent);
      agent.visualState = AGENT_STATE_WORKING;
      const desk = agent.targetDesk;
      if (!desk || desk.occupant !== agent) {
        scheduleTargetRetry(agent);
        continue;
      }

      const activeTask = claimNextTask(desk);
      if (!activeTask) {
        if (agent.awaitingTaskCompletion && agent.currentTask) {
          agent.state = 'waiting';
          continue;
        }

        scheduleTargetRetry(agent);
        continue;
      }

      agent.currentTask = activeTask;
      agent.currentTaskId = activeTask.id;
      syncAgentTaskSpeech(agent, activeTask);

      const skill = agent.skills[activeTask.type] || 1;
      activeTask.progress += agent.productivity * skill;
      if (activeTask.progress >= activeTask.required) {
        activeTask.runtimeStatus = TASK_STATUS_AWAITING_ACK;
        activeTask.progress = activeTask.required * TASK_PROGRESS_ACK_THRESHOLD;
        agent.awaitingTaskCompletion = true;
        handleTaskExecutionResult(desk, activeTask);

        const postExecutionStatus = getTaskStatus(activeTask);

        if (postExecutionStatus === 'pending') {
          agent.awaitingTaskCompletion = false;
          agent.currentTask = null;
          agent.currentTaskId = null;
          agent.lastProgressPhase = null;
          agent.lastTaskStatus = null;
          agent.state = AGENT_STATE_WORKING;
          continue;
        }

        if (postExecutionStatus === TASK_STATUS_FAILED) {
          beginCompletionReaction(agent, 'Finished.');
          continue;
        }

        agent.state = 'waiting';
        agent.stateTimer = 0;
        syncAgentTaskSpeech(agent, activeTask);
        continue;
      }

      agent.stateTimer += 1;
      agent.animationTimer += 1;
      if (agent.animationTimer >= 6) {
        agent.animationTimer = 0;
        agent.animationFrame = (agent.animationFrame + 1) % 4;
      }
      continue;
    }

    if (agent.state === AGENT_STATE_IDLE) {
      agent.visualState = AGENT_STATE_IDLE;

      if (!agent.currentTask && canSpeak(agent)) {
        setAgentSpeech(agent, pickSpeechLine([
          'Waiting for work...',
          'Nothing to do right now.',
          'Just relaxing.'
        ], 'Waiting for work...'), SPEECH_DURATION_MS);
      }

      updateCoffeeAnimation(agent);

      agent.idleTime += 1;
      agent.stateTimer += 1;
      if (agent.targetRetryTimer > 0) {
        agent.targetRetryTimer -= 1;
      }

      if (agent.wanderTimer > 0) {
        agent.wanderTimer -= 1;
      }

      if (agent.targetRetryTimer <= 0) {
        if (assignAgentTarget(agent)) {
          resetIdleBehavior(agent);
          continue;
        }

        agent.targetRetryTimer = hasAnyDeskTasks() ? TARGET_RETRY_DELAY : IDLE_WANDER_REASSIGN_DELAY;
      }

      if (!hasAnyDeskTasks() && agent.targetX === null && agent.targetY === null) {
        if (!agent.idleCycle.walking && agent.coffeeAnim.phase === 'idle') {
          if (agent.idleCycle.pauseTimer > 0) {
            agent.idleCycle.pauseTimer -= 1;
            if (agent.idleCycle.pauseTimer <= 0) {
              startCoffeeSequence(agent);
              agent.idleCycle.timer = randomIdleCooldownFrames();
            }
            continue;
          }

          agent.idleCycle.timer -= 1;
          if (agent.idleCycle.timer <= 0) {
            startIdleRoam(agent);
          }
        }
      }
    }

    if (agent.targetX === null || agent.targetY === null) {
      continue;
    }

    if (agent.state === AGENT_STATE_MOVING && !agent.idleCycle.walking && (!agent.targetDesk || agent.targetDesk.occupant !== agent)) {
      scheduleTargetRetry(agent);
      continue;
    }

    const dx = agent.targetX - agent.x;
    const dy = agent.targetY - agent.y;
    const distance = Math.hypot(dx, dy);

    if (Math.abs(dx) > Math.abs(dy)) {
      agent.direction = dx > 0 ? 'right' : 'left';
    } else if (Math.abs(dy) > 0) {
      agent.direction = dy > 0 ? 'down' : 'up';
    }

    if (distance <= 2) {
      agent.x = agent.targetX;
      agent.y = agent.targetY;

      if (agent.state === AGENT_STATE_MOVING) {
        if (agent.idleCycle.walking) {
          agent.idleCycle.walking = false;
          agent.idleCycle.returning = false;
          agent.idleCycle.walkTarget = null;
          agent.roamTarget = null;
          agent.idleCycle.pauseTimer = randomRoamPauseFrames();
          agent.state = AGENT_STATE_IDLE;
          agent.targetX = null;
          agent.targetY = null;
          agent.animationFrame = 0;
          agent.animationTimer = 0;
          continue;
        }

        trySit(agent);
      } else {
        agent.targetX = null;
        agent.targetY = null;
      }
      continue;
    }

    const nx = dx / distance;
    const ny = dy / distance;
    const moveSpeed = agent.idleCycle.walking ? agent.speed * 0.55 : agent.speed;
    agent.x += nx * moveSpeed;
    agent.y += ny * moveSpeed;

    agent.animationTimer += 1;
    if (agent.animationTimer >= 8) {
      agent.animationTimer = 0;
      agent.animationFrame = (agent.animationFrame + 1) % 4;
    }
  }

  observeAgentStateChanges();
}
