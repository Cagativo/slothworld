/**
 * world-background-composition.js
 *
 * Static treehouse composition for the Slothworld canvas.
 *
 * PROJECTION BOUNDARY:
 *  - This module consumes only world-zone layout constants.
 *  - It does not receive graph nodes, selector output, or engine state.
 *  - It renders deterministic canvas art and optional debug bounds only.
 */

import { WORLD_ZONES, WORLD_ZONE_IDS } from '../ui/config/worldZones.js';
import { BACKGROUND_BOOT_POLICY } from './background-config.js';
import { traceRenderBoot } from './debug.js';

const CANVAS_BASE = Object.freeze({ width: 1060, height: 520 });

export const WORLD_COMPOSITION_ZONES = Object.freeze(
  WORLD_ZONE_IDS.map((id) => {
    const zone = WORLD_ZONES[id];
    return Object.freeze({
      id,
      label: zone.label,
      position: Object.freeze({ x: zone.position.x, y: zone.position.y }),
      size: Object.freeze({ width: zone.size.width, height: zone.size.height }),
      role: roleForZone(id),
    });
  }),
);

const LABEL_STYLE = Object.freeze({
  font: 'bold 9px monospace',
  debugFill: '#fff2bd',
});

function roleForZone(id) {
  return ({
    intakeDesk: 'intake-nook',
    engineCrystal: 'tree-core',
    researchDesk: 'workstation',
    shopifyDesk: 'workstation',
    renderDesk: 'workstation',
    supportDesk: 'workstation',
    approvalDesk: 'delivery-bay',
    anomalyShelf: 'incident-shelf',
    archiveLibrary: 'archive-shelves',
  })[id] || 'workstation';
}

function scalePoint(ctx, x, y) {
  const cw = ctx.canvas && Number.isFinite(ctx.canvas.width) ? ctx.canvas.width : CANVAS_BASE.width;
  const ch = ctx.canvas && Number.isFinite(ctx.canvas.height) ? ctx.canvas.height : CANVAS_BASE.height;
  return {
    x: x * (cw / CANVAS_BASE.width),
    y: y * (ch / CANVAS_BASE.height),
  };
}

