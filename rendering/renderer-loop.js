import { canvas, ctx, agents } from '../core/app-state.js';
import { buildWorldScene } from './world-scene.js';
import { toRenderableComponents } from './world-scene-adapter.js';
import { renderAllLayers } from './world-scene-layer-renderer.js';
import { assertGraphShape, assertEventDriven } from './render-guards.js';
import { buildEntityPositionMap } from './zone-renderer.js';
import {
  canvasInspectionState,
  updateInspectionHover,
  updateInspectionSelection,
  refreshInspectionSelection,
  resolveInspectionTarget,
} from './canvas-inspection-state.js';
import { renderInspectionPopover } from './inspection-popover-renderer.js';
import { isRenderDebugEnabled, traceRenderBoot } from './debug.js';
import { loadedAssets } from './assets.js';
import { isBakedBackgroundActive, selectLoadedBackground } from './background-config.js';
import { renderHotspotHighlights } from './hotspot-highlight-renderer.js';
import {
  getCalibratedHotspots,
  handleHotspotCalibrationPointerDown,
  handleHotspotCalibrationPointerMove,
  handleHotspotCalibrationPointerUp,
  handleHotspotCalibrationKeydown,
  hotspotCalibrationState,
  isHotspotCalibrationEditMode,
  isHotspotCalibrationEnabled,
  selectHotspotForCalibration,
} from '../ui/hotspots/hotspotCalibration.js';
import { buildWorkstationHotspotComponents } from './workstation-hotspots.js';

let _frame = 0;
let _inspectionBindingsAttached = false;
let _latestComponents = [];
let _latestEntityPositions = new Map();
let _latestWorkstationSnapshots = null;

function eventToCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function currentHitTestOptions() {
  return {
    debug: isRenderDebugEnabled(),
    bakedBackground: isBakedBackgroundActive(loadedAssets),
    canvasSize: canvas ? { width: canvas.width, height: canvas.height } : undefined,
    hotspots: getCalibratedHotspots(),
    stationSnapshots: _latestWorkstationSnapshots,
  };
}

