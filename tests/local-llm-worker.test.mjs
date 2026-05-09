import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TASK_TYPE_LOCAL_LLM } from '../core/constants.js';
import { createTaskEngine } from '../core/engine/taskEngine.js';
import {
  LOCAL_LLM_WORKER_ID,
  isWorkerEligibleForTaskType
} from '../core/engine/workerCapabilityPolicy.js';
import { createTaskExecutionWorker } from '../core/workers/taskExecutionWorker.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_DIR = join(ROOT, 'ui');

function collectJs(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectJs(full));
    } else if (entry.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

function createExecutionAdapter() {
  const worker = createTaskExecutionWorker({
    getDiscordClient: () => null,
    taskTriggeredMessageIds: new Set()
  });

  return async (task) => {
    const execution = await worker.executeTask(task);
    return {
      success: execution && execution.success === true,
      output: execution && Object.prototype.hasOwnProperty.call(execution, 'result')
        ? execution.result
        : execution,
      error: execution && execution.error ? execution.error : undefined,
      retryable: false
    };
  };
}

function withFetch(mockFetch, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = previousFetch;
    });
}

function withOllamaEnv(env, fn) {
  const previousBaseUrl = process.env.OLLAMA_BASE_URL;
  const previousModel = process.env.OLLAMA_MODEL;

  process.env.OLLAMA_BASE_URL = env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  process.env.OLLAMA_MODEL = env.OLLAMA_MODEL || 'llama3.1:8b';

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previousBaseUrl === undefined) {
        delete process.env.OLLAMA_BASE_URL;
      } else {
        process.env.OLLAMA_BASE_URL = previousBaseUrl;
      }

      if (previousModel === undefined) {
        delete process.env.OLLAMA_MODEL;
      } else {
        process.env.OLLAMA_MODEL = previousModel;
      }
    });
}

test('Capability policy: local-llm-worker can claim LOCAL_LLM', () => {
  assert.equal(isWorkerEligibleForTaskType(LOCAL_LLM_WORKER_ID, TASK_TYPE_LOCAL_LLM), true);
  assert.equal(isWorkerEligibleForTaskType('generic-worker', TASK_TYPE_LOCAL_LLM), false);
});

test('LOCAL_LLM task executes through TaskExecutionWorker and TaskEngine lifecycle', async () => {
  const emittedEvents = [];
  const fetchCalls = [];

  await withOllamaEnv({
    OLLAMA_BASE_URL: 'http://ollama.test:11434',
    OLLAMA_MODEL: 'llama3.1:8b'
  }, async () => withFetch(async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'llama3.1:8b',
        response: 'local response',
        done: true,
        eval_count: 2
      })
    };
  }, async () => {
    const engine = createTaskEngine({
      emitEvent: (event) => emittedEvents.push(event),
      executor: createExecutionAdapter()
    });

    engine.createTask({
      id: 'local-llm-ok',
      type: TASK_TYPE_LOCAL_LLM,
      payload: {
        prompt: 'Summarize this',
        system: 'Be terse',
        temperature: 0.1
      }
    });
    engine.enqueueTask('local-llm-ok');

    const execution = await engine.executeTask('local-llm-ok');
    assert.equal(execution.success, true);
    assert.equal(execution.output.provider, 'ollama');
    assert.equal(execution.output.text, 'local response');
    assert.equal(execution.output.metadata.model, 'llama3.1:8b');

    const taskBeforeAck = engine.getTask('local-llm-ok');
    assert.equal(taskBeforeAck.status, 'awaiting_ack');
    assert.equal(taskBeforeAck.assignedAgentId, LOCAL_LLM_WORKER_ID);

    const acked = await engine.ackTask('local-llm-ok');
    assert.equal(acked.status, 'acknowledged');

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'http://ollama.test:11434/api/generate');
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
      model: 'llama3.1:8b',
      prompt: 'Summarize this',
      system: 'Be terse',
      stream: false,
      options: {
        temperature: 0.1
      }
    });

    assert.deepEqual(
      emittedEvents.map((event) => event.event),
      [
        'TASK_CREATED',
        'TASK_ENQUEUED',
        'TASK_CLAIMED',
        'TASK_EXECUTE_STARTED',
        'TASK_EXECUTE_FINISHED',
        'TASK_ACKED'
      ]
    );
  }));
});

test('LOCAL_LLM provider failure becomes structured worker failure', async () => {
  await withOllamaEnv({}, async () => withFetch(async () => ({
    ok: false,
    status: 503,
    headers: {
      get: () => 'application/json'
    },
    json: async () => ({
      error: 'ollama unavailable'
    })
  }), async () => {
    const engine = createTaskEngine({
      executor: createExecutionAdapter()
    });

    engine.enqueueTask({
      id: 'local-llm-fail',
      type: TASK_TYPE_LOCAL_LLM,
      payload: {
        prompt: 'hello'
      }
    });

    const execution = await engine.executeTask('local-llm-fail');
    assert.equal(execution.success, false);
    assert.equal(execution.error, 'ollama_request_failed:503');
    assert.deepEqual(execution.output, {
      provider: 'ollama',
      code: 'ollama_request_failed',
      status: 503,
      detail: {
        error: 'ollama unavailable'
      },
      message: 'ollama_request_failed:503'
    });

    const failed = await engine.ackTask('local-llm-fail');
    assert.equal(failed.status, 'failed');
  }));
});

test('LOCAL_LLM provider is not called outside the TaskEngine worker path', async () => {
  let fetchCount = 0;

  await withFetch(async () => {
    fetchCount += 1;
    throw new Error('fetch_should_not_be_called');
  }, async () => {
    const worker = createTaskExecutionWorker({
      getDiscordClient: () => null,
      taskTriggeredMessageIds: new Set()
    });

    await assert.rejects(
      () => worker.executeTask({
        id: 'local-llm-direct',
        type: TASK_TYPE_LOCAL_LLM,
        payload: {
          prompt: 'bypass'
        }
      }),
      (error) => error && error.message === 'ENGINE_ENFORCEMENT_VIOLATION'
    );

    const engine = createTaskEngine({
      executor: createExecutionAdapter()
    });
    engine.enqueueTask({
      id: 'local-llm-unclaimable',
      type: TASK_TYPE_LOCAL_LLM,
      payload: {
        prompt: 'blocked'
      }
    });

    const result = await engine.executeTask('local-llm-unclaimable', { workerId: 'generic-worker' });
    assert.deepEqual(result, {
      success: false,
      error: 'task_not_claimable',
      retryable: false
    });
    assert.equal(fetchCount, 0);
  });
});

test('UI files do not import the Ollama provider for local LLM tasks', () => {
  const hits = [];

  for (const file of collectJs(UI_DIR)) {
    const source = readFileSync(file, 'utf8');
    if (/integrations\/llm\/providers\/ollamaProvider|ollamaProvider/.test(source)) {
      hits.push(relative(ROOT, file));
    }
  }

  assert.deepEqual(hits, []);
});
