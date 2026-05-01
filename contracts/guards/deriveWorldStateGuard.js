/**
 * deriveWorldStateGuard.js
 *
 * Wraps deriveWorldState with contract enforcement.
 * Validates: output has exactly { events, eventsByTaskId, eventsByWorkerId }.
 * Validates: events are sorted ASC by timestamp.
 * Validates: no semantic fields leak into output.
 */

import { deriveWorldState as _deriveWorldState } from '../../core/world/deriveWorldState.js';
import { validate, runInvariants } from '../contractRegistry.js';

const STRICT = process.env.CONTRACT_STRICT_MODE === '1';

/**
 * Contract-guarded deriveWorldState.
 * @param {EventRecord[]} events
 * @returns {IndexedWorld}
 */
export function deriveWorldState(events) {
  const input        = { events: Array.isArray(events) ? events : [] };
  const output       = _deriveWorldState(events);
  const originalInput = events;

  // Normalize Map → plain object for schema validation
  const outputForValidation = {
    events:           output.events,
    eventsByTaskId:   output.eventsByTaskId instanceof Map ? Object.fromEntries(output.eventsByTaskId) : output.eventsByTaskId,
    eventsByWorkerId: output.eventsByWorkerId instanceof Map ? Object.fromEntries(output.eventsByWorkerId) : output.eventsByWorkerId
  };

  const vr = validate('deriveWorldState', input, outputForValidation);
  const ir = runInvariants('deriveWorldState', {
    input,
    output,   // pass real output (with Maps) to invariants
    originalInput
  });

  if ((!vr.valid || !ir.passed) && STRICT) {
    const allErrors = [
      ...vr.errors,
      ...ir.failures.map((f) => `[${f.id}] ${f.error}`)
    ];
    throw new Error(`CONTRACT_GUARD_FAILURE:deriveWorldState\n${allErrors.join('\n')}`);
  }

  return output;
}
