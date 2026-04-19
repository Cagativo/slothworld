/**
 * world-scene.js
 *
 * Renderer input layer: projects a VisualWorldGraph into a scene description
 * object consumed by the rendering pipeline.
 *
 * CONTRACT:
 *  - Input:  VisualWorldGraph — { nodes, edges, metadata }
 *  - Output: scene description — { zones, entities, connections }
 *
 * RULES (enforced by architecture):
 *  - No mapping logic
 *  - No event usage
 *  - No lifecycle logic
 *  - Pure structural projection only
 */

/**
 * @typedef {{ nodes: Array, edges: Array, metadata: object }} VisualWorldGraph
 * @typedef {{ zones: Array, entities: Array, connections: Array }} WorldScene
 * @typedef {{ id: string, position: { x: number, y: number }, size: { width: number, height: number } }} LifecycleZone
 * @typedef {{ id: string, kind: string, position: { x: number, y: number }, size: { width: number, height: number } }} EnvironmentElement
 */

// ---------------------------------------------------------------------------
// Static environment — purely visual, data-independent
// ---------------------------------------------------------------------------

/**
 * Central structural element of the world scene.
 * Rendered behind all zones and entities as the scene anchor point.
 *
 * @type {Readonly<EnvironmentElement>}
 */
export const CENTRAL_STRUCTURE = Object.freeze({
  id:       'central_tree',
  kind:     'tree',
  position: Object.freeze({ x: 490, y: 40 }),
  size:     Object.freeze({ width: 80, height: 100 }),
});

/**
 * Zone background decorations — one desk/area per lifecycle zone.
 * Ordered to match LIFECYCLE_ZONES left-to-right.
 *
 * @type {ReadonlyArray<Readonly<EnvironmentElement>>}
 */
export const ZONE_BACKGROUNDS = Object.freeze([
  Object.freeze({ id: 'bg_CREATED',          kind: 'desk', position: Object.freeze({ x:  40, y: 160 }), size: Object.freeze({ width: 160, height: 200 }) }),
  Object.freeze({ id: 'bg_ENQUEUED',         kind: 'desk', position: Object.freeze({ x: 240, y: 160 }), size: Object.freeze({ width: 160, height: 200 }) }),
  Object.freeze({ id: 'bg_CLAIMED',          kind: 'desk', position: Object.freeze({ x: 440, y: 160 }), size: Object.freeze({ width: 160, height: 200 }) }),
  Object.freeze({ id: 'bg_EXECUTE_FINISHED', kind: 'desk', position: Object.freeze({ x: 640, y: 160 }), size: Object.freeze({ width: 160, height: 200 }) }),
  Object.freeze({ id: 'bg_ACKED',            kind: 'desk', position: Object.freeze({ x: 840, y: 160 }), size: Object.freeze({ width: 160, height: 200 }) }),
]);

/**
 * Decorative elements that appear regardless of world state.
 *
 * @type {ReadonlyArray<Readonly<EnvironmentElement>>}
 */
export const DECORATIONS = Object.freeze([
  Object.freeze({ id: 'deco_bush_left',   kind: 'bush',  position: Object.freeze({ x:  10, y:  60 }), size: Object.freeze({ width: 24, height: 24 }) }),
  Object.freeze({ id: 'deco_bush_right',  kind: 'bush',  position: Object.freeze({ x: 990, y:  60 }), size: Object.freeze({ width: 24, height: 24 }) }),
  Object.freeze({ id: 'deco_rock_1',      kind: 'rock',  position: Object.freeze({ x: 200, y:  80 }), size: Object.freeze({ width: 16, height: 12 }) }),
  Object.freeze({ id: 'deco_rock_2',      kind: 'rock',  position: Object.freeze({ x: 780, y:  80 }), size: Object.freeze({ width: 16, height: 12 }) }),
  Object.freeze({ id: 'deco_path',        kind: 'path',  position: Object.freeze({ x:  40, y: 380 }), size: Object.freeze({ width: 960, height: 12 }) }),
]);

/**
 * Convenience bundle of all static environment elements for renderers
 * that iterate the full environment in one pass.
 *
 * @type {Readonly<{ centralStructure: EnvironmentElement, zoneBackgrounds: ReadonlyArray<EnvironmentElement>, decorations: ReadonlyArray<EnvironmentElement> }>}
 */
export const STATIC_ENVIRONMENT = Object.freeze({
  centralStructure: CENTRAL_STRUCTURE,
  zoneBackgrounds:  ZONE_BACKGROUNDS,
  decorations:      DECORATIONS,
});

