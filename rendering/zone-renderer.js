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
 *            task-chip:       { componentType, id, x, y, zoneId, visualState }
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
  fill:         'rgba(58, 42, 22, 0.55)',
  stroke:       '#7a5c35',
  labelColor:   '#b8a88a',
  lineWidth:    1.5,
  cornerRadius: 4,
  padding:      6,
});

// ---------------------------------------------------------------------------
// Desk position table
//
// Maps deskId → canvas { x, y } for the agent sprite anchor point.
// Kept in sync with initialEventSeed.js desk positions.
// When an agent component carries a deskId present in this table,
// buildEntityPositionMap uses it directly instead of computing a slot index.
// ---------------------------------------------------------------------------

/**
 * @type {Readonly<Record<string, Readonly<{ x: number, y: number }>>>}
 */
// Slot anchors aligned to desk seating in scene_background_01.jpg.
// Background image is 1376×768; canvas is 1060×520 (scale ≈ 0.770x, 0.677y).
// Anchor = desk surface centre. left_back dx offset is handled in
// agent-entity-renderer.js (DESK_SPRITE_OFFSETS), not here.
export const DESK_POSITIONS = Object.freeze({
  'desk-0': Object.freeze({ x: 370, y: 220 }),  // left mushroom platform (right_front)
  'desk-1': Object.freeze({ x: 740, y: 230 }),  // upper-right first desk  (left_front)
  'desk-2': Object.freeze({ x: 840, y: 275 }),  // upper-right second desk (left_front)
  'desk-3': Object.freeze({ x: 580, y: 420 }),  // lower-centre desk       (right_back)
  'desk-4': Object.freeze({ x: 750, y: 450 }),  // lower-right first desk  (left_back) +14dx in renderer
  'desk-5': Object.freeze({ x: 880, y: 380 }),  // far lower-right desk    (left_back) +14dx in renderer
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

  // Collect entity components (agent-sprite and task-chip) per zoneId to determine slot index
  const slotCounters = new Map();
  const positions    = new Map();

  for (const c of components) {
    if (!c || (c.componentType !== 'agent-sprite' && c.componentType !== 'task-chip')) continue;

    // Prefer desk-specific position when deskId is known — gives accurate
    // per-desk placement without any layout computation.
    if (c.deskId && DESK_POSITIONS[c.deskId]) {
      positions.set(c.id, { ...DESK_POSITIONS[c.deskId] });
      continue;
    }

    const zone = c.zoneId ? zoneMap.get(c.zoneId) : null;

    if (!zone) {
      // No zone assigned — use the component's own x/y directly
      positions.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
      continue;
    }

    // Slot index within zone — fallback when no desk position is available
    const slotIndex = slotCounters.get(c.zoneId) ?? 0;
    slotCounters.set(c.zoneId, slotIndex + 1);

    const slotWidth = 32;
    const px = zone.x + ZONE_STYLE.padding + slotWidth / 2 + slotIndex * slotWidth;
    const py = zone.y + (zone.height ?? 0) / 2;

    positions.set(c.id, { x: px, y: py });
  }

  return positions;
}