export function initRenderer() {
  if (_inspectionBindingsAttached || !canvas) {
    return;
  }

  canvas.addEventListener('mousemove', (event) => {
    const point = eventToCanvasPoint(event);
    if (isHotspotCalibrationEditMode() && handleHotspotCalibrationPointerMove(point, {
      altKey: event.altKey,
      hotspots: getCalibratedHotspots(),
    })) {
      canvas.style.cursor = 'grabbing';
      event.preventDefault?.();
      return;
    }
    const hitTestOptions = currentHitTestOptions();
    const hit = updateInspectionHover(
      canvasInspectionState,
      _latestComponents,
      point,
      _latestEntityPositions,
      hitTestOptions
    );
    canvas.style.cursor = hit ? 'pointer' : 'default';
  });

  canvas.addEventListener('mousedown', (event) => {
    const point = eventToCanvasPoint(event);
    if (handleHotspotCalibrationPointerDown(point, {
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      hotspots: getCalibratedHotspots(),
    })) {
      canvas.style.cursor = 'grabbing';
      event.preventDefault?.();
    }
  });

  canvas.addEventListener('mouseup', () => {
    if (handleHotspotCalibrationPointerUp()) {
      canvas.style.cursor = 'pointer';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    updateInspectionHover(
      canvasInspectionState,
      _latestComponents,
      null,
      _latestEntityPositions,
      currentHitTestOptions()
    );
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('click', (event) => {
    const point = eventToCanvasPoint(event);
    const hit = updateInspectionSelection(
      canvasInspectionState,
      _latestComponents,
      point,
      _latestEntityPositions,
      currentHitTestOptions()
    );
    if (hit?.componentType === 'workstation-hotspot') {
      selectHotspotForCalibration(hit.entityId);
    }
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleHotspotCalibrationKeydown);
  }

  _inspectionBindingsAttached = true;
}

export function renderErrorState() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'red';
  ctx.font = 'bold 16px monospace';
  ctx.fillText('Render error \u2014 check console', 20, canvas.height / 2);
}

export function renderFrame(renderView) {
  const bootTraceBackground = selectLoadedBackground(loadedAssets);
  traceRenderBoot('renderer-loop.renderFrame:start', {
    ctx,
    frame: _frame,
    backgroundLoaded: Boolean(bootTraceBackground && bootTraceBackground.image),
    backgroundSource: bootTraceBackground ? bootTraceBackground.filename : null,
    bakedBackgroundActive: isBakedBackgroundActive(bootTraceBackground || loadedAssets),
  });

  assertGraphShape(renderView);
  const scene      = buildWorldScene(renderView);
  assertEventDriven(scene);
  const components = toRenderableComponents(scene);
  _latestWorkstationSnapshots = renderView?.metadata?.workstationSnapshots && typeof renderView.metadata.workstationSnapshots === 'object'
    ? renderView.metadata.workstationSnapshots
    : null;
  const entityPositions = buildEntityPositionMap(components);
  _latestComponents = components;
  _latestEntityPositions = entityPositions;
  const hitTestOptions = currentHitTestOptions();
  const calibratedHotspots = getCalibratedHotspots();
  const workstationHotspotComponents = buildWorkstationHotspotComponents(calibratedHotspots, components, {
    stationSnapshots: _latestWorkstationSnapshots,
  });
  hitTestOptions.stationComponents = workstationHotspotComponents;
  refreshInspectionSelection(canvasInspectionState, components, entityPositions, hitTestOptions);

  if (canvasInspectionState.pointer.inside) {
    updateInspectionHover(
      canvasInspectionState,
      components,
      canvasInspectionState.pointer,
      entityPositions,
      hitTestOptions
    );
  }

  // Targeted debug — logs once per second (~60 frames) when DEV_MODE is on
  if (window.DEV_MODE && _frame % 60 === 0) {
    const byType = {};
    for (const c of components) { byType[c.componentType] = (byType[c.componentType] || 0) + 1; }
    console.log('[WorldScene] frame:', _frame,
      '| zones:', scene.zones.length,
      '| entities:', scene.entities.length,
      '| connections:', scene.connections.length);
    console.log('[WorldScene] components:', byType);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderAllLayers(ctx, components, _frame, {
    calibration: isHotspotCalibrationEnabled(),
  });
  traceRenderBoot('renderer-loop.renderFrame:after-renderAllLayers', {
    ctx,
    frame: _frame,
    componentCount: components.length,
    taskChipCount: components.filter((c) => c && c.componentType === 'task-chip').length,
    agentCount: components.filter((c) => c && c.componentType === 'agent-sprite').length,
    zoneCount: components.filter((c) => c && c.componentType === 'zone-background').length,
    backgroundLoaded: Boolean(bootTraceBackground && bootTraceBackground.image),
    backgroundSource: bootTraceBackground ? bootTraceBackground.filename : null,
    bakedBackgroundActive: isBakedBackgroundActive(bootTraceBackground || loadedAssets),
  });
  renderHotspotHighlights(ctx, canvasInspectionState, {
    debug: isRenderDebugEnabled() || isHotspotCalibrationEnabled(),
    frame: _frame,
    canvasSize: { width: canvas.width, height: canvas.height },
    hotspots: calibratedHotspots,
    hotspotComponents: workstationHotspotComponents,
    calibration: hotspotCalibrationState,
  });
  const inspectionTarget = resolveInspectionTarget(canvasInspectionState);
  renderInspectionPopover(ctx, inspectionTarget, {
    debug: isRenderDebugEnabled() || isHotspotCalibrationEnabled(),
    selected: Boolean(canvasInspectionState.selectedHit && inspectionTarget === canvasInspectionState.selectedHit),
  });
  _frame += 1;
}
