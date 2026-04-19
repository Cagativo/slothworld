/**
 * world-scene-asset-renderer.js
 *
 * Per-layer sprite integration for the WorldScene rendering pipeline.
 *
 * CONTRACT:
 *  - Reads from ASSET_MAPPING (fixed, frozen) in assets.js
 *  - Reads images from loadedAssets (populated by AssetLoader at startup)
 *  - Gracefully skips any image not yet loaded — no errors thrown
 *  - NO Math.random — all multi-asset selection is deterministic via id hash
 *  - NO event access, NO selector access, NO lifecycle inference
 *  - NO new visual states introduced
 *
 * Exported functions map 1-to-1 to the 8 fixed rendering layers:
 *
 *  Layer 1 — renderBackgroundLayer  (ground decor, plants)
 *  Layer 2 — renderCoreLayer        (central tree + accent)
 *  Layer 3 — renderZoneLayer        (desk / shelf sprites)
 *  Layer 4 — renderConnectionLayer  (flow-stream sprites at edge midpoints)
 *  Layer 5 — renderEntityLayer      (agent base sprite)
 *  Layer 6 — renderPropLayer        (task prop sprites)
 *  Layer 7 — renderEffectLayer      (glow orbs + lantern)
 *  Layer 8 — renderUIOverlayLayer   (floating display panels)
 */

import { ASSET_MAPPING, loadedAssets } from './assets.js';
import { CENTRAL_STRUCTURE, DECORATIONS } from './world-scene.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic index from a string key and array length.
 * Uses a djb2-style hash — no randomness.
 *
 * @param {string} str
 * @param {number} len
 * @returns {number}
 */
function deterministicIndex(str, len) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % len;
}

/**
 * Draw an image from loadedAssets if available. No-op otherwise.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} filename
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
function drawIfLoaded(ctx, filename, x, y, w, h) {
  const img = loadedAssets[filename];
  if (img) {
    ctx.drawImage(img, x, y, w, h);
  }
}

// ---------------------------------------------------------------------------
// Sprite size constants
// ---------------------------------------------------------------------------

const AGENT_SIZE = 32;   // px — agent base sprite (square)
const PROP_SIZE  = 24;   // px — task prop sprite (square)
const GLOW_SIZE  = 48;   // px — glow orb overlay (square)
const FLOW_SIZE  = { w: 16, h: 8 };   // px — flow stream sprite
const UI_SIZE    = { w: 48, h: 24 };  // px — floating display panel

// ---------------------------------------------------------------------------
// Layer 1 — Background (ground decor, plants)
// ---------------------------------------------------------------------------

/**
 * Draw the background layer: each DECORATION element gets a groundDecor
 * sprite selected deterministically by decoration index.
 *
 * @param {CanvasRenderingContext2D} ctx
 */
export function renderBackgroundLayer(ctx) {
  const decors = ASSET_MAPPING.environment.groundDecor;
  for (let i = 0; i < DECORATIONS.length; i++) {
    const deco = DECORATIONS[i];
    const filename = decors[i % decors.length];
    drawIfLoaded(ctx, filename, deco.position.x, deco.position.y, deco.size.width, deco.size.height);
  }
}

// ---------------------------------------------------------------------------
// Layer 2 — Core (central tree + accent overlay)
// ---------------------------------------------------------------------------

/**
 * Draw the core layer: central tree sprite then coreAccent overlay,
 * both at CENTRAL_STRUCTURE position/size.
 *
 * @param {CanvasRenderingContext2D} ctx
 */
export function renderCoreLayer(ctx) {
  const { x, y }         = CENTRAL_STRUCTURE.position;
  const { width, height } = CENTRAL_STRUCTURE.size;
  drawIfLoaded(ctx, ASSET_MAPPING.environment.core,       x, y, width, height);
  drawIfLoaded(ctx, ASSET_MAPPING.environment.coreAccent, x, y, width, height);
}

// ---------------------------------------------------------------------------
// Layer 3 — Zone (desk / shelf sprites)
// ---------------------------------------------------------------------------

/**
 * Draw zone background sprites over each zone-background component.
 * The component id is used directly as the ASSET_MAPPING.zones key
 * (e.g. 'CREATED', 'ENQUEUED').
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components
 */
export function renderZoneLayer(ctx, components) {
  for (const c of components) {
    if (c.componentType !== 'zone-background') continue;
    const filename = ASSET_MAPPING.zones[c.id];
    if (!filename) continue;
    drawIfLoaded(ctx, filename, c.x, c.y, c.width, c.height);
  }
}

