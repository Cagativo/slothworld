/**
 * world-scene-adapter.js
 *
 * Converts a WorldScene ({ zones, entities, connections }) produced by
 * world-scene.js into an array of renderable UI component descriptors.
 *
 * CONTRACT:
 *  - Input:  WorldScene — { zones, entities, connections }
 *  - Output: Array of component descriptors — flat list consumed by the
 *            rendering pipeline in declaration order (back → front)
 *
 * RULES:
 *  - No selector calls
 *  - No event usage
 *  - No lifecycle inference
 *  - Pure structural projection — fields are read and re-shaped, never computed
 */

// ---------------------------------------------------------------------------
// Component factories — one function per visual layer, lowest to highest
// ---------------------------------------------------------------------------

/**
 * Project a zone into a zone-background component descriptor.
 *
 * @param {object} zone
 * @returns {{ componentType: string, id: string, x: number, y: number, width: number, height: number }}
 */
function zoneToComponent(zone) {
  return {
    componentType: 'zone-background',
    id:            zone.id,
    x:             zone.position ? zone.position.x : 0,
    y:             zone.position ? zone.position.y : 0,
    width:         zone.size ? zone.size.width  : 0,
    height:        zone.size ? zone.size.height : 0,
  };
}

/**
 * Project an entity into an agent-sprite component descriptor.
 *
 * @param {object} entity
 * @returns {{ componentType: string, id: string, x: number, y: number, visualState: string, zoneId: string|null, metrics: object, anomaly: object|null }}
 */
function entityToComponent(entity) {
  return {
    componentType: 'agent-sprite',
    id:            entity.id,
    x:             entity.position ? entity.position.x : 0,
    y:             entity.position ? entity.position.y : 0,
    visualState:   entity.visualState ?? 'unknown',
    zoneId:        entity.zoneId     ?? null,
    metrics:       entity.metrics    ?? { duration: null, queueTime: null, latency: null },
    anomaly:       entity.anomaly    ?? null,
  };
}

/**
 * Project a connection into a flow-line component descriptor.
 *
 * @param {object} connection
 * @returns {{ componentType: string, from: string, to: string }}
 */
function connectionToComponent(connection) {
  return {
    componentType: 'flow-line',
    from:          connection.from,
    to:            connection.to,
  };
}

// ---------------------------------------------------------------------------
// Adapter entry point
// ---------------------------------------------------------------------------

/**
 * Convert a WorldScene into a flat ordered list of renderable component
 * descriptors.  Rendering order: zones first (background), then
 * connections (mid-ground), then entities (foreground).
 *
 * @param {object | null | undefined} scene  WorldScene — { zones, entities, connections }
 * @returns {Array<object>}                  Flat array of component descriptors
 */
export function toRenderableComponents(scene) {
  const safeScene = scene && typeof scene === 'object' ? scene : {};

  const zones       = Array.isArray(safeScene.zones)       ? safeScene.zones       : [];
  const entities    = Array.isArray(safeScene.entities)    ? safeScene.entities    : [];
  const connections = Array.isArray(safeScene.connections) ? safeScene.connections : [];

  return [
    ...zones.map(zoneToComponent),
    ...connections.map(connectionToComponent),
    ...entities.map(entityToComponent),
  ];
}
