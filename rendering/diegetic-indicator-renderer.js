/**
 * diegetic-indicator-renderer.js
 *
 * In-world visual state indicators for normal display mode.
 *
 * Communicates zone activity through canvas-drawn props — paper stacks,
 * monitor glows, rune pulses, approval markers, archive auras — instead of
 * persistent text labels. Used only in normal mode; debug mode shows raw
 * zone geometry and labels instead.
 *
 * CONTRACT:
 *  - Input:  flat component list from toRenderableComponents() and current
 *            timestamp (ms) for time-based animation
 *  - Output: canvas draw calls only — no return value, no state mutation
 *
 * RULES:
 *  - All visual properties derived solely from task-chip component fields:
 *    { visualState, zoneId, anomaly }
 *  - No event access, no selector access, no lifecycle inference
 *  - No Math.random — animation uses Date.now() (caller-supplied timestamp)
 *  - No raw event keys (events, eventsByTaskId, payload, type) referenced
 *  - Positions are hardcoded to match the 1060×520 background layout
 */

// ---------------------------------------------------------------------------
// Indicator anchor positions — matched to the 1060×520 canvas background
// ---------------------------------------------------------------------------

/**
 * Per-lifecycle-zone indicator anchor (canvas x/y).
 * Each entry sits near a visually meaningful area within the zone.
 *
 * @type {Readonly<Record<string, Readonly<{ x: number, y: number }>>>}
 */
export const ZONE_INDICATOR_ANCHORS = Object.freeze({
  CREATED:          Object.freeze({ x: 107, y: 165 }),  // intake nook desk surface
  ENQUEUED:         Object.freeze({ x: 117, y: 358 }),  // rune-stone area
  CLAIMED:          Object.freeze({ x: 297, y: 240 }),  // workshop floor centre
  EXECUTE_FINISHED: Object.freeze({ x: 657, y: 240 }),  // delivery bay floor centre
  ACKED:            Object.freeze({ x: 894, y: 182 }),  // archive shelving upper area
});

/** Engine-crystal pulse anchor — base of the central tree crystal. */
export const ENGINE_CRYSTAL_ANCHOR = Object.freeze({ x: 480, y: 388 });

/** Anomaly shelf anchor — lower-right quadrant of the ACKED zone. */
export const ANOMALY_ANCHOR = Object.freeze({ x: 878, y: 415 });

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

const PARCHMENT_FILL   = 'rgba(240, 228, 196, 0.88)';
const PARCHMENT_STROKE = '#8a6030';
const AMBER_FILL       = '#d4a017';
const AMBER_GLOW       = 'rgba(212, 160, 23, 0.55)';
const TEAL_FILL        = '#00b8a9';
const TEAL_GLOW        = 'rgba(0, 184, 169, 0.45)';
const ARCHIVE_GLOW     = 'rgba(130, 200, 220, 0.50)';
const ANOMALY_RED      = '#d32f2f';
const ANOMALY_GLOW     = 'rgba(211, 47, 47, 0.45)';

// ---------------------------------------------------------------------------
// Per-zone visual helpers
// ---------------------------------------------------------------------------

/**
 * CREATED zone — paper-stack / inbox tray.
 *
 * Draws a small stack of overlapping parchment sheets. Each sheet is offset
 * 2 px upward. A faint outline-only tray is shown when count = 0.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ax   Anchor X
 * @param {number} ay   Anchor Y
 * @param {number} count  Number of task chips in this zone
 */
function drawPaperStack(ctx, ax, ay, count) {
  ctx.save();

  if (count === 0) {
    // Empty tray outline
    ctx.strokeStyle = 'rgba(138, 96, 48, 0.28)';
    ctx.lineWidth   = 0.8;
    ctx.strokeRect(ax - 11, ay - 7, 22, 13);
    ctx.restore();
    return;
  }

  const sheets = Math.min(count, 5);
  for (let i = sheets - 1; i >= 0; i--) {
    const oy = -i * 2;
    const ox =  i * 0.5;
    ctx.fillStyle   = PARCHMENT_FILL;
    ctx.strokeStyle = PARCHMENT_STROKE;
    ctx.lineWidth   = 0.7;
    ctx.fillRect(  ax - 11 + ox, ay - 7 + oy, 22, 12);
    ctx.strokeRect(ax - 11 + ox, ay - 7 + oy, 22, 12);
  }

  ctx.restore();
}

