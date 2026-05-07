/**
 * Pure hotspot hit testing for fixed workstation interaction areas.
 */

import { WORKSTATION_HOTSPOTS } from './workstationHotspots.js';
import {
  HOTSPOT_CANONICAL_SIZE,
  pointInRect,
  pointInShape,
  scaleShape,
} from './hotspotGeometry.js';

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

export function rectContainsPoint(rect, point) {
  return pointInRect(point, rect);
}

export function hitTestWorkstationHotspots(point, hotspots = WORKSTATION_HOTSPOTS, options = {}) {
  if (!isFinitePoint(point) || !Array.isArray(hotspots)) return null;
  const targetSize = options.canvasSize || HOTSPOT_CANONICAL_SIZE;

  for (let i = hotspots.length - 1; i >= 0; i--) {
    const hotspot = hotspots[i];
    const hitArea = hotspot?.hitArea || hotspot?.bounds;
    const shape = scaleShape(hitArea?.type ? hitArea : { type: 'rect', ...hitArea }, targetSize);
    if (pointInShape(point, shape)) {
      return hotspot;
    }
  }
  return null;
}
