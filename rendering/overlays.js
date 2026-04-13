import { canvas, agents, desks, workflows } from '../core/app-state.js';
import { spriteConfigs } from '../core/constants.js';

// --- Shared rendering state ---
export const uiFxState = {
  frame: 0,
  knownTasks: new Map(),
  creationPops: [],
  completionFlashes: [],
  particles: []
};

// --- Color/label helpers ---
export function getDeskPriorityColor(priority) {
  if (priority === 2) {
    return '#ff5f5f';
  }

  if (priority === 1) {
    return '#ffd45a';
  }

  return '#a8a8a8';
}

export function getTaskIcon(taskType) {
  if (taskType === 'discord') {
    return 'D';
  }

  if (taskType === 'shopify') {
    return 'S';
  }

  return '?';
}

export function getRoleTint(role) {
  if (role === 'researcher') {
    return 'rgba(120, 200, 255, 0.35)';
  }

  if (role === 'executor') {
    return 'rgba(120, 255, 170, 0.35)';
  }

  return 'rgba(255, 210, 120, 0.28)';
}

export function getAgentStateLabel(agent) {
  if (agent.state === 'working') {
    return 'WORK';
  }

  if (agent.state === 'moving') {
    return 'MOVE';
  }

  if (agent.state === 'sitting') {
    return 'SEAT';
  }

  if (agent.targetDesk && agent.targetDesk.lastFailedTask) {
    return 'FAIL';
  }

  return 'IDLE';
}

export function getTaskPriority(task) {
  if (!task || typeof task.priority !== 'number') {
    return 0;
  }

  return Math.max(0, Math.min(2, task.priority));
}

