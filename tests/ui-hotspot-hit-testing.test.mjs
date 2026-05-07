import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_WORKSTATION_HOTSPOT_CONFIGS,
  WORKSTATION_HOTSPOTS,
  validateWorkstationHotspotGeometry,
} from '../ui/hotspots/workstationHotspots.js';
import { CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY } from '../ui/hotspots/workstationHotspotGeometry.generated.js';
import { hitTestWorkstationHotspots } from '../ui/hotspots/hitTestHotspots.js';
import {
  HOTSPOT_CANONICAL_SIZE,
  getShapeBounds,
  pointInCircle,
  pointInPolygon,
  pointInRect,
  scaleShape,
} from '../ui/hotspots/hotspotGeometry.js';
import {
  createCanvasInspectionState,
  updateInspectionHover,
  updateInspectionSelection,
} from '../rendering/canvas-inspection-state.js';
import { renderHotspotHighlights } from '../rendering/hotspot-highlight-renderer.js';
import {
  getCalibratedHotspots,
  exportAllCalibratedHotspots,
  exportAllCalibratedHotspotsDebug,
  exportCalibratedHotspotGeometryModule,
  handleHotspotCalibrationPointerDown,
  handleHotspotCalibrationPointerMove,
  handleHotspotCalibrationPointerUp,
  hotspotCalibrationState,
  isHotspotCalibrationEditMode,
  copyAllCalibratedHotspotsToClipboard,
  nudgeSelectedHotspot,
  copySelectedHotspotJsonToClipboard,
  downloadAllCalibratedHotspots,
  attemptDevSaveAllCalibratedHotspots,
  selectedHotspotCalibrationJson,
  selectHotspotForCalibration,
  setHotspotCalibrationEditLayer,
  setHotspotCalibrationEditMode,
  setHotspotCalibrationEnabled,
} from '../ui/hotspots/hotspotCalibration.js';

function createMockContext() {
  const calls = [];
  const ctx = {
    canvas: { width: 1060, height: 520 },
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
    closePath: () => calls.push(['closePath']),
    rect: (...args) => calls.push(['rect', ...args]),
    arc: (...args) => calls.push(['arc', ...args]),
    fill: () => calls.push(['fill']),
    stroke: () => calls.push(['stroke']),
    fillText: (...args) => calls.push(['fillText', ...args]),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    strokeRect: (...args) => calls.push(['strokeRect', ...args]),
  };
  return new Proxy(ctx, {
    set(target, prop, value) {
      target[prop] = value;
      calls.push(['set', String(prop), value]);
      return true;
    },
  });
}

function rgbaAlpha(value) {
  const match = String(value).match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/);
  return match ? Number(match[1]) : null;
}

function resetCalibration() {
  hotspotCalibrationState.enabled = false;
  hotspotCalibrationState.selectedHotspotId = null;
  hotspotCalibrationState.offsetsById = Object.create(null);
  hotspotCalibrationState.editedHotspotsById = Object.create(null);
  hotspotCalibrationState.editsById = hotspotCalibrationState.editedHotspotsById;
  hotspotCalibrationState.editMode = false;
  hotspotCalibrationState.editLayer = 'hitArea';
  hotspotCalibrationState.dragging = null;
  hotspotCalibrationState.dragStart = null;
  hotspotCalibrationState.originalGeometry = null;
  hotspotCalibrationState.selectedVertexIndex = null;
  if (typeof window !== 'undefined') {
    window.__SLOTHWORLD_HOTSPOT_CALIBRATION__ = false;
    delete window.__SLOTHWORLD_LAST_HOTSPOT_JSON__;
    delete window.__SLOTHWORLD_LAST_HOTSPOT_EXPORT__;
  }
}

test('ui hotspots: rect geometry hit testing includes interior and excludes exterior points', () => {
  const rect = { type: 'rect', x: 10, y: 20, width: 40, height: 30 };
  assert.equal(pointInRect({ x: 20, y: 30 }, rect), true);
  assert.equal(pointInRect({ x: 5, y: 30 }, rect), false);
});

