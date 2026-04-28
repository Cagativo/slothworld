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
  position: Object.freeze({ x: 380, y: 15 }),
  size:     Object.freeze({ width: 200, height: 420 }),
});

/**
 * Zone background decorations — one desk/area per lifecycle zone.
 * Ordered to match LIFECYCLE_ZONES left-to-right.
 *
 * @type {ReadonlyArray<Readonly<EnvironmentElement>>}
 */
export const ZONE_BACKGROUNDS = Object.freeze([
  // Upper-left cozy nook — CREATED intake zone
  Object.freeze({ id: 'bg_CREATED',          kind: 'desk', position: Object.freeze({ x:  25, y:  55 }), size: Object.freeze({ width: 165, height: 155 }) }),
  // Lower-left rune/hex seating area — ENQUEUED queue zone
  Object.freeze({ id: 'bg_ENQUEUED',         kind: 'desk', position: Object.freeze({ x:  15, y: 270 }), size: Object.freeze({ width: 205, height: 200 }) }),
  // Centre-left near stream — CLAIMED in-flight zone
  Object.freeze({ id: 'bg_CLAIMED',          kind: 'desk', position: Object.freeze({ x: 218, y: 140 }), size: Object.freeze({ width: 158, height: 220 }) }),
  // Centre-right open floor — EXECUTE_FINISHED zone
  Object.freeze({ id: 'bg_EXECUTE_FINISHED', kind: 'desk', position: Object.freeze({ x: 578, y: 140 }), size: Object.freeze({ width: 158, height: 220 }) }),
  // Far-right vine-wall shelving — ACKED completion zone
  Object.freeze({ id: 'bg_ACKED',            kind: 'desk', position: Object.freeze({ x: 806, y:  42 }), size: Object.freeze({ width: 220, height: 448 }) }),
]);

/**
 * Decorative elements that appear regardless of world state.
 *
 * @type {ReadonlyArray<Readonly<EnvironmentElement>>}
 */
