/**
 * render-guards.js
 *
 * Input contract enforcement for the rendering pipeline.
 *
 * CONTRACT:
 *  - assertGraphShape(view) must be called at the start of every render
 *    entry point that accepts a VisualWorldGraph argument.
 *  - This module is pure: no DOM, no canvas, no side effects.
 *
 * Usage:
 *   import { assertGraphShape } from './render-guards.js';
 *   assertGraphShape(renderView); // throws TypeError on invalid input
 */

/**
 * The only keys render() will accept on its argument.
 * Any key outside this set indicates a selector output, raw event payload,
 * or mixed data source — all of which must be rejected.
 */
export const ALLOWED_RENDER_VIEW_KEYS = new Set(['nodes', 'edges', 'metadata']);

/**
 * Selector-domain and event-domain keys that indicate a caller is passing the
 * wrong object to render().  Listed explicitly so error messages are specific.
 */
export const FORBIDDEN_RENDER_VIEW_KEYS = new Set([
  // selector / derived-world-state keys
  'tasks', 'agents', 'desks', 'workflows', 'counts', 'incidents',
  'officeLayout', 'transitionByTaskId', 'taskRouteByTaskId',
  'taskVisualTargetByTaskId', 'observability', 'entities',
  // raw event keys
  'events', 'eventsByTaskId', 'eventsByWorkerId', 'rawEvents',
  'payload', 'taskId', 'workerId',
]);

/**
 * Assert that the value passed to render() is a pure VisualWorldGraph —
 * an object containing only { nodes, edges, metadata }.
 *
 * Throws TypeError immediately if any forbidden or unrecognised key is present.
 * Null / undefined are allowed (render() degrades gracefully to an empty view).
 *
 * @param {unknown} view
 */
export function assertGraphShape(view) {
  if (view == null) {
    return; // null / undefined — handled downstream by the safeView fallback
  }

  if (typeof view !== 'object' || Array.isArray(view)) {
    throw new TypeError(
      `render() expects a VisualWorldGraph ({ nodes, edges, metadata }) but received ${Array.isArray(view) ? 'an Array' : typeof view}.`
    );
  }

  const keys = Object.keys(view);

  // Fast path: check known-bad keys first so the error message is specific.
  const forbidden = keys.filter((k) => FORBIDDEN_RENDER_VIEW_KEYS.has(k));
  if (forbidden.length > 0) {
    throw new TypeError(
      `render() received forbidden key(s): [${forbidden.join(', ')}]. ` +
      'Do not pass selector output, event data, or mixed data sources. ' +
      'Only { nodes, edges, metadata } are accepted.'
    );
  }

  // Reject any unrecognised key — also indicates a mixed source.
  const unknown = keys.filter((k) => !ALLOWED_RENDER_VIEW_KEYS.has(k));
  if (unknown.length > 0) {
    throw new TypeError(
      `render() received unrecognised key(s): [${unknown.join(', ')}]. ` +
      'Only { nodes, edges, metadata } are accepted.'
    );
  }
}