test('ui hotspots: circle geometry hit testing includes interior and excludes exterior points', () => {
  const circle = { type: 'circle', cx: 50, cy: 50, radius: 20 };
  assert.equal(pointInCircle({ x: 60, y: 50 }, circle), true);
  assert.equal(pointInCircle({ x: 75, y: 50 }, circle), false);
});

test('ui hotspots: polygon geometry hit testing includes interior and excludes exterior points', () => {
  const polygon = { type: 'polygon', points: [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 40, y: 50 }] };
  assert.equal(pointInPolygon({ x: 35, y: 24 }, polygon), true);
  assert.equal(pointInPolygon({ x: 55, y: 45 }, polygon), false);
});

test('ui hotspots: canonical coordinate scaling scales shape coordinates consistently', () => {
  const scaled = scaleShape(
    { type: 'circle', cx: 100, cy: 50, radius: 10 },
    { width: HOTSPOT_CANONICAL_SIZE.width * 2, height: HOTSPOT_CANONICAL_SIZE.height * 2 }
  );

  assert.deepStrictEqual(scaled, { type: 'circle', cx: 200, cy: 100, radius: 20 });
});

test('ui hotspots: registry includes every workstation click area with friendly metadata', () => {
  assert.equal(WORKSTATION_HOTSPOTS.length, 9);
  for (const hotspot of WORKSTATION_HOTSPOTS) {
    assert.equal(typeof hotspot.id, 'string');
    assert.equal(typeof hotspot.title, 'string');
    assert.equal(typeof hotspot.purpose, 'string');
    assert.ok(hotspot.hitArea);
    assert.ok(hotspot.highlightShape);
    assert.ok(hotspot.popoverAnchor);
    assert.ok(hotspot.bounds.width > 0);
    assert.ok(hotspot.bounds.height > 0);
    assert.equal(typeof hotspot.visualStyle.tint, 'string');
    assert.equal(typeof hotspot.visualStyle.intensity, 'number');
    assert.equal(typeof hotspot.visualStyle.pulse, 'boolean');
    assert.equal(typeof hotspot.visualStyle.sparkle, 'boolean');
  }
});

test('ui hotspots: generated geometry validates against canonical metadata', () => {
  assert.equal(validateWorkstationHotspotGeometry(
    CANONICAL_WORKSTATION_HOTSPOT_CONFIGS,
    CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY
  ), true);
});

test('ui hotspots: generated geometry cannot overwrite station semantics', () => {
  assert.throws(
    () => validateWorkstationHotspotGeometry(
      CANONICAL_WORKSTATION_HOTSPOT_CONFIGS,
      {
        ...CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY,
        engineCrystalHotspot: {
          ...CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY.engineCrystalHotspot,
          title: 'Rewrite Attempt',
        },
      }
    ),
    /forbidden metadata key: title/
  );
});

test('ui hotspots: geometry overrides merge correctly with canonical metadata', () => {
  const canonical = CANONICAL_WORKSTATION_HOTSPOT_CONFIGS.find((hotspot) => hotspot.id === 'engineCrystalHotspot');
  const merged = WORKSTATION_HOTSPOTS.find((hotspot) => hotspot.id === 'engineCrystalHotspot');
  const geometry = CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY.engineCrystalHotspot;

  assert.equal(merged.title, canonical.title);
  assert.equal(merged.purpose, canonical.purpose);
  assert.deepStrictEqual(merged.worldZoneIds, canonical.worldZoneIds);
  assert.deepStrictEqual(merged.hitArea, geometry.hitArea);
  assert.deepStrictEqual(merged.highlightShape, geometry.highlightShape);
  assert.deepStrictEqual(merged.popoverAnchor, geometry.popoverAnchor);
});

test('ui hotspots: canonical configs keep calibration geometry out of station semantics', () => {
  for (const config of CANONICAL_WORKSTATION_HOTSPOT_CONFIGS) {
    assert.equal(config.hitArea, undefined);
    assert.equal(config.highlightShape, undefined);
    assert.equal(config.popoverAnchor, undefined);
    assert.equal(config.visualStyle, undefined);
  }
});

