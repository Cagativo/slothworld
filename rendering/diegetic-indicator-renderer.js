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

export {
  ZONE_INDICATOR_ANCHORS,
  ENGINE_CRYSTAL_ANCHOR,
  ANOMALY_ANCHOR,
} from './scene-anchors.js';

import {
  ZONE_INDICATOR_ANCHORS,
  ENGINE_CRYSTAL_ANCHOR,
  ANOMALY_ANCHOR,
} from './scene-anchors.js';

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

const PARCHMENT_FILL   = 'rgba(240, 228, 196, 0.78)';
const PARCHMENT_STROKE = 'rgba(138, 96, 48, 0.76)';
const AMBER_FILL       = '#d4a017';
const AMBER_GLOW       = 'rgba(212, 160, 23, 0.34)';
const TEAL_FILL        = '#00b8a9';
const TEAL_GLOW        = 'rgba(0, 184, 169, 0.28)';
const ARCHIVE_GLOW     = 'rgba(130, 200, 220, 0.32)';
const ANOMALY_RED      = '#d32f2f';
const ANOMALY_GLOW     = 'rgba(211, 47, 47, 0.30)';

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
    ctx.strokeStyle = 'rgba(138, 96, 48, 0.20)';
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
  const alpha = Math.min(0.72, baseAlpha + 0.16 * pulse);

  // Outer glow halo
  ctx.globalAlpha = alpha * 0.42;
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
  const alpha = workingCount > 0 ? 0.34 + 0.24 * pulse : 0.09;

  // Screen glow halo
  ctx.globalAlpha = alpha * 0.42;
  ctx.fillStyle   = TEAL_GLOW;
  ctx.fillRect(ax - 15, ay - 11, 30, 20);

  // Screen bezel (outer rect)
  ctx.globalAlpha = Math.max(alpha, 0.18);
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
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = AMBER_FILL;
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.ellipse(ax, ay, 11, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const alpha = 0.22 + 0.32 * pulse;

  // Outer amber glow ring
  ctx.globalAlpha = alpha * 0.42;
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
  const baseR  = 6 + Math.min(completedCount * 1.2, 8);
  const radius = baseR + 1.6 * breathe;
  const alpha  = completedCount > 0
    ? Math.min(0.30, 0.10 + completedCount * 0.018 + 0.07 * breathe)
    : 0.035 + 0.02 * breathe;

  // Outer aura
  ctx.globalAlpha = alpha * 0.36;
  ctx.fillStyle   = ARCHIVE_GLOW;
  ctx.beginPath();
  ctx.arc(ax, ay, radius * 1.35, 0, Math.PI * 2);
  ctx.fill();

  // Core glow
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = 'rgba(100, 200, 230, 0.46)';
  ctx.beginPath();
  ctx.arc(ax, ay, radius, 0, Math.PI * 2);
  ctx.fill();

  // Crystal facet lines (static — purely decorative)
  ctx.globalAlpha = alpha * 0.38;
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
    ? Math.min(0.54, 0.22 + Math.min(activeCount, 5) * 0.05 + 0.18 * pulse)
    : 0.08 + 0.05 * pulse;

  const rInner = 18 + 3  * pulse;
  const rOuter = 28 + 6  * pulse;

  // Outer diffuse ring
  ctx.globalAlpha = alpha * 0.26;
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

  const cycleMs = hasHighSeverity ? 900 : 1500;
  const phase = (now % cycleMs) / cycleMs;
  const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  const alpha = hasHighSeverity ? 0.32 + 0.22 * pulse : 0.14 + 0.12 * pulse;
  const radius = hasHighSeverity ? 3.5 + pulse : 2.5 + pulse * 0.6;

  // Tiny shelf-light halo
  ctx.globalAlpha = alpha * 0.28;
  ctx.fillStyle   = ANOMALY_GLOW;
  ctx.beginPath();
  ctx.arc(ax, ay, radius * 3, 0, Math.PI * 2);
  ctx.fill();

  // Warning gem
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = hasHighSeverity ? ANOMALY_RED : '#f57c00';
  ctx.beginPath();
  ctx.arc(ax, ay, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = 'rgba(255, 232, 190, 0.78)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.arc(ax, ay, radius + 1.5, 0, Math.PI * 2);
  ctx.stroke();

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

  function drawAtAnchor(anchor, draw) {
    const scale = Number.isFinite(anchor.scale) && anchor.scale > 0 ? anchor.scale : 1;
    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    ctx.scale(scale, scale);
    draw(0, 0);
    ctx.restore();
  }

  // Draw per-zone indicators using hardcoded anchors
  for (const [zoneId, anchor] of Object.entries(ZONE_INDICATOR_ANCHORS)) {
    const count = countByZone[zoneId] ?? 0;

    switch (zoneId) {
      case 'CREATED':
        drawAtAnchor(anchor, (x, y) => drawPaperStack(ctx, x, y, count));
        break;
      case 'ENQUEUED':
        drawAtAnchor(anchor, (x, y) => drawRuneGlow(ctx, x, y, count, safeNow));
        break;
      case 'CLAIMED':
        drawAtAnchor(anchor, (x, y) => drawMonitorGlow(ctx, x, y, workingByZone[zoneId] ?? 0, safeNow));
        break;
      case 'EXECUTE_FINISHED':
        drawAtAnchor(anchor, (x, y) => drawApprovalMarker(ctx, x, y, processingByZone[zoneId] ?? 0, safeNow));
        break;
      case 'ACKED':
        drawAtAnchor(anchor, (x, y) => drawArchiveGlow(ctx, x, y, completedByZone[zoneId] ?? 0, safeNow));
        break;
    }
  }

  // Engine crystal - always drawn
  drawAtAnchor(ENGINE_CRYSTAL_ANCHOR, (x, y) => drawEngineCrystalPulse(ctx, x, y, totalActive, safeNow));

  // Anomaly glint - only when an anomaly is present
  drawAtAnchor(ANOMALY_ANCHOR, (x, y) => drawAnomalyGlint(ctx, x, y, hasAnomaly, hasHighSeverity, safeNow));
}
