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

/**
 * Resolve the canvas position of an entity component.
 * Prefers the computed slot position from the entity position map;
 * falls back to the component's own x/y if no map entry exists.
 *
 * @param {object} c                                 agent-sprite component
 * @param {Map<string, {x:number, y:number}>} map    entity position map
 * @returns {{ x: number, y: number }}
 */
function posOf(c, map) {
  const p = map && map.get(c.id);
  return p || { x: c.x, y: c.y };
}


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
export function renderEntityLayer(ctx, components, entityPositions) {
  const half     = AGENT_SIZE / 2;
  const agentKey = ASSET_MAPPING.agents.base;
  let debugLogged = false;
  for (const c of components) {
    if (c.componentType !== 'agent-sprite') continue;
    const { x, y } = posOf(c, entityPositions);
    if (window.DEV_MODE && !debugLogged) {
      console.log('[Layer 5] agent key:', agentKey, '| loaded:', !!loadedAssets[agentKey],
        '| first entity pos:', x, y);
      debugLogged = true;
    }
    drawIfLoaded(ctx, agentKey, x - half, y - half, AGENT_SIZE, AGENT_SIZE);
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
export function renderPropLayer(ctx, components, entityPositions) {
  const taskAssets  = ASSET_MAPPING.props.task;
  const booksAssets = ASSET_MAPPING.props.books;
  const sample      = taskAssets.slice(0, 5);
  let   debugLogged = false;
  for (const c of components) {
    if (c.componentType !== 'agent-sprite') continue;
    const { x, y }   = posOf(c, entityPositions);
    // Task prop — offset to the right of the agent
    const taskFile   = taskAssets[deterministicIndex(c.id, taskAssets.length)];
    // Books prop — offset to the left of the agent, selected by id hash
    const booksFile  = booksAssets[deterministicIndex(c.id, booksAssets.length)];
    if (window.DEV_MODE && !debugLogged) {
      console.log('[Layer 6] task prop:', taskFile, '| loaded:', !!loadedAssets[taskFile],
        '| books prop:', booksFile, '| loaded:', !!loadedAssets[booksFile]);
      debugLogged = true;
    }
    drawIfLoaded(ctx, taskFile,  x + 18, y - 10, PROP_SIZE, PROP_SIZE);
    drawIfLoaded(ctx, booksFile, x - 18, y - 10, PROP_SIZE, PROP_SIZE);
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
export function renderEffectLayer(ctx, components, entityPositions) {
  const glowAssets = ASSET_MAPPING.effects.glow;
  const halfGlow   = GLOW_SIZE / 2;
  let   debugLogged = false;
  for (const c of components) {
    if (c.componentType !== 'agent-sprite') continue;
    const { x, y }  = posOf(c, entityPositions);
    const glowFile   = glowAssets[deterministicIndex(c.id, glowAssets.length)];
    if (window.DEV_MODE && !debugLogged) {
      console.log('[Layer 7] glow:', glowFile, '| loaded:', !!loadedAssets[glowFile],
        '| lantern loaded:', !!loadedAssets[ASSET_MAPPING.effects.lantern]);
      debugLogged = true;
    }
    drawIfLoaded(ctx, glowFile,                    x - halfGlow, y - halfGlow, GLOW_SIZE, GLOW_SIZE);
    drawIfLoaded(ctx, ASSET_MAPPING.effects.lantern, x - 22,      y - 14,       14,        20);
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
export function renderUIOverlayLayer(ctx, components, entityPositions) {
  const panelFile = ASSET_MAPPING.effects.ui[0];
  for (const c of components) {
    if (c.componentType !== 'agent-sprite') continue;
    const { x, y } = posOf(c, entityPositions);
    // Panel centred horizontally above the agent
    drawIfLoaded(
      ctx,
      panelFile,
      x - UI_SIZE.w / 2,
      y - AGENT_SIZE / 2 - UI_SIZE.h - 4,
      UI_SIZE.w,
      UI_SIZE.h,
    );
  }
}