test('ui hotspots: hitArea can be forgiving while highlightShape stays visually precise', () => {
  const hotspot = WORKSTATION_HOTSPOTS.find((candidate) => candidate.id === 'engineCrystalHotspot');
  const hitBounds = getShapeBounds(hotspot.hitArea);
  const highlightBounds = getShapeBounds(hotspot.highlightShape);
  const forgivingCorePoint = { x: 532, y: 350 };

  assert.ok(hitBounds.width > highlightBounds.width);
  assert.ok(hitBounds.height > highlightBounds.height);
  assert.equal(
    hitTestWorkstationHotspots(forgivingCorePoint, [hotspot])?.id,
    hotspot.id
  );
});

test('ui hotspots: full scene calibration uses shaped geometry and tight render desk highlight', () => {
  const renderDesk = WORKSTATION_HOTSPOTS.find((candidate) => candidate.id === 'renderMonitorHotspot');
  const engineCore = WORKSTATION_HOTSPOTS.find((candidate) => candidate.id === 'engineCrystalHotspot');
  const archiveShelf = WORKSTATION_HOTSPOTS.find((candidate) => candidate.id === 'archiveShelfHotspot');
  const renderHitBounds = getShapeBounds(renderDesk.hitArea);
  const renderHighlightBounds = getShapeBounds(renderDesk.highlightShape);

  assert.equal(engineCore.hitArea.type, 'polygon');
  assert.equal(archiveShelf.hitArea.type, 'polygon');
  assert.equal(renderDesk.hitArea.type, 'polygon');
  assert.equal(renderDesk.highlightShape.type, 'polygon');
  assert.ok(renderHighlightBounds.width < renderHitBounds.width);
  assert.ok(renderHighlightBounds.height < renderHitBounds.height);
  assert.ok(renderHighlightBounds.y + renderHighlightBounds.height < 505);
});

test('ui hotspots: pure hit testing returns topmost workstation and ignores empty background', () => {
  const research = hitTestWorkstationHotspots({ x: 330, y: 210 });
  assert.equal(research?.id, 'researchMonitorHotspot');

  const empty = hitTestWorkstationHotspots({ x: 20, y: 500 });
  assert.equal(empty, null);
});

test('ui hotspots: hover state tracks hoveredHotspotId for workstation points', () => {
  const state = createCanvasInspectionState();
  const hit = updateInspectionHover(state, [], { x: 330, y: 210 }, null, {
    debug: false,
    bakedBackground: true,
  });

  assert.equal(hit.componentType, 'workstation-hotspot');
  assert.equal(state.hoveredHotspotId, 'researchMonitorHotspot');
  assert.equal(state.hoveredEntityId, 'researchMonitorHotspot');
});

test('ui hotspots: click selects hotspot and background click clears selection', () => {
  const state = createCanvasInspectionState();
  const hit = updateInspectionSelection(state, [], { x: 330, y: 210 }, null, {
    debug: false,
    bakedBackground: true,
  });

  assert.equal(hit.componentType, 'workstation-hotspot');
  assert.equal(state.selectedHotspotId, 'researchMonitorHotspot');

  const cleared = updateInspectionSelection(state, [], { x: 20, y: 500 }, null, {
    debug: false,
    bakedBackground: true,
  });
  assert.equal(cleared, null);
  assert.equal(state.selectedHotspotId, null);
  assert.equal(state.selectedEntityId, null);
});

test('ui hotspots: normal highlight layer draws cyan affordance without raw IDs or hitbox rectangles', () => {
  const ctx = createMockContext();
  const state = createCanvasInspectionState();
  state.hoveredHotspotId = 'researchMonitorHotspot';

  renderHotspotHighlights(ctx, state, { debug: false, frame: 12 });

  assert.ok(ctx.calls.some((call) => call[0] === 'fill'));
  assert.ok(ctx.calls.some((call) => call[0] === 'stroke'));
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillText'));
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillRect' || call[0] === 'strokeRect'));
});

test('ui hotspots: selected highlight draws stronger outline and remains visible without hover', () => {
  const ctx = createMockContext();
  const state = createCanvasInspectionState();
  state.selectedHotspotId = 'researchMonitorHotspot';

  renderHotspotHighlights(ctx, state, { debug: false, frame: 24 });

  assert.ok(ctx.calls.some((call) => call[0] === 'fill'));
  assert.ok(ctx.calls.some((call) => call[0] === 'stroke'));
});

