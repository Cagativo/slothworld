/**
 * world-scene-layer-renderer.js
 *
 * Orchestrates all WorldScene rendering in a fixed 8-layer draw order.
 *
 * CONTRACT:
 *  - Input:  CanvasRenderingContext2D, component list, entity position map,
 *            frame counter
 *  - Output: canvas draw calls only — no return value, no state mutation
 *
 * Layer order (FIXED — must not change):
 *  1. background  — ground decor, plants
 *  2. core        — central tree + accent overlay
 *  3. zone        — desk / shelf geometry + zone sprites
 *  4. connection  — animated flow lines + flow-stream sprites
 *  5. entity      — agent geometry fallback + agent base sprite
 *  6. prop        — task prop sprites near agents
 *  7. effect      — glow orbs + lanterns
 *  8. ui-overlay  — floating display panels
 *
 * RULES:
 *  - Layer order is static and hardcoded — no dynamic reordering
 *  - No event access, no selector access, no lifecycle inference
 *  - Geometry renderers run first in each layer; sprite renderers overlay
 *    on top, so geometry acts as a loaded-asset fallback automatically
 */

import { renderAllZones }          from './zone-renderer.js';
import { renderAllConnections }     from './connection-renderer.js';
import { renderAllAgentEntities }   from './agent-entity-renderer.js';
import { buildEntityPositionMap }   from './zone-renderer.js';
import {
  renderBackgroundLayer,
  renderCoreLayer,
  renderZoneLayer,
  renderConnectionLayer,
  renderEntityLayer,
  renderPropLayer,
  renderEffectLayer,
  renderUIOverlayLayer,
} from './world-scene-asset-renderer.js';

/**
 * Draw the complete WorldScene in the fixed 8-layer order.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>}            components      — flat component list from toRenderableComponents()
 * @param {number}                   frame           — current render frame counter (integer, read-only)
 */
export function renderAllLayers(ctx, components, frame) {
  // Build entity position map once; shared across geometry and sprite layers
  const entityPositions = buildEntityPositionMap(components);

  // Debug log — component counts + entity position map size
  if (typeof window !== 'undefined' && window.DEV_MODE) {
    const byType = {};
    for (const c of components) { byType[c.componentType] = (byType[c.componentType] || 0) + 1; }
    console.log('[renderAllLayers] frame', frame,
      '| zones:', byType['zone-background'] || 0,
      '| entities:', byType['agent-sprite'] || 0,
      '| connections:', byType['flow-line'] || 0,
      '| positions computed:', entityPositions.size);
  }

  // ── Layer 1: background ─────────────────────────────────────────────────
  renderBackgroundLayer(ctx);

  // ── Layer 2: core ───────────────────────────────────────────────────────
  renderCoreLayer(ctx);

  // ── Layer 3: zone ───────────────────────────────────────────────────────
  renderAllZones(ctx, components);
  renderZoneLayer(ctx, components);

  // ── Layer 4: connection ─────────────────────────────────────────────────
  renderAllConnections(ctx, components, entityPositions, frame);
  renderConnectionLayer(ctx, components, entityPositions);

  // ── Layer 5: entity ─────────────────────────────────────────────────────
  renderAllAgentEntities(ctx, components, entityPositions);
  renderEntityLayer(ctx, components, entityPositions);

  // ── Layer 6: prop ───────────────────────────────────────────────────────
  renderPropLayer(ctx, components, entityPositions);

  // ── Layer 7: effect ─────────────────────────────────────────────────────
  renderEffectLayer(ctx, components, entityPositions);

  // ── Layer 8: UI overlay ─────────────────────────────────────────────────
  renderUIOverlayLayer(ctx, components, entityPositions);
}
