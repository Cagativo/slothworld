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
    'desk-0': anchor({ x: 352, y: 224, scale: 0.88, depthY: 246, bounds: { x: 273, y: 145, width: 158, height: 150 } }),
    'desk-1': anchor({ x: 700, y: 232, scale: 0.76, depthY: 248, bounds: { x: 586, y: 175, width: 228, height: 114 } }),
    'desk-2': anchor({ x: 806, y: 284, scale: 0.82, depthY: 304, bounds: { x: 683, y: 223, width: 246, height: 123 } }),
    'desk-3': anchor({ x: 560, y: 430, scale: 1.02, depthY: 452, bounds: { x: 466, y: 348, width: 188, height: 164 } }),
    'desk-4': anchor({ x: 742, y: 452, scale: 1.06, depthY: 474, bounds: { x: 583, y: 373, width: 286, height: 142 } }),
    'desk-5': anchor({ x: 872, y: 390, scale: 0.94, depthY: 414, bounds: { x: 731, y: 320, width: 282, height: 141 } }),
  }),
  chairs: Object.freeze({
    'chair-0': anchor({ x: 330, y: 239, scale: 0.86, depthY: 244 }),
    'chair-1': anchor({ x: 672, y: 247, scale: 0.74, depthY: 250 }),
    'chair-2': anchor({ x: 778, y: 299, scale: 0.80, depthY: 306 }),
    'chair-3': anchor({ x: 532, y: 448, scale: 1.00, depthY: 454 }),
    'chair-4': anchor({ x: 714, y: 470, scale: 1.04, depthY: 476 }),
    'chair-5': anchor({ x: 844, y: 405, scale: 0.92, depthY: 416 }),
  }),
  shelves: Object.freeze({
    intakeShelf: anchor({ x: 104, y: 168, scale: 0.72, depthY: 184, bounds: { x: 83, y: 147, width: 42, height: 42 } }),
    queueRunes: anchor({ x: 126, y: 356, scale: 0.82, depthY: 366, bounds: { x: 103, y: 333, width: 46, height: 46 } }),
    archiveShelf: anchor({ x: 894, y: 176, scale: 0.70, depthY: 202, bounds: { x: 874, y: 156, width: 40, height: 40 } }),
  }),
  crystal: Object.freeze({
    engineCrystal: anchor({ x: 482, y: 382, scale: 0.86, depthY: 390, bounds: { x: 461, y: 361, width: 42, height: 42 } }),
  }),
  river: Object.freeze({
    lowerStream: anchor({ x: 518, y: 456, scale: 1.00, depthY: 456, bounds: { x: 210, y: 406, width: 616, height: 84 } }),
  }),
  warningShelf: Object.freeze({
    anomalyShelf: anchor({ x: 866, y: 408, scale: 0.78, depthY: 420, bounds: { x: 845, y: 387, width: 42, height: 42 } }),
  }),
  approvalDesk: Object.freeze({
    deliveryDesk: anchor({ x: 646, y: 248, scale: 0.76, depthY: 266, bounds: { x: 625, y: 227, width: 42, height: 42 } }),
  }),
  indicators: Object.freeze({
    claimedMonitor: anchor({ x: 286, y: 246, scale: 0.78, depthY: 262, bounds: { x: 265, y: 225, width: 42, height: 42 } }),
  }),
  displaySurfaces: Object.freeze({
    renderDeskGeneratedImage: anchor({ x: 652, y: 426, scale: 1, depthY: 430, bounds: { x: 606, y: 397, width: 92, height: 58 } }),
  }),
  decor: Object.freeze({
    foregroundVine: anchor({ x: 1008, y: 276, scale: 0.74, depthY: 512, bounds: { x: 968, y: 150, width: 76, height: 252 } }),
    smallPlants: anchor({ x: 708, y: 420, scale: 0.56, depthY: 432, bounds: { x: 684, y: 392, width: 48, height: 56 } }),
    booksStack: anchor({ x: 904, y: 118, scale: 0.48, depthY: 138, bounds: { x: 882, y: 96, width: 44, height: 42 } }),
    deskTerminal: anchor({ x: 288, y: 232, scale: 0.42, depthY: 238, bounds: { x: 270, y: 214, width: 36, height: 28 } }),
    archiveShelf: anchor({ x: 925, y: 170, scale: 0.58, depthY: 218, bounds: { x: 878, y: 74, width: 96, height: 160 } }),
    mossShelf: anchor({ x: 818, y: 338, scale: 0.50, depthY: 368, bounds: { x: 780, y: 306, width: 76, height: 60 } }),
  }),
});

export const ZONE_INDICATOR_ANCHORS = Object.freeze({
  CREATED: Object.freeze(SCENE_ANCHORS.shelves.intakeShelf),
  ENQUEUED: Object.freeze(SCENE_ANCHORS.shelves.queueRunes),
  CLAIMED: Object.freeze(SCENE_ANCHORS.indicators.claimedMonitor),
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
