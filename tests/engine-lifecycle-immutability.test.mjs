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
