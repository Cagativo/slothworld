/**
 * debug.js
 *
 * Rendering debug helpers — URL flag detection and mouse pointer tracking.
 *
 * CONTRACT:
 *  - Read-only: does not mutate any render state or dispatch any actions
 *  - DOM access is guarded by typeof window checks for headless compatibility
 */

import { canvas } from '../core/app-state.js';

let debugBindingsAttached = false;

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
 * Attaches mousemove / mouseenter / mouseleave listeners to the canvas so
 * that debugPointer tracks the scaled canvas-coordinate cursor position.
 *
 * Safe to call multiple times — listeners are attached at most once.
 */
export function ensureDebugBindings() {
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
