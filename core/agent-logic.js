import { TARGET_RETRY_DELAY, IDLE_WANDER_REASSIGN_DELAY, WANDER_TARGET_INTERVAL } from './constants.js';
import { canvas, agents, desks, agentStateTracker, emitEvent, eventStream, isDeskAvailableForAgent, getDeskSlotPosition } from './app-state.js';
import { syncTaskStart, handleTaskExecutionResult } from './task-handling.js';

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

  if (agent.visualState !== 'idle' && agent.visualState !== 'working' && agent.visualState !== 'waiting' && agent.visualState !== 'complete_react') {
    agent.visualState = 'idle';
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

function setAgentSpeech(agent, text, duration = 7000, { force = false } = {}) {
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

  return (now - (agent.lastSpeechTime || 0)) > 7000;
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

  if (task.type === 'image_render') {
    return 'Generating image...';
  }

  if (task.type === 'discord') {
    return 'Replying...';
  }

  if (task.type === 'shopify') {
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
  setAgentSpeech(agent, text, 7000, { force: true });
}

function syncCompletionStatuses() {
  while (completionEventCursor < eventStream.length) {
    const event = eventStream[completionEventCursor];
    completionEventCursor += 1;

    if (!event || event.type !== 'TASK_COMPLETED' || !event.payload || !event.payload.taskId) {
      continue;
    }

    completionStatusByTaskId.set(String(event.payload.taskId), event.payload.success === false ? 'failed' : 'done');
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

  const isActive = !!agent.currentTask || agent.visualState !== 'idle';
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

  if (status === 'done' || status === 'failed') {
    return 1;
  }

  if (status === 'awaiting_ack') {
    return 0.95;
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

  if (status === 'done' || status === 'failed') {
    return;
  }

  if (status === 'awaiting_ack') {
    agent.lastProgressPhase = 'finishing';
    return;
  }

  const ratio = deriveTaskProgressRatio(task);
  const phase = ratio < 0.3 ? 'starting' : 'working';
  if (phase !== agent.lastProgressPhase) {
    agent.lastProgressPhase = phase;
    setAgentSpeech(agent, getPhaseSpeech(phase), 7000);
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
  agent.state = 'moving';
  agent.stateTimer = 0;
  agent.animationTimer = 0;

  return true;
}

export function hasAnyDeskTasks() {
  return desks.some((desk) => desk.currentTask || desk.queue.length > 0);
}

export function releaseDesk(desk, agent) {
  if (desk.occupant === agent) {
    desk.occupied = false;
    desk.occupant = null;
  }
}

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

export function scheduleTargetRetry(agent) {
  clearAgentTarget(agent);
  agent.targetRetryTimer = TARGET_RETRY_DELAY;
  agent.wanderTimer = 0;
  agent.stateTimer = 0;
  agent.animationFrame = 0;
  agent.animationTimer = 0;
  agent.state = 'idle';
}

export function setRandomWanderTarget(agent) {
  agent.targetDesk = null;
  agent.targetSlot = null;
  agent.targetX = Math.random() * (canvas.width - 48) + 24;
  agent.targetY = Math.random() * (canvas.height - 48) + 24;
  agent.wanderTimer = WANDER_TARGET_INTERVAL;
}

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
    desk.occupant.visualState = 'working';
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
  agent.state = 'sitting';
  agent.stateTimer = 0;
  agent.animationFrame = 0;
  agent.animationTimer = 0;
  return true;
}

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
    agent.state = 'moving';
    agent.stateTimer = 0;
    agent.wanderTimer = 0;
    agent.targetRetryTimer = 0;
    return true;
  }

  const anyTasks = hasAnyDeskTasks();
  if (anyTasks) {
    agent.targetRetryTimer = TARGET_RETRY_DELAY;
    agent.state = 'idle';
    return false;
  }

  scheduleTargetRetry(agent);
  return false;
}

// --- Simulation update tick ---
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
    if (task && (taskStatus === 'done' || taskStatus === 'failed') && agent.state !== 'complete_react') {
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
        agent.state = 'idle';
        agent.visualState = 'idle';
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

      if (trackedStatus === 'done' || trackedStatus === 'failed') {
        beginCompletionReaction(agent, trackedStatus === 'done' ? 'Done!' : 'Finished.');
        continue;
      }

      if (trackedStatus !== 'awaiting_ack') {
        trackedTask.runtimeStatus = 'awaiting_ack';
      }

      if (typeof trackedTask.required === 'number' && trackedTask.required > 0) {
        trackedTask.progress = Math.max(trackedTask.progress || 0, trackedTask.required * 0.95);
      }

      if (getTaskStatus(trackedTask) === 'awaiting_ack' && canSpeak(agent)) {
        setAgentSpeech(agent, pickSpeechLine([
          'Sending it off...',
          'Almost done...',
          'Waiting for confirmation...'
        ], 'Waiting for confirmation...'), 7000);
      }

      syncAgentTaskSpeech(agent, trackedTask);
      continue;
    }

    if (agent.state === 'sitting') {
      resetIdleBehavior(agent);
      agent.visualState = 'working';
      const desk = agent.targetDesk;
      if (desk && desk.occupant === agent && !desk.currentTask) {
        claimNextTask(desk);
      }

      if (desk && desk.currentTask) {
        agent.state = 'working';
        agent.stateTimer = 0;
      }

      agent.animationFrame = 0;
      agent.animationTimer = 0;
      continue;
    }

    if (agent.state === 'working') {
      resetIdleBehavior(agent);
      agent.visualState = 'working';
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
        activeTask.runtimeStatus = 'awaiting_ack';
        activeTask.progress = activeTask.required * 0.95;
        agent.awaitingTaskCompletion = true;
        handleTaskExecutionResult(desk, activeTask);

        const postExecutionStatus = getTaskStatus(activeTask);

        if (postExecutionStatus === 'pending') {
          agent.awaitingTaskCompletion = false;
          agent.currentTask = null;
          agent.currentTaskId = null;
          agent.lastProgressPhase = null;
          agent.lastTaskStatus = null;
          agent.state = 'working';
          continue;
        }

        if (postExecutionStatus === 'failed') {
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

    if (agent.state === 'idle') {
      agent.visualState = 'idle';

      if (!agent.currentTask && canSpeak(agent)) {
        setAgentSpeech(agent, pickSpeechLine([
          'Waiting for work...',
          'Nothing to do right now.',
          'Just relaxing.'
        ], 'Waiting for work...'), 7000);
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

    if (agent.state === 'moving' && !agent.idleCycle.walking && (!agent.targetDesk || agent.targetDesk.occupant !== agent)) {
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

      if (agent.state === 'moving') {
        if (agent.idleCycle.walking) {
          agent.idleCycle.walking = false;
          agent.idleCycle.returning = false;
          agent.idleCycle.walkTarget = null;
          agent.roamTarget = null;
          agent.idleCycle.pauseTimer = randomRoamPauseFrames();
          agent.state = 'idle';
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
