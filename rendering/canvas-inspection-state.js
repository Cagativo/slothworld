/**
 * canvas-inspection-state.js
 *
 * Small deterministic state holder for hover and click inspection.
 */

import { hitTestRenderableComponents } from './canvas-hit-test.js';

export function createCanvasInspectionState() {
  return {
    hoveredEntityId: null,
    hoveredComponentType: null,
    selectedEntityId: null,
    selectedComponentType: null,
    pointer: { x: null, y: null, inside: false },
    hoveredHit: null,
    selectedHit: null,
  };
}

export const canvasInspectionState = createCanvasInspectionState();

function clearHover(state) {
  state.hoveredEntityId = null;
  state.hoveredComponentType = null;
  state.hoveredHit = null;
}

function assignHover(state, hit) {
  state.hoveredEntityId = hit ? hit.entityId : null;
  state.hoveredComponentType = hit ? hit.componentType : null;
  state.hoveredHit = hit;
}

export function updateInspectionHover(state, components, point, entityPositions, options = {}) {
  if (!state) return null;

  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    state.pointer = { x: null, y: null, inside: false };
    clearHover(state);
    return null;
  }

  state.pointer = { x: point.x, y: point.y, inside: true };
  const hit = hitTestRenderableComponents(components, point, entityPositions, options);
  assignHover(state, hit);
  return hit;
}

export function updateInspectionSelection(state, components, point, entityPositions, options = {}) {
  if (!state) return null;

  const hit = hitTestRenderableComponents(components, point, entityPositions, options);
  state.selectedEntityId = hit ? hit.entityId : null;
  state.selectedComponentType = hit ? hit.componentType : null;
  state.selectedHit = hit;
  return hit;
}

export function clearInspectionSelection(state) {
  if (!state) return;
  state.selectedEntityId = null;
  state.selectedComponentType = null;
  state.selectedHit = null;
}

export function refreshInspectionSelection(state, components, entityPositions, options = {}) {
  if (!state || !state.selectedEntityId || !state.selectedComponentType || !Array.isArray(components)) {
    return null;
  }

  const selected = components.find((component) => {
    if (!component || component.id !== state.selectedEntityId) return false;
    if (state.selectedComponentType === 'world-zone-indicator') {
      return component.componentType === 'zone-background';
    }
    return component.componentType === state.selectedComponentType;
  });

  if (!selected) {
    clearInspectionSelection(state);
    return null;
  }

  const hit = hitTestRenderableComponents(
    [selected],
    {
      x: selected.x ?? 0,
      y: selected.y ?? 0,
    },
    entityPositions,
    options
  );

  state.selectedHit = hit
    ? { ...hit, component: selected }
    : {
        entityId: selected.id ?? null,
        componentType: state.selectedComponentType,
        component: selected,
        bounds: null,
      };
  return state.selectedHit;
}

export function resolveInspectionTarget(state) {
  if (!state) return null;
  return state.selectedHit || state.hoveredHit || null;
}
