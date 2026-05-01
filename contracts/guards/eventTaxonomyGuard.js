/**
 * eventTaxonomyGuard.js
 *
 * Wraps isLifecycleEvent and isSystemEvent with contract enforcement.
 * Intercepts input/output, validates schema, runs invariants, throws in STRICT mode.
 */

import { isLifecycleEvent as _isLifecycleEvent, isSystemEvent as _isSystemEvent } from '../../core/world/eventTaxonomy.js';
import { validate, runInvariants } from '../contractRegistry.js';

const STRICT = process.env.CONTRACT_STRICT_MODE === '1';

function enforceContract(contractName, input, output, extraCtx = {}) {
  const vr = validate(contractName, input, output);
  const ir = runInvariants(contractName, { input, output, ...extraCtx });

  if ((!vr.valid || !ir.passed) && STRICT) {
    const allErrors = [
      ...vr.errors,
      ...ir.failures.map((f) => `[${f.id}] ${f.error}`)
    ];
    throw new Error(`CONTRACT_GUARD_FAILURE:${contractName}\n${allErrors.join('\n')}`);
  }

  return { validationResult: vr, invariantResult: ir };
}

/**
 * Contract-guarded isLifecycleEvent.
 * @param {string} type
 * @returns {boolean}
 */
export function isLifecycleEvent(type) {
  const input  = { type };
  const output = _isLifecycleEvent(type);
  enforceContract('eventTaxonomy.isLifecycleEvent', input, output);
  return output;
}

/**
 * Contract-guarded isSystemEvent.
 * @param {string} type
 * @returns {boolean}
 */
export function isSystemEvent(type) {
  const input  = { type };
  const output = _isSystemEvent(type);
  enforceContract('eventTaxonomy.isSystemEvent', input, output);
  return output;
}
