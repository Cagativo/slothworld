import { TARGET_RETRY_DELAY, SITTING_TO_WORKING_DELAY, IDLE_WANDER_REASSIGN_DELAY, WANDER_TARGET_INTERVAL } from './constants.js';
import { canvas, agents, desks, agentStateTracker, emitEvent, isDeskAvailableForAgent, getDeskSlotPosition } from './app-state.js';
import { syncTaskStart, handleTaskExecutionResult } from './task-handling.js';

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
    if (agent.state === 'sitting') {
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
      agent.stateTimer += 1;
      if (agent.targetRetryTimer > 0) {
        agent.targetRetryTimer -= 1;
      }

      if (agent.wanderTimer > 0) {
        agent.wanderTimer -= 1;
      }

      if (agent.targetRetryTimer <= 0) {
        if (assignAgentTarget(agent)) {
          continue;
        }

        agent.targetRetryTimer = hasAnyDeskTasks() ? TARGET_RETRY_DELAY : IDLE_WANDER_REASSIGN_DELAY;
      }

      if (!hasAnyDeskTasks() && (agent.targetX === null || agent.targetY === null || agent.wanderTimer <= 0)) {
        setRandomWanderTarget(agent);
      }
    }

    if (agent.targetX === null || agent.targetY === null) {
      continue;
    }

    if (agent.state === 'moving' && (!agent.targetDesk || agent.targetDesk.occupant !== agent)) {
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
        trySit(agent);
      } else {
        agent.targetX = null;
        agent.targetY = null;
      }
      continue;
    }

    const nx = dx / distance;
    const ny = dy / distance;
    agent.x += nx * agent.speed;
    agent.y += ny * agent.speed;

    agent.animationTimer += 1;
    if (agent.animationTimer >= 8) {
      agent.animationTimer = 0;
      agent.animationFrame = (agent.animationFrame + 1) % 4;
    }
  }

  observeAgentStateChanges();
}
