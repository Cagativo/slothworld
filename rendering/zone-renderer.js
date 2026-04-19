/**
 * zone-renderer.js
 *
 * Renders zone-background component descriptors and positions entity labels
 * inside their assigned zones on a 2D canvas context.
 *
 * CONTRACT:
 *  - Input:  component descriptors from world-scene-adapter.js
 *            zone-background: { componentType, id, x, y, width, height }
 *            agent-sprite:    { componentType, id, x, y, zoneId, visualState }
 *  - Output: canvas draw calls only — no return value, no state mutation
 *
 * RULES:
 *  - Layout is driven solely by zone position/size fields — no computation
 *  - No dynamic layout engine
 *  - No event access, no selector access, no lifecycle inference
 */

// ---------------------------------------------------------------------------
// Static visual style for zones
// ---------------------------------------------------------------------------

/**
 * Visual style constants for zone backgrounds.
 * Values are purely cosmetic.
 *
 * @type {Readonly<{ fill: string, stroke: string, labelColor: string, lineWidth: number, cornerRadius: number, padding: number }>}
 */
export const ZONE_STYLE = Object.freeze({
  fill:        'rgba(224, 235, 245, 0.45)',
  stroke:      '#90a4ae',
  labelColor:  '#546e7a',
  lineWidth:   1.5,
  cornerRadius: 8,
  padding:     6,
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Draw a rounded rectangle path (does not fill or stroke — caller does that).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r  Corner radius
 */
function roundRect(ctx, x, y, w, h, r) {
  const cr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + cr, y);
  ctx.lineTo(x + w - cr, y);
  ctx.quadraticCurveTo(x + w, y,         x + w, y + cr);
  ctx.lineTo(x + w,       y + h - cr);
  ctx.quadraticCurveTo(x + w, y + h,     x + w - cr, y + h);
  ctx.lineTo(x + cr,      y + h);
  ctx.quadraticCurveTo(x,     y + h,     x, y + h - cr);
  ctx.lineTo(x,           y + cr);
  ctx.quadraticCurveTo(x,     y,         x + cr, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/**
 * Draw a single zone-background component descriptor.
 *
 * Renders a filled rounded rectangle at the zone's position/size, plus a
 * zone-id label at the top edge. No computation — fields are used directly.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} component  zone-background descriptor
 */
export function renderZone(ctx, component) {
  if (!ctx || !component) return;

  const x = typeof component.x      === 'number' ? component.x      : 0;
  const y = typeof component.y      === 'number' ? component.y      : 0;
  const w = typeof component.width  === 'number' ? component.width  : 0;
  const h = typeof component.height === 'number' ? component.height : 0;

  ctx.save();

  // Background fill
  roundRect(ctx, x, y, w, h, ZONE_STYLE.cornerRadius);
  ctx.fillStyle = ZONE_STYLE.fill;
  ctx.fill();

  // Border
  roundRect(ctx, x, y, w, h, ZONE_STYLE.cornerRadius);
  ctx.strokeStyle = ZONE_STYLE.stroke;
  ctx.lineWidth   = ZONE_STYLE.lineWidth;
  ctx.stroke();

  // Zone id label — top-left inside the zone
  ctx.font      = '9px monospace';
  ctx.fillStyle = ZONE_STYLE.labelColor;
  ctx.textAlign = 'left';
  ctx.fillText(component.id ?? '', x + ZONE_STYLE.padding, y + ZONE_STYLE.padding + 9);

  ctx.restore();
}

/**
 * Draw all zone-background components from a component list.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components  Output of toRenderableComponents()
 */
export function renderAllZones(ctx, components) {
  if (!ctx || !Array.isArray(components)) return;
  for (const c of components) {
    if (c && c.componentType === 'zone-background') {
      renderZone(ctx, c);
    }
  }
}

/**
 * Build a position map for entities, placing each one inside its assigned zone.
 *
 * Each entity is assigned a column position within the zone based on its
 * index among siblings sharing the same zoneId. The slot width is derived
 * directly from the zone component's width field — no layout engine.
 *
 * Returns a Map<entityId, { x, y }> suitable for use with renderAllConnections().
 *
 * @param {Array<object>} components  Output of toRenderableComponents()
 * @returns {Map<string, { x: number, y: number }>}
 */
export function buildEntityPositionMap(components) {
  if (!Array.isArray(components)) return new Map();

  // Index zone-background components by id
  const zoneMap = new Map();
  for (const c of components) {
    if (c && c.componentType === 'zone-background') {
      zoneMap.set(c.id, c);
    }
  }

  // Collect agent-sprites per zoneId to determine slot index
  const slotCounters = new Map();
  const positions    = new Map();

  for (const c of components) {
    if (!c || c.componentType !== 'agent-sprite') continue;

    const zone = c.zoneId ? zoneMap.get(c.zoneId) : null;

    if (!zone) {
      // No zone assigned — use the component's own x/y directly
      positions.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
      continue;
    }

    // Slot index within zone
    const slotIndex = slotCounters.get(c.zoneId) ?? 0;
    slotCounters.set(c.zoneId, slotIndex + 1);

    const slotWidth = 32;
    const px = zone.x + ZONE_STYLE.padding + slotWidth / 2 + slotIndex * slotWidth;
    const py = zone.y + (zone.height ?? 0) / 2;

    positions.set(c.id, { x: px, y: py });
  }

  return positions;
}
