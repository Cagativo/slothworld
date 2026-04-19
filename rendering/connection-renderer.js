/**
 * connection-renderer.js
 *
 * Renders flow-line component descriptors onto a 2D canvas context
 * with a purely visual animated dash effect.
 *
 * CONTRACT:
 *  - Input:  flow-line component descriptor from world-scene-adapter.js
 *            { componentType, from, to }
 *            + resolved endpoint positions { x, y } from the entity map
 *            + a frame counter (integer, advances each render tick)
 *  - Output: canvas draw calls only — no return value, no state mutation
 *
 * RULES:
 *  - Animation is driven solely by the frame counter — no event timing
 *  - Connection data (from/to) is used only to look up positions
 *  - No lifecycle inference, no selector access, no app state reads
 *  - Caller owns frame advancement; this module only reads it
 */

// ---------------------------------------------------------------------------
// Static visual style
// ---------------------------------------------------------------------------

/**
 * Visual constants for flow-line rendering.
 * All values are purely cosmetic.
 *
 * @type {Readonly<{ stroke: string, width: number, dashLen: number, gapLen: number, speed: number }>}
 */
export const FLOW_LINE_STYLE = Object.freeze({
  stroke:  '#78909c',  // line colour
  width:   1.5,        // line width in px
  dashLen: 8,          // dash segment length in px
  gapLen:  5,          // gap between dashes in px
  speed:   0.4,        // px of offset advancement per frame
});

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Draw a single flow-line component between two resolved positions.
 *
 * The animated marching-dash effect is produced by advancing
 * `setLineDash` offset by `FLOW_LINE_STYLE.speed * frame` — a purely
 * visual transform with no semantic meaning.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number }} fromPos   Resolved position of the "from" endpoint
 * @param {{ x: number, y: number }} toPos     Resolved position of the "to" endpoint
 * @param {number}                   frame     Current render frame counter (read-only)
 */
export function renderConnection(ctx, fromPos, toPos, frame) {
  if (!ctx || !fromPos || !toPos) return;

  const f = typeof frame === 'number' ? frame : 0;
  const dashOffset = -(f * FLOW_LINE_STYLE.speed) % (FLOW_LINE_STYLE.dashLen + FLOW_LINE_STYLE.gapLen);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(fromPos.x, fromPos.y);
  ctx.lineTo(toPos.x,   toPos.y);
  ctx.setLineDash([FLOW_LINE_STYLE.dashLen, FLOW_LINE_STYLE.gapLen]);
  ctx.lineDashOffset = dashOffset;
  ctx.strokeStyle    = FLOW_LINE_STYLE.stroke;
  ctx.lineWidth      = FLOW_LINE_STYLE.width;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw all flow-line components from a component list.
 *
 * Positions are resolved from `entityPositions`, a Map of entity id → { x, y }.
 * Connections whose endpoints are not present in the map are silently skipped.
 *
 * @param {CanvasRenderingContext2D}       ctx
 * @param {Array<object>}                  components      Output of toRenderableComponents()
 * @param {Map<string, { x: number, y: number }>} entityPositions  id → position lookup
 * @param {number}                         frame           Current render frame counter
 */
export function renderAllConnections(ctx, components, entityPositions, frame) {
  if (!ctx || !Array.isArray(components) || !(entityPositions instanceof Map)) return;

  for (const c of components) {
    if (!c || c.componentType !== 'flow-line') continue;

    const fromPos = entityPositions.get(c.from);
    const toPos   = entityPositions.get(c.to);

    if (fromPos && toPos) {
      renderConnection(ctx, fromPos, toPos, frame);
    }
  }
}
