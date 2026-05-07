/**
 * Workstation hotspot registry.
 *
 * Interaction metadata only: fixed canvas hit areas, friendly station titles,
 * short semantic purposes, and render anchors for hover highlights.
 */

import { SCENE_ANCHORS } from '../../rendering/scene-anchors.js';
import { HOTSPOT_CANONICAL_SIZE, getShapeBounds, rectShape } from './hotspotGeometry.js';
import { CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY } from './workstationHotspotGeometry.generated.js';

export { HOTSPOT_CANONICAL_SIZE };

const GEOMETRY_KEYS = Object.freeze(['hitArea', 'highlightShape', 'popoverAnchor', 'visualStyle']);
const FORBIDDEN_GENERATED_GEOMETRY_KEYS = Object.freeze([
  'id',
  'title',
  'label',
  'purpose',
  'zoneIds',
  'worldZoneIds',
  'feedbackKind',
  'semanticType',
]);

function boundsFrom(anchor, inflate = 0) {
  const b = anchor.bounds || { x: anchor.x - 20, y: anchor.y - 20, width: 40, height: 40 };
  return {
    x: b.x - inflate,
    y: b.y - inflate,
    width: b.width + inflate * 2,
    height: b.height + inflate * 2,
  };
}

function generatedGeometryFor(id) {
  const geometry = CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY[id] || null;
  if (!geometry) return null;
  return Object.fromEntries(GEOMETRY_KEYS
    .filter((key) => geometry[key] !== undefined)
    .map((key) => [key, geometry[key]]));
}

function hotspot(config) {
  const geometry = generatedGeometryFor(config.id) || {};
  const legacyBounds = rectShape(config.bounds || getShapeBounds(geometry.hitArea));
  const hitArea = geometry.hitArea ? Object.freeze(geometry.hitArea) : config.hitArea ? Object.freeze(config.hitArea) : legacyBounds;
  const highlightShape = geometry.highlightShape ? Object.freeze(geometry.highlightShape) : config.highlightShape ? Object.freeze(config.highlightShape) : hitArea;
  const bounds = config.bounds ? legacyBounds : rectShape(getShapeBounds(hitArea));
  const popoverAnchor = geometry.popoverAnchor || config.popoverAnchor || {
    x: bounds.x + bounds.width / 2,
    y: bounds.y,
  };
  const visualStyle = geometry.visualStyle || config.visualStyle || {};
  return Object.freeze({
    id: config.id,
    title: config.title,
    label: config.title,
    purpose: config.purpose,
    worldZoneIds: Object.freeze(config.worldZoneIds || []),
    zoneIds: Object.freeze(config.zoneIds || []),
    bounds,
    hitArea,
    highlightShape,
    popoverAnchor: Object.freeze({ x: popoverAnchor.x, y: popoverAnchor.y }),
    highlightAnchor: Object.freeze(config.highlightAnchor || config.bounds),
    feedbackAnchor: Object.freeze(config.highlightAnchor || config.bounds),
    feedbackKind: config.feedbackKind || 'monitor',
    visualStyle: Object.freeze({
      tint: typeof visualStyle.tint === 'string' ? visualStyle.tint : 'cyan',
      intensity: Number.isFinite(visualStyle.intensity) ? visualStyle.intensity : 1,
      pulse: visualStyle.pulse !== false,
      sparkle: visualStyle.sparkle === true,
    }),
  });
}

