import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine } from '../core/engine/taskEngine.js';
import { CANONICAL_TASK_PIPELINE } from '../core/execution-pipeline.js';

/**
 * Workflow Edge Cases Test Suite
 *
 * Covers fault injection, agent timeouts, pipeline-stage failures, partial
 * completion, immutability contracts, and determinism.
 *
 * All tests are:
 *  - Pure and side-effect free (each test gets its own isolated engine)
 *  - Deterministic (no real timing dependencies; controlled clocks where needed)
 *  - Aligned with engine-lifecycle-immutability.test.mjs patterns
 *
 * Rules honoured:
 *  - core/workflow.js and core/engine/ are NOT modified
 *  - Workflow behaviour is exercised through the canonical TaskEngine API
 */

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeEngine(overrides = {}) {
  const emittedEvents = [];
  const engine = createTaskEngine({
    emitEvent: (event) =>
      emittedEvents.push({ type: event.event, taskId: event.taskId, payload: event.payload }),
    executor: async (task) => ({ success: true, output: { taskId: task.id } }),
    ...overrides
  });
  return { engine, emittedEvents };
}

/** Returns a monotonically-increasing deterministic clock. */
function makeDetClock(startMs = 1_000_000) {
  let t = startMs;
  return () => t++;
}

// ─── Agent timeout mid-workflow ───────────────────────────────────────────────

test('Agent Timeout: executor rejection moves task to awaiting_ack, not stuck executing', async () => {
  const { engine } = makeEngine({
    executor: async () => { throw new Error('AGENT_TIMEOUT'); }
  });

  const taskId = 'timeout-not-stuck';
  engine.createTask({ id: taskId, type: 'test', maxRetries: 0 });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);

  const task = engine.getTask(taskId);
  assert.equal(task.status, 'awaiting_ack',
    'executor rejection must move task to awaiting_ack, not leave it stuck');
});

test('Agent Timeout: TASK_EXECUTE_FINISHED is emitted with success=false on timeout', async () => {
  const { engine, emittedEvents } = makeEngine({
    executor: async () => { throw new Error('AGENT_TIMEOUT'); }
  });

  const taskId = 'timeout-event-check';
  engine.createTask({ id: taskId, type: 'test', maxRetries: 0 });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);

  const finished = emittedEvents.find(
    (e) => e.type === 'TASK_EXECUTE_FINISHED' && e.taskId === taskId
  );
  assert.ok(finished, 'TASK_EXECUTE_FINISHED must be emitted after agent timeout');
  assert.equal(finished.payload.success, false, 'timeout must produce success=false');
});

test('Agent Timeout: timed-out task is correctly acked as failed', async () => {
  const { engine } = makeEngine({
    executor: async () => { throw new Error('AGENT_TIMEOUT'); }
  });

  const taskId = 'timeout-ack-failed';
  engine.createTask({ id: taskId, type: 'test', maxRetries: 0 });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);
  const ackedTask = await engine.ackTask(taskId);

  assert.equal(ackedTask.status, 'failed', 'timed-out task must be acked as failed');
});

test('Agent Timeout: mid-workflow step timeout isolates failure to that step only', async () => {
  const { engine } = makeEngine({
    executor: async (task) => {
      if (task.id === 'wf-step-timeout') {
        throw new Error('AGENT_TIMEOUT');
      }
      return { success: true, output: { taskId: task.id } };
    }
  });

  // Workflow step 1 – completes successfully
  engine.createTask({ id: 'wf-step-ok', type: 'test' });
  engine.enqueueTask('wf-step-ok');
  engine.claimTask('wf-step-ok');
  await engine.executeTask('wf-step-ok');
  await engine.ackTask('wf-step-ok');

  // Workflow step 2 – agent times out
  engine.createTask({ id: 'wf-step-timeout', type: 'test', maxRetries: 0 });
  engine.enqueueTask('wf-step-timeout');
  engine.claimTask('wf-step-timeout');
  await engine.executeTask('wf-step-timeout');
  await engine.ackTask('wf-step-timeout');

  assert.equal(engine.getTask('wf-step-ok').status, 'acknowledged',
    'step before timeout must remain acknowledged');
  assert.equal(engine.getTask('wf-step-timeout').status, 'failed',
    'timed-out step must be failed');

  // A subsequent step that was never started must not exist in the engine
  assert.equal(engine.getTask('wf-step-subsequent'), null,
    'subsequent workflow step must not exist because prior step failed');
});

