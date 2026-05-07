/**
 * Lightweight workstation hotspot calibration mode.
 *
 * Runtime-only UI state. It never mutates the canonical registry; nudge offsets
 * are applied as temporary interaction metadata and can be copied as JSON.
 */

import { WORKSTATION_HOTSPOTS } from './workstationHotspots.js';
import { pointInShape } from './hotspotGeometry.js';

const initialEditedHotspotsById = Object.create(null);

export const hotspotCalibrationState = {
  enabled: false,
  editMode: false,
  editLayer: 'hitArea',
  selectedVertexIndex: null,
  dragging: null,
  dragStart: null,
  originalGeometry: null,
  selectedHotspotId: null,
  offsetsById: Object.create(null),
  editedHotspotsById: initialEditedHotspotsById,
  editsById: initialEditedHotspotsById,
};

const EDIT_LAYERS = Object.freeze(['hitArea', 'highlightShape', 'popoverAnchor', 'all']);
const HANDLE_RADIUS = 7;

function cloneShape(shape) {
  if (!shape) return shape;
  if (shape.type === 'polygon') {
    return { ...shape, points: Array.isArray(shape.points) ? shape.points.map((point) => ({ x: point.x, y: point.y })) : [] };
  }
  return { ...shape };
}

function cloneHotspotGeometry(hotspot) {
  return {
    hitArea: cloneShape(hotspot.hitArea),
    highlightShape: cloneShape(hotspot.highlightShape),
    popoverAnchor: { x: hotspot.popoverAnchor?.x ?? 0, y: hotspot.popoverAnchor?.y ?? 0 },
    visualStyle: hotspot.visualStyle ? { ...hotspot.visualStyle } : undefined,
  };
}

