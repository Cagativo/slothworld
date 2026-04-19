import { canvas, ctx } from '../core/app-state.js';
import { loadedAssets } from './assets.js';
import { spriteConfigs } from '../core/constants.js';
import { resolveAgentVisual } from '../ui/config/agentVisualConfig.js';

let debugBindingsAttached = false;
const debugPointer = {
  x: null,
  y: null,
  inside: false
};

function hashString(text) {
  const value = String(text || '');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function easeInOutSine(t) {
  const x = clamp01(t);
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

function easeOutCubic(t) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

const PHASE_DURATIONS = {
  claim: 1200,
  execute: 2000,
  deliver: 1400
};

function lerp(a, b, t) {
  return a + (b - a) * clamp01(t);
}

function isRenderDebugEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }

  if (window.__SLOTHWORLD_RENDER_DEBUG__ === true) {
    return true;
  }

  try {
    return new URLSearchParams(window.location.search).has('renderDebug');
  } catch (_error) {
    return false;
  }
}

function ensureDebugBindings() {
  if (debugBindingsAttached || typeof window === 'undefined' || !canvas) {
    return;
  }

  const updatePointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    debugPointer.x = (event.clientX - rect.left) * scaleX;
    debugPointer.y = (event.clientY - rect.top) * scaleY;
    debugPointer.inside = true;
  };

  canvas.addEventListener('mousemove', updatePointer);
  canvas.addEventListener('mouseenter', updatePointer);
  canvas.addEventListener('mouseleave', () => {
    debugPointer.inside = false;
    debugPointer.x = null;
    debugPointer.y = null;
  });

  debugBindingsAttached = true;
}

function deskAnchor(desk) {
  if (!desk) {
    return { x: 30, y: 30 };
  }
  return { x: desk.x, y: desk.y + 34 };
}

function zoneAnchor(zone) {
  if (!zone) {
    return { x: 30, y: 30 };
  }

  return { x: zone.x, y: zone.y + 24 };
}

function transitionProgress(startAt, frameNow, durationMs, speedFactor) {
  if (!Number.isFinite(startAt)) {
    return 0;
  }

  const safeDuration = Math.max(1, durationMs * speedFactor);
  return clamp01((frameNow - startAt) / safeDuration);
}

function quadraticBezierPoint(start, control, end, t) {
  const x = (1 - t) * (1 - t) * start.x
    + 2 * (1 - t) * t * control.x
    + t * t * end.x;
  const y = (1 - t) * (1 - t) * start.y
    + 2 * (1 - t) * t * control.y
    + t * t * end.y;

  return { x, y };
}

function arcLerp(start, end, t, arcLift = 20) {
  const mid = {
    x: lerp(start.x, end.x, 0.5),
    y: lerp(start.y, end.y, 0.5) - arcLift
  };

  return quadraticBezierPoint(start, mid, end, clamp01(t));
}

function findTask(tasksById, taskId) {
  if (!taskId) {
    return null;
  }
  return tasksById.get(taskId) || null;
}

function getAgentVisualState(agent) {
  if (!agent || typeof agent !== 'object' || typeof agent.state !== 'string') {
    return 'idle';
  }

  return agent.state;
}

