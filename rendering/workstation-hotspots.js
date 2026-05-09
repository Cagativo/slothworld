/**
 * workstation-hotspots.js
 *
 * Frozen render-only interaction hotspots for the baked Slothworld room plate.
 * Summaries are derived only from render component descriptors.
 */

import {
  WORKSTATION_HOTSPOTS,
  getWorkstationHotspotById,
} from '../ui/hotspots/workstationHotspots.js';
import {
  buildWorkstationNormalSummaryRows,
  buildWorkstationInspectionViewModel,
  buildWorkstationPopoverViewModel,
  buildResearchDeskResultCardViewModel,
  buildWorkstationVisualStateViewModel,
  getWorkstationSemanticMetadata,
} from '../ui/hotspots/workstationSemantics.js';

export { WORKSTATION_HOTSPOTS, getWorkstationHotspotById };
export { buildWorkstationNormalSummaryRows };

const WAITING_STATES = Object.freeze(['idle', 'waiting']);
const ACTIVE_STATES = Object.freeze(['working', 'processing']);
const PROCESSING_STATES = Object.freeze(['processing']);
const COMPLETED_STATES = Object.freeze(['completed']);

function matchesHotspot(component, hotspot) {
  return hotspot.worldZoneIds.includes(component.worldZoneId) || hotspot.zoneIds.includes(component.zoneId);
}