// ─── Task failure at each pipeline stage ─────────────────────────────────────

test('Pipeline[create]: createTask with null input throws invalid_task', () => {
  const { engine } = makeEngine();
  assert.throws(
    () => engine.createTask(null),
    (err) => err instanceof Error && err.message === 'invalid_task'
  );
});

test('Pipeline[create]: createTask without id field throws invalid_task', () => {
  const { engine } = makeEngine();
  assert.throws(
    () => engine.createTask({ type: 'test' }),
    (err) => err instanceof Error && err.message === 'invalid_task'
  );
});

test('Pipeline[enqueue]: enqueueTask for unknown task throws task_not_found', () => {
  const { engine } = makeEngine();
  assert.throws(
    () => engine.enqueueTask('nonexistent-task-id'),
    (err) => err instanceof Error && /task_not_found/.test(err.message)
  );
});

test('Pipeline[claim]: claimTask on a non-queued task returns null', () => {
  const { engine } = makeEngine();
  engine.createTask({ id: 'claim-non-queued', type: 'test' });
  // Task is in "created" state, not "queued"
  const result = engine.claimTask('claim-non-queued');
  assert.equal(result, null, 'claimTask must return null when task is not queued');
});

test('Pipeline[execute]: execution failure (success:false) leaves task in awaiting_ack', async () => {
  const { engine } = makeEngine({
    executor: async () => ({ success: false, retryable: false })
  });

  const taskId = 'execute-fail-status';
  engine.createTask({ id: taskId, type: 'test', maxRetries: 0 });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);

  assert.equal(engine.getTask(taskId).status, 'awaiting_ack',
    'failed execution must leave task in awaiting_ack pending the ack call');
});

test('Pipeline[execute]: executor exception (throw) leaves task in awaiting_ack', async () => {
  const { engine } = makeEngine({
    executor: async () => { throw new Error('UNEXPECTED_CRASH'); }
  });

  const taskId = 'execute-throw-status';
  engine.createTask({ id: taskId, type: 'test', maxRetries: 0 });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);

  assert.equal(engine.getTask(taskId).status, 'awaiting_ack',
    'thrown executor must leave task in awaiting_ack');
});

test('Pipeline[ack]: ackTask without executeTask throws ENGINE_ENFORCEMENT_VIOLATION', async () => {
  const { engine } = makeEngine();
  const taskId = 'ack-without-execute';
  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  // Force awaiting_ack without executing (simulates a corrupt / skipped pipeline).
  // This pattern is established in engine-lifecycle-immutability.test.mjs (ACK prerequisite
  // tests) to verify that the engine enforces executionRecord presence before accepting an ack.
  engine.getTask(taskId).status = 'awaiting_ack';

  await assert.rejects(
    () => engine.ackTask(taskId),
    (err) => err instanceof Error && err.message === 'ENGINE_ENFORCEMENT_VIOLATION'
  );
});

test('Pipeline[ack]: failed execution reaches failed terminal state via TASK_ACKED', async () => {
  const { engine, emittedEvents } = makeEngine({
    executor: async () => ({ success: false, retryable: false })
  });

  const taskId = 'fail-terminal';
  engine.createTask({ id: taskId, type: 'test', maxRetries: 0 });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);
  const task = await engine.ackTask(taskId);

  assert.equal(task.status, 'failed', 'failed task must reach failed terminal state');
  const ackedEvent = emittedEvents.find((e) => e.type === 'TASK_ACKED' && e.taskId === taskId);
  assert.ok(ackedEvent, 'TASK_ACKED must be emitted even for failed tasks');
  assert.equal(ackedEvent.payload.status, 'failed', 'TASK_ACKED payload must carry status=failed');
});

test('Pipeline[execute]: auto-pipeline executes task from created state via executeTask', async () => {
  // TaskEngine auto-enqueues and auto-claims when task starts in created state
  const { engine } = makeEngine();
  engine.createTask({ id: 'auto-pipeline', type: 'test' });
  const result = await engine.executeTask('auto-pipeline');

  assert.equal(result.success, true, 'auto-pipeline execution must succeed');
  assert.equal(engine.getTask('auto-pipeline').status, 'awaiting_ack',
    'task must be awaiting_ack after auto-pipeline execution');
});