function getAgentPosition(agent, frameNow, desksById, tasksById, transitionByTaskId, deskCount, taskRouteByTaskId) {
  const visualState = getAgentVisualState(agent);
  const homeDesk = agent && agent.deskId ? desksById.get(agent.deskId) : null;
  const targetDesk = agent && agent.targetDeskId ? desksById.get(agent.targetDeskId) : null;
  const task = findTask(tasksById, agent && agent.currentTaskId);

  const idHash = hashString(agent && agent.id);
  const speedFactor = 0.9 + ((idHash % 200) / 1000);
  const idleWave = Math.sin(frameNow * 0.0028 + (idHash % 29)) * 2.2;
  const idleDrift = Math.cos(frameNow * 0.0019 + (idHash % 37)) * 1.4;

  const route = task
    ? (taskRouteByTaskId && taskRouteByTaskId.get(task.id)) || {
        intakeDesk: homeDesk || targetDesk,
        workerDesk: homeDesk || targetDesk,
        executionZone: homeDesk || targetDesk,
        deliveryZone: homeDesk || targetDesk
      }
    : {
      intakeDesk: homeDesk || targetDesk,
      workerDesk: homeDesk || targetDesk,
      executionZone: homeDesk || targetDesk,
      deliveryZone: homeDesk || targetDesk
    };
  const transitions = task ? (transitionByTaskId.get(task.id) || {}) : null;

  const intake = deskAnchor(route.intakeDesk || homeDesk || targetDesk);
  const worker = deskAnchor(route.workerDesk || targetDesk || homeDesk);
  const execution = zoneAnchor(route.executionZone || targetDesk || homeDesk);
  const delivery = zoneAnchor(route.deliveryZone || targetDesk || homeDesk);
  const home = deskAnchor(homeDesk || route.workerDesk || route.intakeDesk);

  const queueToDesk = transitionProgress(
    transitions && Number.isFinite(transitions.claimedAt) ? transitions.claimedAt : null,
    frameNow,
    PHASE_DURATIONS.claim,
    speedFactor
  );
  const deskToExec = transitionProgress(
    transitions && Number.isFinite(transitions.executingAt) ? transitions.executingAt : null,
    frameNow,
    PHASE_DURATIONS.execute,
    speedFactor
  );
  const execToDelivery = easeInOutSine(transitionProgress(
    transitions && Number.isFinite(transitions.awaitingAckAt) ? transitions.awaitingAckAt : null,
    frameNow,
    PHASE_DURATIONS.deliver,
    speedFactor
  ));

  if (visualState === 'moving') {
    const p = easeOutCubic(queueToDesk);
    const path = arcLerp(intake, worker, p, 20);
    return {
      x: path.x,
      y: path.y
    };
  }

  if (visualState === 'working') {
    const workPulse = easeOutCubic((Math.sin(frameNow * 0.0028 + (idHash % 17)) + 1) / 2);
    const path = arcLerp(worker, execution, deskToExec, 10);
    return {
      x: path.x,
      y: path.y + (workPulse - 0.5) * 2.2
    };
  }

  if (visualState === 'delivering') {
    const t = execToDelivery;
    const path = arcLerp(execution, delivery, t, 20);
    return {
      x: path.x,
      y: path.y
    };
  }

  if (visualState === 'error') {
    const jitter = Math.sin(frameNow * 0.13 + (hashString(agent.id) % 23)) * 2.4;
    return {
      x: delivery.x + jitter,
      y: delivery.y
    };
  }

  if (visualState === 'awaiting_ack') {
    const ackPulse = Math.sin(frameNow * 0.004 + (idHash % 31));
    const ackX = lerp(execution.x, delivery.x, execToDelivery);
    const ackY = lerp(execution.y, delivery.y, execToDelivery);
    return {
      x: ackX,
      y: ackY + ackPulse * 1.6
    };
  }

  if (visualState === 'queued') {
    return {
      x: intake.x + idleDrift * 0.5,
      y: intake.y + idleWave * 0.5
    };
  }

  // idle (or unknown fallback)
  if (task && task.deskId && desksById.has(task.deskId)) {
    const taskDesk = desksById.get(task.deskId);
    return deskAnchor(taskDesk);
  }

  return {
    x: home.x + idleDrift,
    y: home.y + idleWave
  };
}

