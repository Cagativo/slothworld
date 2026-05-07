/**
 * Geometry helpers for hotspot interaction metadata.
 */

export const HOTSPOT_CANONICAL_SIZE = Object.freeze({ width: 1060, height: 520 });

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function scaleX(value, targetSize, sourceSize) {
  return finite(value) * finite(targetSize?.width, HOTSPOT_CANONICAL_SIZE.width) / finite(sourceSize?.width, HOTSPOT_CANONICAL_SIZE.width);
}

function scaleY(value, targetSize, sourceSize) {
  return finite(value) * finite(targetSize?.height, HOTSPOT_CANONICAL_SIZE.height) / finite(sourceSize?.height, HOTSPOT_CANONICAL_SIZE.height);
}

export function rectShape(rect) {
  return Object.freeze({
    type: 'rect',
    x: finite(rect?.x),
    y: finite(rect?.y),
    width: Math.max(0, finite(rect?.width)),
    height: Math.max(0, finite(rect?.height)),
  });
}

export function pointInRect(point, rect) {
  return Boolean(point && rect
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height);
}

export function pointInCircle(point, circle) {
  if (!point || !circle || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const dx = point.x - circle.cx;
  const dy = point.y - circle.cy;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

export function pointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon?.points) || polygon.points.length < 3) return false;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;

  let inside = false;
  const points = polygon.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i];
    const pj = points[j];
    const yi = finite(pi?.y);
    const yj = finite(pj?.y);
    const intersects = (yi > point.y) !== (yj > point.y)
      && point.x < (finite(pj?.x) - finite(pi?.x)) * (point.y - yi) / ((yj - yi) || 1) + finite(pi?.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function scaleShape(shape, targetSize = HOTSPOT_CANONICAL_SIZE, sourceSize = HOTSPOT_CANONICAL_SIZE) {
  if (!shape || typeof shape !== 'object') return null;
  if (shape.type === 'circle') {
    const sx = finite(targetSize?.width, HOTSPOT_CANONICAL_SIZE.width) / finite(sourceSize?.width, HOTSPOT_CANONICAL_SIZE.width);
    const sy = finite(targetSize?.height, HOTSPOT_CANONICAL_SIZE.height) / finite(sourceSize?.height, HOTSPOT_CANONICAL_SIZE.height);
    return {
      type: 'circle',
      cx: scaleX(shape.cx, targetSize, sourceSize),
      cy: scaleY(shape.cy, targetSize, sourceSize),
      radius: finite(shape.radius) * Math.max(sx, sy),
    };
  }
  if (shape.type === 'polygon') {
    return {
      type: 'polygon',
      points: Array.isArray(shape.points)
        ? shape.points.map((point) => ({
            x: scaleX(point?.x, targetSize, sourceSize),
            y: scaleY(point?.y, targetSize, sourceSize),
          }))
        : [],
    };
  }
  return {
    type: 'rect',
    x: scaleX(shape.x, targetSize, sourceSize),
    y: scaleY(shape.y, targetSize, sourceSize),
    width: scaleX(shape.width, targetSize, sourceSize),
    height: scaleY(shape.height, targetSize, sourceSize),
  };
}

export function pointInShape(point, shape) {
  if (!shape) return false;
  if (shape.type === 'circle') return pointInCircle(point, shape);
  if (shape.type === 'polygon') return pointInPolygon(point, shape);
  return pointInRect(point, shape);
}

export function drawShapePath(ctx, shape) {
  if (!ctx || !shape) return;
  ctx.beginPath();
  if (shape.type === 'circle') {
    ctx.arc(shape.cx, shape.cy, shape.radius, 0, Math.PI * 2);
    ctx.closePath();
    return;
  }
  if (shape.type === 'polygon' && Array.isArray(shape.points) && shape.points.length > 0) {
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    for (let i = 1; i < shape.points.length; i++) {
      ctx.lineTo(shape.points[i].x, shape.points[i].y);
    }
    ctx.closePath();
    return;
  }
  ctx.rect(shape.x, shape.y, shape.width, shape.height);
  ctx.closePath();
}

export function getShapeBounds(shape) {
  if (!shape) return null;
  if (shape.type === 'circle') {
    return {
      x: shape.cx - shape.radius,
      y: shape.cy - shape.radius,
      width: shape.radius * 2,
      height: shape.radius * 2,
    };
  }
  if (shape.type === 'polygon' && Array.isArray(shape.points) && shape.points.length > 0) {
    const xs = shape.points.map((point) => finite(point?.x));
    const ys = shape.points.map((point) => finite(point?.y));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  return {
    x: finite(shape.x),
    y: finite(shape.y),
    width: Math.max(0, finite(shape.width)),
    height: Math.max(0, finite(shape.height)),
  };
}
