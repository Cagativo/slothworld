import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine } from '../core/engine/taskEngine.js';

/**
 * Golden Path Test
 * 
 * Tests a complete deterministic task flow:
 * POST /task → TaskEngine → events → execution → ACK
 */

test('Golden Path: Complete Task Lifecycle', async (t) => {
  const emittedEvents = [];

  // Create TaskEngine with direct stream capture.
  const taskEngine = createTaskEngine({
    emitEvent: (event) => {
      emittedEvents.push({
        type: event.event,
        timestamp: event.timestamp,
        taskId: event.taskId,
        payload: event.payload
      });
    },
    executor: async (task) => {
      // Simple mock executor: just return success
      return {
        success: true,
        output: {
          taskId: task.id,
          executedAt: Date.now(),
          message: 'Golden path task executed'
        }
      };
    }
  });

  // STEP 1: CREATE TASK
  const task = taskEngine.createTask({
    id: 'golden-path-1',
    type: 'golden-path',
    payload: { message: 'test golden path' }
  });

  assert.equal(task.status, 'created', 'Task should be created');
  assert.equal(task.id, 'golden-path-1', 'Task ID should match');

  // Verify event was emitted
  let createdEvent = emittedEvents.find((e) => e.type === 'TASK_CREATED');
  assert.ok(createdEvent, 'TASK_CREATED event should be emitted');
  assert.equal(createdEvent.taskId, 'golden-path-1', 'Event should reference task ID');

  // STEP 2: ENQUEUE TASK
  const enqueuedTask = taskEngine.enqueueTask(task.id);
  assert.equal(enqueuedTask.status, 'queued', 'Task should be queued');

  const queuedEvent = emittedEvents.find((e) => e.type === 'TASK_ENQUEUED');
  assert.ok(queuedEvent, 'TASK_ENQUEUED event should be emitted');

  // STEP 3: CLAIM TASK
  const claimedTask = taskEngine.claimTask(task.id);
  assert.ok(claimedTask, 'Task should be claimed');
  assert.equal(claimedTask.status, 'claimed', 'Task status should be claimed');

  const claimedEvent = emittedEvents.find((e) => e.type === 'TASK_CLAIMED');
  assert.ok(claimedEvent, 'TASK_CLAIMED event should be emitted');

  // STEP 4: EXECUTE TASK
  const result = await taskEngine.executeTask(task.id);
  assert.ok(result, 'Execute should return result');
  assert.equal(result.success, true, 'Execution should succeed');

  const executedTask = taskEngine.getTask(task.id);
  assert.equal(executedTask.status, 'awaiting_ack', 'Task should be awaiting_ack after execution');

  const startEvent = emittedEvents.find((e) => e.type === 'TASK_EXECUTE_STARTED');
  assert.ok(startEvent, 'TASK_EXECUTE_STARTED event should be emitted');

  const finishEvent = emittedEvents.find((e) => e.type === 'TASK_EXECUTE_FINISHED');
  assert.ok(finishEvent, 'TASK_EXECUTE_FINISHED event should be emitted');

  // STEP 5: ACK TASK
  const ackedTask = await taskEngine.ackTask(task.id);
  assert.equal(ackedTask.status, 'acknowledged', 'Task should be acknowledged');
  assert.ok(ackedTask.acknowledgedAt, 'Task should have acknowledgedAt timestamp');

  const ackedEvent = emittedEvents.find((e) => e.type === 'TASK_ACKED');
  assert.ok(ackedEvent, 'TASK_ACKED event should be emitted');

  // VERIFICATION: Check full event stream
  const expectedEventSequence = [
    'TASK_CREATED',
    'TASK_ENQUEUED',
    'TASK_CLAIMED',
    'TASK_EXECUTE_STARTED',
    'TASK_EXECUTE_FINISHED',
    'TASK_ACKED'
  ];

  const actualSequence = emittedEvents.map((e) => e.type);
  assert.deepEqual(
    actualSequence,
    expectedEventSequence,
    `Event sequence should match golden path: ${expectedEventSequence.join(' → ')}`
  );

  console.log('✅ Golden Path: All checks passed');
  console.log(`   - Events emitted: ${emittedEvents.length}`);
  console.log(`   - Event sequence: ${actualSequence.join(' → ')}`);
  console.log('   - Unified stream verification: OK');
});
