/**
 * Dedicated workstation hotspot highlight layer.
 *
 * Drawn after world assets and before inspection popovers. Normal mode uses
 * quiet cyan hover/selection affordances; debug mode shows hitboxes and IDs.
 */

import { WORKSTATION_HOTSPOTS } from '../ui/hotspots/workstationHotspots.js';
import {
  HOTSPOT_CANONICAL_SIZE,
  drawShapePath,
  getShapeBounds,
  scaleShape,
} from '../ui/hotspots/hotspotGeometry.js';

function targetSizeFor(ctx, options) {
  return options.canvasSize || {
    width: ctx?.canvas?.width || HOTSPOT_CANONICAL_SIZE.width,
    height: ctx?.canvas?.height || HOTSPOT_CANONICAL_SIZE.height,
  };
}

function scalePoint(point, targetSize) {
  return {
    x: (point?.x ?? 0) * targetSize.width / HOTSPOT_CANONICAL_SIZE.width,
    y: (point?.y ?? 0) * targetSize.height / HOTSPOT_CANONICAL_SIZE.height,
  };
}

function shapeFor(hotspot, targetSize, key) {
  const base = hotspot[key] || hotspot.hitArea || { type: 'rect', ...hotspot.bounds };
  return scaleShape(base, targetSize);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalVisualStyleFor(hotspot) {
  const style = hotspot?.visualStyle || {};
  return {
    tint: typeof style.tint === 'string' ? style.tint : 'cyan',
    intensity: clamp(style.intensity, 0.45, 1.25),
    pulse: style.pulse !== false,
    sparkle: style.sparkle === true,
  };
}

function componentByHotspotId(components) {
  const map = new Map();
  if (!Array.isArray(components)) return map;
  for (const component of components) {
    if (component?.id) map.set(component.id, component);
  }
  return map;
}

function stationVisualModelFor(hotspot, componentsById) {
  const model = componentsById.get(hotspot.id)?.visualStateViewModel;
  if (!model || typeof model !== 'object') {
    return {
      hotspotId: hotspot.id,
      visualState: 'idle',
      tone: 'quiet',
      intensity: 0,
      effect: 'none',
    };
  }
  return model;
}

function paletteForVisualState(visualState) {
  if (visualState === 'queued') {
    return { fill: 'rgba(244, 174, 82, 0.038)', stroke: 'rgba(250, 188, 96, 0.18)', glow: 'rgba(248, 186, 86, 0.26)' };
  }
  if (visualState === 'awaiting') {
    return { fill: 'rgba(255, 220, 132, 0.046)', stroke: 'rgba(255, 219, 128, 0.24)', glow: 'rgba(255, 216, 120, 0.30)' };
  }
  if (visualState === 'completed') {
    return { fill: 'rgba(210, 242, 255, 0.026)', stroke: 'rgba(196, 237, 255, 0.18)', glow: 'rgba(190, 236, 255, 0.24)' };
  }
  if (visualState === 'failed') {
    return { fill: 'rgba(255, 116, 76, 0.054)', stroke: 'rgba(255, 141, 90, 0.32)', glow: 'rgba(255, 108, 72, 0.36)' };
  }
  return { fill: 'rgba(72, 220, 255, 0.032)', stroke: 'rgba(92, 226, 248, 0.20)', glow: 'rgba(92, 226, 248, 0.28)' };
}

function drawStationSparkle(ctx, bounds, alpha) {
  const x = bounds.x + bounds.width * 0.78;
  const y = bounds.y + bounds.height * 0.24;
  ctx.strokeStyle = `rgba(229, 249, 255, ${alpha})`;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x - 3, y);
  ctx.lineTo(x + 3, y);
  ctx.moveTo(x, y - 3);
  ctx.lineTo(x, y + 3);
  ctx.stroke();
}