test('ui hotspots: normal selected fill opacity remains subtle', () => {
  const ctx = createMockContext();
  const state = createCanvasInspectionState();
  state.selectedHotspotId = 'renderMonitorHotspot';

  renderHotspotHighlights(ctx, state, { debug: false, frame: 24 });

  const fillAlphas = ctx.calls
    .filter((call) => call[0] === 'set' && call[1] === 'fillStyle')
    .map((call) => rgbaAlpha(call[2]))
    .filter(Number.isFinite);

  assert.ok(fillAlphas.some((alpha) => alpha > 0 && alpha <= 0.056));
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillText'));
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillRect' || call[0] === 'strokeRect'));
});

test('ui hotspots: normal selected render desk omits calibration anchor dots and labels', () => {
  const ctx = createMockContext();
  const state = createCanvasInspectionState();
  state.selectedHotspotId = 'renderMonitorHotspot';

  renderHotspotHighlights(ctx, state, { debug: false, frame: 24 });

  assert.ok(!ctx.calls.some((call) => call[0] === 'arc'));
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillText'));
});

test('ui hotspots: ambient state glow renders from visualState view model without interaction labels', () => {
  const ctx = createMockContext();
  const state = createCanvasInspectionState();

  renderHotspotHighlights(ctx, state, {
    debug: false,
    frame: 12,
    hotspotComponents: [{
      id: 'researchMonitorHotspot',
      visualStateViewModel: {
        hotspotId: 'researchMonitorHotspot',
        visualState: 'working',
        tone: 'curious',
        intensity: 0.6,
        effect: 'shimmer',
      },
    }],
  });

  assert.ok(ctx.calls.some((call) => call[0] === 'fill'));
  assert.ok(ctx.calls.some((call) => call[0] === 'stroke'));
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillText'));
  assert.ok(!ctx.calls.some((call) => call[0] === 'fillRect' || call[0] === 'strokeRect'));
  assert.equal(state.hoveredHotspotId, null);
  assert.equal(state.selectedHotspotId, null);
});

test('ui hotspots: idle visualState does not draw ambient glow without hover or selection', () => {
  const ctx = createMockContext();

  renderHotspotHighlights(ctx, createCanvasInspectionState(), {
    debug: false,
    frame: 12,
    hotspotComponents: [{
      id: 'researchMonitorHotspot',
      visualStateViewModel: {
        hotspotId: 'researchMonitorHotspot',
        visualState: 'idle',
        tone: 'curious',
        intensity: 0,
        effect: 'none',
      },
    }],
  });

  assert.deepStrictEqual(ctx.calls, [['save'], ['restore']]);
});

test('ui hotspots: hover and selected highlights remain separate from ambient visualState', () => {
  const ambientCtx = createMockContext();
  const ambientState = createCanvasInspectionState();
  renderHotspotHighlights(ambientCtx, ambientState, {
    debug: false,
    frame: 12,
    hotspotComponents: [{
      id: 'renderMonitorHotspot',
      visualStateViewModel: {
        hotspotId: 'renderMonitorHotspot',
        visualState: 'working',
        tone: 'creative',
        intensity: 0.6,
        effect: 'shimmer',
      },
    }],
  });

  const selectedCtx = createMockContext();
  const selectedState = createCanvasInspectionState();
  selectedState.selectedHotspotId = 'renderMonitorHotspot';
  renderHotspotHighlights(selectedCtx, selectedState, { debug: false, frame: 12 });

  assert.ok(ambientCtx.calls.some((call) => call[0] === 'fill'));
  assert.ok(selectedCtx.calls.some((call) => call[0] === 'fill'));
  assert.equal(ambientState.selectedHotspotId, null);
  assert.equal(selectedState.selectedHotspotId, 'renderMonitorHotspot');
});

