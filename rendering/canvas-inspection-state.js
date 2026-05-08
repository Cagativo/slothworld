/**
 * canvas-inspection-state.js
 *
 * Small deterministic state holder for hover and click inspection.
 */

import { hitTestRenderableComponents } from './canvas-hit-test.js';
import {
  WORKSTATION_HOTSPOTS,
  buildWorkstationHotspotComponents,
  componentForHotspot,
  getWorkstationHotspotById,
} from './workstation-hotspots.js';
import {
  buildInteractionTargets,
} from '../ui/interactions/interactionTargets.js';

export function createCanvasInspectionState() {
  return {
    hoveredEntityId: null,
    hoveredComponentType: null,
    hoveredHotspotId: null,
    hoveredTargetId: null,
    hoveredTargetType: null,
    hoveredInteractionTarget: null,
    selectedEntityId: null,
    selectedComponentType: null,
    selectedHotspotId: null,
    selectedTargetId: null,
    selectedTargetType: null,
    selectedInteractionTarget: null,
    pointer: { x: null, y: null, inside: false },
    hoveredHit: null,
    selectedHit: null,
  };
}

export const canvasInspectionState = createCanvasInspectionState();

function clearHover(state) {
  state.hoveredEntityId = null;
  state.hoveredComponentType = null;
  state.hoveredHotspotId = null;
  state.hoveredTargetId = null;
  state.hoveredTargetType = null;
  state.hoveredInteractionTarget = null;
  state.hoveredHit = null;
}

function assignHover(state, hit) {
  state.hoveredEntityId = hit ? hit.entityId : null;
  state.hoveredComponentType = hit ? hit.componentType : null;
  state.hoveredHotspotId = hit?.componentType === 'workstation-hotspot' ? hit.entityId : null;
  state.hoveredTargetId = hit?.interactionTarget?.id || null;
  state.hoveredTargetType = hit?.interactionTarget?.type || null;
  state.hoveredInteractionTarget = hit?.interactionTarget || null;
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
  state.selectedHotspotId = hit?.componentType === 'workstation-hotspot' ? hit.entityId : null;
  state.selectedTargetId = hit?.interactionTarget?.id || null;
  state.selectedTargetType = hit?.interactionTarget?.type || null;
  state.selectedInteractionTarget = hit?.interactionTarget || null;
  state.selectedHit = hit;
  return hit;
}

export function clearInspectionSelection(state) {
  if (!state) return;
  state.selectedEntityId = null;
  state.selectedComponentType = null;
  state.selectedHotspotId = null;
  state.selectedTargetId = null;
  state.selectedTargetType = null;
  state.selectedInteractionTarget = null;
  state.selectedHit = null;
}

export function refreshInspectionSelection(state, components, entityPositions, options = {}) {
  if (!state || !state.selectedEntityId || !state.selectedComponentType || !Array.isArray(components)) {
    return null;
  }

  if (state.selectedTargetId) {
    const hotspots = options.hotspots || WORKSTATION_HOTSPOTS;
    const stationComponents = options.stationComponents || buildWorkstationHotspotComponents(hotspots, components, {
      stationSnapshots: options.stationSnapshots,
    });
    const targets = buildInteractionTargets(components, {
      ...options,
      hotspots,
      entityPositions,
      stationComponents,
    });
    const target = targets.find((candidate) => candidate.id === state.selectedTargetId);
    if (target) {
      state.selectedInteractionTarget = target;
      state.selectedTargetType = target.type;
      if (target.type === 'station') {
        const component = target.source?.component || stationComponents.find((candidate) => `station:${candidate.id}` === target.id) || null;
        state.selectedHit = {
          entityId: component?.id || target.source?.hotspot?.id || null,
          componentType: 'workstation-hotspot',
          component,
          bounds: target.source?.hotspot?.bounds || null,
          interactionTarget: target,
        };
        state.selectedHotspotId = state.selectedHit.entityId;
        return state.selectedHit;
      }
      if (target.type === 'taskResult') {
        state.selectedHit = {
          entityId: target.id,
          componentType: 'task-result',
          component: { componentType: 'task-result', popoverViewModel: target.viewModel },
          bounds: target.hitArea?.type === 'rect' ? target.hitArea : null,
          interactionTarget: target,
        };
        state.selectedHotspotId = null;
        return state.selectedHit;
      }
    }
  }

  if (state.selectedComponentType === 'workstation-hotspot') {
    const hotspot = getWorkstationHotspotById(state.selectedEntityId);
    if (!hotspot) {
      clearInspectionSelection(state);
      return null;
    }
    state.selectedHit = {
      entityId: hotspot.id,
      componentType: 'workstation-hotspot',
      component: componentForHotspot(hotspot, components, {
        stationSnapshots: options.stationSnapshots,
      }),
      bounds: hotspot.bounds,
    };
    state.selectedHotspotId = hotspot.id;
    return state.selectedHit;
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
  state.selectedHotspotId = state.selectedHit.componentType === 'workstation-hotspot'
    ? state.selectedHit.entityId
    : null;
  return state.selectedHit;
}

export function resolveInspectionTarget(state) {
  if (!state) return null;
  return state.selectedHit || state.hoveredHit || null;
}
