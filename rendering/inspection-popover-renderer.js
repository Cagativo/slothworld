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

function workstationViewModel(component) {
  const model = component?.popoverViewModel;
  if (model && typeof model === 'object' && Array.isArray(model.lines)) return model;
  const fallback = cleanText(component?.purpose) || 'Workstation is idle';
  return {
    title: cleanText(component?.title) || cleanText(component?.label) || 'Workstation',
    lines: [fallback],
    tone: 'quiet',
    maxLines: 2,
  };
}

function workstationInspectionModel(component) {
  const model = component?.inspectionViewModel;
  if (model && typeof model === 'object' && Array.isArray(model.lines) && Array.isArray(model.taskSummaries)) {
    return model;
  }
  const fallback = cleanText(component?.purpose) || 'Ready for work';
  return {
    title: cleanText(component?.title) || cleanText(component?.label) || 'Workstation',
    statusLabel: 'Idle',
    lines: [fallback],
    taskSummaries: [],
    tone: 'quiet',
  };
}

function agentInspectionModel(component) {
  const model = component?.agentInspectionViewModel;
  if (model && typeof model === 'object' && Array.isArray(model.lines)) return model;
  return {
    targetType: 'agent',
    title: 'Sloth Worker',
    statusLabel: 'Idle',
    lines: ['Waiting for work'],
    tone: 'agent',
    maxLines: 2,
  };
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

const NORMAL_POPOVER_FORBIDDEN_PATTERNS = Object.freeze([
  /\btype\s*:/i,
  /\btarget\s*:/i,
  /\bzone\s*:/i,
  /\bpriority\s*:/i,
  /\bbounds\s*:/i,
  /\bid\s*:/i,
  /\bdebug\s*:/i,
  /\bworld-zone\b/i,
  /\bsloth-[\w-]*\b/i,
  /\bTASK_[A-Z0-9_]+\b/,
  /\bAGENT_[A-Z0-9_]+\b/,
  /\bengineCrystal\b/,
]);

function normalTextIsSafe(model) {
  const text = [
    model?.title,
    ...(Array.isArray(model?.rows) ? model.rows : []),
  ].filter(Boolean).join('\n');
  return !NORMAL_POPOVER_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text));
}

function hasLineViewModel(model) {
  return Boolean(model
    && typeof model === 'object'
    && typeof model.title === 'string'
    && Array.isArray(model.lines));
}

function hasStationInspectionViewModel(model) {
  return Boolean(model
    && typeof model === 'object'
    && typeof model.title === 'string'
    && typeof model.statusLabel === 'string'
    && Array.isArray(model.lines)
    && Array.isArray(model.taskSummaries));
}

function hasAgentInspectionViewModel(model) {
  return Boolean(model
    && typeof model === 'object'
    && typeof model.title === 'string'
    && typeof model.statusLabel === 'string'
    && Array.isArray(model.lines));
}

export function canRenderNormalPopover(targetOrHit) {
  const target = targetOrHit?.interactionTarget || targetOrHit;
  const component = targetOrHit?.component || target?.source?.component || target?.source || null;
  const type = target?.type || (
    targetOrHit?.componentType === 'task-result' ? 'taskResult'
      : targetOrHit?.componentType === 'task-chip' ? 'taskMarker'
        : targetOrHit?.componentType === 'workstation-hotspot' ? 'station'
          : targetOrHit?.componentType === 'agent-sprite' ? 'agent'
            : null
  );
  const viewModel = target?.viewModel || component?.inspectionViewModel || component?.popoverViewModel || component?.agentInspectionViewModel || null;

  if (type === 'taskResult' || type === 'taskMarker') return hasLineViewModel(viewModel);
  if (type === 'station') return hasStationInspectionViewModel(viewModel) || hasLineViewModel(viewModel);
  if (type === 'agent') return component?.normalInteractive === true && hasAgentInspectionViewModel(viewModel);
  return false;
}

export function getFriendlyPopoverViewModelForTarget(hit, options = {}) {
  if (!hit || !hit.component || options.debug === true) return null;
  if (!canRenderNormalPopover(hit)) return null;
  const component = hit.component;

  if (hit.componentType === 'workstation-hotspot') {
    const summary = component.summary && typeof component.summary === 'object' ? component.summary : {};
    if (options.selected === true) {
      const viewModel = workstationInspectionModel(component);
      return {
        title: viewModel.title,
        rows: [
          viewModel.statusLabel,
          ...viewModel.lines.slice(0, 3),
          ...viewModel.taskSummaries.slice(0, 3),
        ],
        hasAnomaly: Boolean(summary.failedTasks || summary.anomaly) || viewModel.tone === 'warning',
        debug: false,
      };
    }
    const viewModel = workstationViewModel(component);
    return {
      title: viewModel.title,
      rows: viewModel.lines.slice(0, viewModel.maxLines || 2),
      hasAnomaly: Boolean(summary.failedTasks || summary.anomaly) || viewModel.tone === 'warning',
      debug: false,
    };
  }

  if (hit.componentType === 'agent-sprite') {
    const model = agentInspectionModel(component);
    return {
      title: cleanText(model.title) || 'Sloth Worker',
      rows: [model.statusLabel, ...model.lines.slice(0, model.maxLines || 2)],
      hasAnomaly: model.tone === 'warning',
      debug: false,
    };
  }

  if (component.popoverViewModel && typeof component.popoverViewModel === 'object') {
    const model = component.popoverViewModel;
    const rows = Array.isArray(model.lines) ? model.lines.slice(0, 4) : [];
    return {
      title: cleanText(model.title) || (hit.componentType === 'task-chip' ? 'Task' : 'Result'),
      rows,
      hasAnomaly: model.tone === 'warning',
      debug: false,
    };
  }

  return null;
}