function drawStationStateGlow(ctx, hotspot, model, frame, targetSize) {
  if (!model || model.visualState === 'idle' || model.effect === 'none') return;

  const shape = shapeFor(hotspot, targetSize, 'highlightShape');
  const bounds = getShapeBounds(shape) || { x: 0, y: 0, width: 0, height: 0 };
  const palette = paletteForVisualState(model.visualState);
  const intensity = clamp(model.intensity, 0.18, 1);
  const tick = Number.isFinite(frame) ? frame : 0;
  const pulse = model.effect === 'pulse' ? 0.5 + 0.5 * Math.sin(tick / 24) : 0;
  const shimmer = model.effect === 'shimmer' ? 0.5 + 0.5 * Math.sin(tick / 18) : 0;
  const glint = model.effect === 'glint' ? 0.5 + 0.5 * Math.sin(tick / 12) : 0;
  const motion = Math.max(pulse, shimmer * 0.7, glint);

  ctx.save();
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 6 + motion * 8;
  ctx.fillStyle = palette.fill;
  drawShapePath(ctx, shape);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = palette.stroke;
  ctx.lineWidth = model.visualState === 'failed' ? 0.9 : 0.6;
  drawShapePath(ctx, shape);
  ctx.stroke();

  if (model.effect === 'sparkle') {
    drawStationSparkle(ctx, bounds, 0.26 + 0.16 * Math.sin(tick / 20) * intensity);
  }

  if (model.effect === 'glint') {
    ctx.strokeStyle = `rgba(255, 190, 106, ${0.30 + glint * 0.18})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(bounds.x + bounds.width * 0.22, bounds.y + bounds.height * 0.30);
    ctx.lineTo(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.18);
    ctx.stroke();
  }

  ctx.restore();
}

function drawDiegeticHotspotHighlight(ctx, shape, selected, pulse, intensity) {
  const fillAlpha = Math.min(
    selected ? 0.056 : 0.026,
    (selected ? 0.034 + pulse * 0.012 : 0.018) * intensity
  );
  const glowAlpha = Math.min(
    selected ? 0.42 : 0.20,
    (selected ? 0.28 + pulse * 0.09 : 0.14) * intensity
  );
  const outlineAlpha = Math.min(
    selected ? 0.58 : 0.28,
    (selected ? 0.42 + pulse * 0.10 : 0.20) * intensity
  );

  ctx.shadowColor = `rgba(72, 220, 255, ${glowAlpha})`;
  ctx.shadowBlur = selected ? 17 + pulse * 5 : 9;
  ctx.strokeStyle = `rgba(76, 213, 248, ${selected ? 0.22 : 0.12})`;
  ctx.lineWidth = selected ? 3 : 2;
  drawShapePath(ctx, shape);
  ctx.stroke();

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = `rgba(70, 205, 242, ${fillAlpha})`;
  drawShapePath(ctx, shape);
  ctx.fill();

  ctx.strokeStyle = `rgba(138, 240, 255, ${outlineAlpha})`;
  ctx.lineWidth = selected ? 0.9 : 0.5;
  drawShapePath(ctx, shape);
  ctx.stroke();
}

function drawNormalHighlight(ctx, hotspot, tone, frame, targetSize) {
  const shape = shapeFor(hotspot, targetSize, 'highlightShape');
  const selected = tone === 'selected';
  const visualStyle = normalVisualStyleFor(hotspot);
  const pulse = selected && visualStyle.pulse
    ? 0.5 + 0.5 * Math.sin((Number.isFinite(frame) ? frame : 0) / 22)
    : 0;

  ctx.save();
  drawDiegeticHotspotHighlight(ctx, shape, selected, pulse, visualStyle.intensity);
  ctx.restore();
}

function drawDebugHotspot(ctx, hotspot, targetSize, visualModel) {
  const hitArea = shapeFor(hotspot, targetSize, 'hitArea');
  const highlightShape = shapeFor(hotspot, targetSize, 'highlightShape');
  const anchor = scalePoint(hotspot.popoverAnchor, targetSize);
  const b = getShapeBounds(hitArea) || { x: 0, y: 0, width: 0, height: 0 };
  const selected = hotspot.id === (hotspot.__selectedHotspotId || null);

  ctx.fillStyle = 'rgba(68, 171, 255, 0.16)';
  drawShapePath(ctx, hitArea);
  ctx.fill();

  ctx.strokeStyle = 'rgba(68, 171, 255, 0.72)';
  ctx.lineWidth = 1;
  drawShapePath(ctx, hitArea);
  ctx.stroke();

  ctx.strokeStyle = selected ? 'rgba(255, 246, 176, 0.98)' : 'rgba(98, 240, 255, 0.92)';
  ctx.lineWidth = selected ? 2 : 1.4;
  drawShapePath(ctx, highlightShape);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 246, 176, 0.95)';
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, 3, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(18, 35, 28, 0.72)';
  ctx.fillRect(b.x, b.y, Math.max(80, hotspot.id.length * 5 + 8), 12);
  ctx.fillStyle = '#d9fff0';
  ctx.fillText(hotspot.id, b.x + 4, b.y + 2);
  if (visualModel?.visualState) {
    ctx.fillText(`state: ${visualModel.visualState}`, b.x + 4, b.y + 14);
  }
}

function drawHandle(ctx, x, y, selected = false) {
  ctx.fillStyle = selected ? 'rgba(255, 255, 255, 0.96)' : 'rgba(184, 250, 255, 0.88)';
  ctx.strokeStyle = selected ? 'rgba(255, 220, 104, 0.96)' : 'rgba(58, 211, 244, 0.92)';
  ctx.lineWidth = selected ? 1.4 : 1;
  ctx.beginPath();
  ctx.arc(x, y, selected ? 4 : 3, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawShapeHandles(ctx, shape, selectedVertexIndex) {
  if (!shape) return;
  if (shape.type === 'polygon') {
    shape.points.forEach((point, index) => drawHandle(ctx, point.x, point.y, index === selectedVertexIndex));
    return;
  }
  if (shape.type === 'circle') {
    drawHandle(ctx, shape.cx, shape.cy, selectedVertexIndex === 'center');
    drawHandle(ctx, shape.cx + shape.radius, shape.cy, selectedVertexIndex === 'radius');
    return;
  }
  if (shape.type === 'rect') {
    drawHandle(ctx, shape.x, shape.y);
    drawHandle(ctx, shape.x + shape.width, shape.y);
    drawHandle(ctx, shape.x + shape.width, shape.y + shape.height);
    drawHandle(ctx, shape.x, shape.y + shape.height);
  }
}

function drawCalibrationEditor(ctx, hotspots, targetSize, calibration) {
  if (!calibration?.editMode) return;
  const selectedId = calibration.selectedHotspotId || hotspots[0]?.id || null;
  const selected = hotspots.find((hotspot) => hotspot.id === selectedId);
  if (!selected) return;

  const hitArea = shapeFor(selected, targetSize, 'hitArea');
  const highlightShape = shapeFor(selected, targetSize, 'highlightShape');
  const anchor = scalePoint(selected.popoverAnchor, targetSize);

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 246, 176, 0.98)';
  ctx.lineWidth = 2.2;
  drawShapePath(ctx, highlightShape);
  ctx.stroke();

  if (calibration.editLayer === 'hitArea' || calibration.editLayer === 'all') {
    drawShapeHandles(ctx, hitArea, calibration.selectedVertexIndex);
  }
  if (calibration.editLayer === 'highlightShape' || calibration.editLayer === 'all') {
    drawShapeHandles(ctx, highlightShape, calibration.selectedVertexIndex);
  }
  if (calibration.editLayer === 'popoverAnchor' || calibration.editLayer === 'all') {
    drawHandle(ctx, anchor.x, anchor.y, calibration.editLayer === 'popoverAnchor');
  }

  ctx.fillStyle = 'rgba(18, 35, 28, 0.78)';
  ctx.fillRect(10, 10, 292, 66);
  ctx.fillStyle = '#d9fff0';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`edit: ${selected.id}`, 16, 16);
  ctx.fillText(`layer: ${calibration.editLayer}`, 16, 28);
  ctx.fillText('E toggle | 1 hit | 2 glow | 3 anchor | 4 all', 16, 40);
  ctx.fillText('Ctrl+C selected | Shift+Ctrl+C all | S download', 16, 52);
  ctx.fillText('Ctrl+S dev save when enabled', 16, 64);
  ctx.restore();
}

export function renderHotspotHighlights(ctx, inspectionState, options = {}) {
  if (!ctx) return;
  const debug = options.debug === true;
  const targetSize = targetSizeFor(ctx, options);
  const hotspots = options.hotspots || WORKSTATION_HOTSPOTS;
  const componentsById = componentByHotspotId(options.hotspotComponents);

  ctx.save();
  if (debug) {
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const selectedHotspotId = options.calibration?.selectedHotspotId || inspectionState?.selectedHotspotId || null;
    for (const hotspot of hotspots) {
      drawDebugHotspot(
        ctx,
        { ...hotspot, __selectedHotspotId: selectedHotspotId },
        targetSize,
        stationVisualModelFor(hotspot, componentsById)
      );
    }
    drawCalibrationEditor(ctx, hotspots, targetSize, options.calibration);
    ctx.restore();
    return;
  }

  const hoveredId = inspectionState?.hoveredHotspotId || null;
  const selectedId = inspectionState?.selectedHotspotId || null;
  let drewAmbient = false;
  for (const hotspot of hotspots) {
    const visualModel = stationVisualModelFor(hotspot, componentsById);
    if (visualModel.visualState !== 'idle') {
      drawStationStateGlow(ctx, hotspot, visualModel, options.frame, targetSize);
      drewAmbient = true;
    }
  }

  if (!hoveredId && !selectedId && !drewAmbient) {
    ctx.restore();
    return;
  }

  for (const hotspot of hotspots) {
    if (hotspot.id === selectedId) {
      drawNormalHighlight(ctx, hotspot, 'selected', options.frame, targetSize);
    } else if (hotspot.id === hoveredId) {
      drawNormalHighlight(ctx, hotspot, 'hovered', options.frame, targetSize);
    }
  }
  ctx.restore();
}