// ─── Retry on transient failure ───────────────────────────────────────────────

test('Retry: task retries on retryable failure and succeeds on second attempt', async () => {
  let callCount = 0;
  const { engine, emittedEvents } = makeEngine({
    executor: async (task) => {
      callCount++;
      if (callCount < 2) {
        return { success: false, retryable: true };
      }
      return { success: true, output: { taskId: task.id } };
    }
  });

  const taskId = 'retry-eventual-success';
  engine.createTask({ id: taskId, type: 'test', maxRetries: 3 });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);

  // Attempt 1 – fails with retryable:true → task is requeued
  await engine.executeTask(taskId);
  assert.equal(engine.getTask(taskId).status, 'queued',
    'task must be queued after a retryable failure');

  const requeuedEvent = emittedEvents.find(
    (e) => e.type === 'TASK_REQUEUED' && e.taskId === taskId
  );
  assert.ok(requeuedEvent, 'TASK_REQUEUED event must be emitted for retryable failure');

  // Attempt 2 – succeeds
  await engine.executeTask(taskId);
  assert.equal(engine.getTask(taskId).status, 'awaiting_ack',
    'task must be awaiting_ack after successful retry');

  const ackedTask = await engine.ackTask(taskId);
  assert.equal(ackedTask.status, 'acknowledged', 'task must be acknowledged after successful retry');
  assert.equal(callCount, 2, 'executor must have been called exactly twice');
});

test('Retry: task fails permanently after exhausting maxRetries', async () => {
  const { engine, emittedEvents } = makeEngine({
    executor: async () => ({ success: false, retryable: true })
  });

  const taskId = 'retry-exhausted';
  // maxRetries:2 → retried once (attempts 1 → queue, attempts 2 → awaiting_ack)
  engine.createTask({ id: taskId, type: 'test', maxRetries: 2 });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);

  // Attempt 1 – attempts=1, 1 < 2 → retry
  await engine.executeTask(taskId);
  assert.equal(engine.getTask(taskId).status, 'queued', 'must be queued after first retryable failure');

  // Attempt 2 – attempts=2, 2 < 2 is false → awaiting_ack (retries exhausted)
  await engine.executeTask(taskId);
  assert.equal(engine.getTask(taskId).status, 'awaiting_ack',
    'must be awaiting_ack after exhausting retries');

  const ackedTask = await engine.ackTask(taskId);
  assert.equal(ackedTask.status, 'failed', 'task must be failed after exhausting retries');

  const requeuedEvents = emittedEvents.filter(
    (e) => e.type === 'TASK_REQUEUED' && e.taskId === taskId
  );
  assert.equal(requeuedEvents.length, 1,
    'TASK_REQUEUED must be emitted exactly once (only the first retry)');
});

// ─── Partial completion (some agents succeed, some fail) ─────────────────────

test('Partial Completion: each task in a mixed batch reaches a valid terminal state', async () => {
  const failingIds = new Set(['partial-fail-1', 'partial-fail-3']);

  const { engine } = makeEngine({
    executor: async (task) =>
      failingIds.has(task.id)
        ? { success: false, retryable: false }
        : { success: true, output: { taskId: task.id } }
  });

  const ids = ['partial-fail-1', 'partial-ok-2', 'partial-fail-3', 'partial-ok-4'];
  for (const id of ids) {
    engine.createTask({ id, type: 'test', maxRetries: 0 });
    engine.enqueueTask(id);
    engine.claimTask(id);
    await engine.executeTask(id);
    await engine.ackTask(id);
  }

  assert.equal(engine.getTask('partial-fail-1').status, 'failed',
    'partial-fail-1 must be failed');
  assert.equal(engine.getTask('partial-ok-2').status, 'acknowledged',
    'partial-ok-2 must be acknowledged');
  assert.equal(engine.getTask('partial-fail-3').status, 'failed',
    'partial-fail-3 must be failed');
  assert.equal(engine.getTask('partial-ok-4').status, 'acknowledged',
    'partial-ok-4 must be acknowledged');
});