// --- Desk overlays ---
export function drawDeskProcessingGlow(ctx, desk, pulse) {
  const task = desk.currentTask || desk.queue[0];
  if (!task) {
    return;
  }

  const priority = getTaskPriority(task);
  const intensity = 0.12 + priority * 0.08 + pulse * 0.08;
  const radius = 40 + priority * 8 + pulse * 6;
  const gradient = ctx.createRadialGradient(desk.x, desk.y, 8, desk.x, desk.y, radius);
  gradient.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(desk.x, desk.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function drawDeskQueueStack(ctx, desk) {
  const queueCount = desk.queue.length;
  if (queueCount <= 0) {
    return;
  }

  const maxVisible = Math.min(queueCount, 5);
  for (let i = 0; i < maxVisible; i += 1) {
    const queuedTask = desk.queue[i];
    const offsetX = -26 + i * 4;
    const offsetY = 26 - i * 3;
    const priorityColor = getDeskPriorityColor(getTaskPriority(queuedTask));
    ctx.fillStyle = priorityColor;
    ctx.fillRect(desk.x + offsetX, desk.y + offsetY, 12, 5);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.strokeRect(desk.x + offsetX, desk.y + offsetY, 12, 5);
  }
}

export function drawDeskTaskOverlay(ctx, desk) {
  const labelY = desk.y - spriteConfigs.desk.height / 2 - 10;
  const queueText = `${desk.queue.length}`;
  const activePriority = desk.currentTask ? desk.currentTask.priority : (desk.queue[0] ? desk.queue[0].priority : null);

  if (activePriority !== null) {
    ctx.fillStyle = getDeskPriorityColor(activePriority);
    ctx.fillRect(desk.x - 20, labelY - 10, 40, 6);
  }

  ctx.fillStyle = '#f7f4df';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(queueText, desk.x, labelY);

  if (desk.lastFailedTask) {
    ctx.fillStyle = '#ff5f5f';
    ctx.fillText(`FAILED ${desk.failedTasks}`, desk.x, labelY - 14);
  }

  if (!desk.currentTask) {
    return;
  }

  const barWidth = 64;
  const barHeight = 6;
  const progressRatio = Math.max(0, Math.min(1, desk.currentTask.progress / desk.currentTask.required));
  const barX = desk.x - barWidth / 2;
  const barY = labelY + 6;
  const pulse = 0.5 + 0.5 * Math.sin(uiFxState.frame * 0.16);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  const barGradient = ctx.createLinearGradient(barX, barY, barX + barWidth, barY + barHeight);
  if (desk.currentTask.type === 'shopify') {
    barGradient.addColorStop(0, '#2f8e68');
    barGradient.addColorStop(0.5, '#50d890');
    barGradient.addColorStop(1, '#95ffe8');
  } else {
    barGradient.addColorStop(0, '#387bb5');
    barGradient.addColorStop(0.5, '#6ec6ff');
    barGradient.addColorStop(1, '#b1e9ff');
  }
  ctx.fillStyle = barGradient;
  ctx.fillRect(barX, barY, barWidth * progressRatio, barHeight);

  // Energy scanline to make progress feel live.
  const scanX = barX + (barWidth * ((uiFxState.frame % 48) / 48));
  ctx.fillStyle = `rgba(255, 255, 255, ${0.16 + pulse * 0.1})`;
  ctx.fillRect(scanX, barY, 2, barHeight);

  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(barX, barY, barWidth, barHeight);
}

// --- Task FX ---
export function drawTaskFx(ctx) {
  for (let i = uiFxState.creationPops.length - 1; i >= 0; i -= 1) {
    const pop = uiFxState.creationPops[i];
    pop.life -= 1;
    const alpha = Math.max(0, pop.life / pop.maxLife);
    const size = 8 + (1 - alpha) * 12;

    ctx.fillStyle = `rgba(110, 198, 255, ${0.4 * alpha})`;
    ctx.beginPath();
    ctx.arc(pop.x, pop.y - (1 - alpha) * 10, size, 0, Math.PI * 2);
    ctx.fill();

    if (pop.life <= 0) {
      uiFxState.creationPops.splice(i, 1);
    }
  }

  for (let i = uiFxState.completionFlashes.length - 1; i >= 0; i -= 1) {
    const flash = uiFxState.completionFlashes[i];
    flash.life -= 1;
    const alpha = Math.max(0, flash.life / flash.maxLife);
    const width = 36 + (1 - alpha) * 28;
    const height = 20 + (1 - alpha) * 16;

    ctx.fillStyle = `rgba(255, 255, 255, ${0.35 * alpha})`;
    ctx.fillRect(flash.x - width / 2, flash.y - height / 2, width, height);

    if (flash.life <= 0) {
      uiFxState.completionFlashes.splice(i, 1);
    }
  }

  for (let i = uiFxState.particles.length - 1; i >= 0; i -= 1) {
    const particle = uiFxState.particles[i];
    particle.life -= 1;
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy += 0.02;

    const alpha = Math.max(0, particle.life / particle.maxLife);
    ctx.fillStyle = `rgba(255, 238, 168, ${0.75 * alpha})`;
    ctx.fillRect(particle.x, particle.y, 2, 2);

    if (particle.life <= 0) {
      uiFxState.particles.splice(i, 1);
    }
  }
}

export function refreshTaskFxState() {
  const currentTasks = new Map();

  for (const desk of desks) {
    if (desk.currentTask) {
      currentTasks.set(desk.currentTask.id, {
        x: desk.x,
        y: desk.y,
        priority: getTaskPriority(desk.currentTask)
      });
    }

    for (const queuedTask of desk.queue) {
      currentTasks.set(queuedTask.id, {
        x: desk.x,
        y: desk.y,
        priority: getTaskPriority(queuedTask)
      });
    }
  }

  for (const [taskId, info] of currentTasks) {
    if (!uiFxState.knownTasks.has(taskId)) {
      uiFxState.creationPops.push({
        x: info.x,
        y: info.y - 30,
        life: 18,
        maxLife: 18
      });
    }
  }

  for (const [taskId, previousInfo] of uiFxState.knownTasks) {
    if (!currentTasks.has(taskId)) {
      uiFxState.completionFlashes.push({
        x: previousInfo.x,
        y: previousInfo.y - 16,
        life: 12,
        maxLife: 12
      });

      const particleCount = 8 + previousInfo.priority * 3;
      for (let i = 0; i < particleCount; i += 1) {
        const angle = (Math.PI * 2 * i) / particleCount;
        const speed = 0.6 + Math.random() * 1.1;
        uiFxState.particles.push({
          x: previousInfo.x,
          y: previousInfo.y - 16,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.3,
          life: 24,
          maxLife: 24
        });
      }
    }
  }

  uiFxState.knownTasks = currentTasks;
}

// --- Agent identity layer ---
export function drawAgentIdentityLayer(ctx, agent) {
  const tint = getRoleTint(agent.role);
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(agent.x, agent.y + 8, 12, 0, Math.PI * 2);
  ctx.fill();

  const stateLabel = getAgentStateLabel(agent);
  const stateX = agent.x;
  const stateY = agent.y - 36;
  ctx.fillStyle = 'rgba(18, 22, 34, 0.85)';
  ctx.fillRect(stateX - 15, stateY - 9, 30, 10);
  ctx.fillStyle = '#f7f4df';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(stateLabel, stateX, stateY - 1);

  const activeTask = agent.targetDesk && agent.targetDesk.currentTask ? agent.targetDesk.currentTask : null;
  if (!activeTask) {
    return;
  }

  const icon = getTaskIcon(activeTask.type);
  const iconX = agent.x + 16;
  const iconY = agent.y - 24;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(iconX - 6, iconY - 8, 12, 12);
  ctx.fillStyle = activeTask.type === 'shopify' ? '#7ef7b3' : '#7ecfff';
  ctx.font = '9px monospace';
  ctx.fillText(icon, iconX, iconY + 1);
}

// --- Global HUD ---
export function drawGlobalHud(ctx) {
  let activeTasks = 0;
  let completedTasks = 0;
  let failedTasks = 0;

  for (const desk of desks) {
    activeTasks += desk.queue.length + (desk.currentTask ? 1 : 0);
    completedTasks += desk.completedTasks;
    failedTasks += desk.failedTasks;
  }

  let activeWorkflows = 0;
  for (const workflow of workflows.values()) {
    if (workflow.status === 'running') {
      activeWorkflows += 1;
    }
  }

  ctx.fillStyle = 'rgba(10, 14, 24, 0.78)';
  ctx.fillRect(12, 10, 330, 44);
  ctx.strokeStyle = 'rgba(148, 197, 255, 0.35)';
  ctx.strokeRect(12, 10, 330, 44);

  ctx.fillStyle = '#d5ebff';
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`Active: ${activeTasks}`, 20, 28);
  ctx.fillText(`Done: ${completedTasks}`, 110, 28);
  ctx.fillText(`Failed: ${failedTasks}`, 185, 28);
  ctx.fillText(`Workflows: ${activeWorkflows}`, 260, 28);

  ctx.fillStyle = '#8ea8c3';
  ctx.font = '10px monospace';
  ctx.fillText('Automation OS Runtime', 20, 44);
}

// --- Workflow overlays ---
export function drawWorkflowOverlay(ctx) {
  const activeWorkflowList = Array.from(workflows.values()).filter((workflow) => workflow.status === 'running');
  if (activeWorkflowList.length === 0) {
    return;
  }

  const baseX = canvas.width - 300;
  let baseY = 12;
  const maxCards = Math.min(activeWorkflowList.length, 4);

  for (let i = 0; i < maxCards; i += 1) {
    const workflow = activeWorkflowList[i];
    const cardHeight = 44;
    ctx.fillStyle = 'rgba(12, 16, 30, 0.82)';
    ctx.fillRect(baseX, baseY, 288, cardHeight);
    ctx.strokeStyle = 'rgba(140, 220, 255, 0.3)';
    ctx.strokeRect(baseX, baseY, 288, cardHeight);

    ctx.fillStyle = '#d7f0ff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(workflow.id.slice(0, 34), baseX + 8, baseY + 12);

    const stepY = baseY + 28;
    const maxSteps = Math.min(workflow.steps.length, 6);
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
      const x = baseX + 10 + stepIndex * 44;
      const status = workflow.stepStatuses[stepIndex] || 'pending';
      let fill = 'rgba(112, 132, 158, 0.6)';
      if (status === 'done') {
        fill = 'rgba(126, 247, 179, 0.95)';
      } else if (status === 'running') {
        fill = 'rgba(127, 207, 255, 0.95)';
      } else if (status === 'failed') {
        fill = 'rgba(255, 120, 120, 0.95)';
      }

      ctx.fillStyle = fill;
      ctx.fillRect(x, stepY, 16, 6);
      ctx.strokeStyle = 'rgba(8, 10, 16, 0.65)';
      ctx.strokeRect(x, stepY, 16, 6);

      if (stepIndex < maxSteps - 1) {
        ctx.strokeStyle = 'rgba(180, 220, 245, 0.45)';
        ctx.beginPath();
        ctx.moveTo(x + 16, stepY + 3);
        ctx.lineTo(x + 26, stepY + 3);
        ctx.stroke();
      }
    }

    baseY += 50;
  }
}