function drawOfficeFlow(layout) {
  const intake = layout && layout.intakeDesk ? layout.intakeDesk : { x: 120, y: 220 };
  const workerDesks = layout && Array.isArray(layout.workerDesks) ? layout.workerDesks : [];
  const execution = layout && layout.executionZone ? layout.executionZone : { x: 640, y: 220 };
  const delivery = layout && layout.deliveryZone ? layout.deliveryZone : { x: 640, y: 360 };

  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(intake.x + 42, intake.y + 4);
  ctx.lineTo(execution.x - 46, execution.y + 4);
  ctx.lineTo(delivery.x - 46, delivery.y + 4);
  ctx.stroke();

  for (const desk of workerDesks) {
    ctx.beginPath();
    ctx.moveTo(intake.x + 26, intake.y + 10);
    ctx.lineTo(desk.x - 20, desk.y + 10);
    ctx.lineTo(execution.x - 26, execution.y + 10);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const drawZone = (label, zone, color) => {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    ctx.fillRect(zone.x - 50, zone.y - 24, 100, 48);
    ctx.strokeStyle = color;
    ctx.strokeRect(zone.x - 50, zone.y - 24, 100, 48);
    ctx.fillStyle = color;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, zone.x, zone.y - 30);
  };

  drawZone('INTAKE', intake, '#94a3b8');
  drawZone('EXECUTION', execution, '#38bdf8');
  drawZone('DELIVERY', delivery, '#22c55e');
  ctx.restore();
}

function statusColor(status) {
  const key = String(status || '').toLowerCase();

  if (key === 'failed' || key === 'error') {
    return '#ef4444';
  }

  if (key === 'delivering' || key === 'acknowledged' || key === 'completed') {
    return '#22c55e';
  }

  if (key === 'awaiting_ack') {
    return '#f59e0b';
  }

  if (key === 'working' || key === 'executing' || key === 'claimed' || key === 'moving') {
    return '#38bdf8';
  }

  return '#94a3b8';
}

function resolveSpriteFrame(visual, spriteImage, frameNow, agentId) {
  const imageWidth = spriteImage && Number.isFinite(spriteImage.naturalWidth) ? spriteImage.naturalWidth : spriteImage.width;
  const imageHeight = spriteImage && Number.isFinite(spriteImage.naturalHeight) ? spriteImage.naturalHeight : spriteImage.height;
  const frameWidth = Number.isFinite(visual && visual.frameWidth) ? visual.frameWidth : imageWidth;
  const frameHeight = Number.isFinite(visual && visual.frameHeight) ? visual.frameHeight : imageHeight;
  const frameCount = Math.max(1, Number.isFinite(visual && visual.frameCount) ? visual.frameCount : Math.floor(imageWidth / frameWidth) || 1);
  const fps = Number.isFinite(visual && visual.fps) && visual.fps > 0
    ? visual.fps
    : 5;
  const frameDurationMs = Math.max(1, Math.round(1000 / fps));
  const loop = !(visual && visual.loop === false);
  const elapsed = Math.max(0, frameNow + hashString(agentId) * 17);
  const frameNumber = frameCount <= 1 ? 0 : Math.floor(elapsed / frameDurationMs);
  const frameIndex = frameCount <= 1
    ? 0
    : (loop ? frameNumber % frameCount : Math.min(frameCount - 1, frameNumber));

  return {
    sourceX: frameIndex * frameWidth,
    sourceY: 0,
    sourceWidth: frameWidth,
    sourceHeight: frameHeight,
    frameIndex,
    frameCount
  };
}

function resolveSpriteDrawSize(frame) {
  const targetHeight = spriteConfigs && spriteConfigs.agent && Number.isFinite(spriteConfigs.agent.height)
    ? spriteConfigs.agent.height
    : 48;
  const scale = frame && Number.isFinite(frame.sourceHeight) && frame.sourceHeight > 0
    ? targetHeight / frame.sourceHeight
    : 1;

  return {
    width: (frame && Number.isFinite(frame.sourceWidth) ? frame.sourceWidth : targetHeight) * scale,
    height: targetHeight,
    scale
  };
}

function drawSpriteDebugOverlay(x, y, drawSize, frame, hovered) {
  if (!isRenderDebugEnabled()) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = hovered ? 'rgba(251, 191, 36, 0.95)' : 'rgba(56, 189, 248, 0.85)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - drawSize.width / 2, y - drawSize.height, drawSize.width, drawSize.height);

  ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fill();

  if (hovered) {
    const label = `${frame.sourceWidth}x${frame.sourceHeight} f${frame.frameIndex + 1}/${frame.frameCount}`;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(x - 36, y - drawSize.height - 16, 72, 12);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - drawSize.height - 7);
  }
  ctx.restore();
}

