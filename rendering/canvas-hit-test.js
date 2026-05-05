/**
 * canvas-hit-test.js
 *
 * Pure hit testing for projected render components. It only reads component
 * descriptors and computed entity positions supplied by the canvas pipeline.
 */

import { ZONE_INDICATOR_ANCHORS } from './scene-anchors.js';
import { WORKSTATION_HOTSPOTS, componentForHotspot } from './workstation-hotspots.js';

const TASK_CHIP_BOUNDS = Object.freeze({ width: 36, height: 16 });
const ZONE_INDICATOR_BOUNDS = Object.freeze({ width: 48, height: 48 });

const AGENT_DESK_BOUNDS = Object.freeze({
  'desk-0': Object.freeze({ width: 180, height: 170, dx: 0,  dy: 0 }),
  'desk-1': Object.freeze({ width: 300, height: 150, dx: 0,  dy: 0 }),
  'desk-2': Object.freeze({ width: 300, height: 150, dx: 0,  dy: 0 }),
  'desk-3': Object.freeze({ width: 200, height: 175, dx: 0,  dy: 0 }),
  'desk-4': Object.freeze({ width: 300, height: 150, dx: 14, dy: 0 }),
  'desk-5': Object.freeze({ width: 300, height: 150, dx: 14, dy: 0 }),
});

const AGENT_FALLBACK_BOUNDS = Object.freeze({ width: 64, height: 54, dx: 0, dy: 0 });

const HOVERABLE_TYPES = Object.freeze([
  'world-zone-indicator',
  'workstation-hotspot',
  'agent-sprite',
  'task-chip',
]);

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function posOf(component, entityPositions) {
  const fromMap = entityPositions && component && component.id
    ? entityPositions.get(component.id)
    : null;
  if (fromMap && isFiniteNumber(fromMap.x) && isFiniteNumber(fromMap.y)) {
    return fromMap;
  }

  return {
    x: isFiniteNumber(component?.x) ? component.x : 0,
    y: isFiniteNumber(component?.y) ? component.y : 0,
  };
}

function rectContains(rect, point) {
  return point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height;
}

export function getComponentHitBounds(component, entityPositions) {
  if (!component || typeof component !== 'object') {
    return null;
  }

  if (component.componentType === 'task-chip') {
    const p = posOf(component, entityPositions);
    return {
      x: p.x - TASK_CHIP_BOUNDS.width / 2,
      y: p.y - TASK_CHIP_BOUNDS.height / 2,
      width: TASK_CHIP_BOUNDS.width,
      height: TASK_CHIP_BOUNDS.height,
    };
  }

  if (component.componentType === 'agent-sprite') {
    const p = posOf(component, entityPositions);
    const bounds = AGENT_DESK_BOUNDS[component.deskId] ?? AGENT_FALLBACK_BOUNDS;
    return {
      x: p.x - bounds.width / 2 + bounds.dx,
      y: p.y - bounds.height / 2 + bounds.dy,
      width: bounds.width,
      height: bounds.height,
    };
  }

  if (component.componentType === 'zone-background') {
    return {
      x: isFiniteNumber(component.x) ? component.x : 0,
      y: isFiniteNumber(component.y) ? component.y : 0,
      width: Math.max(0, isFiniteNumber(component.width) ? component.width : 0),
      height: Math.max(0, isFiniteNumber(component.height) ? component.height : 0),
    };
  }

  return null;
}

function isNormalInteractiveAgent(component) {
  return component
    && (component.visualState === 'working'
      || component.visualState === 'processing'
      || component.visualState === 'error'
      || Boolean(component.anomaly)
      || Boolean(component.currentTaskId));
}

function getZoneIndicatorHitBounds(component) {
  const anchor = component && component.id ? ZONE_INDICATOR_ANCHORS[component.id] : null;
  if (!anchor) {
    return null;
  }

  if (anchor.bounds) {
    return {
      x: anchor.bounds.x,
      y: anchor.bounds.y,
      width: anchor.bounds.width,
      height: anchor.bounds.height,
    };
  }

  return {
    x: anchor.x - ZONE_INDICATOR_BOUNDS.width / 2,
    y: anchor.y - ZONE_INDICATOR_BOUNDS.height / 2,
    width: ZONE_INDICATOR_BOUNDS.width,
    height: ZONE_INDICATOR_BOUNDS.height,
  };
}

function resultForComponent(component, componentType, bounds) {
  return {
    entityId: component.id ?? null,
    componentType,
    component,
    bounds,
  };
}

export function hitTestRenderableComponents(components, point, entityPositions, options = {}) {
  if (!Array.isArray(components) || !point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
    return null;
  }

  const debug = options && options.debug === true;
  const bakedBackground = options && options.bakedBackground === true;

  for (let i = components.length - 1; i >= 0; i--) {
    const component = components[i];
    if (!component || component.componentType !== 'task-chip') continue;
    const bounds = getComponentHitBounds(component, entityPositions);
    if (bounds && rectContains(bounds, point)) {
      return resultForComponent(component, 'task-chip', bounds);
    }
  }

  for (let i = components.length - 1; i >= 0; i--) {
    const component = components[i];
    if (!component || component.componentType !== 'agent-sprite') continue;
    if (!debug && bakedBackground) continue;
    if (!debug && !isNormalInteractiveAgent(component)) continue;
    const bounds = getComponentHitBounds(component, entityPositions);
    if (bounds && rectContains(bounds, point)) {
      return resultForComponent(component, 'agent-sprite', bounds);
    }
  }

  for (let i = WORKSTATION_HOTSPOTS.length - 1; i >= 0; i--) {
    const hotspot = WORKSTATION_HOTSPOTS[i];
    if (hotspot.bounds && rectContains(hotspot.bounds, point)) {
      const component = componentForHotspot(hotspot, components);
      return resultForComponent(component, 'workstation-hotspot', hotspot.bounds);
    }
  }

  for (let i = components.length - 1; i >= 0; i--) {
    const component = components[i];
    if (!component || component.componentType !== 'zone-background') continue;
    const bounds = getZoneIndicatorHitBounds(component);
    if (bounds && rectContains(bounds, point)) {
      return resultForComponent(component, 'world-zone-indicator', bounds);
    }
  }

  if (debug) {
    for (let i = components.length - 1; i >= 0; i--) {
      const component = components[i];
      if (!component || component.componentType !== 'zone-background') continue;
      const bounds = getComponentHitBounds(component, entityPositions);
      if (bounds && rectContains(bounds, point)) {
        return resultForComponent(component, 'world-zone-indicator', bounds);
      }
    }
  }

  return null;
}

export function isHoverableComponentType(componentType) {
  return HOVERABLE_TYPES.includes(componentType);
}