test('ui hotspots: debug highlight layer renders hitboxes and hotspot IDs', () => {
  const ctx = createMockContext();

  renderHotspotHighlights(ctx, createCanvasInspectionState(), {
    debug: true,
    frame: 0,
    hotspotComponents: [{
      id: 'researchMonitorHotspot',
      visualStateViewModel: {
        hotspotId: 'researchMonitorHotspot',
        visualState: 'working',
        tone: 'curious',
        intensity: 0.6,
        effect: 'shimmer',
      },
    }],
  });

  assert.ok(ctx.calls.some((call) => call[0] === 'fillRect'));
  assert.ok(ctx.calls.some((call) => call[0] === 'arc'));
  assert.ok(ctx.calls.some((call) => call[0] === 'fillText' && call[1] === 'researchMonitorHotspot'));
  assert.ok(ctx.calls.some((call) => call[0] === 'fillText' && call[1] === 'state: working'));
  assert.ok(ctx.calls.some((call) => call[0] === 'fill'));
  assert.ok(ctx.calls.some((call) => call[0] === 'stroke'));
});

test('ui hotspots: scaled hit testing keeps workstations clickable after canvas resize', () => {
  const scaled = hitTestWorkstationHotspots(
    { x: 660, y: 420 },
    WORKSTATION_HOTSPOTS,
    { canvasSize: { width: HOTSPOT_CANONICAL_SIZE.width * 2, height: HOTSPOT_CANONICAL_SIZE.height * 2 } }
  );

  assert.equal(scaled?.id, 'researchMonitorHotspot');
});

test('ui hotspots: calibration mode nudges selected hotspot metadata without mutating registry', () => {
  resetCalibration();
  setHotspotCalibrationEnabled(true);
  selectHotspotForCalibration('researchMonitorHotspot');
  nudgeSelectedHotspot(3, -2);

  const original = WORKSTATION_HOTSPOTS.find((hotspot) => hotspot.id === 'researchMonitorHotspot');
  const calibrated = getCalibratedHotspots().find((hotspot) => hotspot.id === 'researchMonitorHotspot');
  const json = selectedHotspotCalibrationJson();

  assert.equal(original.hitArea.points[0].x + 3, calibrated.hitArea.points[0].x);
  assert.equal(original.hitArea.points[0].y - 2, calibrated.hitArea.points[0].y);
  assert.ok(json.includes('"researchMonitorHotspot"'));
  assert.equal(original.hitArea.points[0].x, CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY.researchMonitorHotspot.hitArea.points[0].x);
  resetCalibration();
});

test('ui hotspots: calibration edit mode is disabled in normal mode', () => {
  resetCalibration();

  assert.equal(setHotspotCalibrationEditMode(true), false);
  assert.equal(isHotspotCalibrationEditMode(), false);
});

test('ui hotspots: calibration pointer selection updates selectedHotspotId', () => {
  resetCalibration();
  setHotspotCalibrationEnabled(true);
  setHotspotCalibrationEditMode(true);

  assert.equal(handleHotspotCalibrationPointerDown({ x: 620, y: 455 }), true);
  assert.equal(hotspotCalibrationState.selectedHotspotId, 'renderMonitorHotspot');
  handleHotspotCalibrationPointerUp();
  resetCalibration();
});

test('ui hotspots: dragging popover anchor changes only popoverAnchor', () => {
  resetCalibration();
  setHotspotCalibrationEnabled(true);
  selectHotspotForCalibration('renderMonitorHotspot');
  setHotspotCalibrationEditMode(true);
  setHotspotCalibrationEditLayer('popoverAnchor');
  const before = getCalibratedHotspots().find((hotspot) => hotspot.id === 'renderMonitorHotspot');

  assert.equal(handleHotspotCalibrationPointerDown(before.popoverAnchor), true);
  assert.equal(handleHotspotCalibrationPointerMove({ x: before.popoverAnchor.x + 12, y: before.popoverAnchor.y + 5 }), true);
  handleHotspotCalibrationPointerUp();
  const after = getCalibratedHotspots().find((hotspot) => hotspot.id === 'renderMonitorHotspot');

  assert.deepStrictEqual(after.hitArea, before.hitArea);
  assert.deepStrictEqual(after.highlightShape, before.highlightShape);
  assert.deepStrictEqual(after.popoverAnchor, { x: before.popoverAnchor.x + 12, y: before.popoverAnchor.y + 5 });
  resetCalibration();
});

