/**
 * anomalySelectorsGuard.js
 *
 * Wraps getIncidentClusters with contract enforcement.
 * Catches: wrong cluster count, wrong cluster ordering, out-of-enum severity/type values.
 * Catches: representativeEvents exceeding 5 items.
 */

import { getIncidentClusters as _getIncidentClusters } from '../../ui/selectors/anomalySelectors.js';
import { validate, runInvariants } from '../contractRegistry.js';

const STRICT = process.env.CONTRACT_STRICT_MODE === '1';

/**
 * Contract-guarded getIncidentClusters.
 * @param {IndexedWorld} indexedWorld
 * @param {object}       options
 * @returns {IncidentCluster[]}
 */
export function getIncidentClusters(indexedWorld, options = {}) {
  const input  = { indexedWorld, options };
  const output = _getIncidentClusters(indexedWorld, options);

  const includeSystemEvents = options.includeSystemEvents !== false;

  const vr = validate('anomalySelectors.getIncidentClusters', input, output);
  const ir = runInvariants('anomalySelectors.getIncidentClusters', {
    input,
    output,
    includeSystemEvents
  });

  if ((!vr.valid || !ir.passed) && STRICT) {
    const allErrors = [
      ...vr.errors,
      ...ir.failures.map((f) => `[${f.id}] ${f.error}`)
    ];
    throw new Error(`CONTRACT_GUARD_FAILURE:anomalySelectors.getIncidentClusters\n${allErrors.join('\n')}`);
  }

  return output;
}