export function validateWorkstationHotspotGeometry(
  canonicalConfigs,
  generatedGeometry = CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY
) {
  const errors = [];
  const ids = new Set();
  for (const config of canonicalConfigs || []) {
    if (!config?.id) {
      errors.push('Canonical hotspot is missing an id');
      continue;
    }
    if (ids.has(config.id)) errors.push(`Duplicate canonical hotspot id: ${config.id}`);
    ids.add(config.id);
    if (!generatedGeometry[config.id]) errors.push(`Missing generated geometry for canonical hotspot: ${config.id}`);
  }

  for (const [id, geometry] of Object.entries(generatedGeometry || {})) {
    if (!ids.has(id)) errors.push(`Generated geometry id has no canonical hotspot: ${id}`);
    for (const key of FORBIDDEN_GENERATED_GEOMETRY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(geometry || {}, key)) {
        errors.push(`Generated geometry for ${id} contains forbidden metadata key: ${key}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid workstation hotspot geometry:\n${errors.join('\n')}`);
  }
  return true;
}

export const CANONICAL_WORKSTATION_HOTSPOT_CONFIGS = Object.freeze([
  Object.freeze({
    id: 'engineCrystalHotspot',
    title: 'Engine Core',
    purpose: 'Queue and engine state',
    worldZoneIds: ['engineCrystal'],
    zoneIds: ['ENQUEUED'],
    highlightAnchor: SCENE_ANCHORS.crystal.engineCrystal,
    feedbackKind: 'crystal',
  }),
  Object.freeze({
    id: 'intakeDeskHotspot',
    title: 'Intake Desk',
    purpose: 'New work intake',
    worldZoneIds: ['intakeDesk'],
    zoneIds: ['CREATED'],
    highlightAnchor: SCENE_ANCHORS.shelves.intakeShelf,
    feedbackKind: 'shelf',
  }),
  Object.freeze({
    id: 'researchMonitorHotspot',
    title: 'Research Desk',
    purpose: 'Trend and product scans',
    worldZoneIds: ['researchDesk'],
    zoneIds: ['CLAIMED'],
    highlightAnchor: SCENE_ANCHORS.desks['desk-0'],
  }),
  Object.freeze({
    id: 'shopifyMonitorHotspot',
    title: 'Shopify Desk',
    purpose: 'Listings and product work',
    worldZoneIds: ['shopifyDesk'],
    zoneIds: ['CLAIMED'],
    highlightAnchor: SCENE_ANCHORS.desks['desk-1'],
  }),
  Object.freeze({
    id: 'renderMonitorHotspot',
    title: 'Render Desk',
    purpose: 'Images and design renders',
    worldZoneIds: ['renderDesk'],
    zoneIds: ['EXECUTE_FINISHED'],
    highlightAnchor: SCENE_ANCHORS.desks['desk-4'],
  }),
  Object.freeze({
    id: 'supportMonitorHotspot',
    title: 'Support Desk',
    purpose: 'Messages and support replies',
    worldZoneIds: ['supportDesk'],
    zoneIds: ['CLAIMED'],
    highlightAnchor: SCENE_ANCHORS.desks['desk-5'],
  }),
  Object.freeze({
    id: 'approvalDeskHotspot',
    title: 'Approval Desk',
    purpose: 'Review before delivery',
    worldZoneIds: ['approvalDesk'],
    zoneIds: ['EXECUTE_FINISHED'],
    highlightAnchor: SCENE_ANCHORS.approvalDesk.deliveryDesk,
    feedbackKind: 'shelf',
  }),
  Object.freeze({
    id: 'archiveShelfHotspot',
    title: 'Archive Shelf',
    purpose: 'Completed work archive',
    worldZoneIds: ['archiveLibrary'],
    zoneIds: ['ACKED'],
    highlightAnchor: SCENE_ANCHORS.decor.archiveShelf,
    feedbackKind: 'shelf',
  }),
  Object.freeze({
    id: 'anomalyShelfHotspot',
    title: 'Anomaly Shelf',
    purpose: 'Work needing attention',
    worldZoneIds: ['anomalyShelf'],
    zoneIds: ['ACKED'],
    highlightAnchor: SCENE_ANCHORS.warningShelf.anomalyShelf,
    feedbackKind: 'warning',
  }),
]);

validateWorkstationHotspotGeometry(CANONICAL_WORKSTATION_HOTSPOT_CONFIGS);

export const WORKSTATION_HOTSPOTS = Object.freeze(CANONICAL_WORKSTATION_HOTSPOT_CONFIGS.map(hotspot));

export function getWorkstationHotspotById(id) {
  return WORKSTATION_HOTSPOTS.find((hotspot) => hotspot.id === id) || null;
}