/**
 * Fixed zone definitions for lifecycle visualization.
 *
 * Layout is hardcoded. Zones are ordered left-to-right to reflect the
 * canonical task progression visible in the world view.
 *
 * RULES:
 *  - No dynamic positioning logic
 *  - No event or selector access
 *  - Values are pure layout constants
 *
 * @type {LifecycleZone[]}
 */
export const LIFECYCLE_ZONES = Object.freeze([
  Object.freeze({ id: 'CREATED',          position: Object.freeze({ x:  40, y: 160 }), size: Object.freeze({ width: 160, height: 200 }) }),
  Object.freeze({ id: 'ENQUEUED',         position: Object.freeze({ x: 240, y: 160 }), size: Object.freeze({ width: 160, height: 200 }) }),
  Object.freeze({ id: 'CLAIMED',          position: Object.freeze({ x: 440, y: 160 }), size: Object.freeze({ width: 160, height: 200 }) }),
  Object.freeze({ id: 'EXECUTE_FINISHED', position: Object.freeze({ x: 640, y: 160 }), size: Object.freeze({ width: 160, height: 200 }) }),
  Object.freeze({ id: 'ACKED',            position: Object.freeze({ x: 840, y: 160 }), size: Object.freeze({ width: 160, height: 200 }) }),
]);

/**
 * Lookup table: node.status → zone id.
 *
 * Values come directly from node.status — no lifecycle inference.
 * Unknown statuses map to null (entity rendered without a zone).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STATUS_ZONE_MAP = Object.freeze({
  created:          'CREATED',
  enqueued:         'ENQUEUED',
  claimed:          'CLAIMED',
  executing:        'CLAIMED',
  execute_finished: 'EXECUTE_FINISHED',
  acked:            'ACKED',
  completed:        'ACKED',
  failed:           'ACKED',
});

/**
 * Lookup table: node.status → visualState label.
 *
 * visualState is a pure visual classification derived from node.status only.
 * No behavior or lifecycle inference — the value is used by the renderer
 * to select a visual representation (sprite, colour, etc.).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const VISUAL_STATE_MAP = Object.freeze({
  created:          'idle',
  enqueued:         'waiting',
  claimed:          'moving',
  executing:        'moving',
  execute_finished: 'processing',
  acked:            'completed',
  completed:        'completed',
  failed:           'error',
});

/** @type {Readonly<Map<string, LifecycleZone>>} */
const _zoneById = new Map(LIFECYCLE_ZONES.map((z) => [z.id, z]));

/**
 * Build a scene description from a VisualWorldGraph.
 *
 * Entities are projected from non-zone nodes. Each entity receives a
 * zoneId (from STATUS_ZONE_MAP via node.status) and a position anchored
 * to the top-left corner of its zone.
 *
 * @param {VisualWorldGraph | null | undefined} graph
 * @returns {WorldScene}
 */
export function buildWorldScene(graph) {
  const safeGraph = graph && typeof graph === 'object' ? graph : {};

  const nodes = Array.isArray(safeGraph.nodes) ? safeGraph.nodes : [];
  const edges = Array.isArray(safeGraph.edges) ? safeGraph.edges : [];

  const zones = nodes.filter((n) => n && n.type === 'zone');

  const entities = nodes
    .filter((n) => n && n.type !== 'zone')
    .map((n) => {
      const zoneId   = STATUS_ZONE_MAP[n.status] ?? null;
      const zone     = zoneId ? _zoneById.get(zoneId) : null;
      const position = zone
        ? { x: zone.position.x, y: zone.position.y }
        : { x: 0, y: 0 };

      const visualState = VISUAL_STATE_MAP[n.status] ?? 'unknown';

      const meta = n.metadata && typeof n.metadata === 'object' ? n.metadata : {};
      const metrics = {
        duration:  meta.duration  ?? null,
        queueTime: meta.queueTime ?? null,
        latency:   meta.latency   ?? null,
      };

      const firstIncident = Array.isArray(meta.incidents) && meta.incidents.length > 0
        ? meta.incidents[0]
        : null;
      const anomaly = firstIncident
        ? { severity: firstIncident.severity, type: firstIncident.clusterType }
        : null;

      return { id: n.id, type: 'agent', zoneId, visualState, position, metrics, anomaly };
    });

  const connections = edges.map((e) => ({ from: e.from, to: e.to, type: 'flow' }));

  return { zones, entities, connections };
}