test('ui hotspots: calibration edits update edited hotspot override map', () => {
  resetCalibration();
  setHotspotCalibrationEnabled(true);
  selectHotspotForCalibration('renderMonitorHotspot');
  setHotspotCalibrationEditMode(true);
  setHotspotCalibrationEditLayer('popoverAnchor');
  const before = getCalibratedHotspots().find((hotspot) => hotspot.id === 'renderMonitorHotspot');

  handleHotspotCalibrationPointerDown(before.popoverAnchor);
  handleHotspotCalibrationPointerMove({ x: before.popoverAnchor.x + 4, y: before.popoverAnchor.y + 2 });
  handleHotspotCalibrationPointerUp();

  assert.ok(hotspotCalibrationState.editedHotspotsById.renderMonitorHotspot);
  assert.deepStrictEqual(
    hotspotCalibrationState.editedHotspotsById.renderMonitorHotspot.popoverAnchor,
    { x: before.popoverAnchor.x + 4, y: before.popoverAnchor.y + 2 }
  );
  assert.equal(hotspotCalibrationState.editsById, hotspotCalibrationState.editedHotspotsById);
  resetCalibration();
});

test('ui hotspots: dragging highlightShape moves highlightShape but not hitArea', () => {
  resetCalibration();
  setHotspotCalibrationEnabled(true);
  selectHotspotForCalibration('renderMonitorHotspot');
  setHotspotCalibrationEditMode(true);
  setHotspotCalibrationEditLayer('highlightShape');
  const before = getCalibratedHotspots().find((hotspot) => hotspot.id === 'renderMonitorHotspot');
  const start = { x: before.highlightShape.points[0].x + 4, y: before.highlightShape.points[0].y + 4 };

  assert.equal(handleHotspotCalibrationPointerDown(start), true);
  assert.equal(handleHotspotCalibrationPointerMove({ x: start.x + 8, y: start.y + 3 }), true);
  handleHotspotCalibrationPointerUp();
  const after = getCalibratedHotspots().find((hotspot) => hotspot.id === 'renderMonitorHotspot');

  assert.deepStrictEqual(after.hitArea, before.hitArea);
  assert.notDeepStrictEqual(after.highlightShape, before.highlightShape);
  assert.deepStrictEqual(after.popoverAnchor, before.popoverAnchor);
  resetCalibration();
});

test('ui hotspots: edit layer all moves hitArea highlightShape and popoverAnchor together', () => {
  resetCalibration();
  setHotspotCalibrationEnabled(true);
  selectHotspotForCalibration('renderMonitorHotspot');
  setHotspotCalibrationEditMode(true);
  setHotspotCalibrationEditLayer('all');
  const before = getCalibratedHotspots().find((hotspot) => hotspot.id === 'renderMonitorHotspot');
  const start = { x: 620, y: 455 };

  assert.equal(handleHotspotCalibrationPointerDown(start), true);
  assert.equal(handleHotspotCalibrationPointerMove({ x: start.x + 6, y: start.y + 4 }), true);
  handleHotspotCalibrationPointerUp();
  const after = getCalibratedHotspots().find((hotspot) => hotspot.id === 'renderMonitorHotspot');

  assert.equal(after.hitArea.points[0].x, before.hitArea.points[0].x + 6);
  assert.equal(after.highlightShape.points[0].y, before.highlightShape.points[0].y + 4);
  assert.equal(after.popoverAnchor.x, before.popoverAnchor.x + 6);
  assert.equal(after.popoverAnchor.y, before.popoverAnchor.y + 4);
  resetCalibration();
});

