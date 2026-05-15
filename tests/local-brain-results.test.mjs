import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveWorldState } from '../core/world/deriveWorldState.js';
import { buildVisualWorldGraph } from '../core/world/buildVisualWorldGraph.js';
import { getAllTasks, getTaskTransitionTimestamps } from '../ui/selectors/taskSelectors.js';
import { buildLocalBrainModel } from '../ui/operator-control-panel.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function ev(type, taskId, timestamp, payload = {}) {
  return { type, taskId, timestamp, payload };
}

function localBrainGraph(events) {
  const world = deriveWorldState(events);
  const tasks = getAllTasks(world);
  const transitions = Object.fromEntries(
    tasks.map((task) => [task.id, getTaskTransitionTimestamps(world, task.id)])
  );
  return buildVisualWorldGraph({ tasks, transitions });
}

test('completed local_llm task appears in Local Brain card', () => {
  const graph = localBrainGraph([
    ev('TASK_CREATED', 'brain-1', 1000, { type: 'local_llm', title: 'Brain hello' }),
    ev('TASK_ENQUEUED', 'brain-1', 1100),
    ev('TASK_CLAIMED', 'brain-1', 1200, { workerId: 'local-llm-worker' }),
    ev('TASK_EXECUTE_STARTED', 'brain-1', 1300, { workerId: 'local-llm-worker' }),
    ev('TASK_EXECUTE_FINISHED', 'brain-1', 1400, { success: true }),
    ev('TASK_ACKED', 'brain-1', 1500, { status: 'acknowledged', success: true }),
    ev('LOCAL_LLM_COMPLETED', 'brain-1', 1600, {
      taskId: 'brain-1',
      title: 'Brain hello',
      prompt: 'Say hello from local brain',
      text: 'Hello from the local brain.\nI am ready.',
      provider: 'ollama',
      model: 'llama3.1:8b'
    })
  ]);

  const node = graph.nodes.find((entry) => entry.id === 'brain-1');
  assert.equal(node.metadata.localBrain.text, 'Hello from the local brain.\nI am ready.');

  const card = buildLocalBrainModel(graph.nodes);
  assert.equal(card.status, 'completed');
  assert.equal(card.title, 'Brain hello');
  assert.equal(card.prompt, 'Say hello from local brain');
  assert.equal(card.reply, 'Hello from the local brain.\nI am ready.');
  assert.equal(card.error, '');
});

test('failed local_llm task shows error in Local Brain card', () => {
  const graph = localBrainGraph([
    ev('TASK_CREATED', 'brain-fail', 1000, { type: 'local_llm', title: 'Brain failure' }),
    ev('TASK_ENQUEUED', 'brain-fail', 1100),
    ev('TASK_CLAIMED', 'brain-fail', 1200, { workerId: 'local-llm-worker' }),
    ev('TASK_EXECUTE_STARTED', 'brain-fail', 1300, { workerId: 'local-llm-worker' }),
    ev('TASK_EXECUTE_FINISHED', 'brain-fail', 1400, { success: false, error: 'ollama_request_failed:503' }),
    ev('TASK_ACKED', 'brain-fail', 1500, { status: 'failed', success: false, error: 'ollama_request_failed:503' }),
    ev('LOCAL_LLM_FAILED', 'brain-fail', 1600, {
      taskId: 'brain-fail',
      title: 'Brain failure',
      prompt: 'Try local brain',
      error: 'ollama_request_failed:503',
      provider: 'ollama'
    })
  ]);

  const card = buildLocalBrainModel(graph.nodes);
  assert.equal(card.status, 'failed');
  assert.equal(card.title, 'Brain failure');
  assert.equal(card.prompt, 'Try local brain');
  assert.equal(card.reply, '');
  assert.equal(card.error, 'ollama_request_failed:503');
});

test('UI does not import or call Ollama provider directly', () => {
  const uiFiles = [
    'ui/operator-control-panel.js',
    'ui/task-creator-panel.js',
    'ui/control-api.js',
    'ui/window-api.js'
  ];

  for (const relPath of uiFiles) {
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    assert.equal(/ollamaProvider|integrations\/llm\/providers|\/api\/generate|127\.0\.0\.1:11434/.test(source), false, relPath);
  }
});