test('Partial Completion: failed task does not affect lifecycle of sibling tasks', async () => {
  const { engine } = makeEngine({
    executor: async (task) => {
      if (task.id === 'sibling-fail') {
        return { success: false, retryable: false };
      }
      return { success: true, output: { taskId: task.id } };
    }
  });

  // Failing task
  engine.createTask({ id: 'sibling-fail', type: 'test', maxRetries: 0 });
  engine.enqueueTask('sibling-fail');
  engine.claimTask('sibling-fail');
  await engine.executeTask('sibling-fail');
  await engine.ackTask('sibling-fail');

  // Independent successful task – must be unaffected
  engine.createTask({ id: 'sibling-ok', type: 'test' });
  engine.enqueueTask('sibling-ok');
  engine.claimTask('sibling-ok');
  await engine.executeTask('sibling-ok');
  await engine.ackTask('sibling-ok');

  assert.equal(engine.getTask('sibling-fail').status, 'failed',
    'failing task must end as failed');
  assert.equal(engine.getTask('sibling-ok').status, 'acknowledged',
    'independent success task must be unaffected by sibling failure');
});

test('Partial Completion: TASK_ACKED is emitted for every task regardless of outcome', async () => {
  const failingIds = new Set(['mixed-fail-a', 'mixed-fail-b']);

  const { engine, emittedEvents } = makeEngine({
    executor: async (task) =>
      failingIds.has(task.id)
        ? { success: false, retryable: false }
        : { success: true, output: { taskId: task.id } }
  });

  const ids = ['mixed-fail-a', 'mixed-ok-b', 'mixed-fail-b', 'mixed-ok-c'];
  for (const id of ids) {
    engine.createTask({ id, type: 'test', maxRetries: 0 });
    engine.enqueueTask(id);
    engine.claimTask(id);
    await engine.executeTask(id);
    await engine.ackTask(id);
  }

  for (const id of ids) {
    const ackedEvent = emittedEvents.find(
      (e) => e.type === 'TASK_ACKED' && e.taskId === id
    );
    assert.ok(ackedEvent, `TASK_ACKED must be emitted for task ${id}`);
  }
});

test('Partial Completion: queue is empty after all mixed-outcome tasks reach terminal state', async () => {
  const failingIds = new Set(['queue-drain-fail-1', 'queue-drain-fail-2']);

  const { engine } = makeEngine({
    executor: async (task) =>
      failingIds.has(task.id)
        ? { success: false, retryable: false }
        : { success: true, output: { taskId: task.id } }
  });

  const ids = ['queue-drain-fail-1', 'queue-drain-ok-2', 'queue-drain-fail-2', 'queue-drain-ok-3'];
  for (const id of ids) {
    engine.createTask({ id, type: 'test', maxRetries: 0 });
    engine.enqueueTask(id);
    engine.claimTask(id);
    await engine.executeTask(id);
    await engine.ackTask(id);
  }

  const queue = engine.getQueueSnapshot();
  assert.equal(queue.length, 0,
    'queue must be empty once all tasks have reached a terminal state');
});

// ─── Immutability contract ────────────────────────────────────────────────────

test('Immutability: createTask does not set status on the original input object', () => {
  const { engine } = makeEngine();
  const input = { id: 'immut-no-status', type: 'test' };
  assert.equal(input.status, undefined, 'precondition: input must have no status field');

  engine.createTask(input);

  assert.equal(input.status, undefined,
    'createTask must not add a status field to the original input object');
});

test('Immutability: createTask does not alter input id or type fields', () => {
  const { engine } = makeEngine();
  const input = { id: 'immut-fields', type: 'original-type' };
  engine.createTask(input);

  assert.equal(input.id, 'immut-fields', 'createTask must not alter input.id');
  assert.equal(input.type, 'original-type', 'createTask must not alter input.type');
});

test('Immutability: createTask returns a different object reference than the input', () => {
  const { engine } = makeEngine();
  const input = { id: 'immut-ref', type: 'test' };
  const stored = engine.createTask(input);

  assert.notEqual(stored, input,
    'createTask must return a new object, not the original input reference');
});

test('Immutability: post-creation mutation of input object does not change engine-stored status', () => {
  const { engine } = makeEngine();
  const input = { id: 'immut-post-mod', type: 'test' };
  engine.createTask(input);

  // Attempt to mutate the original input after the task was created
  input.status = 'hacked';

  const stored = engine.getTask('immut-post-mod');
  assert.equal(stored.status, 'created',
    'engine must retain its own status, unaffected by post-creation mutation of input');
});