function scaleRect(ctx, zone) {
  const topLeft = scalePoint(ctx, zone.position.x - zone.size.width / 2, zone.position.y - zone.size.height / 2);
  const bottomRight = scalePoint(ctx, zone.position.x + zone.size.width / 2, zone.position.y + zone.size.height / 2);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

function addColorStop(gradient, offset, color) {
  if (gradient && typeof gradient.addColorStop === 'function') {
    gradient.addColorStop(offset, color);
  }
}

function fillPill(ctx, x, y, w, h, color) {
  const r = Math.min(8, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawDesk(ctx, zone, color) {
  const r = scaleRect(ctx, zone);
  const deskW = Math.min(r.width * 0.82, 92);
  const deskH = Math.min(r.height * 0.20, 24);
  const x = r.x + (r.width - deskW) / 2;
  const y = r.y + r.height * 0.60;

  ctx.fillStyle = 'rgba(27, 15, 6, 0.42)';
  ctx.beginPath();
  ctx.ellipse(x + deskW / 2, y + deskH + 8, deskW * 0.58, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  fillPill(ctx, x, y, deskW, deskH, color);
  ctx.fillStyle = 'rgba(245, 216, 128, 0.28)';
  ctx.fillRect(x + deskW * 0.16, y + 5, deskW * 0.68, 2);
}

function drawArchiveShelves(ctx, zone) {
  const r = scaleRect(ctx, zone);
  const shelfX = r.x + r.width * 0.16;
  const shelfY = r.y + r.height * 0.12;
  const shelfW = r.width * 0.68;
  const shelfH = r.height * 0.68;

  ctx.fillStyle = 'rgba(43, 25, 8, 0.64)';
  ctx.fillRect(shelfX, shelfY, shelfW, shelfH);
  ctx.strokeStyle = 'rgba(151, 104, 44, 0.56)';
  ctx.lineWidth = 1;
  ctx.strokeRect(shelfX, shelfY, shelfW, shelfH);

  for (let row = 1; row <= 3; row++) {
    const y = shelfY + (shelfH / 4) * row;
    ctx.beginPath();
    ctx.moveTo(shelfX, y);
    ctx.lineTo(shelfX + shelfW, y);
    ctx.stroke();
  }

  const bookColors = ['#7a9f5d', '#c08a3d', '#8f5945', '#d2bd79'];
  for (let i = 0; i < 14; i++) {
    const x = shelfX + 8 + (i % 7) * (shelfW - 18) / 7;
    const y = shelfY + 10 + Math.floor(i / 7) * (shelfH / 3);
    ctx.fillStyle = bookColors[i % bookColors.length];
    ctx.fillRect(x, y, 4 + (i % 3), 18 + (i % 4));
  }
}

function drawIncidentShelf(ctx, zone) {
  const r = scaleRect(ctx, zone);
  ctx.fillStyle = 'rgba(55, 27, 18, 0.72)';
  fillPill(ctx, r.x + r.width * 0.16, r.y + r.height * 0.42, r.width * 0.68, 16, 'rgba(73, 44, 22, 0.82)');

  const markerX = r.x + r.width * 0.52;
  const markerY = r.y + r.height * 0.34;
  ctx.fillStyle = 'rgba(238, 178, 73, 0.84)';
  ctx.beginPath();
  ctx.arc(markerX, markerY, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(42, 18, 8, 0.70)';
  ctx.fillRect(markerX - 1.2, markerY - 5, 2.4, 7);
  ctx.fillRect(markerX - 1.2, markerY + 4, 2.4, 2.4);
}

function drawTreeCore(ctx, zone, frame) {
  const p = scalePoint(ctx, zone.position.x, zone.position.y);
  const pulse = 0.74 + 0.18 * Math.sin(frame * 0.025);

  const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 135);
  addColorStop(glow, 0, `rgba(119, 238, 194, ${0.28 * pulse})`);
  addColorStop(glow, 0.45, 'rgba(171, 119, 45, 0.16)');
  addColorStop(glow, 1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow || 'rgba(119, 238, 194, 0.08)';
  ctx.fillRect(p.x - 140, p.y - 150, 280, 300);

  ctx.fillStyle = 'rgba(69, 39, 15, 0.62)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 18, 50, 130, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(84, 236, 197, ${0.64 * pulse})`;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 58);
  ctx.lineTo(p.x + 26, p.y);
  ctx.lineTo(p.x, p.y + 74);
  ctx.lineTo(p.x - 26, p.y);
  ctx.closePath();
  ctx.fill();
}

function drawZoneProp(ctx, zone, frame) {
  if (zone.role === 'tree-core') {
    drawTreeCore(ctx, zone, frame);
    return;
  }
  if (zone.role === 'archive-shelves') {
    drawArchiveShelves(ctx, zone);
    return;
  }
  if (zone.role === 'incident-shelf') {
    drawIncidentShelf(ctx, zone);
    return;
  }
  if (zone.role === 'delivery-bay') {
    drawDesk(ctx, zone, 'rgba(104, 67, 29, 0.78)');
    const r = scaleRect(ctx, zone);
    ctx.strokeStyle = 'rgba(235, 186, 91, 0.44)';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + r.width * 0.24, r.y + r.height * 0.28, r.width * 0.52, r.height * 0.34);
    return;
  }
  if (zone.role === 'intake-nook') {
    drawDesk(ctx, zone, 'rgba(115, 73, 29, 0.82)');
    const r = scaleRect(ctx, zone);
    ctx.fillStyle = 'rgba(250, 204, 111, 0.35)';
    ctx.beginPath();
    ctx.arc(r.x + r.width * 0.54, r.y + r.height * 0.34, 10, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  drawDesk(ctx, zone, 'rgba(73, 58, 35, 0.78)');
}

function drawDebugZone(ctx, zone) {
  const r = scaleRect(ctx, zone);
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 220, 105, 0.92)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  ctx.setLineDash([]);
  fillPill(ctx, r.x + 4, r.y + 4, Math.max(72, zone.label.length * 6 + 14), 18, 'rgba(31, 16, 3, 0.86)');
  ctx.fillStyle = LABEL_STYLE.debugFill;
  ctx.font = LABEL_STYLE.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(zone.id, r.x + 11, r.y + 13);
  ctx.restore();
}

/**
 * Draw the no-asset treehouse backdrop used before the final image is loaded.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 */
export function renderTreehouseBackdrop(ctx, frame = 0) {
  if (!ctx || !ctx.canvas) return;
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  traceRenderBoot('world-background-composition.renderTreehouseBackdrop:procedural-fallback-scene', {
    ctx,
    frame,
    backgroundLoaded: false,
    backgroundSource: null,
    drawsDarkBrownGreenBackground: true,
    drawsCurvedTreeBranchArcs: true,
    arcFunction: 'ctx.bezierCurveTo',
  });

  const room = ctx.createLinearGradient(0, 0, 0, ch);
  addColorStop(room, 0, '#1d1207');
  addColorStop(room, 0.46, '#34200d');
  addColorStop(room, 1, '#263719');
  ctx.fillStyle = room || '#1d1207';
  ctx.fillRect(0, 0, cw, ch);

  const canopy = ctx.createRadialGradient(cw * 0.48, ch * 0.03, 0, cw * 0.48, ch * 0.05, cw * 0.52);
  addColorStop(canopy, 0, 'rgba(255, 220, 130, 0.44)');
  addColorStop(canopy, 0.38, 'rgba(112, 75, 24, 0.24)');
  addColorStop(canopy, 1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = canopy || 'rgba(255, 220, 130, 0.12)';
  ctx.fillRect(0, 0, cw, ch * 0.72);

  ctx.fillStyle = 'rgba(15, 8, 2, 0.52)';
  ctx.fillRect(0, 0, cw * 0.14, ch);
  ctx.fillRect(cw * 0.88, 0, cw * 0.12, ch);

  ctx.strokeStyle = 'rgba(86, 55, 22, 0.68)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(cw * 0.06, ch * 0.06);
  ctx.bezierCurveTo(cw * 0.23, ch * 0.22, cw * 0.34, ch * 0.44, cw * 0.48, ch * 0.96);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cw * 0.94, ch * 0.05);
  ctx.bezierCurveTo(cw * 0.78, ch * 0.25, cw * 0.66, ch * 0.48, cw * 0.52, ch * 0.96);
  ctx.stroke();

  const flicker = 0.6 + 0.2 * Math.sin(frame * 0.03);
  ctx.fillStyle = `rgba(247, 199, 96, ${flicker})`;
  for (const point of [
    [0.16, 0.09], [0.28, 0.07], [0.39, 0.10], [0.58, 0.08], [0.72, 0.10], [0.84, 0.07],
  ]) {
    ctx.beginPath();
    ctx.arc(cw * point[0], ch * point[1], 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draw semantic-zone props. Debug mode overlays bounds and raw zone ids.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ debug?: boolean, frame?: number }} options
 */
export function renderWorldCompositionLayer(ctx, options = {}) {
  if (!ctx) return;
  const debug = options.debug === true;
  const bakedBackground = options.bakedBackground === true;
  const bootPolicy = options.bootPolicy || null;
  const frame = Number.isFinite(options.frame) ? options.frame : 0;

  if (bootPolicy === BACKGROUND_BOOT_POLICY.BAKED_PENDING) {
    traceRenderBoot('world-background-composition.renderWorldCompositionLayer:skip-baked-pending', {
      ctx,
      frame,
      backgroundLoaded: false,
      bakedBackgroundActive: false,
      bootPolicy,
      debug,
      zonePropCount: WORLD_COMPOSITION_ZONES.length,
    });
    return;
  }

  if (bakedBackground && !debug) {
    traceRenderBoot('world-background-composition.renderWorldCompositionLayer:skip-baked-background', {
      ctx,
      frame,
      backgroundLoaded: true,
      bakedBackgroundActive: true,
      debug,
      zonePropCount: WORLD_COMPOSITION_ZONES.length,
    });
    return;
  }

  traceRenderBoot('world-background-composition.renderWorldCompositionLayer:semantic-zone-props', {
    ctx,
    frame,
    backgroundLoaded: !bakedBackground ? false : null,
    bakedBackgroundActive: bakedBackground,
    debug,
    zonePropCount: WORLD_COMPOSITION_ZONES.length,
    drawsCentralTealCrystal: true,
    drawsSimpleShelvesAndDesks: true,
  });

  ctx.save();
  for (const zone of WORLD_COMPOSITION_ZONES) {
    drawZoneProp(ctx, zone, frame);
  }
  if (debug) {
    for (const zone of WORLD_COMPOSITION_ZONES) {
      drawDebugZone(ctx, zone);
    }
  }
  ctx.restore();
}

