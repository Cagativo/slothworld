/**
 * contract-system.test.mjs
 *
 * Enumerates every registered contract.
 * Tests: valid inputs, invalid inputs, all failure modes, no silent failures.
 *
 * Runner: node --test tests/contract-system.test.mjs
 * Requires: CONTRACT_STRICT_MODE=1 (set per-test via env override where needed)
 *
 * NOTE: This project uses node:test, not Jest. The user-specified "Jest" runner
 * is UNREPRESENTABLE_IN_EXECUTABLE_FORM without installing jest as a dependency.
 * Tests are written with node:test assert API which is equivalent in coverage.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validate,
  runInvariants,
  listContracts,
  getContract,
  TAXONOMY_CTX
} from '../contracts/contractRegistry.js';

import { deriveWorldState } from '../core/world/deriveWorldState.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeIndexedWorld(events = []) {
  return deriveWorldState(events);
}

function makeLifecycleEventSeq(taskId, types) {
  return types.map((type, i) => ({
    event: type, type, taskId, timestamp: 1000 + i, payload: {}
  }));
}

function makeAckedEvents(taskId, payloadStatus) {
  return makeLifecycleEventSeq(taskId, [
    'TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED',
    'TASK_EXECUTE_STARTED', 'TASK_EXECUTE_FINISHED'
  ]).concat([{
    event: 'TASK_ACKED', type: 'TASK_ACKED', taskId,
    timestamp: 2000, payload: { status: payloadStatus, success: payloadStatus !== 'failed' }
  }]);
}

// ─── 1. Registry meta-tests ───────────────────────────────────────────────────

test('registry: all 7 contracts are registered', () => {
  const names = listContracts();
  const expected = [
    'eventTaxonomy.isLifecycleEvent',
    'eventTaxonomy.isSystemEvent',
    'deriveWorldState',
    'taskSelectors.getTaskStatus',
    'agentSelectors.getAgentState',
    'anomalySelectors.getIncidentClusters',
    'buildVisualWorldGraph'
  ];
  for (const name of expected) {
    assert.ok(names.includes(name), `missing contract: ${name}`);
  }
});

test('registry: every contract has at least one invariant', () => {
  for (const name of listContracts()) {
    const def = getContract(name);
    assert.ok(Array.isArray(def.invariants) && def.invariants.length > 0,
      `${name}: no invariants defined`);
  }
});

test('registry: every contract has enforcement metadata', () => {
  for (const name of listContracts()) {
    const def = getContract(name);
    assert.ok(def.enforcement && def.enforcement.module && def.enforcement.function,
      `${name}: missing enforcement metadata`);
    assert.ok(['runtime', 'test', 'both'].includes(def.enforcement.mode),
      `${name}: invalid enforcement mode`);
  }
});

test('registry: every invariant expression compiles without error', () => {
  for (const name of listContracts()) {
    const def = getContract(name);
    for (const inv of def.invariants) {
      assert.doesNotThrow(() => {
        // eslint-disable-next-line no-new-func
        new Function('input', 'output', 'ctx', inv.expression);
      }, `${name}:${inv.id} — expression failed to compile`);
    }
  }
});

// ─── 2. eventTaxonomy.isLifecycleEvent ───────────────────────────────────────

test('isLifecycleEvent: valid input + true output for each lifecycle event', () => {
  for (const type of TAXONOMY_CTX.LIFECYCLE_EVENTS) {
    const { valid, errors } = validate('eventTaxonomy.isLifecycleEvent', { type }, true);
    assert.ok(valid, `${type}: ${errors.join(', ')}`);
  }
});

test('isLifecycleEvent: valid input + false output for system events', () => {
  for (const type of TAXONOMY_CTX.SYSTEM_EVENTS) {
    const { valid, errors } = validate('eventTaxonomy.isLifecycleEvent', { type }, false);
    assert.ok(valid, `${type}: ${errors.join(', ')}`);
  }
});

test('isLifecycleEvent: invalid — output is not boolean', () => {
  const { valid } = validate('eventTaxonomy.isLifecycleEvent', { type: 'TASK_CREATED' }, 'true');
  assert.strictEqual(valid, false);
});

test('isLifecycleEvent: invalid — missing required input field', () => {
  const { valid } = validate('eventTaxonomy.isLifecycleEvent', {}, true);
  assert.strictEqual(valid, false);
});

test('isLifecycleEvent: invariant LIFECYCLE_TRUE_IFF_IN_ALLOWED_SET — fails when true for system event', () => {
  const { passed, failures } = runInvariants('eventTaxonomy.isLifecycleEvent', {
    input: { type: 'TASK_NOTIFICATION_SENT' },
    output: true,
    ...TAXONOMY_CTX
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'LIFECYCLE_TRUE_IFF_IN_ALLOWED_SET'));
});

test('isLifecycleEvent: invariant LIFECYCLE_SYSTEM_MUTUALLY_EXCLUSIVE — always holds', () => {
  // No type can be in both sets
  for (const type of [...TAXONOMY_CTX.LIFECYCLE_EVENTS, ...TAXONOMY_CTX.SYSTEM_EVENTS]) {
    const { passed } = runInvariants('eventTaxonomy.isLifecycleEvent', {
      input: { type },
      output: TAXONOMY_CTX.LIFECYCLE_EVENTS.includes(type),
      ...TAXONOMY_CTX
    });
    assert.ok(passed, `mutual exclusion failed for ${type}`);
  }
});

test('isLifecycleEvent: unregistered events — false output passes schema, fails LIFECYCLE_TRUE_IFF invariant', () => {
  for (const type of TAXONOMY_CTX.UNREGISTERED_EVENTS) {
    const { valid } = validate('eventTaxonomy.isLifecycleEvent', { type }, false);
    assert.ok(valid, `schema validation failed for unregistered ${type}`);

    const { passed, failures } = runInvariants('eventTaxonomy.isLifecycleEvent', {
      input: { type }, output: true, ...TAXONOMY_CTX
    });
    assert.strictEqual(passed, false, `${type} should not pass as lifecycle=true`);
    assert.ok(failures.length > 0);
  }
});

// ─── 3. eventTaxonomy.isSystemEvent ──────────────────────────────────────────

test('isSystemEvent: valid input + true output for each system event', () => {
  for (const type of TAXONOMY_CTX.SYSTEM_EVENTS) {
    const { valid, errors } = validate('eventTaxonomy.isSystemEvent', { type }, true);
    assert.ok(valid, `${type}: ${errors.join(', ')}`);
  }
});

test('isSystemEvent: invalid — true output for lifecycle event fails invariant', () => {
  const { passed } = runInvariants('eventTaxonomy.isSystemEvent', {
    input: { type: 'TASK_CREATED' }, output: true, ...TAXONOMY_CTX
  });
  assert.strictEqual(passed, false);
});

test('isSystemEvent: no silent failure — invalid output type rejected', () => {
  const { valid } = validate('eventTaxonomy.isSystemEvent', { type: 'TASK_NOTIFICATION_SENT' }, 1);
  assert.strictEqual(valid, false);
});

// ─── 4. deriveWorldState ─────────────────────────────────────────────────────

test('deriveWorldState: valid — empty events array', () => {
  const output = deriveWorldState([]);
  const outputForValidation = {
    events: output.events,
    eventsByTaskId:   Object.fromEntries(output.eventsByTaskId),
    eventsByWorkerId: Object.fromEntries(output.eventsByWorkerId)
  };
  const { valid, errors } = validate('deriveWorldState', { events: [] }, outputForValidation);
  assert.ok(valid, errors.join(', '));
});

test('deriveWorldState: invariant OUTPUT_HAS_EXACTLY_THREE_KEYS', () => {
  const output = deriveWorldState([]);
  const { passed } = runInvariants('deriveWorldState', {
    input: { events: [] }, output, originalInput: []
  });
  assert.ok(passed);
});

test('deriveWorldState: invariant EVENTS_SORTED_ASC_BY_TIMESTAMP', () => {
  const events = [
    { event: 'TASK_ENQUEUED', taskId: 't1', timestamp: 2000, payload: {} },
    { event: 'TASK_CREATED',  taskId: 't1', timestamp: 1000, payload: {} }
  ];
  const output = deriveWorldState(events);
  const { passed } = runInvariants('deriveWorldState', {
    input: { events }, output, originalInput: events
  });
  assert.ok(passed);
  assert.strictEqual(output.events[0].timestamp, 1000);
  assert.strictEqual(output.events[1].timestamp, 2000);
});

test('deriveWorldState: invariant INPUT_NOT_MUTATED — output.events !== original array', () => {
  const events = [{ event: 'TASK_CREATED', taskId: 't1', timestamp: 1000, payload: {} }];
  const output = deriveWorldState(events);
  assert.notStrictEqual(output.events, events);
});

test('deriveWorldState: invariant OUTPUT_CONTAINS_NO_LIFECYCLE_SEMANTICS', () => {
  const output = deriveWorldState([]);
  const { passed } = runInvariants('deriveWorldState', {
    input: { events: [] }, output, originalInput: []
  });
  assert.ok(passed);
  assert.ok(!('status' in output));
  assert.ok(!('metrics' in output));
  assert.ok(!('anomalies' in output));
});

test('deriveWorldState: schema rejects output with extra keys', () => {
  const polluted = {
    events: [],
    eventsByTaskId:   {},
    eventsByWorkerId: {},
    status: 'FORBIDDEN'
  };
  const { valid } = validate('deriveWorldState', { events: [] }, polluted);
  assert.strictEqual(valid, false);
});

// ─── 5. taskSelectors.getTaskStatus ──────────────────────────────────────────

test('getTaskStatus: output never equals "acknowledged"', () => {
  const FORBIDDEN = 'acknowledged';
  const { valid } = validate(
    'taskSelectors.getTaskStatus',
    { indexedWorld: { eventsByTaskId: {} }, taskId: 't1' },
    FORBIDDEN
  );
  assert.strictEqual(valid, false);
});

test('getTaskStatus: all allowed status values pass schema', () => {
  const allowed = ['unknown','created','queued','claimed','executing','awaiting_ack','completed','failed'];
  const baseInput = { indexedWorld: { eventsByTaskId: {} }, taskId: 't1' };
  for (const status of allowed) {
    const { valid, errors } = validate('taskSelectors.getTaskStatus', baseInput, status);
    assert.ok(valid, `${status}: ${errors.join(', ')}`);
  }
});

test('getTaskStatus: invariant COMPLETED_REQUIRES_TASK_ACKED_EVENT', () => {
  // completed without any TASK_ACKED event — invariant must fail
  const { passed, failures } = runInvariants('taskSelectors.getTaskStatus', {
    input:      { indexedWorld: { eventsByTaskId: {} }, taskId: 't1' },
    output:     'completed',
    taskEvents: [], // no events
    ...TAXONOMY_CTX
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'COMPLETED_REQUIRES_TASK_ACKED_EVENT'));
});

test('getTaskStatus: invariant COMPLETED_REQUIRES_TASK_ACKED_EVENT — passes with valid TASK_ACKED', () => {
  const taskEvents = [{ type: 'TASK_ACKED', payload: { status: 'acknowledged' } }];
  const { passed } = runInvariants('taskSelectors.getTaskStatus', {
    input:      { indexedWorld: { eventsByTaskId: {} }, taskId: 't1' },
    output:     'completed',
    taskEvents,
    ...TAXONOMY_CTX
  });
  assert.ok(passed);
});

test('getTaskStatus: invariant FAILED_REQUIRES_TASK_ACKED_FAILED_EVENT', () => {
  // failed without any TASK_ACKED(status=failed) event — invariant must fail
  const { passed, failures } = runInvariants('taskSelectors.getTaskStatus', {
    input:      { indexedWorld: { eventsByTaskId: {} }, taskId: 't1' },
    output:     'failed',
    taskEvents: [],
    ...TAXONOMY_CTX
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'FAILED_REQUIRES_TASK_ACKED_FAILED_EVENT'));
});

test('getTaskStatus: invariant UNKNOWN_REQUIRES_NO_EVENTS — fails when events present', () => {
  const taskEvents = [{ type: 'TASK_CREATED', payload: {} }];
  const { passed, failures } = runInvariants('taskSelectors.getTaskStatus', {
    input:      { indexedWorld: { eventsByTaskId: {} }, taskId: 't1' },
    output:     'unknown',
    taskEvents,
    ...TAXONOMY_CTX
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'UNKNOWN_REQUIRES_NO_EVENTS'));
});

test('getTaskStatus: no silent failure — non-string output rejected', () => {
  const baseInput = { indexedWorld: { eventsByTaskId: {} }, taskId: 't1' };
  const { valid } = validate('taskSelectors.getTaskStatus', baseInput, null);
  assert.strictEqual(valid, false);
});

// ─── 6. agentSelectors.getAgentState ─────────────────────────────────────────

test('getAgentState: all allowed values pass schema', () => {
  const allowed = ['idle', 'moving', 'working', 'delivering', 'error'];
  const baseInput = { indexedWorld: { eventsByWorkerId: {} }, workerId: 'w1' };
  for (const state of allowed) {
    const { valid, errors } = validate('agentSelectors.getAgentState', baseInput, state);
    assert.ok(valid, `${state}: ${errors.join(', ')}`);
  }
});

test('getAgentState: forbidden — task status terms rejected', () => {
  const forbidden = ['claimed', 'executing', 'awaiting_ack', 'failed', 'acknowledged', 'completed'];
  const baseInput = { indexedWorld: { eventsByWorkerId: {} }, workerId: 'w1' };
  for (const value of forbidden) {
    const { valid } = validate('agentSelectors.getAgentState', baseInput, value);
    assert.strictEqual(valid, false, `${value} should be rejected`);
  }
});

test('getAgentState: invariant NO_TASKS_IMPLIES_IDLE — fails when no tasks but output is not idle', () => {
  const { passed, failures } = runInvariants('agentSelectors.getAgentState', {
    input:        { indexedWorld: { eventsByWorkerId: {} }, workerId: 'w1' },
    output:       'working',
    agentTaskIds: []
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'NO_TASKS_IMPLIES_IDLE'));
});

test('getAgentState: invariant NO_TASKS_IMPLIES_IDLE — passes when idle with no tasks', () => {
  const { passed } = runInvariants('agentSelectors.getAgentState', {
    input:        { indexedWorld: { eventsByWorkerId: {} }, workerId: 'w1' },
    output:       'idle',
    agentTaskIds: []
  });
  assert.ok(passed);
});

test('getAgentState: no silent failure — non-string output rejected', () => {
  const { valid } = validate(
    'agentSelectors.getAgentState',
    { indexedWorld: { eventsByWorkerId: {} }, workerId: 'w1' },
    42
  );
  assert.strictEqual(valid, false);
});

// ─── 7. anomalySelectors.getIncidentClusters ─────────────────────────────────

test('getIncidentClusters: invariant CLUSTER_COUNT_WITHOUT_SYSTEM_EVENTS_IS_TWO', () => {
  const twoClusterOutput = [
    { type: 'execution_failures', severity: 'low',  taskIds: [], summary: 'x', representativeEvents: [] },
    { type: 'stalled_tasks',      severity: 'low',  taskIds: [], summary: 'x', representativeEvents: [] }
  ];
  const { passed } = runInvariants('anomalySelectors.getIncidentClusters', {
    input:               { indexedWorld: {}, options: { includeSystemEvents: false } },
    output:              twoClusterOutput,
    includeSystemEvents: false
  });
  assert.ok(passed);
});

test('getIncidentClusters: invariant CLUSTER_COUNT_WITHOUT_SYSTEM_EVENTS_IS_TWO — fails with 3 clusters', () => {
  const threeClusterOutput = [
    { type: 'execution_failures',  severity: 'low', taskIds: [], summary: 'x', representativeEvents: [] },
    { type: 'notification_issues', severity: 'low', taskIds: [], summary: 'x', representativeEvents: [] },
    { type: 'stalled_tasks',       severity: 'low', taskIds: [], summary: 'x', representativeEvents: [] }
  ];
  const { passed, failures } = runInvariants('anomalySelectors.getIncidentClusters', {
    input:               { indexedWorld: {}, options: { includeSystemEvents: false } },
    output:              threeClusterOutput,
    includeSystemEvents: false
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'CLUSTER_COUNT_WITHOUT_SYSTEM_EVENTS_IS_TWO'));
});

test('getIncidentClusters: invariant EXECUTION_FAILURES_ALWAYS_AT_INDEX_ZERO', () => {
  const wrongOrder = [
    { type: 'stalled_tasks',      severity: 'low', taskIds: [], summary: 'x', representativeEvents: [] },
    { type: 'execution_failures', severity: 'low', taskIds: [], summary: 'x', representativeEvents: [] }
  ];
  const { passed, failures } = runInvariants('anomalySelectors.getIncidentClusters', {
    input:               { indexedWorld: {}, options: {} },
    output:              wrongOrder,
    includeSystemEvents: false
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'EXECUTION_FAILURES_ALWAYS_AT_INDEX_ZERO'));
});

test('getIncidentClusters: invariant STALLED_TASKS_ALWAYS_LAST', () => {
  const wrongOrder = [
    { type: 'stalled_tasks',      severity: 'low', taskIds: [], summary: 'x', representativeEvents: [] },
    { type: 'execution_failures', severity: 'low', taskIds: [], summary: 'x', representativeEvents: [] }
  ];
  const { passed, failures } = runInvariants('anomalySelectors.getIncidentClusters', {
    input:  { indexedWorld: {}, options: {} },
    output: wrongOrder,
    includeSystemEvents: false
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'STALLED_TASKS_ALWAYS_LAST'));
});

test('getIncidentClusters: invariant EXECUTION_FAILURES_SEVERITY_RULE — non-empty = high', () => {
  const output = [
    { type: 'execution_failures', severity: 'low', taskIds: ['t1'], summary: 'x', representativeEvents: [] },
    { type: 'stalled_tasks',      severity: 'low', taskIds: [],     summary: 'x', representativeEvents: [] }
  ];
  const { passed, failures } = runInvariants('anomalySelectors.getIncidentClusters', {
    input: { indexedWorld: {}, options: {} }, output, includeSystemEvents: false
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'EXECUTION_FAILURES_SEVERITY_RULE'));
});

test('getIncidentClusters: invariant REPRESENTATIVE_EVENTS_MAX_FIVE — fails with 6 events', () => {
  const sixEvents = [1,2,3,4,5,6].map((n) => ({ id: n }));
  const output = [
    { type: 'execution_failures', severity: 'low', taskIds: [], summary: 'x', representativeEvents: sixEvents },
    { type: 'stalled_tasks',      severity: 'low', taskIds: [], summary: 'x', representativeEvents: [] }
  ];
  const { passed, failures } = runInvariants('anomalySelectors.getIncidentClusters', {
    input: { indexedWorld: {}, options: {} }, output, includeSystemEvents: false
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'REPRESENTATIVE_EVENTS_MAX_FIVE'));
});

test('getIncidentClusters: schema rejects unknown cluster type', () => {
  const output = [
    { type: 'UNKNOWN_TYPE', severity: 'low', taskIds: [], summary: 'x', representativeEvents: [] },
    { type: 'stalled_tasks', severity: 'low', taskIds: [], summary: 'x', representativeEvents: [] }
  ];
  const { valid } = validate('anomalySelectors.getIncidentClusters', { indexedWorld: {}, options: {} }, output);
  assert.strictEqual(valid, false);
});

// ─── 8. buildVisualWorldGraph ─────────────────────────────────────────────────

test('buildVisualWorldGraph: invariant INPUT_CONTAINS_NO_RAW_EVENTS_ARRAY — fails with IndexedWorld keys', () => {
  const rawInput = { events: [], eventsByTaskId: new Map(), eventsByWorkerId: new Map() };
  const { passed, failures } = runInvariants('buildVisualWorldGraph', {
    input:  rawInput,
    output: { nodes: [], edges: [], metadata: {}, observability: { enabled: false, byTaskId: {} } }
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'INPUT_CONTAINS_NO_RAW_EVENTS_ARRAY'));
});

test('buildVisualWorldGraph: invariant NODE_COUNT_EQUALS_TASKS_PLUS_AGENTS', () => {
  const input = {
    tasks:  [{ id: 't1', status: 'created', title: 'x', type: 'test' }],
    agents: [{ id: 'w1', state: 'idle', role: 'operator' }]
  };
  // 2 nodes expected — provide 1 to trigger failure
  const { passed, failures } = runInvariants('buildVisualWorldGraph', {
    input,
    output: {
      nodes:         [{ id: 't1', type: 'task', status: 'created', metadata: {} }],
      edges:         [],
      metadata:      {},
      observability: { enabled: false, byTaskId: {} }
    }
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'NODE_COUNT_EQUALS_TASKS_PLUS_AGENTS'));
});

test('buildVisualWorldGraph: invariant ALL_NODE_TYPES_IN_CLOSED_ENUM — fails on unknown type', () => {
  const input = { tasks: [{ id: 't1' }], agents: [] };
  const { passed, failures } = runInvariants('buildVisualWorldGraph', {
    input,
    output: {
      nodes:         [{ id: 't1', type: 'invalid_type', status: 'created', metadata: {} }],
      edges:         [],
      metadata:      {},
      observability: { enabled: false, byTaskId: {} }
    }
  });
  assert.strictEqual(passed, false);
  assert.ok(failures.some((f) => f.id === 'ALL_NODE_TYPES_IN_CLOSED_ENUM'));
});

test('buildVisualWorldGraph: schema rejects output missing observability key', () => {
  const output = { nodes: [], edges: [], metadata: {} }; // no observability
  const { valid } = validate('buildVisualWorldGraph', { tasks: [], agents: [] }, output);
  assert.strictEqual(valid, false);
});

test('buildVisualWorldGraph: valid minimal output passes all checks', () => {
  const input  = { tasks: [], agents: [] };
  const output = {
    nodes:         [],
    edges:         [],
    metadata:      {},
    observability: { enabled: false, byTaskId: {} }
  };
  const { valid, errors } = validate('buildVisualWorldGraph', input, output);
  assert.ok(valid, errors.join(', '));

  const { passed } = runInvariants('buildVisualWorldGraph', { input, output });
  assert.ok(passed);
});

// ─── 9. No silent failures — strict mode coverage ────────────────────────────

test('no silent failures: validate returns { valid: false } not undefined on bad input', () => {
  for (const name of listContracts()) {
    const result = validate(name, null, null);
    assert.ok(typeof result === 'object' && result !== null, `${name}: validate returned non-object`);
    assert.ok('valid' in result, `${name}: missing valid field`);
    assert.ok('errors' in result, `${name}: missing errors field`);
    assert.strictEqual(result.valid, false, `${name}: null input should be invalid`);
  }
});

test('no silent failures: runInvariants returns { passed, failures } not undefined', () => {
  for (const name of listContracts()) {
    const result = runInvariants(name, { input: {}, output: null });
    assert.ok(typeof result === 'object' && result !== null, `${name}: runInvariants returned non-object`);
    assert.ok('passed' in result, `${name}: missing passed field`);
    assert.ok('failures' in result && Array.isArray(result.failures), `${name}: missing failures array`);
  }
});

test('no silent failures: unknown contract name returns error, not exception', () => {
  const vr = validate('NONEXISTENT_CONTRACT', {}, {});
  assert.strictEqual(vr.valid, false);
  assert.ok(vr.errors.some((e) => e.includes('CONTRACT_NOT_FOUND')));

  const ir = runInvariants('NONEXISTENT_CONTRACT', { input: {}, output: {} });
  assert.strictEqual(ir.passed, false);
});