function roundNumber(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function roundedPoint(point) {
  return {
    x: roundNumber(point?.x),
    y: roundNumber(point?.y),
  };
}

function roundedShape(shape) {
  if (!shape) return shape;
  if (shape.type === 'polygon') {
    return {
      type: 'polygon',
      points: Array.isArray(shape.points) ? shape.points.map(roundedPoint) : [],
    };
  }
  if (shape.type === 'circle') {
    return {
      type: 'circle',
      cx: roundNumber(shape.cx),
      cy: roundNumber(shape.cy),
      radius: roundNumber(shape.radius),
    };
  }
  return {
    type: 'rect',
    x: roundNumber(shape.x),
    y: roundNumber(shape.y),
    width: roundNumber(shape.width),
    height: roundNumber(shape.height),
  };
}

function roundedHotspotGeometry(hotspot) {
  const geometry = {
    hitArea: roundedShape(hotspot.hitArea),
    highlightShape: roundedShape(hotspot.highlightShape),
    popoverAnchor: roundedPoint(hotspot.popoverAnchor),
  };
  if (hotspot.visualStyle) {
    geometry.visualStyle = { ...hotspot.visualStyle };
  }
  return geometry;
}

function editedHotspotsById() {
  if (!hotspotCalibrationState.editedHotspotsById) {
    hotspotCalibrationState.editedHotspotsById = hotspotCalibrationState.editsById || Object.create(null);
  }
  if (hotspotCalibrationState.editsById !== hotspotCalibrationState.editedHotspotsById) {
    hotspotCalibrationState.editsById = hotspotCalibrationState.editedHotspotsById;
  }
  return hotspotCalibrationState.editedHotspotsById;
}

function clonePoint(point, offset) {
  return {
    x: (point?.x ?? 0) + offset.x,
    y: (point?.y ?? 0) + offset.y,
  };
}

function offsetShape(shape, offset) {
  if (!shape) return shape;
  if (shape.type === 'circle') {
    return { ...shape, cx: shape.cx + offset.x, cy: shape.cy + offset.y };
  }
  if (shape.type === 'polygon') {
    return {
      ...shape,
      points: Array.isArray(shape.points) ? shape.points.map((point) => clonePoint(point, offset)) : [],
    };
  }
  return { ...shape, x: shape.x + offset.x, y: shape.y + offset.y };
}

function offsetRect(rect, offset) {
  return { ...rect, x: rect.x + offset.x, y: rect.y + offset.y };
}

function offsetFor(id) {
  const offset = hotspotCalibrationState.offsetsById[id];
  return offset || { x: 0, y: 0 };
}

function editFor(id) {
  return editedHotspotsById()[id] || null;
}

function applyGeometryEdit(hotspot) {
  const edit = editFor(hotspot.id);
  if (!edit) return hotspot;
  return Object.freeze({
    ...hotspot,
    hitArea: Object.freeze(cloneShape(edit.hitArea || hotspot.hitArea)),
    highlightShape: Object.freeze(cloneShape(edit.highlightShape || hotspot.highlightShape)),
    popoverAnchor: Object.freeze({ ...(edit.popoverAnchor || hotspot.popoverAnchor) }),
  });
}

export function isHotspotCalibrationEnabled() {
  if (typeof window !== 'undefined' && window.__SLOTHWORLD_HOTSPOT_CALIBRATION__ === true) {
    return true;
  }
  return hotspotCalibrationState.enabled === true;
}

export function setHotspotCalibrationEnabled(enabled) {
  hotspotCalibrationState.enabled = Boolean(enabled);
  if (!hotspotCalibrationState.enabled) {
    hotspotCalibrationState.editMode = false;
    hotspotCalibrationState.dragging = null;
    hotspotCalibrationState.selectedVertexIndex = null;
  }
  if (typeof window !== 'undefined') {
    window.__SLOTHWORLD_HOTSPOT_CALIBRATION__ = hotspotCalibrationState.enabled;
  }
  if (hotspotCalibrationState.enabled && !hotspotCalibrationState.selectedHotspotId) {
    hotspotCalibrationState.selectedHotspotId = WORKSTATION_HOTSPOTS[0]?.id || null;
  }
  return hotspotCalibrationState.enabled;
}

export function setHotspotCalibrationEditMode(enabled) {
  if (!isHotspotCalibrationEnabled()) {
    hotspotCalibrationState.editMode = false;
    return false;
  }
  hotspotCalibrationState.editMode = Boolean(enabled);
  hotspotCalibrationState.dragging = null;
  hotspotCalibrationState.selectedVertexIndex = null;
  return hotspotCalibrationState.editMode;
}

export function isHotspotCalibrationEditMode() {
  return isHotspotCalibrationEnabled() && hotspotCalibrationState.editMode === true;
}

export function setHotspotCalibrationEditLayer(layer) {
  if (!EDIT_LAYERS.includes(layer)) return hotspotCalibrationState.editLayer;
  hotspotCalibrationState.editLayer = layer;
  hotspotCalibrationState.selectedVertexIndex = null;
  return hotspotCalibrationState.editLayer;
}

export function cycleHotspotCalibrationSelection(direction = 1) {
  if (WORKSTATION_HOTSPOTS.length === 0) return null;
  const currentIndex = WORKSTATION_HOTSPOTS.findIndex((hotspot) => hotspot.id === hotspotCalibrationState.selectedHotspotId);
  const nextIndex = (Math.max(0, currentIndex) + direction + WORKSTATION_HOTSPOTS.length) % WORKSTATION_HOTSPOTS.length;
  hotspotCalibrationState.selectedHotspotId = WORKSTATION_HOTSPOTS[nextIndex].id;
  return hotspotCalibrationState.selectedHotspotId;
}

export function selectHotspotForCalibration(id) {
  if (!WORKSTATION_HOTSPOTS.some((hotspot) => hotspot.id === id)) return null;
  hotspotCalibrationState.selectedHotspotId = id;
  return id;
}

export function nudgeSelectedHotspot(dx, dy) {
  const id = hotspotCalibrationState.selectedHotspotId;
  if (!id) return null;
  const geometry = ensureEdit(id);
  if (!geometry) return null;
  moveLayerGeometry(geometry, 'all', dx, dy);
  return { x: dx, y: dy };
}

export function getCalibratedHotspots(hotspots = WORKSTATION_HOTSPOTS) {
  if (!isHotspotCalibrationEnabled()) return hotspots;
  return hotspots.map((hotspot) => {
    const edited = applyGeometryEdit(hotspot);
    hotspot = edited;
    const offset = offsetFor(hotspot.id);
    if (offset.x === 0 && offset.y === 0) return hotspot;
    return Object.freeze({
      ...hotspot,
      bounds: Object.freeze(offsetRect(hotspot.bounds, offset)),
      hitArea: Object.freeze(offsetShape(hotspot.hitArea, offset)),
      highlightShape: Object.freeze(offsetShape(hotspot.highlightShape, offset)),
      popoverAnchor: Object.freeze(clonePoint(hotspot.popoverAnchor, offset)),
    });
  });
}

function selectedHotspot() {
  const id = hotspotCalibrationState.selectedHotspotId;
  return getCalibratedHotspots().find((candidate) => candidate.id === id) || null;
}

function ensureEdit(id) {
  const current = getCalibratedHotspots().find((candidate) => candidate.id === id);
  if (!current) return null;
  const edits = editedHotspotsById();
  if (!edits[id]) {
    edits[id] = cloneHotspotGeometry(current);
  }
  return edits[id];
}

function moveShape(shape, dx, dy) {
  if (!shape) return shape;
  if (shape.type === 'circle') return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
  if (shape.type === 'polygon') {
    return { ...shape, points: shape.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
  }
  return { ...shape, x: shape.x + dx, y: shape.y + dy };
}

function moveLayerGeometry(geometry, layer, dx, dy) {
  if (layer === 'hitArea' || layer === 'all') geometry.hitArea = moveShape(geometry.hitArea, dx, dy);
  if (layer === 'highlightShape' || layer === 'all') geometry.highlightShape = moveShape(geometry.highlightShape, dx, dy);
  if (layer === 'popoverAnchor' || layer === 'all') {
    geometry.popoverAnchor = { x: geometry.popoverAnchor.x + dx, y: geometry.popoverAnchor.y + dy };
  }
}

function pointDistance(a, b) {
  const dx = (a?.x ?? 0) - (b?.x ?? 0);
  const dy = (a?.y ?? 0) - (b?.y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function shapeVertexAt(shape, point) {
  if (!shape || !point) return null;
  if (shape.type === 'polygon') {
    for (let i = 0; i < shape.points.length; i++) {
      if (pointDistance(shape.points[i], point) <= HANDLE_RADIUS) return { kind: 'polygonVertex', index: i };
    }
  }
  if (shape.type === 'circle') {
    const center = { x: shape.cx, y: shape.cy };
    const radiusHandle = { x: shape.cx + shape.radius, y: shape.cy };
    if (pointDistance(center, point) <= HANDLE_RADIUS) return { kind: 'circleCenter' };
    if (pointDistance(radiusHandle, point) <= HANDLE_RADIUS) return { kind: 'circleRadius' };
  }
  if (shape.type === 'rect') {
    const handles = [
      { name: 'nw', x: shape.x, y: shape.y },
      { name: 'ne', x: shape.x + shape.width, y: shape.y },
      { name: 'se', x: shape.x + shape.width, y: shape.y + shape.height },
      { name: 'sw', x: shape.x, y: shape.y + shape.height },
    ];
    for (const handle of handles) {
      if (pointDistance(handle, point) <= HANDLE_RADIUS) return { kind: 'rectCorner', corner: handle.name };
    }
  }
  return null;
}

function editableShapeFor(hotspot, layer) {
  if (layer === 'hitArea') return hotspot.hitArea;
  if (layer === 'highlightShape') return hotspot.highlightShape;
  return hotspot.highlightShape || hotspot.hitArea;
}

function pointerDragKind(hotspot, point, layer) {
  if (!hotspot || !point) return null;
  if ((layer === 'popoverAnchor' || layer === 'all') && pointDistance(hotspot.popoverAnchor, point) <= HANDLE_RADIUS) {
    return { kind: 'popoverAnchor' };
  }
  if (layer === 'all' && (pointInShape(point, hotspot.hitArea) || pointInShape(point, hotspot.highlightShape))) {
    return { kind: 'moveLayer', layer: 'all' };
  }
  const vertexLayer = layer === 'all' ? 'highlightShape' : layer;
  if (vertexLayer === 'hitArea' || vertexLayer === 'highlightShape') {
    const shape = editableShapeFor(hotspot, vertexLayer);
    const vertex = shapeVertexAt(shape, point);
    if (vertex) return { ...vertex, layer: vertexLayer };
    if (pointInShape(point, shape)) return { kind: 'moveLayer', layer: vertexLayer };
  }
  return null;
}

function applyVertexDrag(geometry, drag, point) {
  const shape = geometry[drag.layer];
  if (!shape) return;
  if (drag.kind === 'polygonVertex' && shape.type === 'polygon') {
    shape.points[drag.index] = { x: point.x, y: point.y };
  }
  if (drag.kind === 'circleCenter' && shape.type === 'circle') {
    shape.cx = point.x;
    shape.cy = point.y;
  }
  if (drag.kind === 'circleRadius' && shape.type === 'circle') {
    shape.radius = Math.max(1, Math.abs(point.x - shape.cx));
  }
  if (drag.kind === 'rectCorner' && shape.type === 'rect') {
    const right = shape.x + shape.width;
    const bottom = shape.y + shape.height;
    if (drag.corner.includes('w')) {
      shape.width = Math.max(1, right - point.x);
      shape.x = point.x;
    }
    if (drag.corner.includes('e')) shape.width = Math.max(1, point.x - shape.x);
    if (drag.corner.includes('n')) {
      shape.height = Math.max(1, bottom - point.y);
      shape.y = point.y;
    }
    if (drag.corner.includes('s')) shape.height = Math.max(1, point.y - shape.y);
  }
}

export function handleHotspotCalibrationPointerDown(point, options = {}) {
  if (!isHotspotCalibrationEditMode() || !point) return false;
  const hotspots = options.hotspots || getCalibratedHotspots();
  const selected = selectedHotspot();
  const layer = options.shiftKey ? 'all' : hotspotCalibrationState.editLayer;
  if (selected) {
    const drag = pointerDragKind(selected, point, layer);
    if (drag) {
      const geometry = ensureEdit(selected.id);
      hotspotCalibrationState.dragging = drag;
      hotspotCalibrationState.dragStart = { x: point.x, y: point.y };
      hotspotCalibrationState.originalGeometry = cloneHotspotGeometry({ ...selected, ...geometry });
      hotspotCalibrationState.selectedVertexIndex = Number.isInteger(drag.index) ? drag.index : null;
      return true;
    }
  }
  const clicked = hotspots.find((hotspot) => pointInShape(point, hotspot.hitArea));
  if (clicked) {
    selectHotspotForCalibration(clicked.id);
    ensureEdit(clicked.id);
    return true;
  }
  return false;
}

export function handleHotspotCalibrationPointerMove(point, options = {}) {
  if (!isHotspotCalibrationEditMode() || !hotspotCalibrationState.dragging || !point) return false;
  const id = hotspotCalibrationState.selectedHotspotId;
  const geometry = ensureEdit(id);
  const original = hotspotCalibrationState.originalGeometry;
  const drag = hotspotCalibrationState.dragging;
  if (!geometry || !original) return false;
  const fine = options.altKey ? 0.25 : 1;
  const dx = (point.x - hotspotCalibrationState.dragStart.x) * fine;
  const dy = (point.y - hotspotCalibrationState.dragStart.y) * fine;
  geometry.hitArea = cloneShape(original.hitArea);
  geometry.highlightShape = cloneShape(original.highlightShape);
  geometry.popoverAnchor = { ...original.popoverAnchor };
  if (drag.kind === 'moveLayer') moveLayerGeometry(geometry, drag.layer, dx, dy);
  if (drag.kind === 'popoverAnchor') geometry.popoverAnchor = { x: original.popoverAnchor.x + dx, y: original.popoverAnchor.y + dy };
  if (drag.kind !== 'moveLayer' && drag.kind !== 'popoverAnchor') applyVertexDrag(geometry, drag, point);
  return true;
}

export function handleHotspotCalibrationPointerUp() {
  if (!hotspotCalibrationState.dragging) return false;
  hotspotCalibrationState.dragging = null;
  hotspotCalibrationState.dragStart = null;
  hotspotCalibrationState.originalGeometry = null;
  return true;
}

export function selectedHotspotCalibrationJson() {
  const id = hotspotCalibrationState.selectedHotspotId;
  const hotspot = getCalibratedHotspots().find((candidate) => candidate.id === id);
  if (!hotspot) return null;
  return JSON.stringify({
    id: hotspot.id,
    ...roundedHotspotGeometry(hotspot),
  }, null, 2);
}

function exportableHotspot(hotspot, override) {
  const merged = {
    ...hotspot,
    ...(override || {}),
  };
  const exported = {
    id: hotspot.id,
    title: hotspot.title,
    label: hotspot.label,
    purpose: hotspot.purpose,
    semanticType: hotspot.semanticType,
    worldZoneIds: Array.isArray(hotspot.worldZoneIds) ? [...hotspot.worldZoneIds] : [],
    zoneIds: Array.isArray(hotspot.zoneIds) ? [...hotspot.zoneIds] : [],
    feedbackKind: hotspot.feedbackKind,
    ...roundedHotspotGeometry(merged),
  };
  return Object.fromEntries(Object.entries(exported).filter(([, value]) => value !== undefined));
}

function exportableGeometryEntry(hotspot, override) {
  const merged = {
    ...hotspot,
    ...(override || {}),
  };
  return {
    id: hotspot.id,
    ...roundedHotspotGeometry(merged),
  };
}

export function exportAllCalibratedHotspotsDebug(baseHotspots = WORKSTATION_HOTSPOTS, editedHotspots = editedHotspotsById()) {
  const entries = baseHotspots.map((hotspot) => exportableHotspot(hotspot, editedHotspots?.[hotspot.id]));
  return JSON.stringify(entries, null, 2);
}

export function exportAllCalibratedHotspots(baseHotspots = WORKSTATION_HOTSPOTS, editedHotspots = editedHotspotsById()) {
  const entries = baseHotspots.map((hotspot) => exportableGeometryEntry(hotspot, editedHotspots?.[hotspot.id]));
  return JSON.stringify(entries, null, 2);
}

function jsLiteral(value, indent = 2) {
  const json = JSON.stringify(value, null, indent);
  return json.replace(/"([A-Za-z_$][\w$]*)":/g, '$1:');
}

export function exportCalibratedHotspotGeometryModule(baseHotspots = WORKSTATION_HOTSPOTS, editedHotspots = editedHotspotsById()) {
  const entries = Object.fromEntries(baseHotspots.map((hotspot) => {
    const geometry = exportableGeometryEntry(hotspot, editedHotspots?.[hotspot.id]);
    const { id, ...geometryOnly } = geometry;
    return [id, geometryOnly];
  }));
  return [
    '/**',
    ' * Generated workstation hotspot calibration geometry.',
    ' *',
    ' * Geometry-only: station names, purposes, zones, and feedback semantics live in',
    ' * workstationHotspots.js so calibration exports cannot rewrite meaning.',
    ' */',
    '',
    `export const CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY = Object.freeze(${jsLiteral(entries, 2)});`,
    '',
  ].join('\n');
}

export async function copySelectedHotspotJsonToClipboard() {
  const json = selectedHotspotCalibrationJson();
  if (!json) return false;
  if (typeof window !== 'undefined') {
    window.__SLOTHWORLD_LAST_HOTSPOT_JSON__ = json;
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(json);
    return true;
  }
  return false;
}

export async function copyAllCalibratedHotspotsToClipboard(baseHotspots = WORKSTATION_HOTSPOTS) {
  const json = exportAllCalibratedHotspots(baseHotspots, editedHotspotsById());
  if (typeof window !== 'undefined') {
    window.__SLOTHWORLD_LAST_HOTSPOT_EXPORT__ = json;
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(json);
    return true;
  }
  return false;
}

export function downloadAllCalibratedHotspots(baseHotspots = WORKSTATION_HOTSPOTS) {
  const text = exportCalibratedHotspotGeometryModule(baseHotspots, editedHotspotsById());
  if (typeof window !== 'undefined') {
    window.__SLOTHWORLD_LAST_HOTSPOT_EXPORT__ = text;
  }
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    return false;
  }
  const blob = new Blob([text], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'workstationHotspotGeometry.generated.js';
  link.style.display = 'none';
  document.body?.appendChild?.(link);
  link.click?.();
  link.remove?.();
  URL.revokeObjectURL?.(url);
  return true;
}

export async function attemptDevSaveAllCalibratedHotspots(baseHotspots = WORKSTATION_HOTSPOTS) {
  const text = exportCalibratedHotspotGeometryModule(baseHotspots, editedHotspotsById());
  if (typeof window !== 'undefined') {
    window.__SLOTHWORLD_LAST_HOTSPOT_EXPORT__ = text;
  }
  if (typeof fetch !== 'function') {
    console.info?.('[Slothworld] Dev hotspot save is unavailable; use Shift+Ctrl+C or S to export geometry.');
    return false;
  }
  try {
    const response = await fetch('/dev/hotspots/save', {
      method: 'POST',
      headers: { 'content-type': 'text/javascript' },
      body: text,
    });
    if (!response.ok) {
      console.info?.('[Slothworld] Dev hotspot save endpoint is disabled; use Shift+Ctrl+C or S to export geometry.');
      return false;
    }
    return true;
  } catch {
    console.info?.('[Slothworld] Dev hotspot save endpoint is unavailable; use Shift+Ctrl+C or S to export geometry.');
    return false;
  }
}

export function handleHotspotCalibrationKeydown(event) {
  if (!event) return false;
  const key = String(event.key || '');
  if (event.ctrlKey && event.altKey && key.toLowerCase() === 'h') {
    setHotspotCalibrationEnabled(!isHotspotCalibrationEnabled());
    event.preventDefault?.();
    return true;
  }
  if (!isHotspotCalibrationEnabled()) return false;

  if (key.toLowerCase() === 'e') {
    setHotspotCalibrationEditMode(!isHotspotCalibrationEditMode());
    event.preventDefault?.();
    return true;
  }

  const layerKeys = { 1: 'hitArea', 2: 'highlightShape', 3: 'popoverAnchor', 4: 'all' };
  if (layerKeys[key]) {
    setHotspotCalibrationEditLayer(layerKeys[key]);
    event.preventDefault?.();
    return true;
  }

  if (key === 'Tab') {
    cycleHotspotCalibrationSelection(event.shiftKey ? -1 : 1);
    event.preventDefault?.();
    return true;
  }

  const step = event.shiftKey ? 10 : 1;
  const nudges = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  if (nudges[key]) {
    nudgeSelectedHotspot(nudges[key][0], nudges[key][1]);
    event.preventDefault?.();
    return true;
  }

  if (event.ctrlKey && key.toLowerCase() === 'c') {
    if (event.shiftKey) {
      copyAllCalibratedHotspotsToClipboard();
    } else {
      copySelectedHotspotJsonToClipboard();
    }
    event.preventDefault?.();
    return true;
  }

  if (event.ctrlKey && key.toLowerCase() === 's') {
    attemptDevSaveAllCalibratedHotspots();
    event.preventDefault?.();
    return true;
  }

  if (!event.ctrlKey && key.toLowerCase() === 's') {
    downloadAllCalibratedHotspots();
    event.preventDefault?.();
    return true;
  }
  return false;
}
