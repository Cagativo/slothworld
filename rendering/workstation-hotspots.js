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
  }),
  hotspot({
    id: 'intakeDeskHotspot',
    label: 'Intake Desk',
    worldZoneIds: ['intakeDesk'],
    zoneIds: ['CREATED'],
    bounds: { x: 44, y: 116, width: 172, height: 126 },
  }),
  hotspot({
    id: 'researchMonitorHotspot',
    label: 'Research Desk',
    worldZoneIds: ['researchDesk'],
    zoneIds: ['CLAIMED'],
    bounds: boundsFrom(SCENE_ANCHORS.desks['desk-0'], -24),
  }),
  hotspot({
    id: 'shopifyMonitorHotspot',
    label: 'Shopify Desk',
    worldZoneIds: ['shopifyDesk'],
    zoneIds: ['CLAIMED'],
    bounds: boundsFrom(SCENE_ANCHORS.desks['desk-1'], -34),
  }),
  hotspot({
    id: 'renderMonitorHotspot',
    label: 'Render Desk',
    worldZoneIds: ['renderDesk'],
    zoneIds: ['EXECUTE_FINISHED'],
    bounds: boundsFrom(SCENE_ANCHORS.desks['desk-4'], -46),
  }),
  hotspot({
    id: 'supportMonitorHotspot',
    label: 'Support Desk',
    worldZoneIds: ['supportDesk'],
    zoneIds: ['CLAIMED'],
    bounds: boundsFrom(SCENE_ANCHORS.desks['desk-5'], -42),
  }),
  hotspot({
    id: 'approvalDeskHotspot',
    label: 'Approval Desk',
    worldZoneIds: ['approvalDesk'],
    zoneIds: ['EXECUTE_FINISHED'],
    bounds: boundsFrom(SCENE_ANCHORS.approvalDesk.deliveryDesk, 6),
  }),
  hotspot({
    id: 'archiveShelfHotspot',
    label: 'Archive Shelf',
    worldZoneIds: ['archiveLibrary'],
    zoneIds: ['ACKED'],
    bounds: { x: 850, y: 42, width: 160, height: 250 },
  }),
  hotspot({
    id: 'anomalyShelfHotspot',
    label: 'Anomaly Shelf',
    worldZoneIds: ['anomalyShelf'],
    zoneIds: ['ACKED'],
    bounds: boundsFrom(SCENE_ANCHORS.warningShelf.anomalyShelf, 8),
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
