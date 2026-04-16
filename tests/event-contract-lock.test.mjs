import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorldState } from '../core/world/deriveWorldState.js';

test('does NOT mark task failed without TASK_ACKED', () => {
  const events = [
    { type: 'TASK_CREATED', taskId: 't1', timestamp: 1, payload: {} },
    { type: 'TASK_EXECUTE_FINISHED', taskId: 't1', timestamp: 2, payload: { success: false, error: 'boom' } }
  ];

  const world = deriveWorldState(events);
  const task = world.tasks.find((item) => item.id === 't1');

  assert.ok(task, 'task should be present in world state');
  assert.equal(task.status, 'awaiting_ack');
  assert.notEqual(task.status, 'failed');
});

test('marks task failed only when TASK_ACKED payload.status is failed', () => {
  const events = [
    { type: 'TASK_CREATED', taskId: 't2', timestamp: 1, payload: {} },
    { type: 'TASK_EXECUTE_FINISHED', taskId: 't2', timestamp: 2, payload: { success: false } },
    { type: 'TASK_ACKED', taskId: 't2', timestamp: 3, payload: { status: 'failed' } }
  ];

  const world = deriveWorldState(events);
  const task = world.tasks.find((item) => item.id === 't2');

  assert.ok(task, 'task should be present in world state');
  assert.equal(task.status, 'failed');
});

test('ignores TASK_FAILED without ACK', () => {
  const events = [
    { type: 'TASK_CREATED', taskId: 't3', timestamp: 1, payload: {} },
    { type: 'TASK_FAILED', taskId: 't3', timestamp: 2, payload: { error: 'legacy' } }
  ];

  const world = deriveWorldState(events);
  const task = world.tasks.find((item) => item.id === 't3');

  assert.ok(task, 'task should be present in world state');
  assert.notEqual(task.status, 'failed');
  assert.equal(task.status, 'created');
});

test('ACK always produces terminal state', () => {
  const events = [
    { type: 'TASK_CREATED', taskId: 't4', timestamp: 1, payload: {} },
    { type: 'TASK_EXECUTE_FINISHED', taskId: 't4', timestamp: 2, payload: { success: true } },
    { type: 'TASK_ACKED', taskId: 't4', timestamp: 3, payload: { status: 'completed' } }
  ];

  const world = deriveWorldState(events);
  const task = world.tasks.find((item) => item.id === 't4');

  assert.ok(task, 'task should be present in world state');
  assert.ok(['completed', 'failed'].includes(task.status), 'ACK should produce a terminal state');
});

test('does NOT mark task completed without TASK_ACKED', () => {
  const events = [
    { type: 'TASK_CREATED', taskId: 't5', timestamp: 1, payload: {} },
    { type: 'TASK_EXECUTE_FINISHED', taskId: 't5', timestamp: 2, payload: { success: true } }
  ];

  const world = deriveWorldState(events);
  const task = world.tasks.find((item) => item.id === 't5');

  assert.ok(task, 'task should be present in world state');
  assert.equal(task.status, 'awaiting_ack');
  assert.notEqual(task.status, 'completed');
  assert.notEqual(task.status, 'failed');
});
