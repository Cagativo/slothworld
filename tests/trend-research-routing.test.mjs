import test from 'node:test';
import assert from 'node:assert/strict';

import { createTaskEngine } from '../core/engine/taskEngine.js';
import { TREND_RESEARCH_WORKER_ID } from '../core/engine/workerCapabilityPolicy.js';

test('TaskEngine routing: TREND_RESEARCH cannot be claimed by generic worker', () => {
  const emittedEvents = [];
  const engine = createTaskEngine({
    emitEvent: (event) => emittedEvents.push(event)
  });

  engine.enqueueTask({
    id: 'trend-generic-denied',
    type: 'TREND_RESEARCH',
    payload: { keyword: 'hoodie', workerId: TREND_RESEARCH_WORKER_ID }
  });

  const result = engine.claimTask('trend-generic-denied', 'generic-worker');

  assert.equal(result, null);
  assert.equal(engine.getTask('trend-generic-denied').status, 'queued');
  assert.deepEqual(engine.getQueueSnapshot(), ['trend-generic-denied']);
  assert.equal(
    emittedEvents.some((event) => event.event === 'TASK_CLAIMED'),
    false,
    'ineligible worker must not emit TASK_CLAIMED'
  );
});

test('TaskEngine routing: TREND_RESEARCH can be claimed by research-capable worker', () => {
  const emittedEvents = [];
  const engine = createTaskEngine({
    emitEvent: (event) => emittedEvents.push(event)
  });

  engine.enqueueTask({
    id: 'trend-research-claimed',
    type: 'TREND_RESEARCH',
    payload: { keyword: 'hoodie' }
  });

  const result = engine.claimTask('trend-research-claimed', TREND_RESEARCH_WORKER_ID);
  const claimedEvent = emittedEvents.find((event) => event.event === 'TASK_CLAIMED');

  assert.ok(result);
  assert.equal(result.status, 'claimed');
  assert.equal(result.assignedAgentId, TREND_RESEARCH_WORKER_ID);
  assert.equal(claimedEvent.payload.assignedAgentId, TREND_RESEARCH_WORKER_ID);
  assert.equal(claimedEvent.payload.workerId, TREND_RESEARCH_WORKER_ID);
});

test('TaskEngine routing: TREND_RESEARCH with random payload.workerId claims as research worker', () => {
  const emittedEvents = [];
  const engine = createTaskEngine({
    emitEvent: (event) => emittedEvents.push(event)
  });

  engine.enqueueTask({
    id: 'trend-random-worker-payload',
    type: 'TREND_RESEARCH',
    payload: { keyword: 'hoodie', workerId: 'random-worker' }
  });

  const result = engine.claimTask('trend-random-worker-payload');
  const claimedEvent = emittedEvents.find((event) => event.event === 'TASK_CLAIMED');

  assert.ok(result);
  assert.equal(result.assignedAgentId, TREND_RESEARCH_WORKER_ID);
  assert.equal(claimedEvent.payload.assignedAgentId, TREND_RESEARCH_WORKER_ID);
  assert.equal(claimedEvent.payload.workerId, TREND_RESEARCH_WORKER_ID);
});

test('TaskEngine routing: TREND_RESEARCH with random payload.agentId claims as research worker', () => {
  const emittedEvents = [];
  const engine = createTaskEngine({
    emitEvent: (event) => emittedEvents.push(event)
  });

  engine.enqueueTask({
    id: 'trend-random-agent-payload',
    type: 'TREND_RESEARCH',
    payload: { keyword: 'hoodie', agentId: 'random-agent' }
  });

  const result = engine.claimTask('trend-random-agent-payload');
  const claimedEvent = emittedEvents.find((event) => event.event === 'TASK_CLAIMED');

  assert.ok(result);
  assert.equal(result.assignedAgentId, TREND_RESEARCH_WORKER_ID);
  assert.equal(claimedEvent.payload.assignedAgentId, TREND_RESEARCH_WORKER_ID);
  assert.equal(claimedEvent.payload.workerId, TREND_RESEARCH_WORKER_ID);
});

test('TaskEngine routing: TREND_RESEARCH with channelId only claims as research worker', () => {
  const emittedEvents = [];
  const engine = createTaskEngine({
    emitEvent: (event) => emittedEvents.push(event)
  });

  engine.enqueueTask({
    id: 'trend-channel-not-worker',
    type: 'TREND_RESEARCH',
    payload: { keyword: 'hoodie', channelId: '1491500223288184964' }
  });

  const result = engine.claimTask('trend-channel-not-worker');
  const claimedEvent = emittedEvents.find((event) => event.event === 'TASK_CLAIMED');

  assert.ok(result);
  assert.equal(result.assignedAgentId, TREND_RESEARCH_WORKER_ID);
  assert.equal(claimedEvent.payload.assignedAgentId, TREND_RESEARCH_WORKER_ID);
  assert.equal(claimedEvent.payload.workerId, TREND_RESEARCH_WORKER_ID);
});

test('TaskEngine routing: generic task behavior still works', () => {
  const engine = createTaskEngine();

  engine.enqueueTask({
    id: 'generic-claimable',
    type: 'standard',
    payload: {}
  });

  const result = engine.claimTask('generic-claimable', 'generic-worker');

  assert.ok(result);
  assert.equal(result.status, 'claimed');
  assert.equal(result.assignedAgentId, 'generic-worker');
});

test('TaskEngine routing: queue scan skips unclaimable TREND_RESEARCH and claims generic task', () => {
  const engine = createTaskEngine();

  engine.enqueueTask({
    id: 'trend-skipped',
    type: 'TREND_RESEARCH',
    payload: { keyword: 'hoodie', workerId: TREND_RESEARCH_WORKER_ID }
  });
  engine.enqueueTask({
    id: 'generic-after-trend',
    type: 'standard',
    payload: {}
  });

  const result = engine.claimTask(null, 'generic-worker');

  assert.ok(result);
  assert.equal(result.id, 'generic-after-trend');
  assert.equal(result.assignedAgentId, 'generic-worker');
  assert.deepEqual(engine.getQueueSnapshot(), ['trend-skipped']);
  assert.equal(engine.getTask('trend-skipped').status, 'queued');
});
