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
import { renderDiegeticIndicators } from './diegetic-indicator-renderer.js';
import { renderWorldCompositionLayer } from './world-background-composition.js';
import { loadedAssets } from './assets.js';
import { isBakedBackgroundActive, selectLoadedBackground } from './background-config.js';
import { renderWorkstationHotspotDebug } from './workstation-hotspots.js';
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
  const activeBackground = selectLoadedBackground(loadedAssets);
  const bakedBackgroundActive = isBakedBackgroundActive(activeBackground);

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
  renderWorldCompositionLayer(ctx, { debug: isRenderDebug, frame, bakedBackground: bakedBackgroundActive });

  // ── Layer 3.5: zone labels (debug mode only) ───────────────────────────
  // Themed zone-name badges (Intake Nook, Task Engine, …). Shown only in
  // debug mode alongside raw zone IDs. In normal mode, in-world diegetic
  // indicators communicate state instead — no duplicate text labels.
  renderZoneLabels(ctx, components, isRenderDebug);
  if (isRenderDebug) {
    renderWorkstationHotspotDebug(ctx);
  }

  // ── Layer 3.6: diegetic indicators (normal mode only) ──────────────────
  // In-world visual props (paper stacks, monitor glow, rune pulse, …) that
  // communicate zone activity without persistent text labels.
  if (!isRenderDebug) {
    renderDiegeticIndicators(ctx, components, Date.now(), { bakedBackground: bakedBackgroundActive });
  }

  // ── Layer 4: connection ─────────────────────────────────────────────────
  renderAllConnections(ctx, components, entityPositions, frame, isRenderDebug);
  renderConnectionLayer(ctx, components, entityPositions, isRenderDebug);

  // ── Layers 5–8: agents, props, effects, UI overlay ─────────────────────
  // Layer 5 agent rendering always runs and resolves positions through
  // entityPositions. Geometry fallback still applies while sprite assets load.
  renderAllAgentEntities(ctx, components, entityPositions, Date.now(), {
    debug: isRenderDebug,
    bakedBackground: bakedBackgroundActive,
  });

  // ── Layer 5.5: task chips ───────────────────────────────────────────────
  // Parchment work-cards for task entities: card body + processing pulse + anomaly badge.
  // In normal mode only active/failed/processing chips are shown and IDs are hidden.
  // In debug mode all chips render with full IDs.
  renderAllTaskChips(ctx, components, entityPositions, isRenderDebug);

  // renderPropLayer remains suppressed in image mode. renderEffectLayer is a hard no-op.
  renderUIOverlayLayer(ctx, components, entityPositions, {
    debug: isRenderDebug,
    bakedBackground: bakedBackgroundActive,
  });
}
