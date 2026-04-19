import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine } from '../core/engine/taskEngine.js';

/**
 * TaskEngine Lifecycle Immutability Tests
 *
 * Verifies that TASK_ACKED is the final terminal state and that
 * no further state transitions are permitted or applied after it.
 */

function makeEngine(overrides = {}) {
  const emittedEvents = [];
  const engine = createTaskEngine({
    emitEvent: (event) => emittedEvents.push({ type: event.event, taskId: event.taskId, payload: event.payload }),
    executor: async (task) => ({ success: true, output: { taskId: task.id } }),
    ...overrides
  });
  return { engine, emittedEvents };
}

async function runToAcked(engine, taskId = 'test-task-1') {
  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);
  const ackedTask = await engine.ackTask(taskId);
  return ackedTask;
}

// ─── Terminal state assertion ─────────────────────────────────────────────────

test('TASK_ACKED: task status is acknowledged after successful ack', async () => {
  const { engine } = makeEngine();
  const ackedTask = await runToAcked(engine);
  assert.equal(ackedTask.status, 'acknowledged');
});

test('TASK_ACKED: TASK_ACKED event is emitted exactly once', async () => {
  const { engine, emittedEvents } = makeEngine();
  await runToAcked(engine);
  const ackedEvents = emittedEvents.filter((e) => e.type === 'TASK_ACKED');
  assert.equal(ackedEvents.length, 1);
});

test('TASK_ACKED: no events are emitted after TASK_ACKED', async () => {
  const { engine, emittedEvents } = makeEngine();
  await runToAcked(engine);
  const ackedIndex = emittedEvents.findIndex((e) => e.type === 'TASK_ACKED');
  assert.ok(ackedIndex >= 0, 'TASK_ACKED must be present');
  const eventsAfterAck = emittedEvents.slice(ackedIndex + 1);
  assert.equal(
    eventsAfterAck.length,
    0,
    `Expected no events after TASK_ACKED, got: ${eventsAfterAck.map((e) => e.type).join(', ')}`
  );
});

// ─── Re-ack rejection ─────────────────────────────────────────────────────────

test('TASK_ACKED: ackTask on an already-acked task throws ENGINE_ENFORCEMENT_VIOLATION', async () => {
  const { engine } = makeEngine();
  await runToAcked(engine, 'test-ack-twice');
  await assert.rejects(
    () => engine.ackTask('test-ack-twice'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'ENGINE_ENFORCEMENT_VIOLATION');
      return true;
    }
  );
});

test('TASK_ACKED: second ackTask emits no additional TASK_ACKED event', async () => {
  const { engine, emittedEvents } = makeEngine();
  await runToAcked(engine, 'test-no-double-emit');
  try {
    await engine.ackTask('test-no-double-emit');
  } catch (_err) {
    // expected rejection
  }
  const ackedCount = emittedEvents.filter((e) => e.type === 'TASK_ACKED').length;
  assert.equal(ackedCount, 1);
});

// ─── Re-execution rejection ───────────────────────────────────────────────────

test('TASK_ACKED: executeTask on an acknowledged task returns idempotent result', async () => {
  const { engine } = makeEngine();
  await runToAcked(engine, 'test-re-execute');
  const result = await engine.executeTask('test-re-execute');
  // Engine returns the last result without re-running the executor
  assert.ok(result, 'Should return a result object');
  assert.equal(result.success, true);
});

test('TASK_ACKED: executeTask on acknowledged task emits TASK_EXECUTE_SKIPPED_IDEMPOTENT, not TASK_EXECUTE_STARTED', async () => {
  const { engine, emittedEvents } = makeEngine();
  await runToAcked(engine, 'test-skip-idempotent');

  const countBefore = emittedEvents.filter((e) => e.type === 'TASK_EXECUTE_STARTED').length;
  await engine.executeTask('test-skip-idempotent');
  const countAfter = emittedEvents.filter((e) => e.type === 'TASK_EXECUTE_STARTED').length;

  assert.equal(countBefore, countAfter, 'TASK_EXECUTE_STARTED must not be emitted after TASK_ACKED');

  const skipped = emittedEvents.filter((e) => e.type === 'TASK_EXECUTE_SKIPPED_IDEMPOTENT');
  assert.ok(skipped.length >= 1, 'TASK_EXECUTE_SKIPPED_IDEMPOTENT should be emitted');
});

// ─── Enqueue / claim rejection after ack ─────────────────────────────────────

test('TASK_ACKED: claimTask returns null on acknowledged task', async () => {
  const { engine } = makeEngine();
  await runToAcked(engine, 'test-claim-after-ack');
  const result = engine.claimTask('test-claim-after-ack');
  assert.equal(result, null, 'claimTask must return null for an acknowledged task');
});