test('Immutability: emitted event payload mutation does not change engine task status', async () => {
  const { engine, emittedEvents } = makeEngine();
  const taskId = 'immut-events';
  engine.createTask({ id: taskId, type: 'test' });

  const createdEvent = emittedEvents.find(
    (e) => e.type === 'TASK_CREATED' && e.taskId === taskId
  );
  assert.ok(createdEvent, 'TASK_CREATED must be emitted');

  // Mutate the captured event payload
  createdEvent.payload.status = 'CORRUPTED';

  // Engine internal state must be unaffected
  const task = engine.getTask(taskId);
  assert.equal(task.status, 'created',
    'engine task status must not be affected by mutation of a captured event payload');
});

test('Immutability: task returned by createTask has status managed exclusively by engine', async () => {
  const { engine } = makeEngine();
  const input = { id: 'immut-engine-status', type: 'test' };
  engine.createTask(input);

  // The returned stored task should reflect engine-managed status
  const retrieved = engine.getTask('immut-engine-status');
  assert.notEqual(retrieved, input,
    'retrieved task must not be the same reference as input');
  assert.equal(retrieved.status, 'created',
    'retrieved task must show engine-managed status');
  assert.equal(retrieved.attempts, 0,
    'retrieved task must have engine-initialised attempts=0');
});

// ─── Determinism (no real timing dependencies) ───────────────────────────────

test('Determinism: controlled clock produces monotonically-increasing timestamps', async () => {
  const { engine } = makeEngine({ now: makeDetClock(5_000_000) });

  const taskId = 'det-clock';
  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);
  await engine.ackTask(taskId);

  const task = engine.getTask(taskId);
  assert.ok(Number.isFinite(task.createdAt), 'createdAt must be set');
  assert.ok(Number.isFinite(task.acknowledgedAt), 'acknowledgedAt must be set');
  assert.ok(task.acknowledgedAt > task.createdAt,
    'acknowledgedAt must be strictly greater than createdAt');
  assert.ok(task.createdAt >= 5_000_000,
    'timestamps must originate from the controlled clock starting value');
});

test('Determinism: two isolated engines with same inputs produce same terminal states', async () => {
  function runScenario(taskId) {
    const { engine } = makeEngine({
      now: makeDetClock(1_000),
      executor: async (t) => ({ success: true, output: { taskId: t.id, fixed: true } })
    });
    engine.createTask({ id: taskId, type: 'test' });
    engine.enqueueTask(taskId);
    engine.claimTask(taskId);
    return engine.executeTask(taskId)
      .then(() => engine.ackTask(taskId))
      .then(() => engine.getTask(taskId));
  }

  const [taskA, taskB] = await Promise.all([
    runScenario('det-same-a'),
    runScenario('det-same-b')
  ]);

  assert.equal(taskA.status, 'acknowledged', 'task A must be acknowledged');
  assert.equal(taskB.status, 'acknowledged', 'task B must be acknowledged');
  assert.equal(taskA.attempts, taskB.attempts,
    'both tasks must have the same attempts count');
  assert.equal(taskA.maxRetries, taskB.maxRetries,
    'both tasks must have the same maxRetries');
});

test('Determinism: CANONICAL_TASK_PIPELINE has exactly 5 ordered stages', () => {
  assert.equal(CANONICAL_TASK_PIPELINE.length, 5,
    'pipeline must have exactly 5 canonical stages');
  assert.deepEqual(CANONICAL_TASK_PIPELINE, [
    'createTask',
    'enqueueTask',
    'claimTask',
    'executeTask',
    'ackTask'
  ], 'pipeline stages must match the canonical order');
});

test('Determinism: failure result is reproducible across repeated runs of same executor', async () => {
  for (let run = 0; run < 3; run++) {
    const { engine } = makeEngine({
      now: makeDetClock(run * 1_000 + 100),
      executor: async () => ({ success: false, retryable: false })
    });

    const taskId = `det-fail-run-${run}`;
    engine.createTask({ id: taskId, type: 'test', maxRetries: 0 });
    engine.enqueueTask(taskId);
    engine.claimTask(taskId);
    await engine.executeTask(taskId);
    await engine.ackTask(taskId);

    assert.equal(engine.getTask(taskId).status, 'failed',
      `run ${run}: task must consistently reach failed state`);
  }
});