export function drawPendingWorkflowsOverlay(ctx) {
  const pendingWorkflowList = Array.from(workflows.values()).filter((workflow) => workflow.status === 'pending_approval');
  if (pendingWorkflowList.length === 0) {
    return;
  }

  // Draw a centered modal for each pending workflow (max 1 visible at a time)
  const workflow = pendingWorkflowList[0];
  const windowWidth = canvas.width;
  const windowHeight = canvas.height;
  const cardWidth = 500;
  const headerHeight = 40;
  const stepHeight = 50;
  const footerHeight = 50;
  const cardHeight = headerHeight + Math.min(workflow.steps.length, 4) * stepHeight + footerHeight;
  const cardX = (windowWidth - cardWidth) / 2;
  const cardY = (windowHeight - cardHeight) / 2;

  // Semi-transparent backdrop
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, windowWidth, windowHeight);

  // Card background
  ctx.fillStyle = 'rgba(20, 25, 40, 0.95)';
  ctx.fillRect(cardX, cardY, cardWidth, cardHeight);

  // Card border - glowing cyan
  ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(cardX, cardY, cardWidth, cardHeight);

  // Header
  ctx.fillStyle = 'rgba(50, 80, 120, 0.8)';
  ctx.fillRect(cardX, cardY, cardWidth, headerHeight);
  ctx.fillStyle = '#d7f0ff';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('⧗ WORKFLOW PENDING APPROVAL', cardX + 12, cardY + 26);

  // Workflow ID
  ctx.fillStyle = '#a0d0ff';
  ctx.font = '10px monospace';
  ctx.fillText(`ID: ${workflow.id}`, cardX + 12, cardY + headerHeight + 16);

  // Steps list
  const stepsToShow = Math.min(workflow.steps.length, 4);
  for (let i = 0; i < stepsToShow; i += 1) {
    const step = workflow.steps[i];
    const plan = workflow.plan && workflow.plan[i] ? workflow.plan[i] : {};
    const stepY = cardY + headerHeight + 20 + i * stepHeight;

    // Step number and title
    ctx.fillStyle = '#7ff0ff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}. ${step.title || `Step ${i + 1}`}`, cardX + 20, stepY + 12);

    // Complexity badge
    const complexityColor = plan.complexity === 'high' ? '#ff8888' : plan.complexity === 'low' ? '#88ff88' : '#ffaa66';
    ctx.fillStyle = complexityColor;
    ctx.font = '9px monospace';
    ctx.fillText(`[${plan.complexity || 'med'}]`, cardX + 20, stepY + 26);

    // Role preference
    ctx.fillStyle = '#b0c8ff';
    ctx.font = '9px monospace';
    ctx.fillText(`Role: ${plan.rolePreference || 'any'}`, cardX + 120, stepY + 26);

    // Description
    ctx.fillStyle = '#80a8ff';
    ctx.font = '9px monospace';
    const desc = plan.description || step.description || '';
    const descShort = desc.length > 45 ? desc.slice(0, 42) + '...' : desc;
    ctx.fillText(descShort, cardX + 20, stepY + 40);
  }

  if (workflow.steps.length > stepsToShow) {
    ctx.fillStyle = '#8080a0';
    ctx.font = '9px monospace';
    ctx.fillText(`... and ${workflow.steps.length - stepsToShow} more steps`, cardX + 20, cardY + headerHeight + 20 + stepsToShow * stepHeight);
  }

  // Footer with approve/reject buttons
  const footerY = cardY + cardHeight - footerHeight;
  ctx.fillStyle = 'rgba(40, 50, 70, 0.8)';
  ctx.fillRect(cardX, footerY, cardWidth, footerHeight);

  // Draw as text instructions (buttons would need mouse tracking which is complex in canvas)
  ctx.fillStyle = '#90ff90';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('[APPROVE: approve workflow ' + workflow.id.slice(0, 12) + ']', cardX + cardWidth / 2, footerY + 18);

  ctx.fillStyle = '#ff9090';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('[REJECT: reject workflow ' + workflow.id.slice(0, 12) + ']', cardX + cardWidth / 2, footerY + 36);

  // Show count of pending workflows if multiple
  if (pendingWorkflowList.length > 1) {
    ctx.fillStyle = '#ffaa66';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`(${pendingWorkflowList.length - 1} more pending)`, cardX + cardWidth / 2, footerY - 8);
  }
}
