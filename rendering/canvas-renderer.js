import { canvas, ctx } from '../core/app-state.js';
import { loadedAssets } from './assets.js';
import { spriteConfigs } from '../core/constants.js';
import { resolveAgentVisual } from '../ui/config/agentVisualConfig.js';
import { getAllTasks, getAllDesks } from '../ui/selectors/taskSelectors.js';
import { getAllAgents } from '../ui/selectors/agentSelectors.js';
import { getTaskCounts } from '../ui/selectors/metricsSelectors.js';
import { getIncidentClusters } from '../ui/selectors/anomalySelectors.js';

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

function getAgentPosition(agent, frameNow, desksById, tasksById) {
  const visualState = getAgentVisualState(agent);
  const homeDesk = agent && agent.deskId ? desksById.get(agent.deskId) : null;
  const targetDesk = agent && agent.targetDeskId ? desksById.get(agent.targetDeskId) : null;
  const task = findTask(tasksById, agent && agent.currentTaskId);

  const home = deskAnchor(homeDesk || targetDesk);
  const target = deskAnchor(targetDesk || homeDesk);

  const idHash = hashString(agent && agent.id);
  const phase = ((frameNow / 1000) + (idHash % 11) * 0.13) % 1;
  const easedPhase = easeInOutSine(phase);
  const wobble = Math.sin(frameNow * 0.02 + (idHash % 13)) * 1.2;
  const idleWave = Math.sin(frameNow * 0.0028 + (idHash % 29)) * 2.2;
  const idleDrift = Math.cos(frameNow * 0.0019 + (idHash % 37)) * 1.4;

  if (visualState === 'moving') {
    return {
      x: home.x + (target.x - home.x) * easedPhase,
      y: home.y + (target.y - home.y) * easedPhase + wobble
    };
  }

  if (visualState === 'working') {
    const workPulse = easeOutCubic((Math.sin(frameNow * 0.0034 + (idHash % 17)) + 1) / 2);
    return {
      x: target.x,
      y: target.y + (workPulse - 0.5) * 3.2
    };
  }

  if (visualState === 'delivering') {
    const arc = Math.sin(frameNow * 0.02 + (hashString(agent.id) % 19));
    return {
      x: target.x + arc * 8,
      y: target.y - 10 - Math.abs(arc) * 8
    };
  }

  if (visualState === 'error') {
    const jitter = Math.sin(frameNow * 0.11 + (hashString(agent.id) % 23)) * 2;
    return {
      x: target.x + jitter,
      y: target.y
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
  const frameDurationMs = Math.max(1, Number.isFinite(visual && visual.frameDurationMs) ? visual.frameDurationMs : 200);
  const frameIndex = frameCount <= 1
    ? 0
    : Math.floor((frameNow + hashString(agentId) * 17) / frameDurationMs) % frameCount;

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

function drawTask(task, desk) {
  if (!desk) {
    return;
  }

  const isActive = task.status === 'claimed' || task.status === 'executing' || task.status === 'awaiting_ack';
  const baseX = desk.x;
  const baseY = isActive ? desk.y - 18 : desk.y + 26;

  ctx.fillStyle = statusColor(task.status);
  ctx.fillRect(baseX - 34, baseY - 8, 68, 16);

  ctx.fillStyle = '#0b1120';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  const shortId = String(task.id || '').slice(-6);
  ctx.fillText(shortId || 'task', baseX, baseY + 3);
}

function drawAgent(agent, desksById, tasksById, frameNow) {
  const visualState = getAgentVisualState(agent);
  const position = getAgentPosition(agent, frameNow, desksById, tasksById);
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

  if (visualState === 'delivering') {
    const pulse = 0.5 + 0.5 * Math.sin(frameNow * 0.02 + (hashString(agent.id) % 29));
    ctx.strokeStyle = `rgba(74, 222, 128, ${0.2 + pulse * 0.55})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y - 6, 11 + pulse * 4, 0, Math.PI * 2);
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

  const latest = list[0];
  ctx.fillStyle = '#fecaca';
  ctx.font = '10px monospace';
  ctx.fillText(`Alert: ${latest.category}${latest.taskId ? ` (${latest.taskId})` : ''}`, 18, 40);
}

export function render(indexedWorld) {
  const safeIndexed = indexedWorld && typeof indexedWorld === 'object'
    ? indexedWorld
    : { events: [], eventsByTaskId: new Map(), eventsByWorkerId: new Map() };

  const desks = getAllDesks(safeIndexed);
  const tasks = getAllTasks(safeIndexed);
  const agents = getAllAgents(safeIndexed);
  const counts = getTaskCounts(safeIndexed);
  const incidents = getIncidentClusters(safeIndexed, { now: Date.now() });

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

  for (const task of tasks) {
    const desk = desksById.get(task.deskId);
    drawTask(task, desk);
  }

  for (const agent of agents) {
    drawAgent(agent, desksById, tasksById, frameNow);
  }

  drawHud(counts, incidents);
}
