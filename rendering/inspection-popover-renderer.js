/**
 * inspection-popover-renderer.js
 *
 * Canvas popover for diegetic inspection. Content is sourced only from
 * render component descriptors.
 */

const NORMAL_CARD_W = 150;
const DEBUG_CARD_W = 218;
const PAD = 8;
const LINE_H = 12;

const ZONE_TITLES = Object.freeze({
  CREATED: 'Intake Nook',
  ENQUEUED: 'Task Engine',
  CLAIMED: 'Workshop',
  EXECUTE_FINISHED: 'Delivery Bay',
  ACKED: 'Archive Vault',
  intakeDesk: 'Intake Desk',
  researchDesk: 'Research Desk',
  shopifyDesk: 'Shopify Desk',
  renderDesk: 'Render Desk',
  supportDesk: 'Support Desk',
  engineCrystal: 'Engine Crystal',
  approvalDesk: 'Approval Desk',
  anomalyShelf: 'Anomaly Shelf',
  archiveLibrary: 'Archive Library',
});

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function cleanText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function titleFor(component, componentType) {
  if (componentType === 'task-chip') return 'Task Scroll';
  if (componentType === 'agent-sprite') return 'Agent Desk';
  if (componentType === 'workstation-hotspot') return cleanText(component.label) || 'Workstation';
  const zoneId = cleanText(component.worldZoneId) || cleanText(component.zoneId) || cleanText(component.id);
  return ZONE_TITLES[zoneId] || 'World Zone';
}

function typeLabel(componentType) {
  if (componentType === 'task-chip') return 'task';
  if (componentType === 'agent-sprite') return 'agent';
  if (componentType === 'workstation-hotspot') return 'workstation';
  return 'world-zone';
}

function metricRows(metrics) {
  if (!metrics || typeof metrics !== 'object') return [];
  const rows = [];
  for (const key of ['duration', 'queueTime', 'latency']) {
    const value = metrics[key];
    if (value !== null && value !== undefined) {
      rows.push(`${key}: ${value}`);
    }
  }
  return rows;
}

export function buildInspectionPopoverRows(hit, options = {}) {
  if (!hit || !hit.component) return null;

  const component = hit.component;
  const isDebug = Boolean(options.debug);
  const rows = [];
  if (isDebug || hit.componentType !== 'workstation-hotspot') {
    rows.push(`type: ${typeLabel(hit.componentType)}`);
  }

  if (hit.componentType === 'workstation-hotspot') {
    const summary = component.summary && typeof component.summary === 'object' ? component.summary : {};
    const activeTasks = summary.activeTasks ?? 0;
    const waitingTasks = summary.waitingTasks ?? 0;
    if (isDebug || activeTasks > 0) rows.push(`active tasks: ${activeTasks}`);
    if (isDebug || waitingTasks > 0) rows.push(`waiting tasks: ${waitingTasks}`);
    if (summary.failedTasks || summary.anomaly) rows.push('attention: yes');
    if (summary.assignedAgents) rows.push(`assigned agents: ${summary.assignedAgents}`);
    if (isDebug) {
      const id = cleanText(component.id);
      if (id) rows.push(`id: ${id}`);
      if (hit.bounds) {
        rows.push(`bounds: ${Math.round(hit.bounds.x)},${Math.round(hit.bounds.y)} ${Math.round(hit.bounds.width)}x${Math.round(hit.bounds.height)}`);
      }
    }
    return {
      title: titleFor(component, hit.componentType),
      rows,
      hasAnomaly: Boolean(summary.failedTasks || summary.anomaly),
      debug: isDebug,
    };
  }

  const visualState = cleanText(component.visualState);
  if (visualState && (isDebug || visualState !== 'unknown')) rows.push(`status: ${visualState}`);

  const zone = cleanText(component.worldZoneId) || cleanText(component.zoneId);
  if (zone) rows.push(`zone: ${zone}`);

  if (isDebug && hit.componentType === 'agent-sprite') {
    const currentTaskId = cleanText(component.currentTaskId);
    if (currentTaskId) rows.push(`current task: ${currentTaskId}`);
  }

  if (isDebug) rows.push(...metricRows(component.metrics));

  if (isDebug && component.anomaly) {
    const severity = cleanText(component.anomaly.severity) || 'unknown';
    const detail = cleanText(component.anomaly.type) || 'anomaly';
    rows.push(`anomaly: ${severity} ${detail}`);
  }

  if (isDebug) {
    const id = cleanText(component.id);
    if (id) rows.push(`id: ${id}`);
    if (hit.bounds) {
      rows.push(`bounds: ${Math.round(hit.bounds.x)},${Math.round(hit.bounds.y)} ${Math.round(hit.bounds.width)}x${Math.round(hit.bounds.height)}`);
    }
    const zoneId = cleanText(component.zoneId);
    const worldZoneId = cleanText(component.worldZoneId);
    if (zoneId && worldZoneId && zoneId !== worldZoneId) {
      rows.push(`lifecycle zone: ${zoneId}`);
    }
  }

  return {
    title: titleFor(component, hit.componentType),
    rows,
    hasAnomaly: Boolean(component.anomaly),
    debug: isDebug,
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const cr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + cr, y);
  ctx.lineTo(x + w - cr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + cr);
  ctx.lineTo(x + w, y + h - cr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - cr, y + h);
  ctx.lineTo(x + cr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - cr);
  ctx.lineTo(x, y + cr);
  ctx.quadraticCurveTo(x, y, x + cr, y);
  ctx.closePath();
}

