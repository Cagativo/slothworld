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
import {
  spriteConfigs,
  TASK_STATUS_FAILED,
  TASK_STATUS_AWAITING_ACK,
  AGENT_STATE_WORKING,
} from '../core/constants.js';
import { hashString } from '../core/utils.js';
import { isRenderDebugEnabled, debugPointer } from './debug.js';
import { compareByDepthY } from './scene-anchors.js';

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
  working:     Object.freeze({ fill: '#00b8a9', stroke: '#006b62', radius: 10, label: 'WORK' }),
  processing:  Object.freeze({ fill: '#7ec8c8', stroke: '#007b7b', radius: 10, label: 'PROC' }),
  completed:   Object.freeze({ fill: '#4caf50', stroke: '#1b5e20', radius: 10, label: 'DONE' }),
  error:       Object.freeze({ fill: '#e53935', stroke: '#7f0000', radius: 10, label: 'ERR'  }),
  unknown:     Object.freeze({ fill: '#8d7b68', stroke: '#5c4a36', radius: 10, label: '?'    }),
});

/** Fallback style used when visualState is not in AGENT_VISUAL_STYLES. */
const FALLBACK_STYLE = AGENT_VISUAL_STYLES.unknown;


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

  return ASSET_MAPPING.agents.base;
}

