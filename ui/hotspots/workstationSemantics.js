/**
 * Friendly workstation semantics.
 *
 * Static station copy and matching hints only. Geometry stays in
 * workstationHotspots.js; renderer-facing status should come from view models.
 */

export const WORKSTATION_SEMANTICS = Object.freeze({
  engineCrystalHotspot: Object.freeze({
    stationKey: 'engine_core',
    title: 'Engine Core',
    purpose: 'Keeps the queue moving through the workshop.',
    idleText: 'Queue is healthy',
    role: 'orchestration',
    tone: 'core',
    statusLabel: 'engine',
    tokens: Object.freeze([]),
  }),
  intakeDeskHotspot: Object.freeze({
    stationKey: 'intake_desk',
    title: 'Intake Desk',
    purpose: 'Collects new requests before work begins.',
    idleText: 'Ready for new requests',
    role: 'intake',
    tone: 'quiet',
    statusLabel: 'request',
    tokens: Object.freeze([]),
  }),
  researchMonitorHotspot: Object.freeze({
    stationKey: 'research_desk',
    title: 'Research Desk',
    purpose: 'Scans trends, signals, and product ideas.',
    idleText: 'Ready to scan trends',
    role: 'research',
    tone: 'curious',
    statusLabel: 'scan',
    tokens: Object.freeze(['trend', 'research', 'scan', 'signal', 'candidate']),
  }),
  shopifyMonitorHotspot: Object.freeze({
    stationKey: 'shopify_desk',
    title: 'Shopify Desk',
    purpose: 'Prepares listings, products, and publishing work.',
    idleText: 'Listings are quiet',
    role: 'commerce',
    tone: 'shop',
    statusLabel: 'listing',
    tokens: Object.freeze(['shopify', 'listing', 'product', 'order', 'publish']),
  }),
  renderMonitorHotspot: Object.freeze({
    stationKey: 'render_desk',
    title: 'Render Desk',
    purpose: 'Shapes image, render, and design work.',
    idleText: 'Render table is idle',
    role: 'rendering',
    tone: 'creative',
    statusLabel: 'render',
    tokens: Object.freeze(['image', 'render', 'design', 'prompt']),
  }),
  supportMonitorHotspot: Object.freeze({
    stationKey: 'support_desk',
    title: 'Support Desk',
    purpose: 'Watches Discord, messages, and support replies.',
    idleText: 'No messages waiting',
    role: 'support',
    tone: 'social',
    statusLabel: 'message',
    tokens: Object.freeze(['discord', 'support', 'message', 'reply', 'notification']),
  }),
  approvalDeskHotspot: Object.freeze({
    stationKey: 'approval_desk',
    title: 'Approval Desk',
    purpose: 'Reviews finished work before delivery.',
    idleText: 'Nothing awaiting review',
    role: 'approval',
    tone: 'review',
    statusLabel: 'approval',
    tokens: Object.freeze([]),
  }),
  archiveShelfHotspot: Object.freeze({
    stationKey: 'archive_shelf',
    title: 'Archive Shelf',
    purpose: 'Stores completed results and history.',
    idleText: 'Archive is quiet',
    role: 'archive',
    tone: 'archive',
    statusLabel: 'archive',
    tokens: Object.freeze([]),
  }),
  anomalyShelfHotspot: Object.freeze({
    stationKey: 'anomaly_shelf',
    title: 'Anomaly Shelf',
    purpose: 'Flags work that needs attention.',
    idleText: 'No alerts right now',
    role: 'attention',
    tone: 'warning',
    statusLabel: 'attention',
    tokens: Object.freeze([]),
  }),
});

export function getWorkstationSemanticMetadata(hotspotId) {
  return WORKSTATION_SEMANTICS[hotspotId] || null;
}

const MAX_BODY_LINES = 2;

function count(summary, key) {
  const value = summary?.[key];
  return Number.isFinite(value) ? value : 0;
}

function pushLine(lines, text) {
  if (text && lines.length < MAX_BODY_LINES) lines.push(text);
}