function textForSemanticMatch(component) {
  return [
    component.taskType,
    component.title,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();
}

function matchesSemanticTokens(component, hotspot) {
  const semantics = getWorkstationSemanticMetadata(hotspot.id);
  if (!semantics || semantics.tokens.length === 0) return true;
  const text = textForSemanticMatch(component);
  return semantics.tokens.some((token) => text.includes(token));
}

function matchesPrimaryWorldZone(component, hotspot) {
  return hotspot.worldZoneIds.includes(component.worldZoneId);
}

function safeStationWorkItems(hotspot, components) {
  if (!hotspot || !Array.isArray(components)) return Object.freeze([]);
  const items = [];
  for (const component of components) {
    if (!component || component.componentType !== 'task-chip') continue;
    if (!matchesHotspot(component, hotspot)) continue;
    if (!matchesPrimaryWorldZone(component, hotspot) && !matchesSemanticTokens(component, hotspot)) continue;
    items.push(Object.freeze({
      title: typeof component.title === 'string' ? component.title : null,
      taskType: typeof component.taskType === 'string' ? component.taskType : null,
      visualState: typeof component.visualState === 'string' ? component.visualState : 'unknown',
      anomaly: Boolean(component.anomaly),
    }));
    if (items.length >= 6) break;
  }
  return Object.freeze(items);
}

export function summarizeHotspotFromComponents(hotspot, components) {
  const summary = {
    activeTasks: 0,
    waitingTasks: 0,
    failedTasks: 0,
    anomaly: false,
    activeAgents: 0,
    assignedAgents: 0,
    createdTasks: 0,
    processingTasks: 0,
    completedTasks: 0,
    semanticActiveTasks: 0,
    focusedActiveTasks: 0,
    focusedWaitingTasks: 0,
    focusedProcessingTasks: 0,
    focusedCompletedTasks: 0,
    focusedFailedTasks: 0,
  };

  if (!hotspot || !Array.isArray(components)) return Object.freeze(summary);

  for (const component of components) {
    if (!component || !matchesHotspot(component, hotspot)) continue;

    if (component.componentType === 'task-chip') {
      if (ACTIVE_STATES.includes(component.visualState)) summary.activeTasks++;
      if (WAITING_STATES.includes(component.visualState)) summary.waitingTasks++;
      if (component.visualState === 'idle') summary.createdTasks++;
      if (PROCESSING_STATES.includes(component.visualState)) summary.processingTasks++;
      if (COMPLETED_STATES.includes(component.visualState)) summary.completedTasks++;
      if (component.visualState === 'error') summary.failedTasks++;
      if (component.anomaly) summary.anomaly = true;
      if (ACTIVE_STATES.includes(component.visualState) && matchesSemanticTokens(component, hotspot)) {
        summary.semanticActiveTasks++;
      }
      if (matchesPrimaryWorldZone(component, hotspot)) {
        if (component.visualState === 'working') summary.focusedActiveTasks++;
        if (WAITING_STATES.includes(component.visualState)) summary.focusedWaitingTasks++;
        if (PROCESSING_STATES.includes(component.visualState)) summary.focusedProcessingTasks++;
        if (COMPLETED_STATES.includes(component.visualState)) summary.focusedCompletedTasks++;
        if (component.visualState === 'error') summary.focusedFailedTasks++;
      }
    }

    if (component.componentType === 'agent-sprite') {
      if (ACTIVE_STATES.includes(component.visualState) || component.visualState === 'error') summary.activeAgents++;
      if (component.currentTaskId) summary.assignedAgents++;
      if (component.anomaly) summary.anomaly = true;
    }
  }

  return Object.freeze(summary);
}

function resolveStationSnapshot(hotspot, stationSnapshots) {
  if (!stationSnapshots || typeof stationSnapshots !== 'object') return null;
  const semantics = getWorkstationSemanticMetadata(hotspot?.id);
  const stationKey = semantics?.stationKey;
  if (!stationKey) return null;
  const snapshot = stationSnapshots[stationKey];
  return snapshot && typeof snapshot === 'object' ? snapshot : null;
}

export function componentForHotspot(hotspot, components, options = {}) {
  const summary = summarizeHotspotFromComponents(hotspot, components);
  const stationWorkItems = safeStationWorkItems(hotspot, components);
  const stationSnapshot = resolveStationSnapshot(hotspot, options.stationSnapshots);
  const component = {
    componentType: 'workstation-hotspot',
    id: hotspot.id,
    label: hotspot.label || hotspot.title,
    title: hotspot.title || hotspot.label,
    purpose: hotspot.purpose || null,
    popoverAnchor: hotspot.popoverAnchor || null,
    worldZoneId: hotspot.worldZoneIds[0] || null,
    zoneId: hotspot.zoneIds[0] || null,
    summary,
    stationWorkItems,
    stationSnapshot,
  };
  const visualStateViewModel = buildWorkstationVisualStateViewModel(component);
  const enrichedComponent = {
    ...component,
    popoverViewModel: buildWorkstationPopoverViewModel(component),
    visualStateViewModel,
    resultCardViewModel: buildResearchDeskResultCardViewModel(stationSnapshot),
  };
  return Object.freeze({
    ...enrichedComponent,
    inspectionViewModel: buildWorkstationInspectionViewModel(enrichedComponent),
  });
}

export function buildWorkstationHotspotComponents(hotspots, components, options = {}) {
  const sourceHotspots = Array.isArray(hotspots) ? hotspots : WORKSTATION_HOTSPOTS;
  return Object.freeze(sourceHotspots.map((hotspot) => componentForHotspot(hotspot, components, options)));
}

export function renderWorkstationHotspotDebug(ctx) {
  if (!ctx) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(125, 230, 205, 0.86)';
  ctx.fillStyle = 'rgba(18, 35, 28, 0.72)';
  ctx.lineWidth = 1;
  ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const hotspot of WORKSTATION_HOTSPOTS) {
    const b = hotspot.bounds;
    ctx.strokeRect(b.x, b.y, b.width, b.height);
    ctx.fillRect(b.x, b.y, Math.max(80, hotspot.id.length * 5 + 8), 12);
    ctx.fillStyle = '#d9fff0';
    ctx.fillText(hotspot.id, b.x + 4, b.y + 2);
    ctx.fillStyle = 'rgba(18, 35, 28, 0.72)';
  }
  ctx.restore();
}

function anchorCenter(hotspot) {
  const anchor = hotspot.highlightAnchor || hotspot.feedbackAnchor || hotspot.bounds;
  const bounds = anchor.bounds || null;
  if (bounds) {
    return {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      radius: Math.max(10, Math.min(24, Math.max(bounds.width, bounds.height) * 0.42)),
    };
  }
  return {
    x: anchor.x ?? hotspot.bounds.x + hotspot.bounds.width / 2,
    y: anchor.y ?? hotspot.bounds.y + hotspot.bounds.height / 2,
    radius: Math.max(10, Math.min(24, (anchor.scale ?? 1) * 18)),
  };
}

