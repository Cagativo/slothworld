/**
 * task-chip-renderer.js
 *
 * Renders task-chip component descriptors as parchment/work-card style elements
 * on a 2D canvas context.
 *
 * Visual conventions (Themed World Projection):
 *  - work-card:    warm parchment card with a left-side state-colour bar
 *  - anomaly badge: small warning triangle at the card's top-right corner
 *  - processingPulse: soft amber ellipse ring pulsing around cards in 'processing' state
 *
 * CONTRACT:
 *  - Input:  task-chip component descriptor from world-scene-adapter.js
 *            { componentType, id, x, y, visualState, zoneId, metrics, anomaly }
 *  - Output: canvas draw calls only — no return value, no state mutation
 *
 * RULES:
 *  - All visual properties driven by visualState and anomaly fields only
 *  - No lifecycle inference — visualState maps to colour/style, never to event type
 *  - No selector or event access
 *  - No Math.random — pulse animation uses Date.now() consistently with sibling renderers
 *  - No DOM or asset dependencies — safe to import in headless test environments
 */

// ---------------------------------------------------------------------------
// Card geometry constants
// ---------------------------------------------------------------------------

/** Card width in canvas pixels. */
const CARD_W = 36;
/** Card height in canvas pixels. */
const CARD_H = 16;
/** Left state-bar width in pixels. */
const BAR_W  = 4;
/** Card corner radius in pixels. */
const CARD_R  = 2;

// ---------------------------------------------------------------------------
// Visual style tables — pure visual data, no lifecycle meaning
// ---------------------------------------------------------------------------

/**
 * Per-visualState parchment card fill and left state-bar colour.
 *
 * fill:      card background — warm parchment tinted by visual state
 * barColor:  left-edge accent bar — same hue as the matching agent entity
 *
 * @type {Readonly<Record<string, Readonly<{ fill: string, barColor: string }>>>}
 */
export const CHIP_STYLES = Object.freeze({
  idle:       Object.freeze({ fill: 'rgba(243,232,198,0.90)', barColor: '#8fbc8f' }),
  waiting:    Object.freeze({ fill: 'rgba(245,236,196,0.90)', barColor: '#d4a017' }),
  working:    Object.freeze({ fill: 'rgba(232,248,244,0.90)', barColor: '#00b8a9' }),
  processing: Object.freeze({ fill: 'rgba(228,244,250,0.92)', barColor: '#7ec8c8' }),
  completed:  Object.freeze({ fill: 'rgba(230,248,232,0.88)', barColor: '#4caf50' }),
  error:      Object.freeze({ fill: 'rgba(250,232,232,0.90)', barColor: '#e53935' }),
  unknown:    Object.freeze({ fill: 'rgba(240,234,220,0.85)', barColor: '#8d7b68' }),
});

/** Fallback style for visualState values not listed in CHIP_STYLES. */
const FALLBACK_CHIP_STYLE = CHIP_STYLES.unknown;

/** Card border — dark warm tone shared across all states. */
const CARD_STROKE = '#7a5030';

/** Task ID text colour — dark ink on parchment. */
const CARD_TEXT_COLOR = '#3a1c08';

/**
 * Anomaly badge fill colours by severity level.
 * Derives from component.anomaly.severity — no event field reading.
 *
 * @type {Readonly<{ high: string, default: string }>}
 */
export const ANOMALY_BADGE_COLORS = Object.freeze({
  high:    '#d32f2f',
  default: '#f57c00',
});

/** Processing pulse ring colour for cards in the 'processing' visual state. */
export const PROCESSING_PULSE_COLOR = '#ffb300';

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
// Visual element drawers
// ---------------------------------------------------------------------------

/**
 * Draw a parchment work-card for one task entity.
 *
 * Card anatomy (left → right):
 *   [ state bar | parchment body with short task ID ]
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} component  task-chip descriptor
 * @param {number} x          canvas X (entity centre)
 * @param {number} y          canvas Y (entity centre)
 */
