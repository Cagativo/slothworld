/**
 * contractRegistry.js
 *
 * Loads all contracts from schema.json.
 * Exposes:
 *   validate(contractName, input, output)  → { valid: boolean, errors: string[] }
 *   runInvariants(contractName, context)   → { passed: boolean, failures: InvariantFailure[] }
 *
 * CONTRACT_STRICT_MODE=1 → validate() and runInvariants() throw on failure.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const STRICT = process.env.CONTRACT_STRICT_MODE === '1';

// ─── Schema loader ────────────────────────────────────────────────────────────

const schemaPath = join(__dirname, 'schema.json');
const rawContracts = JSON.parse(readFileSync(schemaPath, 'utf8'));

/** @type {Map<string, ContractDef>} */
const registry = new Map();

for (const def of rawContracts) {
  registry.set(def.name, def);
}

// ─── Invariant compiler ───────────────────────────────────────────────────────

const compiledInvariants = new Map();

for (const def of rawContracts) {
  const fns = def.invariants.map((inv) => {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('input', 'output', 'ctx', inv.expression);
      return { id: inv.id, fn };
    } catch (err) {
      throw new Error(`CONTRACT_COMPILE_ERROR:${def.name}:${inv.id}: ${err.message}`);
    }
  });
  compiledInvariants.set(def.name, fns);
}

// ─── Lightweight JSON Schema validator ───────────────────────────────────────

function typeCheck(value, schema, path) {
  const errors = [];

  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type) {
    switch (schema.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push(`${path}: expected string, got ${typeof value}`);
        } else {
          if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
            errors.push(`${path}: string length ${value.length} < minLength ${schema.minLength}`);
          }
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`${path}: expected boolean, got ${typeof value}`);
        }
        break;

      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`${path}: expected finite number, got ${typeof value}`);
        }
        break;

      case 'array':
        if (!Array.isArray(value)) {
          errors.push(`${path}: expected array, got ${typeof value}`);
        } else if (schema.items) {
          value.forEach((item, i) => {
            errors.push(...typeCheck(item, schema.items, `${path}[${i}]`));
          });
        }
        break;

      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          errors.push(`${path}: expected object, got ${Array.isArray(value) ? 'array' : typeof value}`);
        } else {
          if (schema.required) {
            for (const req of schema.required) {
              if (!(req in value)) {
                errors.push(`${path}: missing required field "${req}"`);
              }
            }
          }
          if (schema.properties) {
            for (const [key, propSchema] of Object.entries(schema.properties)) {
              if (key in value) {
                errors.push(...typeCheck(value[key], propSchema, `${path}.${key}`));
              }
            }
          }
          if (schema.additionalProperties === false && schema.properties) {
            const allowed = new Set(Object.keys(schema.properties));
            for (const key of Object.keys(value)) {
              if (!allowed.has(key)) {
                errors.push(`${path}: additional property "${key}" not allowed`);
              }
            }
          }
        }
        break;

      default:
        break;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  return errors;
}

// ─── Context builder ──────────────────────────────────────────────────────────

export const TAXONOMY_CTX = Object.freeze({
  LIFECYCLE_EVENTS: Object.freeze([
    'TASK_CREATED',
    'TASK_ENQUEUED',
    'TASK_CLAIMED',
    'TASK_EXECUTE_STARTED',
    'TASK_EXECUTE_FINISHED',
    'TASK_ACKED',
    'TASK_REQUEUED',
    'TASK_EXECUTE_SKIPPED_IDEMPOTENT',
    'TASK_ACK_SIDE_EFFECT_FAILED'
  ]),
  SYSTEM_EVENTS: Object.freeze([
    'TASK_NOTIFICATION_SENT',
    'TASK_NOTIFICATION_SKIPPED',
    'TASK_NOTIFICATION_FAILED'
  ]),
  AGENT_EVENTS: Object.freeze([
    'AGENT_SPAWNED',
    'AGENT_ASSIGNED_IDLE'
  ]),
  UNREGISTERED_EVENTS: Object.freeze([
    // empty — TASK_REQUEUED, TASK_EXECUTE_SKIPPED_IDEMPOTENT, and TASK_ACK_SIDE_EFFECT_FAILED moved to LIFECYCLE_EVENTS
  ]),
  TASK_STATUS_ENUM: Object.freeze([
    'unknown', 'created', 'queued', 'claimed',
    'executing', 'awaiting_ack', 'completed', 'failed'
  ]),
  AGENT_STATE_ENUM: Object.freeze(['idle', 'moving', 'working', 'delivering', 'error']),
  SEVERITY_ENUM:     Object.freeze(['low', 'medium', 'high']),
  CLUSTER_TYPE_ENUM: Object.freeze(['execution_failures', 'notification_issues', 'stalled_tasks'])
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve a contract definition by name.
 * @param {string} name
 * @returns {ContractDef | undefined}
 */
export function getContract(name) {
  return registry.get(name);
}

/**
 * List all registered contract names.
 * @returns {string[]}
 */
export function listContracts() {
  return Array.from(registry.keys());
}

/**
 * Validate input and output against a contract's schemas.
 * Checks allowedValues and forbiddenValues for the output.
 *
 * @param {string} contractName
 * @param {*}      input
 * @param {*}      output
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(contractName, input, output) {
  const def = registry.get(contractName);
  if (!def) {
    const err = `CONTRACT_NOT_FOUND:${contractName}`;
    return { valid: false, errors: [err] };
  }

  const errors = [];

  // Input schema
  errors.push(...typeCheck(input, def.inputSchema, 'input'));

  // Output schema
  errors.push(...typeCheck(output, def.outputSchema, 'output'));

  // Forbidden output values
  for (const forbidden of (def.forbiddenValues || [])) {
    if (output === forbidden) {
      errors.push(`output: value ${JSON.stringify(forbidden)} is in forbiddenValues`);
    }
  }

  const valid = errors.length === 0;
  return { valid, errors };
}

/**
 * Run all invariants for a contract against a given context.
 * context must include: input, output, plus any contract-specific fields.
 *
 * @param {string} contractName
 * @param {object} context  — must contain input + output keys
 * @returns {{ passed: boolean, failures: Array<{id: string, error: string}> }}
 */
export function runInvariants(contractName, context) {
  const def = registry.get(contractName);
  if (!def) {
    const err = `CONTRACT_NOT_FOUND:${contractName}`;
    return { passed: false, failures: [{ id: 'REGISTRY', error: err }] };
  }

  const fns = compiledInvariants.get(contractName) || [];
  const { input, output } = context;
  const ctx = { ...TAXONOMY_CTX, ...context };

  const failures = [];

  for (const { id, fn } of fns) {
    let result;
    try {
      result = fn(input, output, ctx);
    } catch (err) {
      failures.push({ id, error: `INVARIANT_THREW:${err.message}` });
      continue;
    }
    if (result !== true) {
      failures.push({ id, error: `INVARIANT_RETURNED_FALSE` });
    }
  }

  const passed = failures.length === 0;
  return { passed, failures };
}

/**
 * Convenience: validate + runInvariants in one call.
 *
 * @param {string} contractName
 * @param {*}      input
 * @param {*}      output
 * @param {object} extraCtx  — additional context for invariants
 * @returns {{ valid: boolean, errors: string[], passed: boolean, failures: object[] }}
 */
export function assert(contractName, input, output, extraCtx = {}) {
  const validation  = validate(contractName, input, output);
  const invariantRun = runInvariants(contractName, { input, output, ...extraCtx });
  return {
    valid:    validation.valid,
    errors:   validation.errors,
    passed:   invariantRun.passed,
    failures: invariantRun.failures
  };
}
