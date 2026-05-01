/**
 * agentSelectorsGuard.js
 *
 * Wraps getAgentState with contract enforcement.
 * Catches: task-status vocabulary terms appearing in agent state output.
 * Catches: non-empty task list producing 'idle' incorrectly.
 */

import { getAgentState as _getAgentState, getAgentTasks } from '../../ui/selectors/agentSelectors.js';
import { validate, runInvariants } from '../contractRegistry.js';

const STRICT = process.env.CONTRACT_STRICT_MODE === '1';

/**
 * Contract-guarded getAgentState.
 * @param {IndexedWorld} indexedWorld
 * @param {string}       workerId
 * @returns {string}
 */
export function getAgentState(indexedWorld, workerId) {
  const input  = { indexedWorld, workerId };
  const output = _getAgentState(indexedWorld, workerId);

  const agentTaskIds = getAgentTasks(indexedWorld, workerId);

  const vr = validate('agentSelectors.getAgentState', input, output);
  const ir = runInvariants('agentSelectors.getAgentState', {
    input,
    output,
    agentTaskIds
  });

  if ((!vr.valid || !ir.passed) && STRICT) {
    const allErrors = [
      ...vr.errors,
      ...ir.failures.map((f) => `[${f.id}] ${f.error}`)
    ];
    throw new Error(`CONTRACT_GUARD_FAILURE:agentSelectors.getAgentState\n${allErrors.join('\n')}`);
  }

  return output;
}