test('TASK_ACKED: enqueueTask on acknowledged task does not add task back to queue', async () => {
  const { engine } = makeEngine();
  await runToAcked(engine, 'test-enqueue-after-ack');
  engine.enqueueTask('test-enqueue-after-ack');
  const queue = engine.getQueueSnapshot();
  assert.ok(!queue.includes('test-enqueue-after-ack'), 'Acknowledged task must not re-enter the queue');
});

// ─── Terminal state for failed acks ──────────────────────────────────────────

test('TASK_ACKED: failed execution also reaches terminal state via TASK_ACKED', async () => {
  const { engine, emittedEvents } = makeEngine({
    executor: async () => ({ success: false, retryable: false })
  });

  const taskId = 'test-failed-terminal';
  engine.createTask({ id: taskId, type: 'test', maxRetries: 0 });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);
  const ackedTask = await engine.ackTask(taskId);

  assert.equal(ackedTask.status, 'failed');
  const ackedEvent = emittedEvents.find((e) => e.type === 'TASK_ACKED');
  assert.ok(ackedEvent, 'TASK_ACKED must be emitted even on failure');
  assert.equal(ackedEvent.payload.status, 'failed');
});

test('TASK_ACKED: ackTask on failed task also throws ENGINE_ENFORCEMENT_VIOLATION', async () => {
  const { engine } = makeEngine({
    executor: async () => ({ success: false, retryable: false })
  });

  const taskId = 'test-failed-no-reack';
  engine.createTask({ id: taskId, type: 'test', maxRetries: 0 });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);
  await engine.ackTask(taskId);

  await assert.rejects(
    () => engine.ackTask(taskId),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'ENGINE_ENFORCEMENT_VIOLATION');
      return true;
    }
  );
});

// ─── getTask reflects terminal state ─────────────────────────────────────────

test('TASK_ACKED: getTask reflects terminal status after ack', async () => {
  const { engine } = makeEngine();
  await runToAcked(engine, 'test-get-terminal');
  const task = engine.getTask('test-get-terminal');
  assert.ok(['acknowledged', 'failed'].includes(task.status), `Expected terminal status, got: ${task.status}`);
});

test('TASK_ACKED: task has acknowledgedAt timestamp set after ack', async () => {
  const { engine } = makeEngine();
  await runToAcked(engine, 'test-timestamp');
  const task = engine.getTask('test-timestamp');
  assert.ok(Number.isFinite(task.acknowledgedAt) && task.acknowledgedAt > 0, 'acknowledgedAt must be a valid timestamp');
});

// ─── executionRecord prerequisite ────────────────────────────────────────────

test('TASK_ACKED: ackTask throws ENGINE_ENFORCEMENT_VIOLATION when executionRecord is null', async () => {
  const { engine } = makeEngine();
  const taskId = 'test-no-execution-record';

  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);

  // Task is now in awaiting_ack with a valid executionRecord.
  // Clear it via the internal task reference to simulate the corrupt state.
  const task = engine.getTask(taskId);
  task.executionRecord = null;

  await assert.rejects(
    () => engine.ackTask(taskId),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'ENGINE_ENFORCEMENT_VIOLATION');
      return true;
    }
  );
});

test('TASK_ACKED: ackTask throws ENGINE_ENFORCEMENT_VIOLATION when executionRecord.result is missing', async () => {
  const { engine } = makeEngine();
  const taskId = 'test-no-execution-result';

  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);

  const task = engine.getTask(taskId);
  task.executionRecord = { completedAt: Date.now() }; // result field absent

  await assert.rejects(
    () => engine.ackTask(taskId),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'ENGINE_ENFORCEMENT_VIOLATION');
      return true;
    }
  );
});

test('TASK_ACKED: ackTask with missing executionRecord emits no TASK_ACKED event', async () => {
  const { engine, emittedEvents } = makeEngine();
  const taskId = 'test-no-record-no-event';

  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);

  engine.getTask(taskId).executionRecord = null;

  try {
    await engine.ackTask(taskId);
  } catch (_err) {
    // expected
  }

  const ackedEvents = emittedEvents.filter((e) => e.type === 'TASK_ACKED' && e.taskId === taskId);
  assert.equal(ackedEvents.length, 0, 'TASK_ACKED must not be emitted when executionRecord is absent');
});

// ─── Worker mutation bypass ───────────────────────────────────────────────────

test('Worker: returning a mutated status field in result does not change task lifecycle state', async () => {
  // A worker that tries to smuggle a lifecycle status via its result output.
  const { engine } = makeEngine({
    executor: async (task) => ({
      success: true,
      output: {
        taskId: task.id,
        // Attempting to inject a status transition via result payload.
        status: 'acknowledged',
        lifecycle: 'completed'
      }
    })
  });

  const taskId = 'test-worker-status-smuggle';
  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);

  // Engine must not have applied the worker-supplied status.
  const task = engine.getTask(taskId);
  assert.equal(task.status, 'awaiting_ack', 'Task must be awaiting_ack; worker result must not alter lifecycle state');
});