function pushInspectionLine(lines, text) {
  if (text && lines.length < MAX_INSPECTION_LINES) lines.push(text);
}

function plural(countValue, singular, pluralValue = `${singular}s`) {
  return countValue === 1 ? singular : pluralValue;
}

function countLine(countValue, label) {
  if (countValue <= 0) return null;
  return `${countValue} ${label}`;
}

function genericActiveLine(summary, metadata) {
  const active = count(summary, 'semanticActiveTasks');
  if (active <= 0) return null;
  const label = metadata?.statusLabel || 'task';
  return `${active} ${label} ${plural(active, 'active', 'active')}`;
}

function snapshotCurrentWorkLines(snapshot, metadata) {
  if (!snapshot || !snapshot.currentWork || snapshot.currentWork.count <= 0) return [];
  const countValue = Number.isFinite(snapshot.currentWork.count) ? snapshot.currentWork.count : 0;
  const label = metadata?.statusLabel || 'task';
  const lines = [`${countValue} ${label} active`];
  const firstItem = Array.isArray(snapshot.currentWork.items) ? snapshot.currentWork.items[0] : null;
  if (firstItem && typeof firstItem.summary === 'string' && firstItem.summary.trim()) {
    lines.push(firstItem.summary.trim());
  } else if (firstItem && typeof firstItem.title === 'string' && firstItem.title.trim()) {
    lines.push(firstItem.title.trim());
  }
  return lines;
}

function snapshotLastResultLines(snapshot) {
  if (!snapshot || !snapshot.lastResult) return [];
  const lines = [];
  const status = snapshot.lastResult.status ? titleCaseToken(snapshot.lastResult.status) : 'Completed';
  lines.push(`Last result: ${status}`);
  if (typeof snapshot.lastResult.summary === 'string' && snapshot.lastResult.summary.trim()) {
    lines.push(snapshot.lastResult.summary.trim());
  } else if (typeof snapshot.lastResult.title === 'string' && snapshot.lastResult.title.trim()) {
    lines.push(snapshot.lastResult.title.trim());
  }
  return lines;
}

function buildSnapshotPreferredLines(component, metadata) {
  const snapshot = component?.stationSnapshot && typeof component.stationSnapshot === 'object'
    ? component.stationSnapshot
    : null;
  const currentLines = snapshotCurrentWorkLines(snapshot, metadata);
  if (currentLines.length > 0) return currentLines;
  return snapshotLastResultLines(snapshot);
}

function buildStatusLines(hotspotId, summary, metadata) {
  const lines = [];

  if (hotspotId === 'engineCrystalHotspot') {
    pushLine(lines, countLine(count(summary, 'focusedWaitingTasks'), 'queued'));
    pushLine(lines, countLine(count(summary, 'focusedActiveTasks'), 'active'));
    pushLine(lines, countLine(count(summary, 'focusedProcessingTasks'), 'processing'));
    if (count(summary, 'focusedFailedTasks') > 0) pushLine(lines, 'attention needed');
    return lines;
  }

  if (hotspotId === 'intakeDeskHotspot') {
    pushLine(lines, countLine(count(summary, 'focusedWaitingTasks'), 'waiting'));
    return lines;
  }

  if (hotspotId === 'approvalDeskHotspot') {
    pushLine(lines, countLine(count(summary, 'focusedProcessingTasks'), 'awaiting approval'));
    pushLine(lines, countLine(count(summary, 'focusedActiveTasks'), 'approval active'));
    return lines;
  }

  if (hotspotId === 'archiveShelfHotspot') {
    const completed = count(summary, 'focusedCompletedTasks');
    if (completed > 0) pushLine(lines, `archive: ${completed} complete`);
    return lines;
  }

  if (hotspotId === 'anomalyShelfHotspot') {
    const failed = count(summary, 'focusedFailedTasks');
    if (failed > 0 || summary?.anomaly) pushLine(lines, 'attention needed');
    pushLine(lines, countLine(failed, 'failed'));
    return lines;
  }

  pushLine(lines, genericActiveLine(summary, metadata));
  if (count(summary, 'failedTasks') > 0 || summary?.anomaly) pushLine(lines, 'attention needed');
  return lines;
}