export function shouldRenderAgentComponent(component, options = {}) {
  if (!component) return false;
  if (options.debug === true) return true;
  if (options.bakedBackground !== true) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Sprite sheet helpers
// ---------------------------------------------------------------------------

/**
 * Maps a lifecycle status string to a representative canvas colour.
 * Used for error-state rings and name-tag backgrounds.
 *
 * @param {string} status
 * @returns {string}
 */
export function statusColor(status) {
  const key = String(status || '').toLowerCase();

  if (key === TASK_STATUS_FAILED || key === 'error') {
    return '#e53935';
  }

  if (key === 'acknowledged' || key === 'completed') {
    return '#4caf50';
  }

  if (key === TASK_STATUS_AWAITING_ACK) {
    return '#ffb300';
  }

  if (key === AGENT_STATE_WORKING || key === 'executing' || key === 'claimed') {
    return '#00b8a9';
  }

  return '#8fbc8f';
}

/**
 * Calculate the source rectangle and frame index for a sprite sheet animation.
 *
 * @param {object} visual  Animation descriptor from resolveAgentVisual()
 * @param {HTMLImageElement} spriteImage
 * @param {number} frameNow  Current timestamp in ms (e.g. Date.now())
 * @param {string} agentId   Used to stagger per-agent frame offset
 * @returns {{ sourceX, sourceY, sourceWidth, sourceHeight, frameIndex, frameCount }}
 */
export function resolveSpriteFrame(visual, spriteImage, frameNow, agentId) {
  const imageWidth = spriteImage && Number.isFinite(spriteImage.naturalWidth) ? spriteImage.naturalWidth : spriteImage.width;
  const imageHeight = spriteImage && Number.isFinite(spriteImage.naturalHeight) ? spriteImage.naturalHeight : spriteImage.height;
  const frameWidth = Number.isFinite(visual && visual.frameWidth) ? visual.frameWidth : imageWidth;
  const frameHeight = Number.isFinite(visual && visual.frameHeight) ? visual.frameHeight : imageHeight;
  const frameCount = Math.max(1, Number.isFinite(visual && visual.frameCount) ? visual.frameCount : Math.floor(imageWidth / frameWidth) || 1);
  const fps = Number.isFinite(visual && visual.fps) && visual.fps > 0
    ? visual.fps
    : 5;
  const frameDurationMs = Math.max(1, Math.round(1000 / fps));
  const loop = !(visual && visual.loop === false);
  const elapsed = Math.max(0, frameNow + hashString(agentId) * 17);
  const frameNumber = frameCount <= 1 ? 0 : Math.floor(elapsed / frameDurationMs);
  const frameIndex = frameCount <= 1
    ? 0
    : (loop ? frameNumber % frameCount : Math.min(frameCount - 1, frameNumber));

  return {
    sourceX: frameIndex * frameWidth,
    sourceY: 0,
    sourceWidth: frameWidth,
    sourceHeight: frameHeight,
    frameIndex,
    frameCount,
  };
}

/**
 * Scale a sprite frame to the configured agent target height.
 *
 * @param {{ sourceWidth: number, sourceHeight: number }} frame  From resolveSpriteFrame()
 * @returns {{ width: number, height: number, scale: number }}
 */
export function resolveSpriteDrawSize(frame) {
  const targetHeight = spriteConfigs && spriteConfigs.agent && Number.isFinite(spriteConfigs.agent.height)
    ? spriteConfigs.agent.height
    : 54;
  const scale = frame && Number.isFinite(frame.sourceHeight) && frame.sourceHeight > 0
    ? targetHeight / frame.sourceHeight
    : 1;

  return {
    width: (frame && Number.isFinite(frame.sourceWidth) ? frame.sourceWidth : targetHeight) * scale,
    height: targetHeight,
    scale,
  };
}

/**
 * Draw a debug bounding box and optional hover label over a sprite.
 * Only draws when ?renderDebug is active.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {{ width: number, height: number }} drawSize
 * @param {{ sourceWidth: number, sourceHeight: number, frameIndex: number, frameCount: number }} frame
 * @param {boolean} hovered
 */
export function drawSpriteDebugOverlay(ctx, x, y, drawSize, frame, hovered) {
  if (!isRenderDebugEnabled()) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = hovered ? 'rgba(251, 191, 36, 0.95)' : 'rgba(56, 189, 248, 0.85)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - drawSize.width / 2, y - drawSize.height, drawSize.width, drawSize.height);

  ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fill();

  if (hovered) {
    const label = `${frame.sourceWidth}x${frame.sourceHeight} f${frame.frameIndex + 1}/${frame.frameCount}`;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(x - 36, y - drawSize.height - 16, 72, 12);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - drawSize.height - 7);
  }
  ctx.restore();
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
 * @param {number} [frameNow]  Current timestamp in ms for sprite animation (optional)
 */
export function renderAgentEntity(ctx, component, frameNow, options = {}) {
  if (!ctx || !component) return;
  if (!shouldRenderAgentComponent(component, {
    ...options,
    debug: options.debug === true || isRenderDebugEnabled(),
  })) return;

  const x     = typeof component.x === 'number' ? component.x : 0;
  const y     = typeof component.y === 'number' ? component.y : 0;
  const style = AGENT_VISUAL_STYLES[component.visualState] ?? FALLBACK_STYLE;
  const spriteFilename = spriteForComponent(component);
  const spriteImage = loadedAssets[spriteFilename];

  const sizes   = (component.deskId && DESK_SPRITE_SIZES[component.deskId])
    ? DESK_SPRITE_SIZES[component.deskId]
    : null;
  const offsets = (component.deskId && DESK_SPRITE_OFFSETS[component.deskId])
    ? DESK_SPRITE_OFFSETS[component.deskId]
    : { dx: 0, dy: 0 };
  const anchorScale = Number.isFinite(component.scale) && component.scale > 0 ? component.scale : 1;

  if (spriteImage) {
    if (sizes) {
      // Desk sprite — fixed dimensions, no frame animation.
      const drawW = sizes.w * anchorScale;
      const drawH = sizes.h * anchorScale;
      const drawDx = offsets.dx * anchorScale;
      const drawDy = offsets.dy * anchorScale;
      ctx.drawImage(spriteImage,
        x - drawW / 2 + drawDx,
        y - drawH / 2 + drawDy,
        drawW, drawH);

      if (isRenderDebugEnabled()) {
        const label = `${spriteFilename.replace('.png', '')} @${anchorScale.toFixed(2)}`;
        ctx.font      = '8px monospace';
        ctx.fillStyle = style.stroke;
        ctx.textAlign = 'center';
        ctx.fillText(label, x, y + style.radius + 10);
      }
    } else {
      // Non-desk sprite path — use frame calculation so sprite sheets animate correctly.
      // Passing null as the visual descriptor causes resolveSpriteFrame to use the full
      // image dimensions as a single-frame fallback (frameCount=1, fps=5).
      // Future: pass resolveAgentVisual(component.visualState) here once visual configs
      // are propagated through the component descriptor.
      const now   = typeof frameNow === 'number' ? frameNow : Date.now();
      const frame = resolveSpriteFrame(null, spriteImage, now, component.id);
      const baseDrawSize = resolveSpriteDrawSize(frame);
      const drawSize = {
        width: baseDrawSize.width * anchorScale,
        height: baseDrawSize.height * anchorScale,
        scale: baseDrawSize.scale * anchorScale,
      };

      const isHovered = debugPointer.inside
        && Number.isFinite(debugPointer.x)
        && Number.isFinite(debugPointer.y)
        && debugPointer.x >= x - drawSize.width / 2
        && debugPointer.x <= x + drawSize.width / 2
        && debugPointer.y >= y - drawSize.height
        && debugPointer.y <= y;

      ctx.drawImage(
        spriteImage,
        frame.sourceX,
        frame.sourceY,
        frame.sourceWidth,
        frame.sourceHeight,
        x - drawSize.width / 2,
        y - drawSize.height,
        drawSize.width,
        drawSize.height
      );

      drawSpriteDebugOverlay(ctx, x, y, drawSize, frame, isHovered);
    }
  } else {
    // Keep geometry fallback while images are still loading.
    ctx.beginPath();
    ctx.arc(x, y, style.radius * anchorScale, 0, Math.PI * 2);
    ctx.fillStyle   = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth   = 2;
    ctx.fill();
    ctx.stroke();
  }

  // Anomaly ring — drawn over the body when anomaly is present
  if (component.anomaly) {
    ctx.beginPath();
    ctx.arc(x, y, style.radius * anchorScale + 4, 0, Math.PI * 2);
    ctx.strokeStyle = component.anomaly.severity === 'high' ? '#d32f2f' : '#f57c00';
    ctx.lineWidth   = 2;
    ctx.stroke();
  }

  // Nameplate badge — warm parchment plaque above the sprite.
  // Visual convention (Themed World Projection): rounded badge with amber border
  // and warm cream text, replacing the plain debug-style dark rectangle.
  if (component.id) {
    const isDebugMode = isRenderDebugEnabled();
    const tagOffsetDx = offsets.dx * anchorScale;
    const tagOffsetDy = offsets.dy * anchorScale;
    const tagH  = (sizes ? sizes.h : (spriteConfigs?.agent?.height ?? 54)) * anchorScale;
    const tagX  = x + tagOffsetDx;
    const tagY  = y - tagH / 2 + tagOffsetDy - 6;

    ctx.save();
    ctx.font = 'bold 9px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';

    const labelText = isDebugMode ? component.id : '';
    const textW = isDebugMode ? ctx.measureText(labelText).width : 12;
    const padX  = 4;
    const padY  = 2;
    const bw    = textW + padX * 2;
    const bh    = isDebugMode ? 11 + padY * 2 : 5;
    const bx    = tagX - bw / 2;
    const by    = tagY - bh;
    const cr    = 3;

    // Badge background — warm dark parchment
    ctx.beginPath();
    ctx.moveTo(bx + cr, by);
    ctx.lineTo(bx + bw - cr, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + cr);
    ctx.lineTo(bx + bw, by + bh - cr);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - cr, by + bh);
    ctx.lineTo(bx + cr, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - cr);
    ctx.lineTo(bx, by + cr);
    ctx.quadraticCurveTo(bx, by, bx + cr, by);
    ctx.closePath();
    ctx.fillStyle = isDebugMode ? 'rgba(26, 14, 4, 0.82)' : 'rgba(26, 14, 4, 0.32)';
    ctx.fill();

    // Badge border — amber-brown accent
    ctx.beginPath();
    ctx.moveTo(bx + cr, by);
    ctx.lineTo(bx + bw - cr, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + cr);
    ctx.lineTo(bx + bw, by + bh - cr);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - cr, by + bh);
    ctx.lineTo(bx + cr, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - cr);
    ctx.lineTo(bx, by + cr);
    ctx.quadraticCurveTo(bx, by, bx + cr, by);
    ctx.closePath();
    ctx.strokeStyle = component.anomaly
      ? (isDebugMode ? '#d07030' : 'rgba(208, 112, 48, 0.38)')
      : (isDebugMode ? '#8a6030' : 'rgba(138, 96, 48, 0.28)');
    ctx.lineWidth   = isDebugMode ? 0.8 : 0.5;
    ctx.stroke();

    // Agent ID text — warm cream
    if (isDebugMode) {
      ctx.fillStyle = '#e8d8b0';
      ctx.fillText(labelText, tagX, tagY);
    }

    ctx.restore();
  }
}

/**
 * Draw all agent-sprite components from a component list onto a canvas context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} components  Output of toRenderableComponents()
 * @param {number} [frameNow]  Current timestamp in ms for sprite animation (optional)
 */
export function renderAllAgentEntities(ctx, components, entityPositions, frameNow, options = {}) {
  if (!ctx || !Array.isArray(components)) return;
  const agents = components
    .filter((c) => c && c.componentType === 'agent-sprite')
    .map((c) => {
      const p = entityPositions && entityPositions.get(c.id);
      return p ? { ...c, ...p } : c;
    })
    .sort(compareByDepthY);

  for (const c of agents) {
    renderAgentEntity(ctx, c, frameNow, options);
  }
}