function anchorFor(ctx, hit, width, height) {
  const canvasW = finite(ctx?.canvas?.width, 1060);
  const canvasH = finite(ctx?.canvas?.height, 520);
  const bounds = hit.bounds || { x: 0, y: 0, width: 0, height: 0 };
  let x = bounds.x + bounds.width + 8;
  let y = bounds.y - 6;

  if (x + width > canvasW - 8) {
    x = bounds.x - width - 8;
  }
  if (x < 8) x = 8;
  if (y + height > canvasH - 8) y = canvasH - height - 8;
  if (y < 8) y = 8;

  return { x, y };
}

export function renderInspectionPopover(ctx, hit, options = {}) {
  if (!ctx || !hit) return;

  const model = buildInspectionPopoverRows(hit, options);
  if (!model) return;

  const cardW = model.debug ? DEBUG_CARD_W : NORMAL_CARD_W;
  const cardH = PAD * 2 + 15 + model.rows.length * LINE_H;
  const { x, y } = anchorFor(ctx, hit, cardW, cardH);

  ctx.save();

  ctx.shadowColor = 'rgba(0, 0, 0, 0.26)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  roundRect(ctx, x, y, cardW, cardH, 6);
  ctx.fillStyle = model.debug ? 'rgba(32, 20, 8, 0.86)' : 'rgba(38, 27, 14, 0.58)';
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = model.hasAnomaly ? 'rgba(207, 105, 54, 0.62)' : 'rgba(215, 174, 104, 0.34)';
  ctx.lineWidth = model.debug ? 0.8 : 0.6;
  roundRect(ctx, x, y, cardW, cardH, 6);
  ctx.stroke();

  ctx.fillStyle = '#ead0a0';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(model.title, x + PAD, y + PAD);

  if (model.hasAnomaly) {
    ctx.fillStyle = 'rgba(230, 91, 59, 0.82)';
    ctx.beginPath();
    ctx.arc(x + cardW - PAD - 4, y + PAD + 5, 3, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }

  ctx.font = '9px monospace';
  ctx.fillStyle = model.debug ? 'rgba(252, 239, 204, 0.84)' : 'rgba(252, 239, 204, 0.74)';
  let rowY = y + PAD + 16;
  for (const row of model.rows) {
    ctx.fillText(row, x + PAD, rowY);
    rowY += LINE_H;
  }

  ctx.restore();
}