export function buildInspectionPopoverRows(hit, options = {}) {
  if (!hit || !hit.component) return null;

  const component = hit.component;
  const isDebug = Boolean(options.debug);
  if (!isDebug) {
    const friendlyModel = getFriendlyPopoverViewModelForTarget(hit, options);
    return friendlyModel && normalTextIsSafe(friendlyModel) ? friendlyModel : null;
  }
  const rows = [];
  rows.push(`type: ${typeLabel(hit.componentType)}`);
  if (hit.interactionTarget) {
    rows.push(`target: ${hit.interactionTarget.type}`);
    rows.push(`priority: ${hit.interactionTarget.priority}`);
  }

  if (hit.componentType === 'workstation-hotspot') {
    const summary = component.summary && typeof component.summary === 'object' ? component.summary : {};
    const activeTasks = summary.activeTasks ?? 0;
    const waitingTasks = summary.waitingTasks ?? 0;
    rows.push(`active tasks: ${activeTasks}`);
    rows.push(`waiting tasks: ${waitingTasks}`);
    rows.push(`created tasks: ${summary.createdTasks ?? 0}`);
    rows.push(`processing tasks: ${summary.processingTasks ?? 0}`);
    rows.push(`completed tasks: ${summary.completedTasks ?? 0}`);
    rows.push(`failed tasks: ${summary.failedTasks ?? 0}`);
    rows.push(`semantic active: ${summary.semanticActiveTasks ?? 0}`);
    rows.push(`station active: ${summary.focusedActiveTasks ?? 0}`);
    rows.push(`station waiting: ${summary.focusedWaitingTasks ?? 0}`);
    rows.push(`station processing: ${summary.focusedProcessingTasks ?? 0}`);
    rows.push(`station completed: ${summary.focusedCompletedTasks ?? 0}`);
    rows.push(`station failed: ${summary.focusedFailedTasks ?? 0}`);
    if (summary.anomaly) rows.push('attention: yes');
    rows.push(`assigned agents: ${summary.assignedAgents ?? 0}`);
    const id = cleanText(component.id);
    if (id) rows.push(`id: ${id}`);
    const zoneId = cleanText(component.zoneId);
    const worldZoneId = cleanText(component.worldZoneId);
    if (worldZoneId) rows.push(`world zone: ${worldZoneId}`);
    if (zoneId) rows.push(`lifecycle zone: ${zoneId}`);
    if (hit.bounds) {
      rows.push(`bounds: ${Math.round(hit.bounds.x)},${Math.round(hit.bounds.y)} ${Math.round(hit.bounds.width)}x${Math.round(hit.bounds.height)}`);
    }
    return {
      title: titleFor(component, hit.componentType),
      rows,
      hasAnomaly: Boolean(summary.failedTasks || summary.anomaly),
      debug: true,
    };
  }

  const visualState = cleanText(component.visualState);
  if (visualState && (isDebug || visualState !== 'unknown')) rows.push(`status: ${visualState}`);

  const zone = cleanText(component.worldZoneId) || cleanText(component.zoneId);
  if (zone) rows.push(`zone: ${zone}`);

  if (hit.componentType === 'agent-sprite') {
    const currentTaskId = cleanText(component.currentTaskId);
    if (currentTaskId) rows.push(`current task: ${currentTaskId}`);
  }

  rows.push(...metricRows(component.metrics));

  if (component.anomaly) {
    const severity = cleanText(component.anomaly.severity) || 'unknown';
    const detail = cleanText(component.anomaly.type) || 'anomaly';
    rows.push(`anomaly: ${severity} ${detail}`);
  }

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
  if (hit.componentType === 'workstation-hotspot' && hit.component?.popoverAnchor) {
    const anchor = hit.component.popoverAnchor;
    const scaledX = finite(anchor.x, 0) * canvasW / 1060;
    const scaledY = finite(anchor.y, 0) * canvasH / 520;
    return {
      x: Math.max(8, Math.min(canvasW - width - 8, scaledX + 8)),
      y: Math.max(8, Math.min(canvasH - height - 8, scaledY - 6)),
    };
  }
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