test('Worker: directly writing task.status during execution does not bypass ackTask requirement', async () => {
  let capturedTask = null;

  // Executor captures the task reference and attempts a direct status mutation.
  const { engine, emittedEvents } = makeEngine({
    executor: async (task) => {
      capturedTask = task;
      task.status = 'acknowledged'; // direct mutation attempt
      return { success: true, output: { taskId: task.id } };
    }
  });

  const taskId = 'test-worker-direct-mutate';
  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);

  // The engine overwrites task.status to 'awaiting_ack' after the executor resolves.
  const task = engine.getTask(taskId);
  assert.equal(task.status, 'awaiting_ack', 'Engine must overwrite worker-mutated status to awaiting_ack');

  // TASK_ACKED must not have been emitted — ackTask was never called.
  const ackedEvents = emittedEvents.filter((e) => e.type === 'TASK_ACKED');
  assert.equal(ackedEvents.length, 0, 'TASK_ACKED must not be emitted due to a worker direct mutation');
});

test('Worker: direct status mutation after execution does not skip ackTask requirement', async () => {
  const { engine, emittedEvents } = makeEngine();

  const taskId = 'test-worker-post-exec-mutate';
  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);
  await engine.executeTask(taskId);

  // Simulate a worker/external actor obtaining the task reference and mutating it.
  const task = engine.getTask(taskId);
  task.status = 'acknowledged';

  // Even after the forced mutation, TASK_ACKED must not have been emitted.
  const ackedEvents = emittedEvents.filter((e) => e.type === 'TASK_ACKED');
  assert.equal(ackedEvents.length, 0, 'TASK_ACKED must not be emitted by direct status mutation');

  // The engine still requires a proper ackTask call to complete the lifecycle.
  // Restore awaiting_ack so ackTask can proceed, confirming the engine is still authoritative.
  task.status = 'awaiting_ack';
  const ackedTask = await engine.ackTask(taskId);
  assert.equal(ackedTask.status, 'acknowledged', 'Engine must still govern the final acknowledged transition via ackTask');

  const ackedEventsAfter = emittedEvents.filter((e) => e.type === 'TASK_ACKED');
  assert.equal(ackedEventsAfter.length, 1, 'TASK_ACKED must only be emitted by TaskEngine via ackTask');
});

// ─── ACK invalid without executionRecord ever being set ──────────────────────

test('ACK prerequisite: ackTask rejects when awaiting_ack reached without executeTask (executionRecord never set)', async () => {
  // Scenario: task is created and claimed, but executeTask is never called.
  // A direct status mutation forces awaiting_ack, simulating a partial/skipped
  // execution path. executionRecord remains null (its initial value).
  const { engine } = makeEngine();
  const taskId = 'test-ack-no-execute';

  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);

  // Skip executeTask entirely — force the status without going through the engine.
  const task = engine.getTask(taskId);
  assert.equal(task.executionRecord, null, 'executionRecord must be null before executeTask is called');
  task.status = 'awaiting_ack';

  await assert.rejects(
    () => engine.ackTask(taskId),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'ENGINE_ENFORCEMENT_VIOLATION');
      return true;
    }
  );
});

test('ACK prerequisite: no TASK_ACKED event emitted when executionRecord was never set', async () => {
  const { engine, emittedEvents } = makeEngine();
  const taskId = 'test-ack-no-execute-no-event';

  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);

  engine.getTask(taskId).status = 'awaiting_ack';

  try {
    await engine.ackTask(taskId);
  } catch (_err) {
    // expected rejection
  }

  const ackedEvents = emittedEvents.filter((e) => e.type === 'TASK_ACKED' && e.taskId === taskId);
  assert.equal(ackedEvents.length, 0, 'TASK_ACKED must not be emitted without a stored executionRecord');
});

test('ACK prerequisite: task status remains awaiting_ack after failed ack with no executionRecord', async () => {
  const { engine } = makeEngine();
  const taskId = 'test-ack-no-execute-status-preserved';

  engine.createTask({ id: taskId, type: 'test' });
  engine.enqueueTask(taskId);
  engine.claimTask(taskId);

  engine.getTask(taskId).status = 'awaiting_ack';

  try {
    await engine.ackTask(taskId);
  } catch (_err) {
    // expected rejection
  }

  // The engine must not have advanced the status; the task stays in awaiting_ack.
  const task = engine.getTask(taskId);
  assert.equal(task.status, 'awaiting_ack', 'Task status must remain awaiting_ack after a rejected ack attempt');
  assert.equal(task.executionRecord, null, 'executionRecord must still be null after rejected ack');
});
