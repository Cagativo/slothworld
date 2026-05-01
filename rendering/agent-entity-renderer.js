/**
 * agent-entity-renderer.js
 *
 * Renders agent-sprite component descriptors onto a 2D canvas context.
 *
 * CONTRACT:
 *  - Input:  agent-sprite component descriptor from world-scene-adapter.js
 *            { componentType, id, x, y, visualState, zoneId, metrics, anomaly }
 *  - Output: canvas draw calls only — no return value, no state mutation
 *
 * RULES:
 *  - All visual properties are driven by visualState only
 *  - No lifecycle inference
 *  - No selector or event access
 *  - Pure mapping: visualState → { fillStyle, strokeStyle, radius, label }
 */

import { loadedAssets, ASSET_MAPPING } from './assets.js';

// ---------------------------------------------------------------------------
// Static visual style table — one entry per supported visualState
// ---------------------------------------------------------------------------

/**
 * @typedef {{ fill: string, stroke: string, radius: number, label: string }} AgentVisualStyle
 */

/**
 * Mapping from visualState → canvas draw properties.
 *
 * All values are purely visual. No behavior or lifecycle meaning is attached.
 *
 * @type {Readonly<Record<string, Readonly<AgentVisualStyle>>>}
 */
export const AGENT_VISUAL_STYLES = Object.freeze({
  idle:        Object.freeze({ fill: '#6b8f5e', stroke: '#3a5c2a', radius: 10, label: 'IDLE' }),
  waiting:     Object.freeze({ fill: '#d4a017', stroke: '#8b6a00', radius: 10, label: 'WAIT' }),
  moving:      Object.freeze({ fill: '#00b8a9', stroke: '#006b62', radius: 10, label: 'MOVE' }),
  processing:  Object.freeze({ fill: '#7ec8c8', stroke: '#007b7b', radius: 10, label: 'PROC' }),
  completed:   Object.freeze({ fill: '#4caf50', stroke: '#1b5e20', radius: 10, label: 'DONE' }),
  error:       Object.freeze({ fill: '#e53935', stroke: '#7f0000', radius: 10, label: 'ERR'  }),
  unknown:     Object.freeze({ fill: '#8d7b68', stroke: '#5c4a36', radius: 10, label: '?'    }),
});

/** Fallback style used when visualState is not in AGENT_VISUAL_STYLES. */
const FALLBACK_STYLE = AGENT_VISUAL_STYLES.unknown;

const AGENT_W = 62;
const AGENT_H = 54;

/**
 * Per-desk render dimensions — sized to match each sprite's natural aspect ratio
 * at a scale appropriate for the 1060×520 canvas.
 *
 * right_front: 360×500 (portrait)   → 90×125
 * right_back:  365×320 (near-square) → 110×96
 * left_front:  392×219 (landscape)  → 110×61
 * left_back:   392×219 (landscape)  → 110×61
 */
const DESK_SPRITE_SIZES = Object.freeze({
  'desk-0': Object.freeze({ w: 180, h: 170  }),
  'desk-1': Object.freeze({ w: 300, h: 150  }),
  'desk-2': Object.freeze({ w: 300, h: 150  }),
  'desk-3': Object.freeze({ w: 200, h: 175  }),
  'desk-4': Object.freeze({ w: 300, h: 150  }),
  'desk-5': Object.freeze({ w: 300, h: 150  }),
});

/**
 * Per-desk draw offset — compensates for sprite composition asymmetry where the
 * desk graphic visual center is not at the frame center.
 *
 * Analysis (natural image → scaled frame):
 *  right_front: desk at ~50% x  → dx≈0
 *  left_front:  desk at ~47% x  → dx≈+3   (3px left of center)
 *  right_back:  desk at ~52% x  → dx≈-2
 *  left_back:   desk at ~35% x  → dx≈+16.5 (16.5px left of center)
 *
 * Desks 1/2 (left_front) are calibration reference (+3px offset baked into
 * DESK_POSITIONS). Desks 4/5 (left_back) need +14 extra to match that reference.
 */
const DESK_SPRITE_OFFSETS = Object.freeze({
  'desk-0': Object.freeze({ dx:  0, dy: 0 }),
  'desk-1': Object.freeze({ dx:  0, dy: 0 }),
  'desk-2': Object.freeze({ dx:  0, dy: 0 }),
  'desk-3': Object.freeze({ dx:  0, dy: 0 }),
  'desk-4': Object.freeze({ dx: 14, dy: 0 }),  // left_back: desk 14px further left than left_front
  'desk-5': Object.freeze({ dx: 14, dy: 0 }),
});