test('ui hotspots: copied calibration JSON contains updated geometry and window fallback', async () => {
  resetCalibration();
  globalThis.window = { __SLOTHWORLD_HOTSPOT_CALIBRATION__: false };
  setHotspotCalibrationEnabled(true);
  selectHotspotForCalibration('renderMonitorHotspot');
  setHotspotCalibrationEditMode(true);
  setHotspotCalibrationEditLayer('popoverAnchor');
  const before = getCalibratedHotspots().find((hotspot) => hotspot.id === 'renderMonitorHotspot');
  handleHotspotCalibrationPointerDown(before.popoverAnchor);
  handleHotspotCalibrationPointerMove({ x: before.popoverAnchor.x + 2, y: before.popoverAnchor.y + 3 });
  handleHotspotCalibrationPointerUp();

  const copied = await copySelectedHotspotJsonToClipboard();
  const json = selectedHotspotCalibrationJson();

  assert.equal(copied, false);
  assert.ok(json.includes('"renderMonitorHotspot"'));
  assert.ok(json.includes('"popoverAnchor"'));
  assert.equal(globalThis.window.__SLOTHWORLD_LAST_HOTSPOT_JSON__, json);
  resetCalibration();
});

test('ui hotspots: selected export still exports one hotspot only', () => {
  resetCalibration();
  setHotspotCalibrationEnabled(true);
  selectHotspotForCalibration('renderMonitorHotspot');

  const json = selectedHotspotCalibrationJson();
  const parsed = JSON.parse(json);

  assert.equal(Array.isArray(parsed), false);
  assert.equal(parsed.id, 'renderMonitorHotspot');
  assert.ok(!json.includes('researchMonitorHotspot'));
  resetCalibration();
});

test('ui hotspots: geometry export includes every calibrated hotspot and preserves unedited geometry', () => {
  resetCalibration();
  setHotspotCalibrationEnabled(true);
  selectHotspotForCalibration('renderMonitorHotspot');
  setHotspotCalibrationEditMode(true);
  setHotspotCalibrationEditLayer('popoverAnchor');
  const before = getCalibratedHotspots().find((hotspot) => hotspot.id === 'renderMonitorHotspot');
  handleHotspotCalibrationPointerDown(before.popoverAnchor);
  handleHotspotCalibrationPointerMove({ x: before.popoverAnchor.x + 9, y: before.popoverAnchor.y + 7 });
  handleHotspotCalibrationPointerUp();

  const parsed = JSON.parse(exportAllCalibratedHotspots(WORKSTATION_HOTSPOTS, hotspotCalibrationState.editedHotspotsById));
  const edited = parsed.find((hotspot) => hotspot.id === 'renderMonitorHotspot');
  const unedited = parsed.find((hotspot) => hotspot.id === 'researchMonitorHotspot');
  const originalUnedited = WORKSTATION_HOTSPOTS.find((hotspot) => hotspot.id === 'researchMonitorHotspot');

  assert.equal(parsed.length, WORKSTATION_HOTSPOTS.length);
  assert.deepStrictEqual(edited.popoverAnchor, { x: before.popoverAnchor.x + 9, y: before.popoverAnchor.y + 7 });
  assert.deepStrictEqual(unedited.hitArea, originalUnedited.hitArea);
  assert.equal(unedited.title, undefined);
  assert.equal(unedited.purpose, undefined);
  assert.equal(unedited.worldZoneIds, undefined);
  assert.equal(unedited.feedbackKind, undefined);
  assert.equal(unedited.visualStyle.tint, originalUnedited.visualStyle.tint);
  resetCalibration();
});

test('ui hotspots: full debug export remains available separately', () => {
  const parsed = JSON.parse(exportAllCalibratedHotspotsDebug(WORKSTATION_HOTSPOTS, Object.create(null)));
  const engine = parsed.find((hotspot) => hotspot.id === 'engineCrystalHotspot');

  assert.equal(parsed.length, WORKSTATION_HOTSPOTS.length);
  assert.equal(engine.title, 'Engine Core');
  assert.deepStrictEqual(engine.worldZoneIds, ['engineCrystal']);
  assert.equal(engine.feedbackKind, 'crystal');
});