function drawTaskCard(ctx, component, x, y) {
  const chipStyle = CHIP_STYLES[component.visualState] ?? FALLBACK_CHIP_STYLE;
  const cx = x - CARD_W / 2;
  const cy = y - CARD_H / 2;

  ctx.save();

  // Card background
  roundRect(ctx, cx, cy, CARD_W, CARD_H, CARD_R);
  ctx.fillStyle = chipStyle.fill;
  ctx.fill();

  // Card border
  roundRect(ctx, cx, cy, CARD_W, CARD_H, CARD_R);
  ctx.strokeStyle = CARD_STROKE;
  ctx.lineWidth   = 0.8;
  ctx.stroke();

  // Left state-colour bar (clipped to left rounded-corner shape)
  roundRect(ctx, cx, cy, BAR_W + CARD_R, CARD_H, CARD_R);
  ctx.fillStyle = chipStyle.barColor;
  ctx.fill();
  // Overwrite the right portion of the bar area with card fill to give clean edge
  ctx.fillStyle = chipStyle.fill;
  ctx.fillRect(cx + CARD_R, cy, BAR_W, CARD_H);

  // Task ID label — last 6 chars of the id for brevity
  if (component.id) {
    const shortId = String(component.id).slice(-6);
    ctx.font         = '7px monospace';
    ctx.fillStyle    = CARD_TEXT_COLOR;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortId, cx + BAR_W + (CARD_W - BAR_W) / 2, cy + CARD_H / 2);
  }

  ctx.restore();
}

/**
 * Draw a pulsing amber ellipse ring around a card in the 'processing' state.
 *
 * The ring signals that the task has finished execution and is awaiting ACK.
 * Pulse is sinusoidal, driven by Date.now() — consistent with renderUIOverlayLayer.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x  Card centre X
 * @param {number} y  Card centre Y
 */
function drawProcessingPulse(ctx, x, y) {
  const now   = Date.now();
  const phase = (now % 1600) / 1600;                         // 1.6 s cycle
  const scale = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  const alpha = 0.16 + 0.24 * scale;
  const rX    = CARD_W / 2 + 3 + 2 * scale;
  const rY    = CARD_H / 2 + 3 + 1 * scale;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, rX, rY, 0, 0, Math.PI * 2);
  ctx.strokeStyle = PROCESSING_PULSE_COLOR;
  ctx.lineWidth   = 1.5;
  ctx.globalAlpha = alpha;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a small warning-triangle anomaly badge at the card's top-right corner.
 *
 * Badge colour derives from component.anomaly.severity — no event field reading.
 * A white exclamation mark is drawn inside the triangle for readability.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x       Card centre X
 * @param {number} y       Card centre Y
 * @param {object} anomaly { severity: string, type: string }
 */
function drawAnomalyBadge(ctx, x, y, anomaly) {
  const color = anomaly.severity === 'high'
    ? ANOMALY_BADGE_COLORS.high
    : ANOMALY_BADGE_COLORS.default;

  // Anchor at card top-right corner, offset outward slightly
  const bx  = x + CARD_W / 2 + 1;
  const by  = y - CARD_H / 2 - 1;
  const ts  = 6;   // half-span of the triangle

  ctx.save();

  // Triangle fill
  ctx.beginPath();
  ctx.moveTo(bx,       by - ts);   // apex
  ctx.lineTo(bx + ts,  by + ts);   // bottom-right
  ctx.lineTo(bx - ts,  by + ts);   // bottom-left
  ctx.closePath();
  ctx.fillStyle   = color;
  ctx.globalAlpha = 0.92;
  ctx.fill();

  // Exclamation mark (vertical stroke + dot)
  ctx.globalAlpha = 0.96;
  ctx.fillStyle   = '#ffffff';
  ctx.fillRect(bx - 0.8, by - 0.5, 1.6, 4.5);   // vertical bar
  ctx.fillRect(bx - 0.8, by + 4.8, 1.6, 1.6);   // dot

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Render all task-chip components as parchment work-cards.
 *
 * Draw order per entity (back → front):
 *  1. Processing pulse ring (behind card; only for 'processing' visualState)
 *  2. Parchment card   (background + state bar + ID label)
 *  3. Anomaly badge    (top-right overlay; only when component.anomaly is set)
 *
 * @param {CanvasRenderingContext2D}           ctx
 * @param {Array<object>}                      components       flat component list
 * @param {Map<string, {x:number, y:number}>}  entityPositions  from buildEntityPositionMap()
 */
export function renderAllTaskChips(ctx, components, entityPositions) {
  if (!ctx || !Array.isArray(components)) return;

  for (const c of components) {
    if (!c || c.componentType !== 'task-chip') continue;

    const p = entityPositions && entityPositions.get(c.id);
    const x = p ? p.x : (typeof c.x === 'number' ? c.x : 0);
    const y = p ? p.y : (typeof c.y === 'number' ? c.y : 0);

    // 1. Processing pulse — drawn first so it sits behind the card body
    if (c.visualState === 'processing') {
      drawProcessingPulse(ctx, x, y);
    }

    // 2. Card body
    drawTaskCard(ctx, c, x, y);

    // 3. Anomaly badge — drawn last so it overlays the card corner
    if (c.anomaly) {
      drawAnomalyBadge(ctx, x, y, c.anomaly);
    }
  }
}
