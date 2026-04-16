import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorldState } from '../core/world/deriveWorldState.js';
import { getTaskStatus, getTaskEvents } from '../ui/selectors/taskSelectors.js';

test('does NOT mark task failed without TASK_ACKED', () => {
  const events = [
    { type: 'TASK_CREATED', taskId: 't1', timestamp: 1, payload: {} },
    { type: 'TASK_EXECUTE_FINISHED', taskId: 't1', timestamp: 2, payload: { success: false, error: 'boom' } }
  ];

  const world = deriveWorldState(events);
  const status = getTaskStatus(world, 't1');
  const taskEvents = getTaskEvents(world, 't1');

  assert.ok(taskEvents.length > 0, 'task should be present in indexed world');
  assert.equal(status, 'awaiting_ack');
  assert.notEqual(status, 'failed');
});

test('marks task failed only when TASK_ACKED payload.status is failed', () => {
  const events = [
    { type: 'TASK_CREATED', taskId: 't2', timestamp: 1, payload: {} },
    { type: 'TASK_EXECUTE_FINISHED', taskId: 't2', timestamp: 2, payload: { success: false } },
    { type: 'TASK_ACKED', taskId: 't2', timestamp: 3, payload: { status: 'failed' } }
  ];

  const world = deriveWorldState(events);
  const status = getTaskStatus(world, 't2');
  const taskEvents = getTaskEvents(world, 't2');

  assert.ok(taskEvents.length > 0, 'task should be present in indexed world');
  assert.equal(status, 'failed');
});

test('ignores TASK_FAILED without ACK', () => {
  const events = [
    { type: 'TASK_CREATED', taskId: 't3', timestamp: 1, payload: {} },
    { type: 'TASK_FAILED', taskId: 't3', timestamp: 2, payload: { error: 'legacy' } }
  ];

  const world = deriveWorldState(events);
  const status = getTaskStatus(world, 't3');
  const taskEvents = getTaskEvents(world, 't3');

  assert.ok(taskEvents.length > 0, 'task should be present in indexed world');
  assert.notEqual(status, 'failed');
  assert.equal(status, 'created');
});

test('ACK always produces terminal state', () => {
  const events = [
    { type: 'TASK_CREATED', taskId: 't4', timestamp: 1, payload: {} },
    { type: 'TASK_EXECUTE_FINISHED', taskId: 't4', timestamp: 2, payload: { success: true } },
    { type: 'TASK_ACKED', taskId: 't4', timestamp: 3, payload: { status: 'completed' } }
  ];

  const world = deriveWorldState(events);
  const status = getTaskStatus(world, 't4');
  const taskEvents = getTaskEvents(world, 't4');

  assert.ok(taskEvents.length > 0, 'task should be present in indexed world');
  assert.ok(['completed', 'failed'].includes(status), 'ACK should produce a terminal state');
});

test('does NOT mark task completed without TASK_ACKED', () => {
  const events = [
    { type: 'TASK_CREATED', taskId: 't5', timestamp: 1, payload: {} },
    { type: 'TASK_EXECUTE_FINISHED', taskId: 't5', timestamp: 2, payload: { success: true } }
  ];

  const world = deriveWorldState(events);
  const status = getTaskStatus(world, 't5');
  const taskEvents = getTaskEvents(world, 't5');

  assert.ok(taskEvents.length > 0, 'task should be present in indexed world');
  assert.equal(status, 'awaiting_ack');
  assert.notEqual(status, 'completed');
  assert.notEqual(status, 'failed');
});
