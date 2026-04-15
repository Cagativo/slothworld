import { canvas, ctx } from '../core/app-state.js';
import { loadedAssets } from './assets.js';
import { spriteConfigs } from '../core/constants.js';
import { resolveAgentVisual } from '../ui/config/agentVisualConfig.js';

function hashString(text) {
  const value = String(text || '');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
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

function computeAgentRenderPosition(agent, desksById, tasksById, frameNow) {
  const homeDesk = agent && agent.deskId ? desksById.get(agent.deskId) : null;
  const targetDesk = agent && agent.targetDeskId ? desksById.get(agent.targetDeskId) : null;
  const task = findTask(tasksById, agent && agent.currentTaskId);

  const home = deskAnchor(homeDesk || targetDesk);
  const target = deskAnchor(targetDesk || homeDesk);

  const phase = ((frameNow / 1000) + (hashString(agent && agent.id) % 11) * 0.13) % 1;
  const wobble = Math.sin(frameNow * 0.02 + (hashString(agent && agent.id) % 13)) * 1.2;

  if (agent && agent.state === 'moving') {
    return {
      x: home.x + (target.x - home.x) * phase,
      y: home.y + (target.y - home.y) * phase + wobble
    };
  }

  if (agent && agent.state === 'working') {
    return {
      x: target.x,
      y: target.y + Math.sin(frameNow * 0.03 + (hashString(agent.id) % 17)) * 1.6
    };
  }

  if (agent && agent.state === 'delivering') {
    const arc = Math.sin(frameNow * 0.02 + (hashString(agent.id) % 19));
    return {
      x: target.x + arc * 8,
      y: target.y - 10 - Math.abs(arc) * 8
    };
  }

  if (agent && agent.state === 'error') {
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

  return home;
}

function statusColor(status) {
  if (status === 'failed' || status === 'error') {
    return '#ef4444';
  }
  if (status === 'acknowledged' || status === 'completed') {
    return '#22c55e';
  }
  if (status === 'executing' || status === 'awaiting_ack' || status === 'claimed') {
    return '#38bdf8';
  }
  return '#94a3b8';
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
  const position = computeAgentRenderPosition(agent, desksById, tasksById, frameNow);
  const x = position.x;
  const y = position.y;

  const visual = resolveAgentVisual(agent && agent.role, agent && agent.state);
  const spriteImage = visual && visual.spriteFilename ? loadedAssets[visual.spriteFilename] : null;

  if (spriteImage) {
    const width = spriteConfigs && spriteConfigs.agent && Number.isFinite(spriteConfigs.agent.width)
      ? spriteConfigs.agent.width
      : 48;
    const height = spriteConfigs && spriteConfigs.agent && Number.isFinite(spriteConfigs.agent.height)
      ? spriteConfigs.agent.height
      : 48;

    ctx.drawImage(
      spriteImage,
      x - width / 2,
      y - height / 2,
      width,
      height
    );
  } else {
    // Fallback: preserve previous circle visualization when no sprite is available.
    ctx.fillStyle = statusColor(agent.state);
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  if (agent && agent.state === 'working') {
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

  if (agent && agent.state === 'delivering') {
    const pulse = 0.5 + 0.5 * Math.sin(frameNow * 0.02 + (hashString(agent.id) % 29));
    ctx.strokeStyle = `rgba(74, 222, 128, ${0.2 + pulse * 0.55})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y - 6, 11 + pulse * 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(agent.id).replace('agent-desk-', 'A').replace('agent-', 'A-'), x, y + 20);
  ctx.fillText(agent.state || 'idle', x, y + 30);
}

function drawHud(worldState) {
  const overlays = worldState && worldState.ui && Array.isArray(worldState.ui.overlays)
    ? worldState.ui.overlays
    : [];
  const hud = overlays.find((item) => item && item.type === 'hud');

  const counts = hud && hud.counts ? hud.counts : { queued: 0, active: 0, done: 0, failed: 0 };

  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.fillRect(10, 10, 340, 38);
  ctx.strokeStyle = '#334155';
  ctx.strokeRect(10, 10, 340, 38);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`Queued: ${counts.queued}`, 18, 25);
  ctx.fillText(`Active: ${counts.active}`, 105, 25);
  ctx.fillText(`Done: ${counts.done}`, 188, 25);
  ctx.fillText(`Failed: ${counts.failed}`, 260, 25);

  const notifications = worldState && worldState.ui && Array.isArray(worldState.ui.notifications)
    ? worldState.ui.notifications
    : [];

  if (!notifications.length) {
    return;
  }

  const latest = notifications[notifications.length - 1];
  ctx.fillStyle = '#fecaca';
  ctx.font = '10px monospace';
  ctx.fillText(`Alert: ${latest.message}`, 18, 40);
}

export function render(worldState) {
  const safeWorld = worldState && typeof worldState === 'object'
    ? worldState
    : { agents: [], tasks: [], desks: [], ui: { overlays: [], notifications: [] } };

  const desks = Array.isArray(safeWorld.desks) ? safeWorld.desks : [];
  const tasks = Array.isArray(safeWorld.tasks) ? safeWorld.tasks : [];
  const agents = Array.isArray(safeWorld.agents) ? safeWorld.agents : [];

  const desksById = new Map(desks.map((desk) => [desk.id, desk]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const frameNow = Date.now();

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

  drawHud(safeWorld);
}
