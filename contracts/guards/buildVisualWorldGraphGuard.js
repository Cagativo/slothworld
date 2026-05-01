/**
 * buildVisualWorldGraphGuard.js
 *
 * Wraps buildVisualWorldGraph with contract enforcement.
 * Catches: raw IndexedWorld passed directly as input (events/eventsByTaskId fields present).
 * Catches: node count mismatch vs tasks.length + agents.length.
 * Catches: node type outside closed enum.
 * Catches: observability.enabled=false with non-empty byTaskId.
 */

import { buildVisualWorldGraph as _buildVisualWorldGraph } from '../../core/world/buildVisualWorldGraph.js';
import { validate, runInvariants } from '../contractRegistry.js';

const STRICT = process.env.CONTRACT_STRICT_MODE === '1';

// Detect if caller passed raw IndexedWorld — most common misuse pattern.
function assertNotRawIndexedWorld(input) {
  const INDEXED_WORLD_KEYS = ['events', 'eventsByTaskId', 'eventsByWorkerId'];
  const present = INDEXED_WORLD_KEYS.filter((k) => k in input);
  if (present.length > 0) {
    const msg = `CONTRACT_GUARD_FAILURE:buildVisualWorldGraph:RAW_INDEXED_WORLD_DETECTED — forbidden keys present: ${present.join(', ')}`;
    if (STRICT) throw new Error(msg);
    return msg;
  }
  return null;
}

/**
 * Contract-guarded buildVisualWorldGraph.
 * @param {object} input    — must be pre-computed selector output, not raw IndexedWorld
 * @param {object} options
 * @returns {VisualWorldGraph}
 */
export function buildVisualWorldGraph(input, options = {}) {
  // Pre-call: catch raw IndexedWorld before execution
  const rawWorldError = assertNotRawIndexedWorld(input);

  const output = _buildVisualWorldGraph(input, options);

  // Normalize observability.byTaskId for schema validation (Map → object)
  const outputForValidation = {
    nodes:    output.nodes,
    edges:    output.edges,
    metadata: output.metadata,
    observability: {
      enabled:  output.observability.enabled,
      byTaskId: output.observability.byTaskId instanceof Map
        ? Object.fromEntries(output.observability.byTaskId)
        : (output.observability.byTaskId || {})
    }
  };

  const vr = validate('buildVisualWorldGraph', input, outputForValidation);
  const ir = runInvariants('buildVisualWorldGraph', {
    input,
    output: outputForValidation
  });

  const allErrors = [
    ...(rawWorldError ? [rawWorldError] : []),
    ...vr.errors,
    ...ir.failures.map((f) => `[${f.id}] ${f.error}`)
  ];

  const failed = allErrors.length > 0;
  if (failed && STRICT) {
    throw new Error(`CONTRACT_GUARD_FAILURE:buildVisualWorldGraph\n${allErrors.join('\n')}`);
  }

  return output;
}
