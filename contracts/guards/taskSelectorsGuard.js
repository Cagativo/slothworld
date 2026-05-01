/**
 * taskSelectorsGuard.js
 *
 * Wraps getTaskStatus with contract enforcement.
 * Key violation caught: output === 'acknowledged' (engine term leaking into selector output).
 * Key invariant: output never equals 'acknowledged'.
 */

import { getTaskStatus as _getTaskStatus } from '../../ui/selectors/taskSelectors.js';
import { validate, runInvariants, TAXONOMY_CTX } from '../contractRegistry.js';

const STRICT = process.env.CONTRACT_STRICT_MODE === '1';

/**
 * Contract-guarded getTaskStatus.
 * @param {IndexedWorld} indexedWorld
 * @param {string}       taskId
 * @returns {string}
 */
export function getTaskStatus(indexedWorld, taskId) {
  const input  = { indexedWorld, taskId };
  const output = _getTaskStatus(indexedWorld, taskId);

  // Collect task events for invariant context
  let taskEvents = [];
  if (indexedWorld && indexedWorld.eventsByTaskId instanceof Map) {
    taskEvents = indexedWorld.eventsByTaskId.get(String(taskId)) || [];
  }

  const vr = validate('taskSelectors.getTaskStatus', input, output);
  const ir = runInvariants('taskSelectors.getTaskStatus', {
    input,
    output,
    taskEvents,
    ...TAXONOMY_CTX
  });

  if ((!vr.valid || !ir.passed) && STRICT) {
    const allErrors = [
      ...vr.errors,
      ...ir.failures.map((f) => `[${f.id}] ${f.error}`)
    ];
    throw new Error(`CONTRACT_GUARD_FAILURE:taskSelectors.getTaskStatus\n${allErrors.join('\n')}`);
  }

  return output;
}