// ---------------------------------------------------------------------------
// Layer 4 — Connection (flow-stream sprites at edge midpoints)
// ---------------------------------------------------------------------------

/**
 * Draw a flow-stream sprite centred at the midpoint of each flow-line.
 * Sprite is chosen by connection index mod flow asset count (deterministic).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components
 * @param {Map<string, {x:number, y:number}>} entityPositions
 */
export function renderConnectionLayer(ctx, components, entityPositions) {
  const flowAssets = ASSET_MAPPING.effects.flow;
  let idx = 0;
  for (const c of components) {
    if (c.componentType !== 'flow-line') continue;
    const fromPos = entityPositions.get(c.from);
    const toPos   = entityPositions.get(c.to);
    if (fromPos && toPos) {
      const mx = (fromPos.x + toPos.x) / 2;
      const my = (fromPos.y + toPos.y) / 2;
      const filename = flowAssets[idx % flowAssets.length];
      drawIfLoaded(ctx, filename, mx - FLOW_SIZE.w / 2, my - FLOW_SIZE.h / 2, FLOW_SIZE.w, FLOW_SIZE.h);
    }
    idx++;
  }
}

// ---------------------------------------------------------------------------
// Layer 5 — Entity (agent base sprite)
// ---------------------------------------------------------------------------

/**
 * Draw the agent base sprite for each agent-sprite component.
 * Visual state is applied via animation only — this layer does NOT
 * switch assets by visualState.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components
 */
export function renderEntityLayer(ctx, components) {
  const half = AGENT_SIZE / 2;
  for (const c of components) {
    if (c.componentType !== 'agent-sprite') continue;
    drawIfLoaded(ctx, ASSET_MAPPING.agents.base, c.x - half, c.y - half, AGENT_SIZE, AGENT_SIZE);
  }
}

// ---------------------------------------------------------------------------
// Layer 6 — Prop (task prop sprites near agents)
// ---------------------------------------------------------------------------

/**
 * Draw a task prop sprite offset (+18 x, -10 y) from each agent position.
 * Prop asset is selected by deterministicIndex(entity.id, props.length).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components
 */
export function renderPropLayer(ctx, components) {
  const propAssets = ASSET_MAPPING.props;
  for (const c of components) {
    if (c.componentType !== 'agent-sprite') continue;
    const filename = propAssets[deterministicIndex(c.id, propAssets.length)];
    drawIfLoaded(ctx, filename, c.x + 18, c.y - 10, PROP_SIZE, PROP_SIZE);
  }
}

// ---------------------------------------------------------------------------
// Layer 7 — Effect (glow orbs + lantern)
// ---------------------------------------------------------------------------

/**
 * Draw effect sprites for each agent:
 *  - Glow orb: overlay centred on the agent, selected by deterministicIndex(id, glows.length)
 *  - Lantern:  drawn at a fixed offset (-22 x, -14 y) from the agent position
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components
 */
export function renderEffectLayer(ctx, components) {
  const glowAssets = ASSET_MAPPING.effects.glow;
  const halfGlow   = GLOW_SIZE / 2;
  for (const c of components) {
    if (c.componentType !== 'agent-sprite') continue;
    // Glow orb overlay
    const glowFile = glowAssets[deterministicIndex(c.id, glowAssets.length)];
    drawIfLoaded(ctx, glowFile, c.x - halfGlow, c.y - halfGlow, GLOW_SIZE, GLOW_SIZE);
    // Lantern — fixed offset to the left and above the agent
    drawIfLoaded(ctx, ASSET_MAPPING.effects.lantern, c.x - 22, c.y - 14, 14, 20);
  }
}

// ---------------------------------------------------------------------------
// Layer 8 — UI Overlay (floating display panels)
// ---------------------------------------------------------------------------

/**
 * Draw a floating display panel above each agent-sprite component.
 * Uses ASSET_MAPPING.effects.ui[0] (ui_floating_display_01.png).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components
 */
export function renderUIOverlayLayer(ctx, components) {
  const panelFile = ASSET_MAPPING.effects.ui[0];
  for (const c of components) {
    if (c.componentType !== 'agent-sprite') continue;
    // Panel centred horizontally above the agent
    drawIfLoaded(
      ctx,
      panelFile,
      c.x - UI_SIZE.w / 2,
      c.y - AGENT_SIZE / 2 - UI_SIZE.h - 4,
      UI_SIZE.w,
      UI_SIZE.h,
    );
  }
}

