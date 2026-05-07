/**
 * debug.js
 *
 * Rendering debug helpers — URL flag detection and mouse pointer tracking.
 *
 * CONTRACT:
 *  - Read-only: does not mutate any render state or dispatch any actions
 *  - DOM access is guarded by typeof window checks for headless compatibility
 */

let debugBindingsAttached = false;

function getCanvasElement() {
  if (typeof document === 'undefined') {
    return null;
  }
  return document.getElementById('game');
}

/**
 * Tracks pointer position inside the canvas for hover-based debug overlays.
 * Updated by ensureDebugBindings() event listeners.
 *
 * @type {{ x: number|null, y: number|null, inside: boolean }}
 */
export const debugPointer = {
  x: null,
  y: null,
  inside: false,
};

/**
 * Returns true when the ?renderDebug URL parameter is present or when the
 * global flag window.__SLOTHWORLD_RENDER_DEBUG__ is set to true.
 *
 * @returns {boolean}
 */
export function isRenderDebugEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }

  if (window.__SLOTHWORLD_RENDER_DEBUG__ === true) {
    return true;
  }

  try {
    return new URLSearchParams(window.location.search).has('renderDebug');
  } catch (_error) {
    return false;
  }
}

/**
 * Returns true when boot-time render tracing is explicitly enabled.
 *
 * Enable in DevTools before refresh with either:
 *   window.__SLOTHWORLD_TRACE_RENDER_BOOT__ = true
 *   localStorage.setItem('slothworld.traceRenderBoot', '1')
 *
 * @returns {boolean}
 */
export function isRenderBootTraceEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }

  if (window.__SLOTHWORLD_TRACE_RENDER_BOOT__ === true) {
    return true;
  }

  try {
    return window.localStorage?.getItem('slothworld.traceRenderBoot') === '1';
  } catch (_error) {
    return false;
  }
}

function canvasSizeFrom(details) {
  if (details && details.canvasSize) {
    return details.canvasSize;
  }
  const canvasFromContext = details && details.ctx && details.ctx.canvas;
  if (canvasFromContext) {
    return {
      width: canvasFromContext.width,
      height: canvasFromContext.height,
    };
  }
  const canvas = getCanvasElement();
  if (canvas) {
    return {
      width: canvas.width,
      height: canvas.height,
    };
  }
  return null;
}

/**
 * Gated boot render trace logger. Does nothing unless isRenderBootTraceEnabled().
 *
 * @param {string} pathName
 * @param {object} [details]
 */
export function traceRenderBoot(pathName, details = {}) {
  if (!isRenderBootTraceEnabled()) {
    return;
  }

  const { ctx, ...rest } = details || {};
  const payload = {
    path: pathName,
    timestamp: Date.now(),
    performanceNow: typeof performance !== 'undefined' ? Number(performance.now().toFixed(2)) : null,
    canvasSize: canvasSizeFrom(details),
    ...rest,
  };

  console.log('[Slothworld render boot trace]', payload);
  void ctx;
}

/**
 * Attaches mousemove / mouseenter / mouseleave listeners to the canvas so
 * that debugPointer tracks the scaled canvas-coordinate cursor position.
 *
 * Safe to call multiple times — listeners are attached at most once.
 */
export function ensureDebugBindings() {
  const canvas = getCanvasElement();
  if (debugBindingsAttached || typeof window === 'undefined' || !canvas) {
    return;
  }

  const updatePointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    debugPointer.x = (event.clientX - rect.left) * scaleX;
    debugPointer.y = (event.clientY - rect.top) * scaleY;
    debugPointer.inside = true;
  };

  canvas.addEventListener('mousemove', updatePointer);
  canvas.addEventListener('mouseenter', updatePointer);
  canvas.addEventListener('mouseleave', () => {
    debugPointer.inside = false;
    debugPointer.x = null;
    debugPointer.y = null;
  });

  debugBindingsAttached = true;
}