test('ui hotspots: all calibration export rounds coordinates', () => {
  const text = exportAllCalibratedHotspots([{
    id: 'roundingHotspot',
    title: 'Rounding Desk',
    label: 'Rounding Desk',
    purpose: 'Rounding test',
    worldZoneIds: [],
    zoneIds: [],
    hitArea: { type: 'rect', x: 1.234, y: 2.26, width: 3.05, height: 4.04 },
    highlightShape: { type: 'circle', cx: 5.55, cy: 6.66, radius: 7.77 },
    popoverAnchor: { x: 8.88, y: 9.99 },
  }], Object.create(null));

  const [hotspot] = JSON.parse(text);
  assert.deepStrictEqual(hotspot.hitArea, { type: 'rect', x: 1.2, y: 2.3, width: 3.1, height: 4 });
  assert.deepStrictEqual(hotspot.highlightShape, { type: 'circle', cx: 5.6, cy: 6.7, radius: 7.8 });
  assert.deepStrictEqual(hotspot.popoverAnchor, { x: 8.9, y: 10 });
});

test('ui hotspots: all calibration clipboard and download set all-export fallback', async () => {
  resetCalibration();
  globalThis.window = { __SLOTHWORLD_HOTSPOT_CALIBRATION__: false };
  setHotspotCalibrationEnabled(true);
  selectHotspotForCalibration('renderMonitorHotspot');
  setHotspotCalibrationEditMode(true);

  const copied = await copyAllCalibratedHotspotsToClipboard();
  const copiedJson = globalThis.window.__SLOTHWORLD_LAST_HOTSPOT_EXPORT__;

  assert.equal(copied, false);
  assert.equal(JSON.parse(copiedJson).length, WORKSTATION_HOTSPOTS.length);
  assert.equal(JSON.parse(copiedJson)[0].title, undefined);
  assert.equal(downloadAllCalibratedHotspots(), false);
  assert.ok(globalThis.window.__SLOTHWORLD_LAST_HOTSPOT_EXPORT__.includes('CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY'));
  resetCalibration();
});

test('ui hotspots: generated module export is geometry-only', () => {
  const text = exportCalibratedHotspotGeometryModule(WORKSTATION_HOTSPOTS, Object.create(null));

  assert.ok(text.includes('CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY'));
  assert.ok(text.includes('engineCrystalHotspot'));
  assert.ok(!text.includes('Engine Core'));
  assert.ok(!text.includes('worldZoneIds'));
  assert.ok(!text.includes('feedbackKind'));
});

test('ui hotspots: dev save fallback does not write without endpoint', async () => {
  resetCalibration();
  globalThis.window = { __SLOTHWORLD_HOTSPOT_CALIBRATION__: false };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = undefined;
    const saved = await attemptDevSaveAllCalibratedHotspots();

    assert.equal(saved, false);
    assert.ok(globalThis.window.__SLOTHWORLD_LAST_HOTSPOT_EXPORT__.includes('CALIBRATED_WORKSTATION_HOTSPOT_GEOMETRY'));
  } finally {
    globalThis.fetch = originalFetch;
    resetCalibration();
  }
});

test('ui hotspots: calibration edit mode renders handles and HUD only in debug', () => {
  resetCalibration();
  setHotspotCalibrationEnabled(true);
  selectHotspotForCalibration('renderMonitorHotspot');
  setHotspotCalibrationEditMode(true);
  setHotspotCalibrationEditLayer('highlightShape');
  const debugCtx = createMockContext();

  renderHotspotHighlights(debugCtx, createCanvasInspectionState(), {
    debug: true,
    frame: 0,
    hotspots: getCalibratedHotspots(),
    calibration: hotspotCalibrationState,
  });

  assert.ok(debugCtx.calls.some((call) => call[0] === 'fillText' && String(call[1]).startsWith('edit: ')));
  assert.ok(debugCtx.calls.some((call) => call[0] === 'fillText' && call[1] === 'layer: highlightShape'));
  assert.ok(debugCtx.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('Shift+Ctrl+C all')));
  assert.ok(debugCtx.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('Ctrl+S dev save')));

  const normalCtx = createMockContext();
  renderHotspotHighlights(normalCtx, createCanvasInspectionState(), {
    debug: false,
    frame: 0,
    hotspots: getCalibratedHotspots(),
    calibration: hotspotCalibrationState,
  });

  assert.ok(!normalCtx.calls.some((call) => call[0] === 'fillText'));
  assert.ok(!normalCtx.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('download')));
  resetCalibration();
});