export const DECORATIONS = Object.freeze([
  // ── Stream waypoints (kind: 'path') ──────────────────────────────────────
  // Traced directly from the reference image (1060×520 canvas).
  // Stream originates near the arch/tree base, curves down-left through the
  // centre-left floor, then back toward lower-centre.
  // Centers: (318,166) → (233,218) → (180,276) → (180,343) → (244,395)
  Object.freeze({ id: 'deco_stream_source', kind: 'path', position: Object.freeze({ x: 301, y: 138 }), size: Object.freeze({ width:  34, height: 56 }) }),
  Object.freeze({ id: 'deco_stream_left',   kind: 'path', position: Object.freeze({ x: 211, y: 190 }), size: Object.freeze({ width:  44, height: 56 }) }),
  Object.freeze({ id: 'deco_stream_mid',    kind: 'path', position: Object.freeze({ x: 156, y: 248 }), size: Object.freeze({ width:  48, height: 56 }) }),
  Object.freeze({ id: 'deco_stream_floor',  kind: 'path', position: Object.freeze({ x: 154, y: 319 }), size: Object.freeze({ width:  52, height: 48 }) }),
  Object.freeze({ id: 'deco_stream_right',  kind: 'path', position: Object.freeze({ x: 220, y: 371 }), size: Object.freeze({ width:  48, height: 48 }) }),

  // ── Canopy vine strips — decor_vine_01 (715×207) ─────────────────────────
  // Broader centre canopy strip + narrow left/right wall clips.
  Object.freeze({ id: 'deco_vine_canopy',     kind: 'vine', position: Object.freeze({ x: 155, y:  -8 }), size: Object.freeze({ width: 520, height: 118 }) }),
  Object.freeze({ id: 'deco_vine_left_wall',  kind: 'vine', position: Object.freeze({ x: -18, y:  -4 }), size: Object.freeze({ width: 160, height:  48 }) }),
  Object.freeze({ id: 'deco_vine_right_wall', kind: 'vine', position: Object.freeze({ x: 918, y:  -4 }), size: Object.freeze({ width: 160, height:  48 }) }),

  // ── Hanging plants — macramé cluster in upper-left nook ───────────────────
  // Large hanging plant at top-left ceiling, over the CREATED alcove.
  Object.freeze({ id: 'deco_hanging_plants', kind: 'plant', position: Object.freeze({ x: -14, y: 12 }), size: Object.freeze({ width: 90, height: 95 }) }),

  // ── Hanging lanterns — light_lantern_02 (170×215, ratio ~0.79:1) ─────────
  // Nook lantern (warm amber glow in upper-left alcove) + two mid-ceiling lanterns.
  Object.freeze({ id: 'deco_lantern_nook',  kind: 'lantern', position: Object.freeze({ x:  88, y:  68 }), size: Object.freeze({ width: 22, height: 28 }) }),
  Object.freeze({ id: 'deco_lantern_mid_l', kind: 'lantern', position: Object.freeze({ x: 248, y:  60 }), size: Object.freeze({ width: 22, height: 28 }) }),
  Object.freeze({ id: 'deco_lantern_mid_r', kind: 'lantern', position: Object.freeze({ x: 740, y:  60 }), size: Object.freeze({ width: 22, height: 28 }) }),

  // ── Left-wall plant cluster ───────────────────────────────────────────────
  // Large plant at the top-left border; small plants bridging the gap down
  // between CREATED (y=55-210) and ENQUEUED (y=270-470).
  Object.freeze({ id: 'deco_plant_left_top', kind: 'plant',    position: Object.freeze({ x: -14, y:  16 }), size: Object.freeze({ width:  90, height:  96 }) }),
  Object.freeze({ id: 'deco_plant_left_mid', kind: 'plant-sm', position: Object.freeze({ x:   0, y: 152 }), size: Object.freeze({ width:  44, height:  62 }) }),
  Object.freeze({ id: 'deco_plant_left_low', kind: 'plant-sm', position: Object.freeze({ x:   0, y: 248 }), size: Object.freeze({ width:  40, height:  52 }) }),

  // ── Stream-bank plants ────────────────────────────────────────────────────
  // Small plants flanking the stream as it curves down from source to mid.
  Object.freeze({ id: 'deco_bank_upper',   kind: 'plant-sm', position: Object.freeze({ x: 288, y: 180 }), size: Object.freeze({ width: 38, height: 50 }) }),
  Object.freeze({ id: 'deco_bank_left_a',  kind: 'plant-sm', position: Object.freeze({ x: 100, y: 262 }), size: Object.freeze({ width: 34, height: 44 }) }),
  Object.freeze({ id: 'deco_bank_left_b',  kind: 'plant-sm', position: Object.freeze({ x:  88, y: 338 }), size: Object.freeze({ width: 36, height: 46 }) }),
  Object.freeze({ id: 'deco_bank_right_a', kind: 'plant-sm', position: Object.freeze({ x: 234, y: 356 }), size: Object.freeze({ width: 34, height: 44 }) }),

  // ── Tree root flankers ────────────────────────────────────────────────────
  // Large plants grounding the central tree base on both sides.
  Object.freeze({ id: 'deco_root_left',  kind: 'plant', position: Object.freeze({ x: 310, y: 368 }), size: Object.freeze({ width: 80, height: 80 }) }),
  Object.freeze({ id: 'deco_root_right', kind: 'plant', position: Object.freeze({ x: 614, y: 368 }), size: Object.freeze({ width: 80, height: 80 }) }),

  // ── Rune/stone blocks in ENQUEUED zone (lower-left) ──────────────────────
  // Glowing stone cubes with runic markings that represent queued task data.
  Object.freeze({ id: 'deco_rune_stones', kind: 'books', position: Object.freeze({ x: 130, y: 328 }), size: Object.freeze({ width: 64, height: 64 }) }),

  // ── Large plant — centre-right, flanking EXECUTE_FINISHED zone ───────────
  Object.freeze({ id: 'deco_plant_center_r', kind: 'plant', position: Object.freeze({ x: 558, y: 218 }), size: Object.freeze({ width: 88, height: 96 }) }),

  // ── Books stack in ACKED zone ─────────────────────────────────────────────
  Object.freeze({ id: 'deco_books_acked', kind: 'books', position: Object.freeze({ x: 832, y:  46 }), size: Object.freeze({ width: 72, height: 68 }) }),

  // ── Right-wall plant cluster ──────────────────────────────────────────────
  // Flanks the far-right edge of the ACKED vine-wall zone.
  Object.freeze({ id: 'deco_plant_right_top', kind: 'plant',    position: Object.freeze({ x:  962, y:  16 }), size: Object.freeze({ width:  90, height:  96 }) }),
  Object.freeze({ id: 'deco_plant_right_mid', kind: 'plant-sm', position: Object.freeze({ x:  984, y: 148 }), size: Object.freeze({ width:  44, height:  60 }) }),
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
  // Upper-left cozy alcove — warm nook with curved wood desk and hanging lantern.
  Object.freeze({ id: 'CREATED',          position: Object.freeze({ x:  25, y:  55 }), size: Object.freeze({ width: 165, height: 155 }) }),
  // Lower-left rune/hex seating — mossy hexagonal sofa and glowing stone cubes.
  Object.freeze({ id: 'ENQUEUED',         position: Object.freeze({ x:  15, y: 270 }), size: Object.freeze({ width: 205, height: 200 }) }),
  // Centre-left near stream — open floor between the nook and the central tree.
  Object.freeze({ id: 'CLAIMED',          position: Object.freeze({ x: 218, y: 140 }), size: Object.freeze({ width: 158, height: 220 }) }),
  // Centre-right open floor — right of the crystal tree, flanked by large plant.
  Object.freeze({ id: 'EXECUTE_FINISHED', position: Object.freeze({ x: 578, y: 140 }), size: Object.freeze({ width: 158, height: 220 }) }),
  // Far-right vine-wall shelving — tall wooden panel wall with built-in shelves.
  Object.freeze({ id: 'ACKED',            position: Object.freeze({ x: 806, y:  42 }), size: Object.freeze({ width: 220, height: 448 }) }),
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

  const zones = LIFECYCLE_ZONES;

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

      const deskId        = meta.deskId        ?? null;
      // currentTaskId is set by agentSelectors when a task assignment is confirmed.
      // It is null for idle agents and must never be derived from raw events here.
      const currentTaskId = meta.currentTaskId ?? null;

      return { id: n.id, type: 'agent', zoneId, visualState, position, metrics, anomaly, deskId, currentTaskId };
    });

  const connections = edges.map((e) => ({ from: e.from, to: e.to, type: 'flow' }));

  return { zones, entities, connections };
}