/**
 * ENQUEUED zone — glowing rune cube.
 *
 * A small square with an amber pulse glow. Brightness scales with task count.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ax
 * @param {number} ay
 * @param {number} count
 * @param {number} now  Timestamp ms
 */
function drawRuneGlow(ctx, ax, ay, count, now) {
  ctx.save();

  const phase = (now % 2000) / 2000;
  const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  const baseAlpha = count > 0 ? 0.35 + Math.min(count, 4) * 0.12 : 0.12;
  const alpha = Math.min(0.92, baseAlpha + 0.25 * pulse);

  // Outer glow halo
  ctx.globalAlpha = alpha * 0.6;
  ctx.fillStyle   = AMBER_GLOW;
  ctx.fillRect(ax - 13, ay - 13, 26, 26);

  // Cube body
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = AMBER_FILL;
  ctx.strokeStyle = '#8b6a00';
  ctx.lineWidth   = 0.8;
  ctx.fillRect(  ax - 8, ay - 8, 16, 16);
  ctx.strokeRect(ax - 8, ay - 8, 16, 16);

  // Rune cross mark inside cube
  ctx.globalAlpha = alpha * 0.65;
  ctx.strokeStyle = '#fff3c0';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(ax - 3, ay);     ctx.lineTo(ax + 3, ay);
  ctx.moveTo(ax,     ay - 3); ctx.lineTo(ax,     ay + 3);
  ctx.stroke();

  ctx.restore();
}

/**
 * CLAIMED zone — monitor screen glow.
 *
 * A small rectangular "screen" with a teal inner glow. Pulses gently for
 * working tasks; very faint when idle.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ax
 * @param {number} ay
 * @param {number} workingCount  Chips with visualState 'working'
 * @param {number} now
 */
function drawMonitorGlow(ctx, ax, ay, workingCount, now) {
  ctx.save();

  const phase = (now % 1600) / 1600;
  const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  const alpha = workingCount > 0 ? 0.45 + 0.35 * pulse : 0.13;

  // Screen glow halo
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle   = TEAL_GLOW;
  ctx.fillRect(ax - 15, ay - 11, 30, 20);

  // Screen bezel (outer rect)
  ctx.globalAlpha = Math.max(alpha, 0.25);
  ctx.strokeStyle = '#3a5c5c';
  ctx.lineWidth   = 1;
  ctx.strokeRect(ax - 12, ay - 8, 24, 15);

  // Screen face (inner rect)
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = TEAL_FILL;
  ctx.fillRect(ax - 10, ay - 6, 20, 11);

  ctx.restore();
}

/**
 * EXECUTE_FINISHED zone — approval / clipboard marker.
 *
 * A pulsing amber ellipse ring for processing (awaiting-ack) tasks.
 * Faint outline only when no processing tasks.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ax
 * @param {number} ay
 * @param {number} processingCount  Chips with visualState 'processing'
 * @param {number} now
 */