export function buildWorkstationPopoverViewModel(component) {
  const hotspotId = component?.id || null;
  const metadata = getWorkstationSemanticMetadata(hotspotId);
  const summary = component?.summary && typeof component.summary === 'object' ? component.summary : {};
  const snapshotLines = buildSnapshotPreferredLines(component, metadata);
  const lines = snapshotLines.length > 0
    ? snapshotLines.slice(0, MAX_BODY_LINES)
    : buildStatusLines(hotspotId, summary, metadata);
  const fallback = metadata?.idleText || metadata?.purpose || component?.purpose || 'Workstation is idle';

  if (lines.length === 0) pushLine(lines, fallback);

  return Object.freeze({
    hotspotId,
    title: metadata?.title || component?.title || component?.label || 'Workstation',
    lines: Object.freeze(lines.slice(0, MAX_BODY_LINES)),
    tone: metadata?.tone || 'quiet',
    maxLines: MAX_BODY_LINES,
  });
}

export function buildWorkstationNormalSummaryRows(component) {
  return buildWorkstationPopoverViewModel(component).lines;
}

const VISUAL_STATES = Object.freeze(['idle', 'queued', 'working', 'awaiting', 'completed', 'failed']);
const VISUAL_EFFECTS = Object.freeze(['none', 'pulse', 'shimmer', 'sparkle', 'glint']);

function visualModel(hotspotId, metadata, visualState, effect, intensity = 0.7) {
  const safeState = VISUAL_STATES.includes(visualState) ? visualState : 'idle';
  const safeEffect = VISUAL_EFFECTS.includes(effect) ? effect : 'none';
  return Object.freeze({
    hotspotId,
    visualState: safeState,
    tone: metadata?.tone || 'quiet',
    intensity: safeState === 'idle' ? 0 : Math.min(1, Math.max(0.18, intensity)),
    effect: safeState === 'idle' ? 'none' : safeEffect,
  });
}

export function buildWorkstationVisualStateViewModel(component) {
  const hotspotId = component?.id || null;
  const metadata = getWorkstationSemanticMetadata(hotspotId);
  const summary = component?.summary && typeof component.summary === 'object' ? component.summary : {};

  if (summary.anomaly || count(summary, 'focusedFailedTasks') > 0 || count(summary, 'failedTasks') > 0) {
    return visualModel(hotspotId, metadata, 'failed', 'glint', 0.9);
  }

  if (hotspotId === 'engineCrystalHotspot') {
    if (count(summary, 'focusedProcessingTasks') > 0 || count(summary, 'focusedActiveTasks') > 0) {
      return visualModel(hotspotId, metadata, 'working', 'shimmer', 0.72);
    }
    if (count(summary, 'focusedWaitingTasks') > 0) {
      return visualModel(hotspotId, metadata, 'queued', 'pulse', 0.58);
    }
    return visualModel(hotspotId, metadata, 'idle', 'none', 0);
  }

  if (hotspotId === 'intakeDeskHotspot') {
    if (count(summary, 'focusedWaitingTasks') > 0 || count(summary, 'createdTasks') > 0) {
      return visualModel(hotspotId, metadata, 'queued', 'pulse', 0.52);
    }
    return visualModel(hotspotId, metadata, 'idle', 'none', 0);
  }

  if (hotspotId === 'approvalDeskHotspot') {
    if (count(summary, 'focusedProcessingTasks') > 0 || count(summary, 'focusedActiveTasks') > 0) {
      return visualModel(hotspotId, metadata, 'awaiting', 'pulse', 0.66);
    }
    return visualModel(hotspotId, metadata, 'idle', 'none', 0);
  }

  if (hotspotId === 'archiveShelfHotspot') {
    if (count(summary, 'focusedCompletedTasks') > 0) {
      return visualModel(hotspotId, metadata, 'completed', 'sparkle', 0.48);
    }
    return visualModel(hotspotId, metadata, 'idle', 'none', 0);
  }

  if (hotspotId === 'anomalyShelfHotspot') {
    return visualModel(hotspotId, metadata, 'idle', 'none', 0);
  }

  if (hotspotId === 'shopifyMonitorHotspot') {
    if (count(summary, 'focusedProcessingTasks') > 0) {
      return visualModel(hotspotId, metadata, 'awaiting', 'pulse', 0.58);
    }
    if (count(summary, 'semanticActiveTasks') > 0 || count(summary, 'focusedActiveTasks') > 0) {
      return visualModel(hotspotId, metadata, 'working', 'shimmer', 0.58);
    }
    if (count(summary, 'focusedWaitingTasks') > 0) {
      return visualModel(hotspotId, metadata, 'queued', 'pulse', 0.44);
    }
    return visualModel(hotspotId, metadata, 'idle', 'none', 0);
  }

  if (hotspotId === 'supportMonitorHotspot') {
    if (count(summary, 'semanticActiveTasks') > 0 || count(summary, 'focusedActiveTasks') > 0) {
      return visualModel(hotspotId, metadata, 'working', 'shimmer', 0.54);
    }
    if (count(summary, 'focusedWaitingTasks') > 0) {
      return visualModel(hotspotId, metadata, 'queued', 'pulse', 0.42);
    }
    return visualModel(hotspotId, metadata, 'idle', 'none', 0);
  }

  if (count(summary, 'semanticActiveTasks') > 0 || count(summary, 'focusedActiveTasks') > 0) {
    return visualModel(hotspotId, metadata, 'working', 'shimmer', 0.56);
  }

  return visualModel(hotspotId, metadata, 'idle', 'none', 0);
}