const DESK_SPRITE_BY_ID = Object.freeze({
  'desk-0': 'sloth_worker_desk_facing_right_front_01.png',
  'desk-1': 'sloth_worker_desk_facing_left_front_01.png',
  'desk-2': 'sloth_worker_desk_facing_left_front_01.png',
  'desk-3': 'sloth_worker_desk_facing_right_back_01.png',
  'desk-4': 'sloth_worker_desk_facing_left_back_01.png',
  'desk-5': 'sloth_worker_desk_facing_left_back_01.png',
});

function spriteForComponent(component) {
  if (component && component.deskId && DESK_SPRITE_BY_ID[component.deskId]) {
    return DESK_SPRITE_BY_ID[component.deskId];
  }

  const match = component && typeof component.id === 'string'
    ? /^sloth-(\d+)$/.exec(component.id)
    : null;
  if (match) {
    const idx = Number(match[1]) - 1;
    const spriteByIndex = [
      'sloth_worker_desk_facing_right_front_01.png',
      'sloth_worker_desk_facing_left_front_01.png',
      'sloth_worker_desk_facing_left_front_01.png',
      'sloth_worker_desk_facing_right_back_01.png',
      'sloth_worker_desk_facing_left_back_01.png',
      'sloth_worker_desk_facing_left_back_01.png',
    ];
    if (idx >= 0 && idx < spriteByIndex.length) {
      return spriteByIndex[idx];
    }
  }

  return ASSET_MAPPING.agents.base;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Draw a single agent-sprite component descriptor onto a canvas context.
 *
 * Reads: component.x, component.y, component.visualState, component.anomaly
 * Does NOT read: events, selectors, app state
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} component  agent-sprite descriptor from toRenderableComponents()
 */
export function renderAgentEntity(ctx, component) {
  if (!ctx || !component) return;

  const x     = typeof component.x === 'number' ? component.x : 0;
  const y     = typeof component.y === 'number' ? component.y : 0;
  const style = AGENT_VISUAL_STYLES[component.visualState] ?? FALLBACK_STYLE;
  const spriteFilename = spriteForComponent(component);
  const spriteImage = loadedAssets[spriteFilename];

  const sizes   = (component.deskId && DESK_SPRITE_SIZES[component.deskId])
    ? DESK_SPRITE_SIZES[component.deskId]
    : { w: AGENT_W, h: AGENT_H };
  const offsets = (component.deskId && DESK_SPRITE_OFFSETS[component.deskId])
    ? DESK_SPRITE_OFFSETS[component.deskId]
    : { dx: 0, dy: 0 };

  if (spriteImage) {
    ctx.drawImage(spriteImage,
      x - sizes.w / 2 + offsets.dx,
      y - sizes.h / 2 + offsets.dy,
      sizes.w, sizes.h);
  } else {
    // Keep geometry fallback while images are still loading.
    ctx.beginPath();
    ctx.arc(x, y, style.radius, 0, Math.PI * 2);
    ctx.fillStyle   = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth   = 2;
    ctx.fill();
    ctx.stroke();
  }

  // Anomaly ring — drawn over the body when anomaly is present
  if (component.anomaly) {
    ctx.beginPath();
    ctx.arc(x, y, style.radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = component.anomaly.severity === 'high' ? '#d32f2f' : '#f57c00';
    ctx.lineWidth   = 2;
    ctx.stroke();
  }

  // Name tag — always shown above the sprite (follows composition offset so it
  // centres over the actual sprite rather than the raw anchor point)
  if (component.id) {
    const tagX = x + offsets.dx;
    const tagY = y - sizes.h / 2 + offsets.dy - 4;
    ctx.font         = 'bold 9px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle    = 'rgba(0,0,0,0.55)';
    const metrics    = ctx.measureText(component.id);
    const pad        = 3;
    ctx.fillRect(tagX - metrics.width / 2 - pad, tagY - 11, metrics.width + pad * 2, 13);
    ctx.fillStyle = '#e8d8b0';
    ctx.fillText(component.id, tagX, tagY);
  }

  // Debug-only filename label for seat calibration.
  const isRenderDebug = typeof window !== 'undefined' &&
    (window.__SLOTHWORLD_RENDER_DEBUG__ === true ||
      (() => { try { return new URLSearchParams(window.location.search).has('renderDebug'); } catch (_) { return false; } })());
  if (isRenderDebug) {
    const label = spriteFilename.replace('.png', '');
    ctx.font      = '8px monospace';
    ctx.fillStyle = style.stroke;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + style.radius + 10);
  }
}

/**
 * Draw all agent-sprite components from a component list onto a canvas context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components  Output of toRenderableComponents()
 */
export function renderAllAgentEntities(ctx, components, entityPositions) {
  if (!ctx || !Array.isArray(components)) return;
  for (const c of components) {
    if (c && c.componentType === 'agent-sprite') {
      const p = entityPositions && entityPositions.get(c.id);
      renderAgentEntity(ctx, p ? { ...c, x: p.x, y: p.y } : c);
    }
  }
}
