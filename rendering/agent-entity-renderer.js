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

  // Body circle
  ctx.beginPath();
  ctx.arc(x, y, style.radius, 0, Math.PI * 2);
  ctx.fillStyle   = style.fill;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth   = 2;
  ctx.fill();
  ctx.stroke();

  // Anomaly ring — drawn over the body when anomaly is present
  if (component.anomaly) {
    ctx.beginPath();
    ctx.arc(x, y, style.radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = component.anomaly.severity === 'high' ? '#d32f2f' : '#f57c00';
    ctx.lineWidth   = 2;
    ctx.stroke();
  }

  // State label — small text centred below the circle
  ctx.font      = '8px monospace';
  ctx.fillStyle = style.stroke;
  ctx.textAlign = 'center';
  ctx.fillText(style.label, x, y + style.radius + 10);
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
