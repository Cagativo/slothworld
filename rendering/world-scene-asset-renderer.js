/**
 * world-scene-asset-renderer.js
 *
 * Per-layer sprite integration for the WorldScene rendering pipeline.
 *
 * CONTRACT:
 *  - Reads from ASSET_MAPPING (fixed, frozen) in assets.js
 *  - Reads images from loadedAssets (populated by AssetLoader at startup)
 *  - Gracefully skips any image not yet loaded — no errors thrown
 *  - NO Math.random — all multi-asset selection is deterministic via id hash
 *  - NO event access, NO selector access, NO lifecycle inference
 *  - NO new visual states introduced
 *
 * Exported functions map 1-to-1 to the 8 fixed rendering layers:
 *
 *  Layer 1 — renderBackgroundLayer  (ground decor, plants)
 *  Layer 2 — renderCoreLayer        (central tree + accent)
 *  Layer 3 — renderZoneLayer        (desk / shelf sprites)
 *  Layer 4 — renderConnectionLayer  (flow-stream sprites at edge midpoints)
 *  Layer 5 — renderEntityLayer      (agent base sprite)
 *  Layer 6 — renderPropLayer        (task prop sprites)
 *  Layer 7 — renderEffectLayer      (glow orbs + lantern)
 *  Layer 8 — renderUIOverlayLayer   (floating display panels)
 */

import { ASSET_MAPPING, loadedAssets } from './assets.js';
import { CENTRAL_STRUCTURE, DECORATIONS } from './world-scene.js';
import { renderTreehouseBackdrop } from './world-background-composition.js';
import { spriteConfigs } from '../core/constants.js';
import { compareByDepthY } from './scene-anchors.js';
import { drawRuntimePropAsset } from './prop-asset-renderer.js';
import {
  BACKGROUND_BOOT_POLICY,
  getBackgroundBootPolicy,
  selectLoadedBackground,
} from './background-config.js';
import { traceRenderBoot, traceResearchCard } from './debug.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic index from a string key and array length.
 * Uses a djb2-style hash — no randomness.
 *
 * @param {string} str
 * @param {number} len
 * @returns {number}
 */
function deterministicIndex(str, len) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % len;
}

/**
 * Draw an image from loadedAssets if available. No-op otherwise.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} filename
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
function drawIfLoaded(ctx, filename, x, y, w, h) {
  const img = loadedAssets[filename];
  if (img) {
    ctx.drawImage(img, x, y, w, h);
  }
}

function drawBakedPendingBootBackground(ctx) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const base = ctx.createLinearGradient(0, 0, 0, ch);
  base.addColorStop(0, '#120d08');
  base.addColorStop(0.58, '#1b130c');
  base.addColorStop(1, '#17110a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, cw, ch);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fillRect(0, 0, cw, Math.max(8, ch * 0.035));
  ctx.fillRect(0, ch - Math.max(10, ch * 0.04), cw, Math.max(10, ch * 0.04));
}

function normalizeTrendResultItems(resultPayload) {
  const directRanked = resultPayload && Array.isArray(resultPayload.ranked) ? resultPayload.ranked : null;
  if (directRanked) {
    return directRanked;
  }

  const nestedRanked = resultPayload && resultPayload.result && Array.isArray(resultPayload.result.ranked)
    ? resultPayload.result.ranked
    : null;
  if (nestedRanked) {
    return nestedRanked;
  }

  const directScored = resultPayload && Array.isArray(resultPayload.scored) ? resultPayload.scored : null;
  if (directScored) {
    return directScored;
  }

  const nestedScored = resultPayload && resultPayload.result && Array.isArray(resultPayload.result.scored)
    ? resultPayload.result.scored
    : null;
  if (nestedScored) {
    return nestedScored;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Sprite size constants
// ---------------------------------------------------------------------------


const PROP_SIZE = 20;   // px — task prop sprite (square)
const GLOW_SIZE = 40;   // px — glow orb overlay (square halo, not dominant bubble)
const FLOW_SIZE = { w: 16, h: 8 };  // px — flow stream sprite
const UI_SIZE   = { w: 52, h: 22 }; // px — floating display panel
const TREND_PANEL_ASSET_ID = 'ui_floating_display_01.png';
const TREND_PANEL_MAX_VISIBLE = 4;
const TREND_PANEL_HIDE_AFTER_MS = 30_000;
const PANEL_OFFSET_Y = 6;           // px gap between top of agent sprite and panel bottom
const PANEL_ENTER_DURATION_MS = 250;
const PANEL_ENTER_SLIDE_PX = 10;    // px slide distance on enter (downward offset → 0)
const PANEL_EXIT_DURATION_MS = 250;
const RESULT_FADE_DURATION_MS = 180;
const RESULT_STAGGER_MS = 50;       // ms delay between successive result fade-ins
const RESULT_HIGHLIGHT_DURATION_MS = 800;
const SCROLL_HINT_HEIGHT = 16;      // px — gradient overlay height at bottom when overflow
const SKELETON_ROWS = 2;            // placeholder rows during loading
const SHIMMER_DURATION_MS = 1200;   // full shimmer cycle duration
const STATUS_DOT_RADIUS = 4;        // px
const STATUS_WORKING_COLOR = '#e8a838';
const STATUS_DONE_COLOR = '#6daa45';
const RESEARCH_CARD_MAX_ROWS = 3;
const RESEARCH_CARD_MAX_LINES_PER_ROW = 2;
const trendPanelUIState = new Map();

/**
 * Resolve the canvas position of an entity component.
 * Prefers the computed slot position from the entity position map;
 * falls back to the component's own x/y if no map entry exists.
 *
 * @param {object} c                                 agent-sprite component
 * @param {Map<string, {x:number, y:number}>} map    entity position map
 * @returns {{ x: number, y: number }}
 */
function posOf(c, map) {
  const p = map && map.get(c.id);
  return p || { x: c.x, y: c.y };
}

/**
 * Truncate text to fit within maxWidth using slice-based reduction.
 * Returns text with ellipsis if truncation occurred.
 */
function truncateText(ctx, text, maxWidth) {
  const ellipsis = '…';
  const ellipsisWidth = ctx.measureText(ellipsis).width;
  const availWidth = maxWidth - ellipsisWidth;

  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  let truncated = text;
  let step = Math.max(1, Math.floor(truncated.length / 4));

  while (truncated.length > 0 && ctx.measureText(truncated).width > availWidth) {
    truncated = truncated.slice(0, -step);
  }

  return truncated + ellipsis;
}

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

function cleanCardText(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

export function wrapResearchCardText(ctx, text, maxWidth, maxLines = RESEARCH_CARD_MAX_LINES_PER_ROW) {
  const source = cleanCardText(text);
  if (!source) return [];

  const words = source.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(truncateText(ctx, word, maxWidth));
      current = '';
    }

    if (lines.length >= maxLines) break;
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = truncateText(ctx, lines[lines.length - 1], maxWidth);
  }

  return lines;
}

function findResearchDeskCardComponent(components) {
  if (!Array.isArray(components)) return null;
  return components.find((entry) => entry
    && entry.componentType === 'workstation-hotspot'
    && entry.id === 'researchMonitorHotspot'
    && entry.resultCardViewModel
    && typeof entry.resultCardViewModel === 'object'
    && Array.isArray(entry.resultCardViewModel.rows)) || null;
}

function shouldRenderWorkstationResultCard(component, options = {}) {
  if (!component?.resultCardViewModel) return false;
  if (options.debug === true) return false;
  return component.isHovered === true
    || component.isSelected === true
    || options.selectedHotspotId === component.id
    || options.hoveredHotspotId === component.id;
}

