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
import { renderZoneLabels }         from './zone-label-renderer.js';
import { renderAllTaskChips }       from './task-chip-renderer.js';
import {
  renderBackgroundLayer,
  renderCoreLayer,
  renderZoneLayer,
  renderConnectionLayer,
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
  renderBackgroundLayer(ctx, frame);

  // ── Layer 2: core ───────────────────────────────────────────────────────
  renderCoreLayer(ctx, frame);

  // ── Layer 3: zone ───────────────────────────────────────────────────────
  // Zone geometry (filled rect + id label from renderAllZones) is debug-only.
  // In normal mode the sprite assets in renderZoneLayer provide full zone coverage.
  // Enable via window.__SLOTHWORLD_RENDER_DEBUG__ = true  or ?renderDebug in the URL.
  const isRenderDebug = typeof window !== 'undefined' &&
    (window.__SLOTHWORLD_RENDER_DEBUG__ === true ||
     (() => { try { return new URLSearchParams(window.location.search).has('renderDebug'); } catch (_) { return false; } })());
  if (isRenderDebug) {
    renderAllZones(ctx, components);
  }
  renderZoneLayer(ctx, components);

  // ── Layer 3.5: zone labels ──────────────────────────────────────────────
  // Themed zone name badges (Intake Nook, Task Engine, …) drawn over the
  // background image or procedural scene. Suppressed in debug mode since
  // renderAllZones already shows raw zone IDs.
  renderZoneLabels(ctx, components, isRenderDebug);

  // ── Layer 4: connection ─────────────────────────────────────────────────
  renderAllConnections(ctx, components, entityPositions, frame);
  renderConnectionLayer(ctx, components, entityPositions);

  // ── Layers 5–8: agents, props, effects, UI overlay ─────────────────────
  // Layer 5 agent rendering always runs and resolves positions through
  // entityPositions. Geometry fallback still applies while sprite assets load.
  renderAllAgentEntities(ctx, components, entityPositions, Date.now());

  // ── Layer 5.5: task chips ───────────────────────────────────────────────
  // Parchment work-cards for task entities: card body + processing pulse + anomaly badge.
  // Rendered after agents so cards appear in front of desk sprites.
  renderAllTaskChips(ctx, components, entityPositions);

  // renderPropLayer remains suppressed in image mode. renderEffectLayer is a hard no-op.
  renderUIOverlayLayer(ctx, components, entityPositions);
}
