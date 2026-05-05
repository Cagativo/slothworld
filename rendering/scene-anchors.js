/**
 * scene-anchors.js
 *
 * Frozen anchor data for placing rendered assets into the illustrated
 * Slothworld treehouse. These are rendering-only coordinates; they do not
 * derive lifecycle state or inspect events.
 */

export const SCENE_CANVAS = Object.freeze({ width: 1060, height: 520 });

function anchor(config) {
  return Object.freeze({
    x: config.x,
    y: config.y,
    scale: config.scale,
    depthY: config.depthY,
    ...(config.bounds
      ? {
          bounds: Object.freeze({
            x: config.bounds.x,
            y: config.bounds.y,
            width: config.bounds.width,
            height: config.bounds.height,
          }),
        }
      : {}),
  });
}

export const SCENE_ANCHORS = Object.freeze({
  desks: Object.freeze({
    'desk-0': anchor({ x: 370, y: 220, scale: 0.94, depthY: 246, bounds: { x: 280, y: 135, width: 180, height: 170 } }),
    'desk-1': anchor({ x: 740, y: 230, scale: 0.82, depthY: 250, bounds: { x: 590, y: 155, width: 300, height: 150 } }),
    'desk-2': anchor({ x: 840, y: 275, scale: 0.88, depthY: 296, bounds: { x: 690, y: 200, width: 300, height: 150 } }),
    'desk-3': anchor({ x: 580, y: 420, scale: 1.06, depthY: 444, bounds: { x: 480, y: 332, width: 200, height: 175 } }),
    'desk-4': anchor({ x: 750, y: 450, scale: 1.10, depthY: 472, bounds: { x: 600, y: 370, width: 300, height: 145 } }),
    'desk-5': anchor({ x: 880, y: 380, scale: 1.00, depthY: 404, bounds: { x: 730, y: 305, width: 300, height: 150 } }),
  }),
  chairs: Object.freeze({
    'chair-0': anchor({ x: 346, y: 236, scale: 0.92, depthY: 244 }),
    'chair-1': anchor({ x: 710, y: 246, scale: 0.80, depthY: 252 }),
    'chair-2': anchor({ x: 812, y: 292, scale: 0.86, depthY: 300 }),
    'chair-3': anchor({ x: 552, y: 440, scale: 1.04, depthY: 448 }),
    'chair-4': anchor({ x: 722, y: 466, scale: 1.08, depthY: 474 }),
    'chair-5': anchor({ x: 852, y: 396, scale: 0.98, depthY: 406 }),
  }),
  shelves: Object.freeze({
    intakeShelf: anchor({ x: 107, y: 165, scale: 0.82, depthY: 182, bounds: { x: 83, y: 141, width: 48, height: 48 } }),
    queueRunes: anchor({ x: 117, y: 358, scale: 0.95, depthY: 368, bounds: { x: 93, y: 334, width: 48, height: 48 } }),
    archiveShelf: anchor({ x: 894, y: 182, scale: 0.88, depthY: 206, bounds: { x: 870, y: 158, width: 48, height: 48 } }),
  }),
  crystal: Object.freeze({
    engineCrystal: anchor({ x: 480, y: 388, scale: 1.00, depthY: 392, bounds: { x: 456, y: 364, width: 48, height: 48 } }),
  }),
  river: Object.freeze({
    lowerStream: anchor({ x: 518, y: 456, scale: 1.00, depthY: 456, bounds: { x: 210, y: 406, width: 616, height: 84 } }),
  }),
  warningShelf: Object.freeze({
    anomalyShelf: anchor({ x: 878, y: 415, scale: 1.00, depthY: 426, bounds: { x: 854, y: 391, width: 48, height: 48 } }),
  }),
  approvalDesk: Object.freeze({
    deliveryDesk: anchor({ x: 657, y: 240, scale: 0.90, depthY: 262, bounds: { x: 633, y: 216, width: 48, height: 48 } }),
  }),
});

export const ZONE_INDICATOR_ANCHORS = Object.freeze({
  CREATED: Object.freeze(SCENE_ANCHORS.shelves.intakeShelf),
  ENQUEUED: Object.freeze(SCENE_ANCHORS.shelves.queueRunes),
  CLAIMED: Object.freeze({ x: 297, y: 240, scale: 0.92, depthY: 260, bounds: Object.freeze({ x: 273, y: 216, width: 48, height: 48 }) }),
  EXECUTE_FINISHED: Object.freeze(SCENE_ANCHORS.approvalDesk.deliveryDesk),
  ACKED: Object.freeze(SCENE_ANCHORS.shelves.archiveShelf),
});

export const ENGINE_CRYSTAL_ANCHOR = SCENE_ANCHORS.crystal.engineCrystal;
export const ANOMALY_ANCHOR = SCENE_ANCHORS.warningShelf.anomalyShelf;

export function getDeskAnchor(deskId) {
  return deskId && SCENE_ANCHORS.desks[deskId] ? SCENE_ANCHORS.desks[deskId] : null;
}

export function getZoneIndicatorAnchor(zoneId) {
  return zoneId && ZONE_INDICATOR_ANCHORS[zoneId] ? ZONE_INDICATOR_ANCHORS[zoneId] : null;
}

export function compareByDepthY(a, b) {
  const da = Number.isFinite(a?.depthY) ? a.depthY : (Number.isFinite(a?.y) ? a.y : 0);
  const db = Number.isFinite(b?.depthY) ? b.depthY : (Number.isFinite(b?.y) ? b.y : 0);
  if (da !== db) return da - db;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}