const MAX_INSPECTION_LINES = 3;
const MAX_TASK_SUMMARIES = 3;

function titleCaseToken(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyTaskLabel(workItem, metadata) {
  const text = [workItem?.title, workItem?.taskType]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();
  if (text.includes('trend') || text.includes('research') || text.includes('scan')) return 'Trend scan';
  if (text.includes('image') || text.includes('render') || text.includes('mockup') || text.includes('design')) return 'Image render';
  if (text.includes('shopify') || text.includes('listing') || text.includes('product') || text.includes('publish')) return 'Listing work';
  if (text.includes('discord') || text.includes('support') || text.includes('message') || text.includes('reply')) return 'Support message';
  if (text.includes('approval') || text.includes('approve') || text.includes('review')) return 'Review item';
  if (workItem?.anomaly) return 'Needs attention';
  return metadata?.statusLabel ? titleCaseToken(`${metadata.statusLabel} work`) : 'Work item';
}

function friendlyTaskState(visualState) {
  if (visualState === 'error') return 'needs attention';
  if (visualState === 'completed') return 'complete';
  if (visualState === 'processing') return 'processing';
  if (visualState === 'working') return 'active';
  if (visualState === 'idle' || visualState === 'waiting') return 'waiting';
  return null;
}

function buildTaskSummaries(workItems, metadata) {
  if (!Array.isArray(workItems)) return [];
  const rows = [];
  for (const item of workItems) {
    const state = friendlyTaskState(item?.visualState);
    const label = friendlyTaskLabel(item, metadata);
    const text = state ? `${label}: ${state}` : label;
    if (!rows.includes(text)) rows.push(text);
    if (rows.length >= MAX_TASK_SUMMARIES) break;
  }
  return rows;
}

function statusLabelForInspection(hotspotId, visualModelValue, summary) {
  if (visualModelValue.visualState === 'failed') return 'Needs attention';
  if (visualModelValue.visualState === 'awaiting') return 'Awaiting review';
  if (visualModelValue.visualState === 'completed') return 'Recently completed';
  if (visualModelValue.visualState === 'working') return 'Active';
  if (visualModelValue.visualState === 'queued') return hotspotId === 'intakeDeskHotspot' ? 'Requests waiting' : 'Queued';
  if (count(summary, 'focusedWaitingTasks') > 0) return 'Waiting';
  return 'Idle';
}

function idleInspectionLine(metadata) {
  if (!metadata) return 'Ready for work';
  if (metadata.stationKey === 'render_desk') return 'Ready for image and mockup work';
  if (metadata.stationKey === 'research_desk') return 'Ready for trend research';
  if (metadata.stationKey === 'shopify_desk') return 'Ready for listing work';
  if (metadata.stationKey === 'support_desk') return 'Ready for messages';
  if (metadata.stationKey === 'approval_desk') return 'Ready for review';
  if (metadata.stationKey === 'archive_shelf') return 'Ready to store completed results';
  if (metadata.stationKey === 'anomaly_shelf') return 'Watching for work that needs attention';
  if (metadata.stationKey === 'intake_desk') return 'Ready for new requests';
  if (metadata.stationKey === 'engine_core') return 'Queue is healthy';
  return metadata.idleText || metadata.purpose || 'Ready for work';
}

function buildInspectionLines(component, metadata, visualModelValue, taskSummaries) {
  const summary = component?.summary || {};
  const lines = [];
  if (visualModelValue.visualState === 'idle' && taskSummaries.length === 0) {
    pushInspectionLine(lines, idleInspectionLine(metadata));
    return lines.slice(0, MAX_INSPECTION_LINES);
  }

  if (component?.id === 'engineCrystalHotspot') {
    pushInspectionLine(lines, countLine(count(summary, 'focusedWaitingTasks'), 'queued'));
    pushInspectionLine(lines, countLine(count(summary, 'focusedProcessingTasks'), 'processing'));
    pushInspectionLine(lines, countLine(count(summary, 'focusedActiveTasks'), 'active'));
    return lines.slice(0, MAX_INSPECTION_LINES);
  }

  if (component?.id === 'archiveShelfHotspot') {
    pushInspectionLine(lines, countLine(count(summary, 'focusedCompletedTasks'), 'completed result'));
    return lines.slice(0, MAX_INSPECTION_LINES);
  }

  if (component?.id === 'anomalyShelfHotspot') {
    if (count(summary, 'focusedFailedTasks') > 0 || summary.anomaly) pushInspectionLine(lines, 'Attention needed');
    pushInspectionLine(lines, countLine(count(summary, 'focusedFailedTasks'), 'failed item'));
    return lines.slice(0, MAX_INSPECTION_LINES);
  }

  pushInspectionLine(lines, countLine(count(summary, 'focusedWaitingTasks'), 'waiting'));
  pushInspectionLine(lines, countLine(count(summary, 'focusedProcessingTasks'), 'processing'));
  pushInspectionLine(lines, countLine(count(summary, 'semanticActiveTasks') || count(summary, 'focusedActiveTasks'), 'active'));
  if (lines.length === 0 && taskSummaries.length > 0) pushInspectionLine(lines, metadata?.purpose || 'Work is attached here');
  return lines.slice(0, MAX_INSPECTION_LINES);
}

export function buildWorkstationInspectionViewModel(component) {
  const hotspotId = component?.id || null;
  const metadata = getWorkstationSemanticMetadata(hotspotId);
  const visualState = component?.visualStateViewModel || buildWorkstationVisualStateViewModel(component);
  const summary = component?.summary && typeof component.summary === 'object' ? component.summary : {};
  const taskSummaries = buildTaskSummaries(component?.stationWorkItems, metadata);
  const lines = buildInspectionLines(component, metadata, visualState, taskSummaries);

  return Object.freeze({
    stationId: metadata?.stationKey || hotspotId,
    hotspotId,
    title: metadata?.title || component?.title || component?.label || 'Workstation',
    statusLabel: statusLabelForInspection(hotspotId, visualState, summary),
    tone: metadata?.tone || 'quiet',
    lines: Object.freeze(lines.slice(0, MAX_INSPECTION_LINES)),
    taskSummaries: Object.freeze(taskSummaries.slice(0, MAX_TASK_SUMMARIES)),
  });
}
