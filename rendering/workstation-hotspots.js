/**
 * workstation-hotspots.js
 *
 * Frozen render-only interaction hotspots for the baked Slothworld room plate.
 * Summaries are derived only from render component descriptors.
 */

import { SCENE_ANCHORS } from './scene-anchors.js';

function hotspot(config) {
  return Object.freeze({
    id: config.id,
    label: config.label,
    worldZoneIds: Object.freeze(config.worldZoneIds || []),
    zoneIds: Object.freeze(config.zoneIds || []),
    bounds: Object.freeze({ ...config.bounds }),
    feedbackAnchor: Object.freeze(config.feedbackAnchor || config.bounds),
    feedbackKind: config.feedbackKind || 'monitor',
  });
}

function boundsFrom(anchor, inflate = 0) {
  const b = anchor.bounds || { x: anchor.x - 20, y: anchor.y - 20, width: 40, height: 40 };
  return {
    x: b.x - inflate,
    y: b.y - inflate,
    width: b.width + inflate * 2,
    height: b.height + inflate * 2,
  };
}

export const WORKSTATION_HOTSPOTS = Object.freeze([
  hotspot({
    id: 'engineCrystalHotspot',
    label: 'Engine Core',
    worldZoneIds: ['engineCrystal'],
    zoneIds: ['ENQUEUED'],
    bounds: { x: 454, y: 118, width: 78, height: 292 },
    feedbackAnchor: SCENE_ANCHORS.crystal.engineCrystal,
    feedbackKind: 'crystal',
  }),
  hotspot({
    id: 'intakeDeskHotspot',
    label: 'Intake Desk',
    worldZoneIds: ['intakeDesk'],
    zoneIds: ['CREATED'],
    bounds: { x: 44, y: 116, width: 172, height: 126 },
    feedbackAnchor: SCENE_ANCHORS.shelves.intakeShelf,
    feedbackKind: 'shelf',
  }),
  hotspot({
    id: 'researchMonitorHotspot',
    label: 'Research Desk',
    worldZoneIds: ['researchDesk'],
    zoneIds: ['CLAIMED'],
    bounds: boundsFrom(SCENE_ANCHORS.desks['desk-0'], -24),
    feedbackAnchor: SCENE_ANCHORS.desks['desk-0'],
  }),
  hotspot({
    id: 'shopifyMonitorHotspot',
    label: 'Shopify Desk',
    worldZoneIds: ['shopifyDesk'],
    zoneIds: ['CLAIMED'],
    bounds: boundsFrom(SCENE_ANCHORS.desks['desk-1'], -34),
    feedbackAnchor: SCENE_ANCHORS.desks['desk-1'],
  }),
  hotspot({
    id: 'renderMonitorHotspot',
    label: 'Render Desk',
    worldZoneIds: ['renderDesk'],
    zoneIds: ['EXECUTE_FINISHED'],
    bounds: boundsFrom(SCENE_ANCHORS.desks['desk-4'], -46),
    feedbackAnchor: SCENE_ANCHORS.desks['desk-4'],
  }),
  hotspot({
    id: 'supportMonitorHotspot',
    label: 'Support Desk',
    worldZoneIds: ['supportDesk'],
    zoneIds: ['CLAIMED'],
    bounds: boundsFrom(SCENE_ANCHORS.desks['desk-5'], -42),
    feedbackAnchor: SCENE_ANCHORS.desks['desk-5'],
  }),
  hotspot({
    id: 'approvalDeskHotspot',
    label: 'Approval Desk',
    worldZoneIds: ['approvalDesk'],
    zoneIds: ['EXECUTE_FINISHED'],
    bounds: boundsFrom(SCENE_ANCHORS.approvalDesk.deliveryDesk, 6),
    feedbackAnchor: SCENE_ANCHORS.approvalDesk.deliveryDesk,
    feedbackKind: 'shelf',
  }),
  hotspot({
    id: 'archiveShelfHotspot',
    label: 'Archive Shelf',
    worldZoneIds: ['archiveLibrary'],
    zoneIds: ['ACKED'],
    bounds: { x: 850, y: 42, width: 160, height: 250 },
    feedbackAnchor: SCENE_ANCHORS.decor.archiveShelf,
    feedbackKind: 'shelf',
  }),
  hotspot({
    id: 'anomalyShelfHotspot',
    label: 'Anomaly Shelf',
    worldZoneIds: ['anomalyShelf'],
    zoneIds: ['ACKED'],
    bounds: boundsFrom(SCENE_ANCHORS.warningShelf.anomalyShelf, 8),
    feedbackAnchor: SCENE_ANCHORS.warningShelf.anomalyShelf,
    feedbackKind: 'warning',
  }),
]);

const WAITING_STATES = Object.freeze(['idle', 'waiting']);
const ACTIVE_STATES = Object.freeze(['working', 'processing']);

function matchesHotspot(component, hotspot) {
  return hotspot.worldZoneIds.includes(component.worldZoneId) || hotspot.zoneIds.includes(component.zoneId);
}

export function summarizeHotspotFromComponents(hotspot, components) {
  const summary = {
    activeTasks: 0,
    waitingTasks: 0,
    failedTasks: 0,
    anomaly: false,
    activeAgents: 0,
    assignedAgents: 0,
  };

  if (!hotspot || !Array.isArray(components)) return Object.freeze(summary);

  for (const component of components) {
    if (!component || !matchesHotspot(component, hotspot)) continue;

    if (component.componentType === 'task-chip') {
      if (ACTIVE_STATES.includes(component.visualState)) summary.activeTasks++;
      if (WAITING_STATES.includes(component.visualState)) summary.waitingTasks++;
      if (component.visualState === 'error') summary.failedTasks++;
      if (component.anomaly) summary.anomaly = true;
    }

    if (component.componentType === 'agent-sprite') {
      if (ACTIVE_STATES.includes(component.visualState) || component.visualState === 'error') summary.activeAgents++;
      if (component.currentTaskId) summary.assignedAgents++;
      if (component.anomaly) summary.anomaly = true;
    }
  }

  return Object.freeze(summary);
}

export function componentForHotspot(hotspot, components) {
  const summary = summarizeHotspotFromComponents(hotspot, components);
  return Object.freeze({
    componentType: 'workstation-hotspot',
    id: hotspot.id,
    label: hotspot.label,
    worldZoneId: hotspot.worldZoneIds[0] || null,
    zoneId: hotspot.zoneIds[0] || null,
    summary,
  });
}

export function getWorkstationHotspotById(id) {
  return WORKSTATION_HOTSPOTS.find((hotspot) => hotspot.id === id) || null;
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
  const anchor = hotspot.feedbackAnchor || hotspot.bounds;
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