function drawLeafIcon(ctx, x, y, size) {
  ctx.save();
  ctx.fillStyle = '#42f1cf';
  ctx.strokeStyle = 'rgba(180, 255, 235, 0.72)';
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.ellipse(x - size * 0.18, y, size * 0.28, size * 0.48, -0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + size * 0.18, y, size * 0.28, size * 0.48, 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.38);
  ctx.lineTo(x, y + size * 0.82);
  ctx.stroke();
  ctx.restore();
}

function renderResearchDeskResultCard(ctx, model, options = {}) {
  if (!model || !Array.isArray(model.rows) || model.rows.length === 0) return;

  const canvasW = Number.isFinite(ctx?.canvas?.width) ? ctx.canvas.width : 1060;
  const canvasH = Number.isFinite(ctx?.canvas?.height) ? ctx.canvas.height : 520;
  const scale = Math.max(0.82, Math.min(1.35, canvasW / 1060));
  const cardW = Math.min(canvasW - 48, Math.max(420, 620 * scale));
  const cardX = Math.max(24, Math.min(canvasW - cardW - 24, 86 * scale));
  const cardY = Math.max(42, Math.min(canvasH - 230, 150 * scale));
  const padX = 34 * scale;
  const padY = 28 * scale;
  const headerH = 56 * scale;
  const rowGap = 12 * scale;
  const bulletGap = 18 * scale;
  const bodyFontPx = Math.max(17, 22 * scale);
  const titleFontPx = Math.max(25, 34 * scale);
  const lineH = bodyFontPx * 1.25;
  const rows = model.rows.slice(0, RESEARCH_CARD_MAX_ROWS);

  ctx.save();
  ctx.font = `${bodyFontPx}px sans-serif`;
  const textMaxW = cardW - padX * 2 - bulletGap - 18 * scale;
  const wrappedRows = rows.map((row) => ({
    label: cleanCardText(row.label),
    lines: wrapResearchCardText(ctx, `${row.label}: ${row.text}`, textMaxW, RESEARCH_CARD_MAX_LINES_PER_ROW),
  }));
  const bodyLines = wrappedRows.reduce((sum, row) => sum + Math.max(1, row.lines.length), 0);
  const cardH = Math.min(
    canvasH - cardY - 24,
    Math.max(
      250 * scale,
      padY * 2 + headerH + 24 * scale + bodyLines * lineH + (wrappedRows.length - 1) * rowGap
    )
  );
  traceResearchCard('[RESEARCH_CARD_DRAW_CALLED]', {
    x: cardX,
    y: cardY,
    width: cardW,
    height: cardH,
    rowsCount: rows.length,
  });

  ctx.globalAlpha = options.alpha ?? 1;
  ctx.shadowColor = 'rgba(31, 249, 216, 0.42)';
  ctx.shadowBlur = 16 * scale;
  ctx.shadowOffsetY = 0;
  roundRect(ctx, cardX, cardY, cardW, cardH, 24 * scale);
  ctx.fillStyle = 'rgba(7, 23, 20, 0.78)';
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.5 * scale;
  ctx.strokeStyle = 'rgba(65, 244, 218, 0.95)';
  roundRect(ctx, cardX, cardY, cardW, cardH, 24 * scale);
  ctx.stroke();

  drawLeafIcon(ctx, cardX + padX + 18 * scale, cardY + padY + 16 * scale, 28 * scale);

  ctx.fillStyle = '#fff4cf';
  ctx.font = `700 ${titleFontPx}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(model.title || 'Research Desk', cardX + padX + 66 * scale, cardY + padY + 18 * scale);

  const dividerY = cardY + padY + headerH;
  const dividerGradient = ctx.createLinearGradient(cardX + padX, dividerY, cardX + cardW - padX, dividerY);
  dividerGradient.addColorStop(0, 'rgba(65, 244, 218, 0.05)');
  dividerGradient.addColorStop(0.5, 'rgba(65, 244, 218, 0.85)');
  dividerGradient.addColorStop(1, 'rgba(65, 244, 218, 0.05)');
  ctx.strokeStyle = dividerGradient;
  ctx.lineWidth = 1.2 * scale;
  ctx.beginPath();
  ctx.moveTo(cardX + padX, dividerY);
  ctx.lineTo(cardX + cardW - padX, dividerY);
  ctx.stroke();

  ctx.font = `${bodyFontPx}px sans-serif`;
  ctx.fillStyle = '#fff6d8';
  ctx.textBaseline = 'top';

  let rowY = dividerY + 24 * scale;
  for (const row of wrappedRows) {
    if (rowY > cardY + cardH - padY - lineH) break;
    ctx.save();
    ctx.shadowColor = 'rgba(65, 244, 218, 0.7)';
    ctx.shadowBlur = 8 * scale;
    ctx.fillStyle = '#43f3d4';
    ctx.beginPath();
    ctx.ellipse(cardX + padX + 9 * scale, rowY + lineH * 0.48, 6 * scale, 10 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const textX = cardX + padX + bulletGap + 18 * scale;
    for (const line of row.lines) {
      if (rowY > cardY + cardH - padY - lineH) break;
      ctx.fillText(line, textX, rowY);
      rowY += lineH;
    }
    rowY += rowGap;
  }

  ctx.restore();
}

/**
 * Render a skeleton placeholder row with shimmer effect.
 * Shimmer is time-based, stateless.
 */
function renderSkeletonRow(ctx, rowY, panelX, panelY, panelWidth, paddingX, lineHeight, now) {
  const baseColor = 'rgba(100, 120, 140, 0.25)';
  const shimmerColor = 'rgba(180, 200, 220, 0.40)';

  ctx.save();
  ctx.fillStyle = baseColor;
  ctx.fillRect(panelX + paddingX, rowY - lineHeight / 2, panelWidth - paddingX * 2, lineHeight);

  const shimmerWidth = 30;
  const progress = (now % SHIMMER_DURATION_MS) / SHIMMER_DURATION_MS;
  const shimmerX = panelX + paddingX + (panelWidth - paddingX * 2 - shimmerWidth) * progress;

  const grad = ctx.createLinearGradient(shimmerX - shimmerWidth / 2, 0, shimmerX + shimmerWidth / 2, 0);
  grad.addColorStop(0, 'rgba(180, 200, 220, 0)');
  grad.addColorStop(0.5, shimmerColor);
  grad.addColorStop(1, 'rgba(180, 200, 220, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(shimmerX - shimmerWidth / 2, rowY - lineHeight / 2, shimmerWidth, lineHeight);

  ctx.restore();
}

function renderCompactTrendScreen(ctx, state, alpha, now) {
  const pulse = 0.5 + 0.5 * Math.sin((now * Math.PI * 2) / 1400);
  const w = 34;
  const h = 14;
  const x = state.anchorX - w / 2;
  const y = state.anchorY - 44;
  const activeAlpha = state.cachedStatus === 'working' ? 0.18 + 0.12 * pulse : 0.12;

  ctx.save();
  ctx.globalAlpha = alpha * activeAlpha;
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = '#54eccc';
  ctx.fillRect(x - 5, y - 4, w + 10, h + 8);
  ctx.globalAlpha = alpha * Math.min(0.42, activeAlpha + 0.10);
  ctx.fillStyle = '#8fffea';
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = alpha * 0.26;
  ctx.fillStyle = '#f8ffe8';
  ctx.fillRect(x + 5, y + 4, w * 0.52, 2);
  ctx.fillRect(x + 5, y + 8, w * 0.34, 2);
  ctx.restore();
}


// ---------------------------------------------------------------------------
// Full-scene compositing layer config
// ---------------------------------------------------------------------------

/**
 * Toggle flags for legacy per-element transparent compositing layers.
 *
 * All disabled — the scene now uses either the unified sceneBackground image
 * or the procedural drawRoomScene() function. Individual transparent overlay
 * sprites created a "floating props on empty canvas" appearance and are no
 * longer used while the unified background is active.
 *
 * Keep as false unless reverting to the legacy per-element sprite approach.
 */
const SCENE_COMPOSITE = Object.freeze({
  archDoor:          false,
  bookshelf:         false,
  slothSceneLayers:  false,  // ASSET_MAPPING.agents.sceneLayers — RGB, no alpha; not viable over photo background
});

/** @param {CanvasRenderingContext2D} ctx */
export function renderCompositeSceneLayers(ctx) {
  // Intentionally no-op while SCENE_COMPOSITE flags are all false.
  // The unified room background (image or procedural) renders in renderBackgroundLayer.
  void ctx;
}

// ---------------------------------------------------------------------------
// Layer 1 — Background (unified room environment)
// ---------------------------------------------------------------------------

/**
 * Draw the winding stream animation over the background.
 *
 * Control points come from DECORATION entries with kind === 'path'.
 * Their centres define the stream centerline in declaration order.
 * @param {number} frame
 * @param {boolean} overlayMode  true = shimmer-only over an existing static stream
 */
function drawStream(ctx, frame, overlayMode) {
  const pts = DECORATIONS
    .filter((d) => d.kind === 'path')
    .map((d) => ({
      x: d.position.x + d.size.width  / 2,
      y: d.position.y + d.size.height / 2,
    }));

  if (pts.length < 2) return;

  function tracePath() {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }

  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  if (!overlayMode) {
    // Full stream body — used in procedural room mode
    ctx.beginPath(); tracePath();
    ctx.strokeStyle = 'rgba(0, 80, 72, 0.50)';
    ctx.lineWidth   = 46;
    ctx.beginPath(); tracePath();
    ctx.strokeStyle = 'rgba(0, 175, 152, 0.72)';
    ctx.lineWidth   = 32;
    ctx.stroke();
  }

  // Animated shimmer — always drawn (lighter when overlaying image stream)
  const shimmerAlpha = overlayMode ? 0.18 + 0.06 * Math.sin(frame * 0.04)
                                   : 0.32 + 0.08 * Math.sin(frame * 0.04);
  const dashLen  = 20;
  const gapLen   = 30;
  const dashOff  = -(frame * 0.55) % (dashLen + gapLen);
  ctx.beginPath(); tracePath();
  ctx.strokeStyle    = `rgba(140, 245, 225, ${shimmerAlpha})`;
  ctx.lineWidth      = overlayMode ? 8 : 12;
  ctx.setLineDash([dashLen, gapLen]);
  ctx.lineDashOffset = dashOff;
  ctx.stroke();

  // Leaf/debris particle removed — the floating teal ellipse was a visible
  // teal highlight overlay on the baked stream, inconsistent with image mode.

  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Draw the procedural room environment — a unified, painted-background
 * representation of the reference image composition.
 *
 * This renders the scene as one coherent space rather than scattered sprites:
 *  - Dark warm bark-brown base tone (inside of a forest hollow)
 *  - Central arch glow (amber/gold light through the ornate door)
 *  - Left nook warmth (lantern-lit cosy alcove, upper-left)
 *  - Right-area neutral cool light (cloudy sky visible on right)
 *  - Mossy green ground plane (lower portion of canvas)
 *  - Left tree-trunk wall vignette
 *  - Right vine-wall vignette
 *  - Top canopy vignette
 *  - Animating fairy-light string points (ceiling)
 *  - Ground stones (small ellipses, deterministic)
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 */
function drawRoomScene(ctx, frame) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;

  // ── 1. Base room atmosphere ─────────────────────────────────────────────
  // Warm dark interior — inside of a living forest hollow.
  const baseGrad = ctx.createLinearGradient(0, 0, 0, ch);
  baseGrad.addColorStop(0,   '#1c1408');
  baseGrad.addColorStop(0.3, '#28190a');
  baseGrad.addColorStop(0.6, '#36240e');
  baseGrad.addColorStop(1,   '#2c1e0a');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, cw, ch);

  // ── 2. Arch glow — amber/gold from behind the tree arch (upper centre) ──
  const archX = cw * 0.44;
  const archGlow = ctx.createRadialGradient(archX, 0, 0, archX, ch * 0.06, cw * 0.42);
  archGlow.addColorStop(0,    'rgba(255, 228, 142, 0.96)');
  archGlow.addColorStop(0.15, 'rgba(235, 190,  98, 0.80)');
  archGlow.addColorStop(0.38, 'rgba(185, 138,  55, 0.50)');
  archGlow.addColorStop(0.65, 'rgba(115,  84,  28, 0.20)');
  archGlow.addColorStop(1,    'rgba(  0,   0,   0,  0)');
  ctx.fillStyle = archGlow;
  ctx.fillRect(cw * 0.08, 0, cw * 0.76, ch * 0.80);

  // ── 3. Left nook — warm lantern amber in upper-left alcove ──────────────
  const nookX = cw * 0.10;
  const nookY = ch * 0.26;
  const nookGlow = ctx.createRadialGradient(nookX, nookY, 0, nookX, nookY, cw * 0.26);
  nookGlow.addColorStop(0,   'rgba(215, 155,  68, 0.56)');
  nookGlow.addColorStop(0.35,'rgba(178, 118,  44, 0.28)');
  nookGlow.addColorStop(0.70,'rgba(120,  80,  24, 0.10)');
  nookGlow.addColorStop(1,   'rgba(  0,   0,   0,  0)');
  ctx.fillStyle = nookGlow;
  ctx.fillRect(0, 0, cw * 0.40, ch * 0.72);

  // ── 4. Right area — neutral, slightly cool (cloudy sky beyond the wall) ─
  const rGlow = ctx.createRadialGradient(cw * 0.86, ch * 0.20, 0, cw * 0.86, ch * 0.20, cw * 0.28);
  rGlow.addColorStop(0,   'rgba(205, 220, 228, 0.32)');
  rGlow.addColorStop(0.5, 'rgba(168, 182, 188, 0.14)');
  rGlow.addColorStop(1,   'rgba(  0,   0,   0,  0)');
  ctx.fillStyle = rGlow;
  ctx.fillRect(cw * 0.60, 0, cw * 0.40, ch * 0.58);

  // ── 5. Mossy ground plane ───────────────────────────────────────────────
  // Transitions from the warm base tone into green moss from ~38% height.
  const groundStart = ch * 0.38;
  const groundGrad = ctx.createLinearGradient(0, groundStart, 0, ch);
  groundGrad.addColorStop(0,    'rgba( 60,  92, 38,  0)');
  groundGrad.addColorStop(0.10, 'rgba( 68, 105, 44, 0.68)');
  groundGrad.addColorStop(0.32, 'rgba( 78, 118, 50, 0.88)');
  groundGrad.addColorStop(0.62, 'rgba( 82, 122, 52, 0.94)');
  groundGrad.addColorStop(1,    'rgba( 62,  92, 38, 0.96)');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, groundStart, cw, ch - groundStart);

  // Centre floor highlight — open space glows slightly brighter
  const floorLight = ctx.createRadialGradient(cw * 0.50, ch * 0.72, 0, cw * 0.50, ch * 0.72, cw * 0.38);
  floorLight.addColorStop(0,   'rgba(112, 158, 66, 0.42)');
  floorLight.addColorStop(0.5, 'rgba( 90, 130, 52, 0.18)');
  floorLight.addColorStop(1,   'rgba(  0,   0,  0,  0)');
  ctx.fillStyle = floorLight;
  ctx.fillRect(cw * 0.10, ch * 0.50, cw * 0.80, ch * 0.50);

  // ── 6. Left tree-trunk wall — dark organic vignette ────────────────────
  const lWall = ctx.createLinearGradient(0, 0, cw * 0.22, 0);
  lWall.addColorStop(0,    'rgba(16,  8,  2, 0.96)');
  lWall.addColorStop(0.38, 'rgba(34, 20,  7, 0.74)');
  lWall.addColorStop(0.72, 'rgba(44, 28, 10, 0.30)');
  lWall.addColorStop(1,    'rgba( 0,  0,  0,  0)');
  ctx.fillStyle = lWall;
  ctx.fillRect(0, 0, cw * 0.22, ch);

  // ── 7. Right vine-wall — darker structured vignette ─────────────────────
  const rWall = ctx.createLinearGradient(cw * 0.78, 0, cw, 0);
  rWall.addColorStop(0,    'rgba( 0,  0,  0,  0)');
  rWall.addColorStop(0.28, 'rgba(28, 18,  7, 0.28)');
  rWall.addColorStop(0.62, 'rgba(20, 12,  4, 0.70)');
  rWall.addColorStop(1,    'rgba(12,  6,  1, 0.94)');
  ctx.fillStyle = rWall;
  ctx.fillRect(cw * 0.78, 0, cw * 0.22, ch);

  // ── 8. Top canopy — heavy dark pressing down from ceiling ───────────────
  const ceiling = ctx.createLinearGradient(0, 0, 0, ch * 0.30);
  ceiling.addColorStop(0,    'rgba( 8,  4,  1, 0.92)');
  ceiling.addColorStop(0.38, 'rgba(16, 10,  4, 0.48)');
  ceiling.addColorStop(0.78, 'rgba(18, 12,  5, 0.14)');
  ceiling.addColorStop(1,    'rgba( 0,  0,  0,  0)');
  ctx.fillStyle = ceiling;
  ctx.fillRect(0, 0, cw, ch * 0.30);

  // Narrow bright strip at very top — the sunlit sky bleeding in
  const skyBleed = ctx.createLinearGradient(0, 0, 0, ch * 0.04);
  skyBleed.addColorStop(0,   'rgba(255, 235, 165, 0.28)');
  skyBleed.addColorStop(1,   'rgba(  0,   0,   0,  0)');
  ctx.fillStyle = skyBleed;
  ctx.fillRect(cw * 0.28, 0, cw * 0.36, ch * 0.04);

  // ── 9. Bottom / outer edge vignette ────────────────────────────────────
  // The reference image has a subtle fish-eye / circular room enclosure.
  const btm = ctx.createLinearGradient(0, ch * 0.82, 0, ch);
  btm.addColorStop(0,   'rgba(0, 0, 0, 0)');
  btm.addColorStop(1,   'rgba(0, 0, 0, 0.40)');
  ctx.fillStyle = btm;
  ctx.fillRect(0, ch * 0.82, cw, ch * 0.18);

  // ── 10. Fairy light string points (ceiling/canopy) ──────────────────────
  // Deterministic positions; gentle independent flicker driven by frame.
  const fairyLights = [
    { nx: 0.130, ny: 0.018, r: 1.6 }, { nx: 0.210, ny: 0.028, r: 1.3 },
    { nx: 0.295, ny: 0.016, r: 1.9 }, { nx: 0.385, ny: 0.026, r: 1.4 },
    { nx: 0.460, ny: 0.014, r: 2.1 }, { nx: 0.525, ny: 0.024, r: 1.5 },
    { nx: 0.600, ny: 0.018, r: 1.7 }, { nx: 0.672, ny: 0.028, r: 1.4 },
    { nx: 0.745, ny: 0.016, r: 1.6 }, { nx: 0.175, ny: 0.055, r: 1.2 },
    { nx: 0.260, ny: 0.048, r: 1.5 }, { nx: 0.435, ny: 0.050, r: 1.7 },
    { nx: 0.550, ny: 0.058, r: 1.3 }, { nx: 0.640, ny: 0.046, r: 1.6 },
    { nx: 0.715, ny: 0.055, r: 1.2 },
  ];
  ctx.save();
  const fb = frame * 0.009;
  for (let i = 0; i < fairyLights.length; i++) {
    const fl     = fairyLights[i];
    const flic   = 0.55 + 0.45 * Math.sin(fb + i * 1.41);
    const lx = cw * fl.nx;
    const ly = ch * fl.ny;
    // Soft halo
    const halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, fl.r * 6);
    halo.addColorStop(0,   `rgba(255, 242, 185, ${0.58 * flic})`);
    halo.addColorStop(0.4, `rgba(240, 215, 145, ${0.26 * flic})`);
    halo.addColorStop(1,    'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(lx - fl.r * 7, ly - fl.r * 7, fl.r * 14, fl.r * 14);
    // Bright centre dot
    ctx.fillStyle = `rgba(255, 252, 224, ${0.88 * flic})`;
    ctx.beginPath();
    ctx.arc(lx, ly, fl.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ── 11. Ground stones — small organic rocks on the floor ────────────────
  // All sizes and positions deterministic — no Math.random.
  const stones = [
    { nx: 0.245, ny: 0.680, w: 13, h: 7.5 }, { nx: 0.302, ny: 0.725, w: 9.5, h: 5.5 },
    { nx: 0.200, ny: 0.754, w: 11,  h: 6.5 }, { nx: 0.496, ny: 0.824, w: 15,  h: 8.5 },
    { nx: 0.598, ny: 0.782, w: 10,  h: 5.8 }, { nx: 0.695, ny: 0.762, w: 12,  h: 6.8 },
    { nx: 0.348, ny: 0.858, w: 17,  h: 9.5 }, { nx: 0.448, ny: 0.900, w: 11,  h: 6.2 },
    { nx: 0.152, ny: 0.692, w: 8.5, h: 5.0 }, { nx: 0.558, ny: 0.848, w: 9.0, h: 5.2 },
  ];
  ctx.save();
  for (const s of stones) {
    const sx = cw * s.nx;
    const sy = ch * s.ny;
    // Stone body
    ctx.fillStyle = 'rgba(132, 112, 82, 0.58)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, s.w, s.h, 0, 0, Math.PI * 2);
    ctx.fill();
    // Highlight
    ctx.fillStyle = 'rgba(172, 150, 110, 0.36)';
    ctx.beginPath();
    ctx.ellipse(sx - s.w * 0.18, sy - s.h * 0.28, s.w * 0.56, s.h * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw Layer 1: the unified room background + animated stream.
 *
 * Two modes, selected automatically:
 *  A. Image mode  — sceneBackground image loaded → draw it full-canvas,
 *                   then lay the stream shimmer on top (overlayMode = true).
 *  B. Procedural  — no image → drawRoomScene() paints the entire environment
 *                   from canvas operations, then drawStream draws the full body.
 *
 * Individual decor sprites (plants, vines, lanterns) are NOT drawn here.
 * The room background — image or procedural — provides all environmental
 * decoration. Scattered per-sprite rendering is what produced the
 * "floating props on empty canvas" appearance.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame  Current render frame counter
 */
export function renderBackgroundLayer(ctx, frame, options = {}) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;

  const bg = selectLoadedBackground(loadedAssets);
  const bgImg = bg && bg.image;
  const bootPolicy = options.bootPolicy || getBackgroundBootPolicy(loadedAssets, options);

  if (bootPolicy === BACKGROUND_BOOT_POLICY.BAKED_READY && bgImg) {
    traceRenderBoot('baked-background', {
      ctx,
      frame,
      backgroundLoaded: true,
      backgroundSource: bg.filename,
      imageNaturalSize: {
        width: bgImg.naturalWidth || bgImg.width || null,
        height: bgImg.naturalHeight || bgImg.height || null,
      },
    });
    // ── A. Image mode ────────────────────────────────────────────────────
    // The background image is the sole environmental visual. No overlays drawn.
    ctx.drawImage(bgImg, 0, 0, cw, ch);
    return;
  }

  if (bootPolicy === BACKGROUND_BOOT_POLICY.FALLBACK_ALLOWED) {
    traceRenderBoot('procedural-fallback', {
      ctx,
      frame,
      backgroundLoaded: false,
      backgroundSource: null,
      fallbackFunction: 'renderTreehouseBackdrop',
    });
    // ── B. Explicit procedural fallback ───────────────────────────────────
    // Debug/calibration/opt-in modes can still inspect the legacy treehouse
    // projection while normal baked boot suppresses it.
    renderTreehouseBackdrop(ctx, frame);
    return;
  }

  traceRenderBoot('baked-pending-blank', {
    ctx,
    frame,
    backgroundLoaded: false,
    backgroundSource: null,
    bootPolicy,
    fallbackSuppressed: true,
  });
  drawBakedPendingBootBackground(ctx);
}

// ---------------------------------------------------------------------------
// Layer 2 — Core (central tree + crystal column)
// ---------------------------------------------------------------------------

/**
 * Draw the teal-to-gold crystal column embedded in the tree trunk.
 *
 * The column is an elongated diamond (top tip → widest point → bottom tip)
 * with a teal/gold gradient fill, a left-facing facet highlight, and a
 * pulsing outer glow. Pulse frequency is driven solely by the frame counter.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx     Horizontal center of the tree trunk
 * @param {number} top    Y position of the crystal's top tip
 * @param {number} bot    Y position of the crystal's bottom tip
 * @param {number} frame
 */
function drawCrystalColumn(ctx, cx, top, bot, frame) {
  const pulse    = 0.82 + 0.18 * Math.sin(frame * 0.035);
  const crystalW = 38;                       // half-width at widest point
  const wideY    = top + (bot - top) * 0.36; // widest point — new image has more centred shoulder

  ctx.save();

  // Outer glow — drawn first so it sits behind the crystal body
  const glowR  = crystalW * 2.4;
  const glowMY = top + (bot - top) * 0.5;
  const outerGlow = ctx.createRadialGradient(cx, glowMY, 0, cx, glowMY, glowR);
  outerGlow.addColorStop(0,   `rgba(0, 230, 190, ${0.28 * pulse})`);
  outerGlow.addColorStop(0.45,`rgba(0, 180, 145, ${0.12 * pulse})`);
  outerGlow.addColorStop(1,    'rgba(0,   0,   0, 0)');
  ctx.fillStyle = outerGlow;
  ctx.fillRect(cx - glowR, top - 24, glowR * 2, (bot - top) + 48);

  // Crystal body — elongated diamond path
  ctx.beginPath();
  ctx.moveTo(cx,            top);    // apex
  ctx.lineTo(cx + crystalW, wideY);  // right shoulder
  ctx.lineTo(cx,            bot);    // base tip
  ctx.lineTo(cx - crystalW, wideY);  // left shoulder
  ctx.closePath();

  const bodyGrad = ctx.createLinearGradient(cx - crystalW, top, cx + crystalW, bot);
  bodyGrad.addColorStop(0,    `rgba( 95, 255, 215, ${0.92 * pulse})`);
  bodyGrad.addColorStop(0.25, `rgba(  0, 215, 170, ${0.95 * pulse})`);
  bodyGrad.addColorStop(0.65, `rgba(  0, 165, 130, ${0.88 * pulse})`);
  bodyGrad.addColorStop(1,    `rgba(185, 160,  35, ${0.75 * pulse})`);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // Left-face facet — lighter triangle to suggest a flat panel catching light
  ctx.beginPath();
  ctx.moveTo(cx,            top);
  ctx.lineTo(cx - crystalW, wideY);
  ctx.lineTo(cx,            bot);
  ctx.closePath();
  ctx.fillStyle = `rgba(190, 255, 245, ${0.16 * pulse})`;
  ctx.fill();

  // Right-face facet — slightly warm tint for the shadowed panel
  ctx.beginPath();
  ctx.moveTo(cx,            top);
  ctx.lineTo(cx + crystalW, wideY);
  ctx.lineTo(cx,            bot);
  ctx.closePath();
  ctx.fillStyle = `rgba(200, 240, 180, ${0.08 * pulse})`;
  ctx.fill();

  // Inner highlight line — thin bright stripe down the left edge
  ctx.beginPath();
  ctx.moveTo(cx - crystalW * 0.6, wideY - (wideY - top) * 0.5);
  ctx.lineTo(cx - crystalW * 0.3, wideY + (bot  - wideY) * 0.4);
  ctx.strokeStyle = `rgba(220, 255, 250, ${0.45 * pulse})`;
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // Crystal outline
  ctx.beginPath();
  ctx.moveTo(cx,            top);
  ctx.lineTo(cx + crystalW, wideY);
  ctx.lineTo(cx,            bot);
  ctx.lineTo(cx - crystalW, wideY);
  ctx.closePath();
  ctx.strokeStyle = `rgba(160, 255, 225, ${0.55 * pulse})`;
  ctx.lineWidth   = 1;
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw the dark rhomboid pit/pool below the crystal column base.
 *
 * Represents the underground pool visible in the new reference image —
 * a diamond-shaped void into which the crystal descends. Drawn between the
 * tree sprite and the crystal column so the column overlaps the upper rim.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx       Horizontal centre of the tree trunk
 * @param {number} crystalBot  Y position of the crystal's bottom tip
 * @param {number} frame
 */
function drawCrystalPool(ctx, cx, crystalBot, frame) {
  const poolDepth = 68;    // vertical extent of the visible pit below crystal base
  const poolW     = 58;    // half-width of the pit at its widest point
  const poolMidY  = crystalBot + poolDepth * 0.44;
  const poolBotY  = crystalBot + poolDepth;

  ctx.save();

  // Pit interior — dark gradient receding into shadow
  const poolGrad = ctx.createLinearGradient(cx, crystalBot, cx, poolBotY);
  poolGrad.addColorStop(0,   'rgba(0, 28, 22, 0.88)');
  poolGrad.addColorStop(0.55,'rgba(0, 12, 10, 0.96)');
  poolGrad.addColorStop(1,   'rgba(0,  4,  3, 0.99)');

  ctx.beginPath();
  ctx.moveTo(cx,           crystalBot);  // top vertex (crystal base tip enters here)
  ctx.lineTo(cx + poolW,   poolMidY);    // right shoulder
  ctx.lineTo(cx,           poolBotY);    // bottom vertex
  ctx.lineTo(cx - poolW,   poolMidY);    // left shoulder
  ctx.closePath();
  ctx.fillStyle = poolGrad;
  ctx.fill();

  // Teal rim glow — faint pulse around the pool edge matching the crystal
  const pulse = 0.68 + 0.22 * Math.sin(frame * 0.028);
  ctx.strokeStyle = `rgba(0, 170, 138, ${0.38 * pulse})`;
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // Reflective shimmer — hairline bright stripe at the mid-point
  ctx.beginPath();
  ctx.moveTo(cx - poolW * 0.5, poolMidY);
  ctx.lineTo(cx + poolW * 0.5, poolMidY);
  ctx.strokeStyle = `rgba(100, 240, 210, ${0.14 * pulse})`;
  ctx.lineWidth   = 1;
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw the core layer: ambient glow → canopy warmth → main tree sprite →
 * crystal pool/pit → crystal column.
 *
 * Layer order places the pool between tree and crystal so the crystal base
 * appears to descend into the pit, matching the new reference image.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame  Current render frame counter
 */
export function renderCoreLayer(ctx, frame) {
  // HARD NO-OP — disabled unconditionally.
  //
  // The procedural crystal column, pool, ambient teal glow, and canopy gradient
  // all fire during the image preload window (before scene_background_01.jpg is
  // in loadedAssets), producing a visible blue/teal flash on every page refresh.
  // The `if (bgImg) return` guard was insufficient because loadedAssets is populated
  // asynchronously — the first N frames always ran the procedural path.
  //
  // Crystal, pool, and ambient lighting are fully baked into the background image.
  // This layer has nothing to add. Re-enable selectively once the scene is stable
  // and only for interactive overlays (e.g. task-driven crystal pulse).
  void ctx; void frame;
}

// ---------------------------------------------------------------------------
// Layer 3 — Zone (desk / shelf sprites)
// ---------------------------------------------------------------------------

/**
 * Draw zone background sprites over each zone-background component.
 * The component id is used directly as the ASSET_MAPPING.zones key
 * (e.g. 'CREATED', 'ENQUEUED').
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components
 */
export function renderZoneLayer(ctx, components, options = {}) {
  // When the scene background image is loaded, all zone furniture (desks, benches,
  // shelves) is already baked into the image. Drawing zone sprites on top doubles
  // the furniture and produces floating blocks over the background.
  // Skip entirely in image mode — only run in procedural fallback mode.
  const bg = selectLoadedBackground(loadedAssets);
  const bgImg = bg && bg.image;
  const bootPolicy = options.bootPolicy || getBackgroundBootPolicy(loadedAssets, options);
  if (bgImg) {
    traceRenderBoot('world-scene-asset-renderer.renderZoneLayer:skip-baked-background', {
      ctx,
      backgroundLoaded: true,
      backgroundSource: bg.filename,
      zoneCount: Array.isArray(components)
        ? components.filter((c) => c && c.componentType === 'zone-background').length
        : 0,
    });
    return;
  }

  if (bootPolicy === BACKGROUND_BOOT_POLICY.BAKED_PENDING) {
    traceRenderBoot('world-scene-asset-renderer.renderZoneLayer:skip-baked-pending', {
      ctx,
      backgroundLoaded: false,
      backgroundSource: null,
      bootPolicy,
      zoneCount: Array.isArray(components)
        ? components.filter((c) => c && c.componentType === 'zone-background').length
        : 0,
    });
    return;
  }

  traceRenderBoot('world-scene-asset-renderer.renderZoneLayer:procedural-zone-sprites', {
    ctx,
    backgroundLoaded: false,
    backgroundSource: null,
    zoneCount: Array.isArray(components)
      ? components.filter((c) => c && c.componentType === 'zone-background').length
      : 0,
    staticDeskSprites: true,
  });

  for (const c of components) {
    if (c.componentType !== 'zone-background') continue;
    // ACKED zone sprite (storage_shelf_moss_01.png) contains 'STORAGE' painted in
    // the pixel art. Suppress it — the bookshelf composite layer covers this zone
    // and provides a cleaner read. Re-enable if a relabelled sprite is available.
    if (c.id === 'ACKED') continue;
    const filename = ASSET_MAPPING.zones[c.id];
    if (!filename) continue;
    drawIfLoaded(ctx, filename, c.x, c.y, c.width, c.height);
  }

  // Static terminal desks — procedural mode only (image mode has these baked in).
  drawIfLoaded(ctx, ASSET_MAPPING.zones.ENQUEUED, 916 - 48, 266 - 30, 96, 60);
  drawIfLoaded(ctx, ASSET_MAPPING.zones.ENQUEUED, 657 - 39, 250 - 24, 78, 48);
}

// ---------------------------------------------------------------------------
// Layer 4 — Connection (flow-stream sprites at edge midpoints)
// ---------------------------------------------------------------------------

/**
 * Draw a flow-stream sprite centred at the midpoint of each flow-line.
 * Sprite is chosen by connection index mod flow asset count (deterministic).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components
 * @param {Map<string, {x:number, y:number}>} entityPositions
 */
export function renderConnectionLayer(ctx, components, entityPositions, isDebugMode = false) {
  const flowAssets = ASSET_MAPPING.effects.flow;
  let idx = 0;
  ctx.save();
  if (!isDebugMode) {
    ctx.globalAlpha = 0.11;
    ctx.globalCompositeOperation = 'screen';
  }
  for (const c of components) {
    if (c.componentType !== 'flow-line') continue;
    const fromPos = entityPositions.get(c.from);
    const toPos   = entityPositions.get(c.to);
    if (fromPos && toPos) {
      const mx = (fromPos.x + toPos.x) / 2;
      const my = (fromPos.y + toPos.y) / 2;
      const filename = flowAssets[idx % flowAssets.length];
      const assetKey = isDebugMode ? 'dataStreamMain' : 'dataStreamSoft';
      const drawn = drawRuntimePropAsset(ctx, assetKey, {
        x: mx,
        y: my,
        width: isDebugMode ? 22 : 18,
        height: isDebugMode ? 11 : 9,
        alpha: isDebugMode ? 0.18 : 0.10,
      });
      if (!drawn) {
        drawIfLoaded(ctx, filename, mx - FLOW_SIZE.w / 2, my - FLOW_SIZE.h / 2, FLOW_SIZE.w, FLOW_SIZE.h);
      }
    }
    idx++;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Layer 5 — Entity
// ---------------------------------------------------------------------------

/**
 * Legacy no-op.
 *
 * Agent sprite drawing now runs in agent-entity-renderer.js so it always uses
 * entityPositions and a single deterministic desk mapping path.
 */
export function renderEntityLayer(ctx, components, entityPositions) {
  void ctx;
  void components;
  void entityPositions;
}

// ---------------------------------------------------------------------------
// Layer 6 — Prop (task prop sprites near agents)
// ---------------------------------------------------------------------------

/**
 * Draw a task prop sprite offset (+18 x, -10 y) from each agent position.
 * Prop asset is selected by deterministicIndex(entity.id, props.length).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components
 */
export function renderPropLayer(ctx, components, entityPositions) {
  const taskAssets  = ASSET_MAPPING.props.task;
  const booksAssets = ASSET_MAPPING.props.books;
  let   debugLogged = false;
  const agents = components
    .filter((c) => c && c.componentType === 'agent-sprite')
    .map((c) => ({ ...c, ...posOf(c, entityPositions) }))
    .sort(compareByDepthY);

  for (const c of agents) {
    const { x, y, scale = 1 }  = c;
    const propSize = PROP_SIZE * (Number.isFinite(scale) ? scale : 1);
    // Props offset relative to agent anchor; larger PROP_SIZE to stay visible
    // next to the now-bigger sloth sprites.
    const taskFile  = taskAssets[deterministicIndex(c.id, taskAssets.length)];
    const booksFile = booksAssets[deterministicIndex(c.id, booksAssets.length)];
    if (window.DEV_MODE && !debugLogged) {
      console.log('[Layer 6] task prop:', taskFile, '| loaded:', !!loadedAssets[taskFile],
        '| books prop:', booksFile, '| loaded:', !!loadedAssets[booksFile]);
      debugLogged = true;
    }
    drawIfLoaded(ctx, taskFile,  x + 22, y - 6, propSize, propSize);
    drawIfLoaded(ctx, booksFile, x - 22, y - 6, propSize, propSize);
  }
}

// ---------------------------------------------------------------------------
// Layer 7 — Effect (glow orbs + lantern)
// ---------------------------------------------------------------------------

/**
 * Draw effect sprites for each agent:
 *  - Glow orb: soft light overlay centred on the agent, selected by
 *    deterministicIndex(id, glows.length).
 *
 * Lanterns are no longer drawn here — they are fixed scene elements placed
 * via DECORATIONS (kind: 'lantern') and rendered in renderBackgroundLayer.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components
 * @param {Map<string, {x:number, y:number}>} entityPositions
 */
export function renderEffectLayer(ctx, components, entityPositions) {
  // HARD NO-OP — disabled unconditionally.
  //
  // The screen-blend + 0.14 globalAlpha glow orb pass was firing during the
  // preload window (before loadedAssets is populated), causing a blue/teal flash
  // at every page refresh. A conditional guard on bgImg was insufficient because
  // loadedAssets fills asynchronously — early frames always entered the glow path.
  //
  // `ctx.globalCompositeOperation = 'screen'` and `ctx.globalAlpha = 0.14` are
  // explicitly removed. No glow sprite is drawn. Re-enable once scene is stable
  // and a glow style suited to the background image has been chosen.
  void ctx; void components; void entityPositions;
}

// ---------------------------------------------------------------------------
// Layer 8 — UI Overlay (floating display panels)
// ---------------------------------------------------------------------------

/**
 * Draw a floating task-status panel above any agent that has an active task.
 *
 * Gate: c.currentTaskId must be non-null — it is set by agentSelectors only when
 * a task assignment has been confirmed. Idle agents (currentTaskId === null) are
 * skipped entirely, so no panel appears when no tasks are running.
 *
 * Panel contents:
 *  - ui_floating_display_01.png sprite as the backdrop
 *  - "#<last-6-of-taskId>" on the first text line
 *  - agent visualState on the second text line
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components
 * @param {Map<string, {x:number, y:number}>} entityPositions
 */
export function renderUIOverlayLayer(ctx, components, entityPositions, options = {}) {
  const now = Date.now();
  const bakedNormalMode = options.bakedBackground === true && options.debug !== true;
  const activeBackground = selectLoadedBackground(loadedAssets);
  const bootPolicy = options.bootPolicy
    || (options.bakedBackground === true ? BACKGROUND_BOOT_POLICY.BAKED_READY : getBackgroundBootPolicy(loadedAssets, options));
  const allowPendingOverlay = options.allowOverlayDuringBakedPending === true || options.debug === true;
  const researchTrendTaskId = options.stationSnapshots
    && options.stationSnapshots.research_desk
    && options.stationSnapshots.research_desk.trendResult
    && typeof options.stationSnapshots.research_desk.trendResult.taskId === 'string'
    ? options.stationSnapshots.research_desk.trendResult.taskId
    : null;
  const researchCardComponent = findResearchDeskCardComponent(components);
  const hasResearchResultCard = Boolean(researchCardComponent?.resultCardViewModel);
  const researchCardModel = shouldRenderWorkstationResultCard(researchCardComponent, options)
    ? researchCardComponent.resultCardViewModel
    : null;
  const hasResearchCardModel = Boolean(researchCardModel);
  traceResearchCard('[RESEARCH_CARD_RENDER_INPUT]', {
    stationId: 'research_desk',
    hasResultCardViewModel: hasResearchResultCard,
    debugMode: options.debug === true,
    selected: options.selectedHotspotId === 'researchMonitorHotspot',
    hovered: options.hoveredHotspotId === 'researchMonitorHotspot',
  });

  // ── Pass 1: collect panels currently reported by selectors ───────────────
  // taskId → { results, keyword, agentX, agentY, status }
  const activePanels = new Map();

  for (const c of components) {
    if (c.componentType !== 'agent-sprite') continue;
    if (hasResearchResultCard && options.debug !== true) continue;

    const panel = c.trendPanelState && typeof c.trendPanelState === 'object'
      ? c.trendPanelState
      : null;
    if (!panel) continue;

    const panelTaskId = typeof panel.taskId === 'string' && panel.taskId.trim().length > 0
      ? panel.taskId
      : null;
    if (!panelTaskId) continue;
    if (researchTrendTaskId && panelTaskId === researchTrendTaskId) continue;

    const panelResults = Array.isArray(panel.results) ? panel.results : [];
    const normalizedItems = panelResults
      .map((entry) => {
        if (entry && typeof entry === 'object') {
          return {
            item: typeof entry.item === 'string' ? entry.item : '',
            score: Number.isFinite(entry.score) ? Number(entry.score) : null,
          };
        }
        return { item: typeof entry === 'string' ? entry : '', score: null };
      })
      .filter((entry) => entry.item.length > 0);

    if (normalizedItems.length === 0 && panel.status !== 'working') continue;

    const { x, y } = posOf(c, entityPositions);
    activePanels.set(panelTaskId, {
      results: normalizedItems,
      keyword: typeof panel.keyword === 'string' ? panel.keyword : '',
      status: typeof panel.status === 'string' ? panel.status : 'working',
      agentX: x,
      agentY: y,
    });
  }

  traceRenderBoot('world-scene-asset-renderer.renderUIOverlayLayer:task-result-overlay-state', {
    ctx,
    backgroundLoaded: Boolean(activeBackground && activeBackground.image),
    backgroundSource: activeBackground ? activeBackground.filename : null,
    bakedBackgroundActive: options.bakedBackground === true,
    debug: options.debug === true,
    bakedNormalMode,
    bootPolicy,
    pendingOverlaySuppressed: bootPolicy === BACKGROUND_BOOT_POLICY.BAKED_PENDING && !allowPendingOverlay,
    activePanelCount: activePanels.size,
    cachedPanelCount: trendPanelUIState.size,
  });

  if (bootPolicy === BACKGROUND_BOOT_POLICY.BAKED_PENDING && !allowPendingOverlay) {
    return;
  }

  if (options.debug !== true) {
    renderResearchDeskResultCard(ctx, researchCardModel);
  }

  // ── Pass 2: update renderer-local state ──────────────────────────────────

  // Begin exit for panels no longer in selector output
  for (const [taskId, state] of trendPanelUIState) {
    if (!activePanels.has(taskId) && !state.exitingAt) {
      state.exitingAt = now;
    }
  }

  for (const [taskId, panelData] of activePanels) {
    if (!trendPanelUIState.has(taskId)) {
      // First appearance — capture anchor and stagger initial results
      const resultFirstSeenAt = new Map();
      panelData.results.forEach((r, i) => {
        resultFirstSeenAt.set(r.item, now + i * RESULT_STAGGER_MS);
      });
      const topItem = panelData.results.slice(-TREND_PANEL_MAX_VISIBLE)[0]?.item ?? null;
      trendPanelUIState.set(taskId, {
        firstSeenAt: now,
        exitingAt: null,
        anchorX: panelData.agentX,
        anchorY: panelData.agentY,
        cachedResults: panelData.results,
        cachedKeyword: panelData.keyword,
        cachedStatus: panelData.status || 'working',
        resultFirstSeenAt,
        highlightItem: topItem,
        highlightStartAt: topItem ? now : null,
      });
    } else {
      const state = trendPanelUIState.get(taskId);
      state.exitingAt = null; // cancel pending exit if selector returned again
      state.cachedResults = panelData.results;
      state.cachedKeyword = panelData.keyword;
      state.cachedStatus = panelData.status || 'working';

      // Register newly arrived results with staggered timestamps
      let newIdx = 0;
      for (const r of panelData.results) {
        if (!state.resultFirstSeenAt.has(r.item)) {
          state.resultFirstSeenAt.set(r.item, now + newIdx * RESULT_STAGGER_MS);
          newIdx++;
        }
      }

      // Highlight top visible result when it changes
      const topItem = panelData.results.slice(-TREND_PANEL_MAX_VISIBLE)[0]?.item ?? null;
      if (topItem && topItem !== state.highlightItem) {
        state.highlightItem = topItem;
        state.highlightStartAt = now;
      }
    }
  }

  // Prune fully-exited panels; safety-timeout stale ones
  for (const [taskId, state] of trendPanelUIState) {
    const exitDone = state.exitingAt !== null && (now - state.exitingAt) >= PANEL_EXIT_DURATION_MS;
    const timedOut = (now - state.firstSeenAt) >= TREND_PANEL_HIDE_AFTER_MS;
    if (exitDone || timedOut) {
      trendPanelUIState.delete(taskId);
    }
  }

  // ── Pass 3: render ───────────────────────────────────────────────────────

  const agentHalfH = (spriteConfigs?.agent?.height ?? 54) / 2;

  for (const [, state] of trendPanelUIState) {
    // Enter animation
    const enterProgress = Math.min(1, (now - state.firstSeenAt) / PANEL_ENTER_DURATION_MS);
    const slideY = PANEL_ENTER_SLIDE_PX * (1 - enterProgress);

    // Exit animation
    const exitAlpha = state.exitingAt !== null
      ? Math.max(0, 1 - (now - state.exitingAt) / PANEL_EXIT_DURATION_MS)
      : 1;

    const panelAlpha = enterProgress * exitAlpha;
    if (panelAlpha <= 0) continue;

    if (bakedNormalMode) {
      renderCompactTrendScreen(ctx, state, panelAlpha, now);
      continue;
    }

    const isLoading = state.cachedStatus === 'working' && state.cachedResults.length === 0;
    const visibleResults = isLoading ? [] : state.cachedResults.slice(-TREND_PANEL_MAX_VISIBLE);
    const needsScroll = !isLoading && state.cachedResults.length > TREND_PANEL_MAX_VISIBLE;
    const renderRowCount = isLoading ? SKELETON_ROWS : visibleResults.length;

    // Layout (computed from cached data, anchored to initial position)
    const lineHeight = 12;
    const paddingX = 10;
    const paddingY = 10;
    const panelWidth = 170;
    const scrollHintRows = needsScroll ? 1 : 0;
    const panelHeight = paddingY + lineHeight + renderRowCount * lineHeight
      + scrollHintRows * lineHeight + paddingY + 4;

    const panelX = state.anchorX - panelWidth / 2;
    const panelY = state.anchorY - agentHalfH - PANEL_OFFSET_Y - panelHeight + slideY;

    ctx.save();
    ctx.globalAlpha = panelAlpha;

    // Background
    drawIfLoaded(ctx, TREND_PANEL_ASSET_ID, panelX, panelY, panelWidth, panelHeight);
    if (!loadedAssets[TREND_PANEL_ASSET_ID]) {
      ctx.fillStyle = 'rgba(12, 16, 30, 0.88)';
      ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
      ctx.strokeStyle = 'rgba(232, 168, 56, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '9px monospace';

    const headerBaselineY = panelY + paddingY + lineHeight / 2;

    // Title
    ctx.fillStyle = '#e8a838';
    ctx.fillText(`Top Trends: ${state.cachedKeyword}`, panelX + paddingX, headerBaselineY);

    // Skeleton loading rows
    if (isLoading) {
      for (let i = 0; i < SKELETON_ROWS; i++) {
        const itemBaselineY = headerBaselineY + (i + 1) * lineHeight;
        renderSkeletonRow(ctx, itemBaselineY, panelX, panelY, panelWidth, paddingX, lineHeight, now);
      }
    } else {
      // Result rows — each fades in independently with stagger
      for (let i = 0; i < visibleResults.length; i++) {
        const r = visibleResults[i];
        const itemFirstSeen = state.resultFirstSeenAt.get(r.item) ?? state.firstSeenAt;
        const itemFadeIn = Math.min(1, Math.max(0, (now - itemFirstSeen) / RESULT_FADE_DURATION_MS));
        if (itemFadeIn <= 0) continue;

        const itemBaselineY = headerBaselineY + (i + 1) * lineHeight;
        const isHighlighted = r.item === state.highlightItem && state.highlightStartAt !== null;

        // Highlight pulse — subtle background glow on the top result at arrival
        if (isHighlighted) {
          const pulseAge = now - state.highlightStartAt;
          if (pulseAge < RESULT_HIGHLIGHT_DURATION_MS) {
            const pulse = Math.sin((pulseAge / RESULT_HIGHLIGHT_DURATION_MS) * Math.PI);
            ctx.save();
            ctx.globalAlpha = panelAlpha * itemFadeIn * pulse * 0.30;
            ctx.fillStyle = '#ffdd88';
            ctx.fillRect(
              panelX + paddingX - 2,
              itemBaselineY - lineHeight / 2,
              panelWidth - paddingX * 2 + 4,
              lineHeight,
            );
            ctx.restore();
          }
        }

        // Truncate text to fit available width
        const scoreLabel = r.score === null ? '' : ` ${r.score.toFixed(2)}`;
        const scoreWidth = r.score === null ? 0 : ctx.measureText(scoreLabel).width;
        const maxItemWidth = panelWidth - paddingX * 2 - scoreWidth;
        const truncatedItem = truncateText(ctx, r.item, maxItemWidth);

        ctx.save();
        ctx.globalAlpha = panelAlpha * itemFadeIn;
        ctx.fillStyle = isHighlighted ? '#ffe97a' : '#f7f4df';
        ctx.fillText(`${truncatedItem}${scoreLabel}`, panelX + paddingX, itemBaselineY);
        ctx.restore();
      }

      // Scroll hint gradient
      if (needsScroll) {
        const scrollRowY = headerBaselineY + (visibleResults.length + 1) * lineHeight;
        const scrollGradY = scrollRowY - SCROLL_HINT_HEIGHT;

        ctx.save();
        const grad = ctx.createLinearGradient(0, scrollGradY, 0, scrollRowY);
        grad.addColorStop(0, 'rgba(12, 16, 30, 0)');
        grad.addColorStop(1, 'rgba(12, 16, 30, 0.88)');
        ctx.fillStyle = grad;
        ctx.fillRect(panelX + paddingX, scrollGradY, panelWidth - paddingX * 2, SCROLL_HINT_HEIGHT);
        ctx.restore();

        // "... more" text on top of gradient
        ctx.fillStyle = '#cfd7f4';
        ctx.fillText('... more', panelX + paddingX, scrollRowY);
      }
    }

    // Status indicator dot (top-right corner)
    const statusX = panelX + panelWidth - paddingX - STATUS_DOT_RADIUS * 1.5;
    const statusY = panelY + paddingY + STATUS_DOT_RADIUS;

    if (state.cachedStatus === 'working') {
      const pulse = 0.5 + 0.5 * Math.sin((now * Math.PI * 2) / 1000);
      ctx.save();
      ctx.globalAlpha = panelAlpha * (0.5 + 0.5 * pulse);
      ctx.fillStyle = STATUS_WORKING_COLOR;
      ctx.beginPath();
      ctx.arc(statusX, statusY, STATUS_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (state.cachedStatus === 'done') {
      ctx.fillStyle = STATUS_DONE_COLOR;
      ctx.beginPath();
      ctx.arc(statusX, statusY, STATUS_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