function drawApprovalMarker(ctx, ax, ay, processingCount, now) {
  ctx.save();

  const phase = (now % 1600) / 1600;
  const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);

  if (processingCount === 0) {
    // Faint clipboard outline
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = AMBER_FILL;
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.ellipse(ax, ay, 11, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const alpha = 0.30 + 0.45 * pulse;

  // Outer amber glow ring
  ctx.globalAlpha = alpha * 0.55;
  ctx.strokeStyle = AMBER_FILL;
  ctx.lineWidth   = 3 + 2 * pulse;
  ctx.beginPath();
  ctx.ellipse(ax, ay, 14 + 2 * pulse, 10 + 1 * pulse, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Inner fill
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = AMBER_GLOW;
  ctx.beginPath();
  ctx.ellipse(ax, ay, 9, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Checkmark stroke
  ctx.globalAlpha = Math.min(0.9, alpha + 0.2);
  ctx.strokeStyle = '#fff3c0';
  ctx.lineWidth   = 1.2;
  ctx.beginPath();
  ctx.moveTo(ax - 4, ay);
  ctx.lineTo(ax - 1, ay + 3);
  ctx.lineTo(ax + 5, ay - 3);
  ctx.stroke();

  ctx.restore();
}

/**
 * ACKED zone — archive crystal glow.
 *
 * A soft blue-green radial aura that grows with completed task count.
 * Breathes slowly to feel alive without being distracting.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ax
 * @param {number} ay
 * @param {number} completedCount  Chips with visualState 'completed'
 * @param {number} now
 */
function drawArchiveGlow(ctx, ax, ay, completedCount, now) {
  ctx.save();

  const phase  = (now % 3000) / 3000;
  const breathe = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  const baseR  = 10 + Math.min(completedCount * 2.5, 18);
  const radius = baseR + 3 * breathe;
  const alpha  = completedCount > 0
    ? Math.min(0.72, 0.25 + completedCount * 0.06 + 0.2 * breathe)
    : 0.10 + 0.06 * breathe;

  // Outer aura
  ctx.globalAlpha = alpha * 0.5;
  ctx.fillStyle   = ARCHIVE_GLOW;
  ctx.beginPath();
  ctx.arc(ax, ay, radius * 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Core glow
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = 'rgba(100, 200, 230, 0.70)';
  ctx.beginPath();
  ctx.arc(ax, ay, radius, 0, Math.PI * 2);
  ctx.fill();

  // Crystal facet lines (static — purely decorative)
  ctx.globalAlpha = alpha * 0.55;
  ctx.strokeStyle = '#c8f0ff';
  ctx.lineWidth   = 0.7;
  ctx.beginPath();
  ctx.moveTo(ax,      ay - radius * 0.85);
  ctx.lineTo(ax,      ay + radius * 0.85);
  ctx.moveTo(ax - radius * 0.7, ay);
  ctx.lineTo(ax + radius * 0.7, ay);
  ctx.stroke();

  ctx.restore();
}

/**
 * Engine crystal — pulsing glow ring at the base of the central tree crystal.
 *
 * Intensity is proportional to total active task count (working + processing).
 * The ring is always present; it just breathes slower and dimmer when idle.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ax
 * @param {number} ay
 * @param {number} activeCount  Total working + processing chips
 * @param {number} now
 */
function drawEngineCrystalPulse(ctx, ax, ay, activeCount, now) {
  ctx.save();

  const cycleMs = activeCount > 0 ? 1200 - Math.min(activeCount, 4) * 120 : 2400;
  const phase   = (now % cycleMs) / cycleMs;
  const pulse   = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  const alpha   = activeCount > 0
    ? Math.min(0.80, 0.30 + Math.min(activeCount, 5) * 0.08 + 0.28 * pulse)
    : 0.12 + 0.08 * pulse;

  const rInner = 18 + 3  * pulse;
  const rOuter = 28 + 6  * pulse;

  // Outer diffuse ring
  ctx.globalAlpha = alpha * 0.40;
  ctx.strokeStyle = 'rgba(180, 240, 200, 0.90)';
  ctx.lineWidth   = 5 + 3 * pulse;
  ctx.beginPath();
  ctx.arc(ax, ay, rOuter, 0, Math.PI * 2);
  ctx.stroke();

  // Inner bright ring
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(140, 230, 160, 0.95)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.arc(ax, ay, rInner, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

/**
 * Anomaly shelf — warning glint.
 *
 * Draws a small pulsing red warning triangle when any chip carries anomaly
 * data. Hidden when no anomalies are present.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ax
 * @param {number} ay
 * @param {boolean} hasAnomaly
 * @param {boolean} hasHighSeverity
 * @param {number} now
 */
function drawAnomalyGlint(ctx, ax, ay, hasAnomaly, hasHighSeverity, now) {
  if (!hasAnomaly) return;

  ctx.save();

  const phase = (now % 800) / 800;
  const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  const alpha = 0.55 + 0.40 * pulse;
  const ts    = 7 + 1.5 * pulse;   // triangle half-span

  // Glow halo
  ctx.globalAlpha = alpha * 0.35;
  ctx.fillStyle   = ANOMALY_GLOW;
  ctx.beginPath();
  ctx.arc(ax, ay, ts * 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Triangle
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = hasHighSeverity ? ANOMALY_RED : '#f57c00';
  ctx.beginPath();
  ctx.moveTo(ax,          ay - ts);
  ctx.lineTo(ax + ts,     ay + ts);
  ctx.lineTo(ax - ts,     ay + ts);
  ctx.closePath();
  ctx.fill();

  // Exclamation
  ctx.globalAlpha = 0.95;
  ctx.fillStyle   = '#ffffff';
  ctx.fillRect(ax - 0.8, ay - 1.5, 1.6, 4.5);
  ctx.fillRect(ax - 0.8, ay + 3.5, 1.6, 1.6);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Render all in-world diegetic indicators.
 *
 * Iterates the component list once to tally task chip counts per zone, then
 * draws one indicator visual per zone plus the engine crystal and anomaly
 * glint. All data comes exclusively from component.visualState, zoneId, and
 * anomaly — no selector or event access.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>}            components  Flat component list from toRenderableComponents()
 * @param {number}                   now         Current timestamp ms for animation
 */
export function renderDiegeticIndicators(ctx, components, now) {
  if (!ctx || !Array.isArray(components)) return;

  // Accumulate per-zone stats from task-chip components only
  const countByZone      = {};
  const workingByZone    = {};
  const processingByZone = {};
  const completedByZone  = {};
  let   totalActive   = 0;
  let   hasAnomaly    = false;
  let   hasHighSeverity = false;

  for (const c of components) {
    if (!c || c.componentType !== 'task-chip') continue;
    const z = c.zoneId ?? '_none';
    countByZone[z]      = (countByZone[z]      ?? 0) + 1;
    workingByZone[z]    = (workingByZone[z]    ?? 0) + (c.visualState === 'working'    ? 1 : 0);
    processingByZone[z] = (processingByZone[z] ?? 0) + (c.visualState === 'processing' ? 1 : 0);
    completedByZone[z]  = (completedByZone[z]  ?? 0) + (c.visualState === 'completed'  ? 1 : 0);

    if (c.visualState === 'working' || c.visualState === 'processing') totalActive++;

    if (c.anomaly) {
      hasAnomaly = true;
      if (c.anomaly.severity === 'high') hasHighSeverity = true;
    }
  }

  const safeNow = typeof now === 'number' ? now : 0;

  // Draw per-zone indicators using hardcoded anchors
  for (const [zoneId, anchor] of Object.entries(ZONE_INDICATOR_ANCHORS)) {
    const { x, y } = anchor;
    const count = countByZone[zoneId] ?? 0;

    switch (zoneId) {
      case 'CREATED':
        drawPaperStack(ctx, x, y, count);
        break;
      case 'ENQUEUED':
        drawRuneGlow(ctx, x, y, count, safeNow);
        break;
      case 'CLAIMED':
        drawMonitorGlow(ctx, x, y, workingByZone[zoneId] ?? 0, safeNow);
        break;
      case 'EXECUTE_FINISHED':
        drawApprovalMarker(ctx, x, y, processingByZone[zoneId] ?? 0, safeNow);
        break;
      case 'ACKED':
        drawArchiveGlow(ctx, x, y, completedByZone[zoneId] ?? 0, safeNow);
        break;
    }
  }

  // Engine crystal — always drawn
  drawEngineCrystalPulse(ctx, ENGINE_CRYSTAL_ANCHOR.x, ENGINE_CRYSTAL_ANCHOR.y, totalActive, safeNow);

  // Anomaly glint — only when an anomaly is present
  drawAnomalyGlint(ctx, ANOMALY_ANCHOR.x, ANOMALY_ANCHOR.y, hasAnomaly, hasHighSeverity, safeNow);
}