function isHotspotHovered(hotspot, inspectionState) {
  return inspectionState?.hoveredComponentType === 'workstation-hotspot'
    && inspectionState?.hoveredEntityId === hotspot.id;
}

function drawSoftGlow(ctx, point, color, alpha, radiusScale = 1) {
  const radius = point.radius * radiusScale;
  const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
  glow.addColorStop(0, color.inner);
  glow.addColorStop(0.46, color.mid);
  glow.addColorStop(1, color.outer);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawHoverShimmer(ctx, point, kind) {
  ctx.globalAlpha = kind === 'warning' ? 0.28 : 0.20;
  ctx.strokeStyle = kind === 'warning' ? 'rgba(255, 202, 110, 0.82)' : 'rgba(197, 245, 232, 0.72)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y, point.radius * 0.92, point.radius * 0.42, -0.12, 0, Math.PI * 2);
  ctx.stroke();
}

function drawLiveBadge(ctx, point, color, anomaly) {
  const badgeRadius = anomaly ? 3.8 : 3;
  ctx.globalAlpha = anomaly ? 0.82 : 0.58;
  ctx.fillStyle = anomaly ? 'rgba(255, 188, 83, 0.92)' : color.dot;
  ctx.beginPath();
  ctx.arc(point.x + point.radius * 0.42, point.y - point.radius * 0.34, badgeRadius, 0, Math.PI * 2);
  ctx.fill();
}

function paletteForHotspot(hotspot, summary) {
  if (summary.anomaly || summary.failedTasks > 0 || hotspot.feedbackKind === 'warning') {
    return {
      inner: 'rgba(255, 222, 138, 0.58)',
      mid: 'rgba(255, 173, 82, 0.22)',
      outer: 'rgba(255, 173, 82, 0)',
      dot: 'rgba(255, 202, 110, 0.88)',
    };
  }
  if (hotspot.feedbackKind === 'crystal') {
    return {
      inner: 'rgba(187, 246, 255, 0.46)',
      mid: 'rgba(121, 220, 235, 0.18)',
      outer: 'rgba(121, 220, 235, 0)',
      dot: 'rgba(185, 248, 255, 0.72)',
    };
  }
  return {
    inner: 'rgba(193, 248, 228, 0.42)',
    mid: 'rgba(122, 224, 196, 0.16)',
    outer: 'rgba(122, 224, 196, 0)',
    dot: 'rgba(185, 248, 218, 0.68)',
  };
}

/**
 * Draws quiet normal-mode affordances over the baked room plate.
 * Inactive hotspots intentionally produce no visible draw calls.
 */
export function renderWorkstationHotspotFeedback(ctx, components, inspectionState, options = {}) {
  if (!ctx || options.debug === true || options.bakedBackground !== true) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const hotspot of WORKSTATION_HOTSPOTS) {
    const summary = summarizeHotspotFromComponents(hotspot, components);
    const hovered = isHotspotHovered(hotspot, inspectionState);
    const active = summary.activeTasks > 0
      || summary.failedTasks > 0
      || summary.activeAgents > 0
      || summary.assignedAgents > 0
      || summary.anomaly;

    if (!hovered && !active) continue;

    const point = anchorCenter(hotspot);
    const palette = paletteForHotspot(hotspot, summary);
    const anomaly = summary.anomaly || summary.failedTasks > 0 || hotspot.feedbackKind === 'warning';

    if (hovered) {
      drawSoftGlow(ctx, point, palette, anomaly ? 0.24 : 0.16, anomaly ? 1.25 : 1.08);
      drawHoverShimmer(ctx, point, hotspot.feedbackKind);
    }
    if (active) {
      drawSoftGlow(ctx, point, palette, anomaly ? 0.20 : 0.10, anomaly ? 1.08 : 0.82);
      drawLiveBadge(ctx, point, palette, anomaly);
    }
  }
  ctx.restore();
}
