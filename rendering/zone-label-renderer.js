/**
 * zone-label-renderer.js
 *
 * Renders themed zone-name badges over lifecycle zone areas in the world canvas.
 *
 * Visual convention (Themed World Projection):
 *  - Each lifecycle zone gets a small plaque/scroll label near its top edge
 *  - Labels use LIFECYCLE_ZONE_THEMES names instead of raw zone IDs
 *  - Hidden when debug mode is active (debug mode already shows raw IDs via renderAllZones)
 *
 * CONTRACT:
 *  - Input:  zone-background component descriptors from world-scene-adapter.js
 *            { componentType, id, x, y, width, height }
 *  - Output: canvas draw calls only — no return value, no state mutation
 *
 * RULES:
 *  - Only LIFECYCLE_ZONE_THEMES data drives label content — no raw events, no selectors
 *  - No lifecycle inference
 *  - No DOM or asset dependencies — safe to import in headless test environments
 *  - Pure structural projection: zone position/size fields are used directly
 */

import { LIFECYCLE_ZONE_THEMES } from './world-scene.js';

// ---------------------------------------------------------------------------
// Label badge visual style — parchment/plaque aesthetic
// ---------------------------------------------------------------------------

/**
 * Zone label badge style constants.
 * Warm dark background with amber border and cream text — treehouse palette.
 *
 * @type {Readonly<{ bgFill: string, bgStroke: string, textColor: string, font: string, cornerRadius: number, padX: number, padY: number, lineWidth: number }>}
 */
export const ZONE_LABEL_STYLE = Object.freeze({
  bgFill:       'rgba(24, 14, 4, 0.78)',
  bgStroke:     '#8a6230',
  textColor:    '#e8d8b0',
  font:         'bold 8px monospace',
  cornerRadius: 3,
  padX:         5,
  padY:         3,
  lineWidth:    1,
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Trace a rounded rectangle path. Does not fill or stroke — caller does that.
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
  ctx.quadraticCurveTo(x + w, y, x + w, y + cr);
  ctx.lineTo(x + w, y + h - cr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - cr, y + h);
  ctx.lineTo(x + cr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - cr);
  ctx.lineTo(x, y + cr);
  ctx.quadraticCurveTo(x, y, x + cr, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Per-zone label renderer
// ---------------------------------------------------------------------------

/**
 * Draw a single themed zone label centred near the top edge of a zone.
 *
 * Label text is sourced exclusively from LIFECYCLE_ZONE_THEMES[component.id].label —
 * no raw event reading, no lifecycle inference.
 * Silently skipped when component.id is absent from LIFECYCLE_ZONE_THEMES.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} component  zone-background descriptor { id, x, y, width, height }
 */
function renderZoneLabel(ctx, component) {
  if (!ctx || !component) return;

  const zoneData = LIFECYCLE_ZONE_THEMES[component.id];
  if (!zoneData) return;

  const label = zoneData.label;
  const cx    = (typeof component.x     === 'number' ? component.x     : 0)
              + (typeof component.width  === 'number' ? component.width  : 0) / 2;
  const ty    = (typeof component.y     === 'number' ? component.y     : 0) + 8;

  ctx.save();
  ctx.font = ZONE_LABEL_STYLE.font;

  const measured = ctx.measureText(label);
  const tw = (measured && typeof measured.width === 'number') ? measured.width : label.length * 5;
  const bw = tw + ZONE_LABEL_STYLE.padX * 2;
  const bh = 8  + ZONE_LABEL_STYLE.padY * 2;  // 8px approximate cap-height
  const bx = cx - bw / 2;
  const by = ty;

  // Badge background
  roundRect(ctx, bx, by, bw, bh, ZONE_LABEL_STYLE.cornerRadius);
  ctx.fillStyle = ZONE_LABEL_STYLE.bgFill;
  ctx.fill();

  // Badge border
  roundRect(ctx, bx, by, bw, bh, ZONE_LABEL_STYLE.cornerRadius);
  ctx.strokeStyle = ZONE_LABEL_STYLE.bgStroke;
  ctx.lineWidth   = ZONE_LABEL_STYLE.lineWidth;
  ctx.stroke();

  // Label text
  ctx.fillStyle    = ZONE_LABEL_STYLE.textColor;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, by + bh / 2);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Draw themed zone labels for all zone-background components.
 *
 * When hideWhenDebug is true the function is a no-op — debug mode already
 * renders raw zone IDs via renderAllZones(), so themed labels would compete.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>}            components      flat component list from toRenderableComponents()
 * @param {boolean}                  [hideWhenDebug] suppress rendering when debug overlay is active
 */
export function renderZoneLabels(ctx, components, hideWhenDebug) {
  if (!ctx || !Array.isArray(components)) return;
  if (hideWhenDebug) return;

  for (const c of components) {
    if (c && c.componentType === 'zone-background') {
      renderZoneLabel(ctx, c);
    }
  }
}