function drawDesk(desk) {
  const width = 92;
  const height = 56;
  const x = desk.x - width / 2;
  const y = desk.y - height / 2;

  ctx.fillStyle = '#1f2937';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#334155';
  ctx.strokeRect(x, y, width, height);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`Desk ${desk.id}`, desk.x, y - 6);

  const queueCount = Array.isArray(desk.queueTaskIds) ? desk.queueTaskIds.length : 0;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`Q:${queueCount}`, desk.x, y + height + 12);
}

function drawTask(entity, position) {
  if (!position) {
    return;
  }

  const baseX = position.x;
  const baseY = entity.isActive ? position.y - 22 : position.y + 22;

  ctx.fillStyle = statusColor(entity.visualState);
  ctx.fillRect(baseX - 34, baseY - 8, 68, 16);

  ctx.fillStyle = '#0b1120';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  const shortId = String(entity.id || '').slice(-6);
  ctx.fillText(shortId || 'task', baseX, baseY + 3);
}

function drawAgent(agent, desksById, tasksById, frameNow, transitionByTaskId, deskCount, taskRouteByTaskId) {
  const visualState = getAgentVisualState(agent);
  const position = getAgentPosition(agent, frameNow, desksById, tasksById, transitionByTaskId, deskCount, taskRouteByTaskId);
  const x = position.x;
  const y = position.y;

  const visual = resolveAgentVisual(agent && agent.role, visualState);
  const spriteImage = visual && visual.spriteFilename ? loadedAssets[visual.spriteFilename] : null;

  if (spriteImage) {
    const frame = resolveSpriteFrame(visual, spriteImage, frameNow, agent && agent.id);
    const drawSize = resolveSpriteDrawSize(frame);
    const isHovered = debugPointer.inside
      && Number.isFinite(debugPointer.x)
      && Number.isFinite(debugPointer.y)
      && debugPointer.x >= x - drawSize.width / 2
      && debugPointer.x <= x + drawSize.width / 2
      && debugPointer.y >= y - drawSize.height
      && debugPointer.y <= y;

    ctx.save();
    if (visualState === 'queued') {
      ctx.globalAlpha = 0.58;
    }
    ctx.drawImage(
      spriteImage,
      frame.sourceX,
      frame.sourceY,
      frame.sourceWidth,
      frame.sourceHeight,
      x - drawSize.width / 2,
      y - drawSize.height,
      drawSize.width,
      drawSize.height
    );
    ctx.restore();

    drawSpriteDebugOverlay(x, y, drawSize, frame, isHovered);
  } else {
    // Fallback: preserve previous circle visualization when no sprite is available.
    ctx.fillStyle = statusColor(visualState);
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  if (visualState === 'working') {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.beginPath();
    ctx.arc(x, y + 2, 16, 0, Math.PI * 2);
    ctx.fill();

    const task = findTask(tasksById, agent.currentTaskId);
    if (task) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(x - 24, y - 34, 48, 12);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(task.id).slice(-6), x, y - 25);
    }
  }

  if (visualState === 'awaiting_ack') {
    const ackPulse = 0.5 + 0.5 * Math.sin(frameNow * 0.008 + (hashString(agent.id) % 41));
    ctx.strokeStyle = `rgba(245, 158, 11, ${0.2 + ackPulse * 0.65})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y - 8, 12 + ackPulse * 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (visualState === 'delivering') {
    const rippleBase = ((frameNow + hashString(agent.id) * 23) % 1800) / 1800;
    const rippleA = rippleBase;
    const rippleB = (rippleBase + 0.5) % 1;
    const drawRipple = (phase) => {
      const eased = easeOutCubic(phase);
      const alpha = 0.45 * (1 - eased);
      ctx.strokeStyle = `rgba(74, 222, 128, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y - 8, 8 + eased * 18, 0, Math.PI * 2);
      ctx.stroke();
    };
    drawRipple(rippleA);
    drawRipple(rippleB);
  }

  if (visualState === 'error') {
    const errJitter = Math.sin(frameNow * 0.12 + hashString(agent.id)) * 2;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 10 + errJitter, y - 22);
    ctx.lineTo(x + 10 - errJitter, y - 2);
    ctx.moveTo(x + 10 - errJitter, y - 22);
    ctx.lineTo(x - 10 + errJitter, y - 2);
    ctx.stroke();
  }

  if (visualState === 'idle') {
    const idlePulse = 0.5 + 0.5 * Math.sin(frameNow * 0.003 + (hashString(agent.id) % 31));
    ctx.strokeStyle = `rgba(148, 163, 184, ${0.12 + idlePulse * 0.12})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y + 1, 12 + idlePulse * 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(agent.id).replace('agent-desk-', 'A').replace('agent-', 'A-'), x, y + 20);
  ctx.fillText(visualState, x, y + 30);
}

function drawHud(counts, incidents) {
  const safeCounts = counts && typeof counts === 'object'
    ? counts
    : { queued: 0, active: 0, done: 0, failed: 0 };

  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.fillRect(10, 10, 360, 38);
  ctx.strokeStyle = '#334155';
  ctx.strokeRect(10, 10, 360, 38);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`Queued: ${safeCounts.queued}`, 18, 25);
  ctx.fillText(`Active: ${safeCounts.active}`, 105, 25);
  ctx.fillText(`Done: ${safeCounts.done}`, 188, 25);
  ctx.fillText(`Failed: ${safeCounts.failed}`, 260, 25);

  const list = Array.isArray(incidents) ? incidents : [];

  if (!list.length) {
    return;
  }

  const latest = list.find((cluster) => Array.isArray(cluster && cluster.taskIds) && cluster.taskIds.length > 0) || list[0];
  ctx.fillStyle = '#fecaca';
  ctx.font = '10px monospace';
  const clusterLabel = latest && typeof latest.type === 'string' ? latest.type : 'unknown';
  const taskCount = latest && Array.isArray(latest.taskIds) ? latest.taskIds.length : 0;
  ctx.fillText(`Alert: ${clusterLabel} (${taskCount} tasks)`, 18, 40);
}

export function render(renderView) {
  const safeView = renderView && typeof renderView === 'object' ? renderView : {};
  const entities = Array.isArray(safeView.entities) ? safeView.entities : [];
  const desks = Array.isArray(safeView.desks) ? safeView.desks : [];
  const tasks = Array.isArray(safeView.tasks) ? safeView.tasks : [];
  const agents = Array.isArray(safeView.agents) ? safeView.agents : [];
  const counts = safeView.counts && typeof safeView.counts === 'object' ? safeView.counts : {};
  const incidents = Array.isArray(safeView.incidents) ? safeView.incidents : [];
  const officeLayout = safeView.officeLayout && typeof safeView.officeLayout === 'object' ? safeView.officeLayout : {};
  const transitionByTaskId = safeView.transitionByTaskId instanceof Map ? safeView.transitionByTaskId : new Map();
  const taskRouteByTaskId = safeView.taskRouteByTaskId instanceof Map ? safeView.taskRouteByTaskId : new Map();
  const taskVisualTargetByTaskId = safeView.taskVisualTargetByTaskId instanceof Map ? safeView.taskVisualTargetByTaskId : new Map();

  const desksById = new Map(desks.map((desk) => [desk.id, desk]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const frameNow = Date.now();

  ensureDebugBindings();
  ctx.imageSmoothingEnabled = false;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const desk of desks) {
    drawDesk(desk);
  }

  drawOfficeFlow(officeLayout);

  for (const entity of entities) {
    const taskPosition = taskVisualTargetByTaskId.get(entity.id) || null;
    drawTask(entity, taskPosition);
  }

  for (const agent of agents) {
    drawAgent(agent, desksById, tasksById, frameNow, transitionByTaskId, desks.length || (officeLayout.workerDesks && officeLayout.workerDesks.length) || 1, taskRouteByTaskId);
  }

  drawHud(counts, incidents);
}
