import { TARGET_RETRY_DELAY, SITTING_TO_WORKING_DELAY, IDLE_WANDER_REASSIGN_DELAY, WANDER_TARGET_INTERVAL } from './constants.js';
import { canvas, agents, desks, agentStateTracker, emitEvent, isDeskAvailableForAgent, getDeskSlotPosition } from './app-state.js';
import { syncTaskStart, handleTaskExecutionResult } from './task-handling.js';

const FRAME_RATE = 60;
const IDLE_WAIT_MIN_FRAMES = 5 * FRAME_RATE;
const IDLE_WAIT_MAX_FRAMES = 10 * FRAME_RATE;
const IDLE_COOLDOWN_MIN_FRAMES = 5 * FRAME_RATE;
const IDLE_COOLDOWN_MAX_FRAMES = 10 * FRAME_RATE;
const ROAM_PAUSE_MIN_FRAMES = 40;
const ROAM_PAUSE_MAX_FRAMES = 90;
const ROAM_PADDING = 26;
const ROAM_TARGET_MIN_DISTANCE = 58;

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

  if (!agent.speechBubble || typeof agent.speechBubble !== 'object') {
    agent.speechBubble = {
      text: '',
      timer: 0,
      duration: 2000
    };
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

  const coffeeLines = ['need coffee...', 'thinking...'];
  const text = coffeeLines[Math.floor(Math.random() * coffeeLines.length)];
  agent.speechBubble = {
    text,
    timer: 2000,
    duration: 2000
  };
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

  const idleLines = ['just vibing...', 'no tasks yet'];
  const text = idleLines[Math.floor(Math.random() * idleLines.length)];
  agent.speechBubble = {
    text,
    timer: 2000,
    duration: 2000
  };

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
  nextTask.status = 'processing';
  syncTaskStart(nextTask);
  desk.currentTask = nextTask;
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

  const workerLines = ['got it!', 'on it', 'processing task'];
  const text = workerLines[Math.floor(Math.random() * workerLines.length)];
  if (desk.occupant) {
    desk.occupant.speechBubble = {
      text,
      timer: 2000,
      duration: 2000
    };
  }

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
  for (const agent of agents) {
    ensureIdleStateFields(agent);

    if (agent.state === 'sitting') {
      resetIdleBehavior(agent);
      const desk = agent.targetDesk;
      if (desk && desk.occupant === agent && !desk.currentTask) {
        claimNextTask(desk);
      }

      agent.animationFrame = 0;
      agent.animationTimer = 0;
      agent.stateTimer += 1;
      if (agent.stateTimer >= SITTING_TO_WORKING_DELAY) {
        agent.state = 'working';
        agent.stateTimer = 0;
      }
      continue;
    }

    if (agent.state === 'working') {
      resetIdleBehavior(agent);
      const desk = agent.targetDesk;
      if (!desk || desk.occupant !== agent) {
        scheduleTargetRetry(agent);
        continue;
      }

      const activeTask = claimNextTask(desk);
      if (!activeTask) {
        scheduleTargetRetry(agent);
        continue;
      }

      const skill = agent.skills[activeTask.type] || 1;
      activeTask.progress += agent.productivity * skill;
      if (activeTask.progress >= activeTask.required) {
        activeTask.progress = activeTask.required;
        handleTaskExecutionResult(desk, activeTask);
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
