import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TASK_TYPE_TREND_RESEARCH } from '../core/constants.js';
import { createTaskEngine } from '../core/engine/taskEngine.js';
import { createTaskExecutionWorker } from '../core/workers/taskExecutionWorker.js';
import { runAnalyzeTrendsWorker } from '../core/workers/analyzeTrendsWorker.js';

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

function createAnalysisExecutionAdapter(analysisInput) {
  return async () => {
    const execution = await runAnalyzeTrendsWorker(analysisInput);
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

function withTrendEnv(fn) {
  const previousBaseUrl = process.env.OLLAMA_BASE_URL;
  const previousModel = process.env.OLLAMA_MODEL;
  const previousLiveMode = process.env.TREND_SIGNALS_LIVE_MODE;
  const previousTimeout = process.env.SLOTHWORLD_TREND_ANALYSIS_TIMEOUT_MS;

  process.env.OLLAMA_BASE_URL = 'http://ollama.test:11434';
  process.env.OLLAMA_MODEL = 'llama3.1:8b';
  process.env.TREND_SIGNALS_LIVE_MODE = 'false';
  delete process.env.SLOTHWORLD_TREND_ANALYSIS_TIMEOUT_MS;

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previousBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
      else process.env.OLLAMA_BASE_URL = previousBaseUrl;

      if (previousModel === undefined) delete process.env.OLLAMA_MODEL;
      else process.env.OLLAMA_MODEL = previousModel;

      if (previousLiveMode === undefined) delete process.env.TREND_SIGNALS_LIVE_MODE;
      else process.env.TREND_SIGNALS_LIVE_MODE = previousLiveMode;

      if (previousTimeout === undefined) delete process.env.SLOTHWORLD_TREND_ANALYSIS_TIMEOUT_MS;
      else process.env.SLOTHWORLD_TREND_ANALYSIS_TIMEOUT_MS = previousTimeout;
    });
}

test('TREND_RESEARCH executes Ollama analysis through TaskExecutionWorker and preserves ranked output', async () => {
  const fetchCalls = [];
  const emittedEvents = [];

  await withTrendEnv(() => withFetch(async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'llama3.1:8b',
        response: JSON.stringify({
          summary: 'Cozy products are gaining broad signal support.',
          recommendation: 'Prioritize the top cozy cluster.',
          confidence: 'high'
        }),
        done: true,
        eval_count: 12
      })
    };
  }, async () => {
    const engine = createTaskEngine({
      emitEvent: (event) => emittedEvents.push(event),
      executor: createExecutionAdapter()
    });

    engine.createTask({
      id: 'trend-ollama-ok',
      type: TASK_TYPE_TREND_RESEARCH,
      payload: {
        keyword: 'cozy',
        temperature: 0.2
      }
    });
    engine.enqueueTask('trend-ollama-ok');

    const execution = await engine.executeTask('trend-ollama-ok');
    assert.equal(execution.success, true);
    assert.ok(Array.isArray(execution.output.ranked), 'ranked output must remain present');
    assert.ok(execution.output.ranked.length > 0, 'ranked output must not be empty');
    assert.equal(execution.output.analysis.summary, 'Cozy products are gaining broad signal support.');
    assert.equal(execution.output.analysis.recommendation, 'Prioritize the top cozy cluster.');
    assert.equal(execution.output.analysis.provider, 'ollama');
    assert.equal(execution.output.analysis.model, 'llama3.1:8b');
    assert.ok(Array.isArray(execution.output.scored), 'scored output must be exposed');
    assert.ok(Array.isArray(execution.output.candidates), 'candidates output must be exposed');
    assert.ok(Array.isArray(execution.output.evidence.rawSignals), 'raw signals must remain evidence');
    assert.ok(Array.isArray(execution.output.evidence.normalizedSignals), 'normalized signals must remain evidence');
    assert.ok(Array.isArray(execution.output.evidence.scoredSignals), 'scored signals must remain evidence');

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'http://ollama.test:11434/api/generate');
    const request = JSON.parse(fetchCalls[0].options.body);
    assert.equal(request.model, 'llama3.1:8b');
    assert.equal(request.stream, false);
    assert.deepEqual(request.options, {
      num_predict: 120,
      temperature: 0.2,
      top_p: 0.8,
      num_ctx: 1024
    });
    assert.match(request.system, /tiny JSON/i);
    assert.match(request.prompt, /"keyword":"cozy"/);
    assert.match(request.prompt, /"facts"/);
    assert.doesNotMatch(request.prompt, /"rawSignals"/);
    assert.doesNotMatch(request.prompt, /"normalizedSignals"/);
    assert.doesNotMatch(request.prompt, /"metrics"/);
    assert.doesNotMatch(request.prompt, /"evidence"/);
    assert.ok(Buffer.byteLength(request.prompt, 'utf8') < 1600, 'prompt should stay below the safe byte threshold');

    await engine.ackTask('trend-ollama-ok');
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
    assert.equal(emittedEvents.filter((event) => event.event === 'TASK_CREATED').length, 1);
  }));
});

test('analyzeTrendsWorker wraps prose Ollama output as fallback analysis', async () => {
  const fetchCalls = [];

  await withTrendEnv(() => withFetch(async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'llama3.1:8b',
        response: 'The cozy cluster is promising, but the evidence is still thin.',
        done: true
      })
    };
  }, async () => {
    const engine = createTaskEngine({
      executor: createAnalysisExecutionAdapter({
        keyword: 'cozy',
        candidates: [
          { item: 'cozy blanket', source: 'reddit', score: 0.74 }
        ],
        scoredSignals: [
          { item: 'cozy blanket', source: 'reddit', score: 0.74 }
        ],
        rawSignals: [
          {
            source: 'reddit',
            text: 'cozy blanket discussion',
            metrics: { popularity: 4, engagement: 8, velocity: 1 }
          }
        ],
        normalizedSignals: [
          {
            item: 'cozy blanket',
            source: 'reddit',
            normalizedMetrics: { reliabilityWeight: 0.7 }
          }
        ]
      })
    });

    engine.createTask({
      id: 'trend-analysis-prose',
      type: 'analysis_probe',
      payload: {}
    });
    engine.enqueueTask('trend-analysis-prose');

    const execution = await engine.executeTask('trend-analysis-prose');
    assert.equal(execution.success, true);
    assert.equal(execution.output.summary, 'The cozy cluster is promising, but the evidence is still thin.');
    assert.equal(execution.output.recommendation, 'Review ranked trend evidence before action.');
    assert.equal(execution.output.confidence, 'low');
    assert.equal(execution.output.rawText, 'The cozy cluster is promising, but the evidence is still thin.');
    assert.equal(fetchCalls.length, 1);
  }));
});

test('analyzeTrendsWorker skips provider and returns fallback analysis when candidates are empty', async () => {
  let fetchCalled = false;

  await withTrendEnv(() => withFetch(async () => {
    fetchCalled = true;
    throw new Error('fetch should not be called');
  }, async () => {
    const engine = createTaskEngine({
      executor: createAnalysisExecutionAdapter({
        keyword: 'quiet',
        candidates: [],
        scoredSignals: [
          { item: 'quiet desk', source: 'reddit', score: 0.5 }
        ],
        rawSignals: [],
        normalizedSignals: []
      })
    });

    engine.createTask({
      id: 'trend-analysis-empty',
      type: 'analysis_probe',
      payload: {}
    });
    engine.enqueueTask('trend-analysis-empty');

    const execution = await engine.executeTask('trend-analysis-empty');
    assert.equal(execution.success, true);
    assert.equal(execution.output.summary, 'No strong trend candidates were found.');
    assert.equal(execution.output.recommendation, 'Collect more signals before acting.');
    assert.equal(execution.output.confidence, 'low');
    assert.equal(execution.output.provider, 'deterministic');
    assert.equal(fetchCalled, false);
  }));
});

test('TREND_RESEARCH uses fallback analysis and still succeeds when Ollama returns 500', async () => {
  await withTrendEnv(() => withFetch(async () => ({
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

    engine.createTask({
      id: 'trend-ollama-fail',
      type: TASK_TYPE_TREND_RESEARCH,
      payload: {
        keyword: 'cozy'
      }
    });
    engine.enqueueTask('trend-ollama-fail');

    const execution = await engine.executeTask('trend-ollama-fail');
    assert.equal(execution.success, true);
    assert.ok(Array.isArray(execution.output.ranked), 'ranked output must remain present');
    assert.ok(Array.isArray(execution.output.scored), 'scored output must remain present');
    assert.ok(Array.isArray(execution.output.candidates), 'candidates output must remain present');
    assert.ok(execution.output.evidence && Array.isArray(execution.output.evidence.rawSignals), 'evidence must remain present');
    assert.equal(execution.output.analysis.unavailable, true);
    assert.equal(execution.output.analysis.reason, 'ollama_request_failed');
    assert.equal(
      execution.output.analysis.summary,
      'Trend analysis was skipped because the local model did not respond in time.'
    );
  }));
});

test('TREND_RESEARCH uses timeout fallback and still succeeds when Ollama is too slow', async () => {
  let observedAbort = false;

  await withTrendEnv(() => {
    process.env.SLOTHWORLD_TREND_ANALYSIS_TIMEOUT_MS = '5';

    return withFetch(async (_url, options = {}) => new Promise((resolve, reject) => {
      if (options.signal && typeof options.signal.addEventListener === 'function') {
        options.signal.addEventListener('abort', () => {
          observedAbort = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }

      setTimeout(() => resolve({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'llama3.1:8b',
          response: '{"summary":"late","recommendation":"late","confidence":"low"}',
          done: true
        })
      }), 100);
    }), async () => {
      const engine = createTaskEngine({
        executor: createExecutionAdapter()
      });

      engine.createTask({
        id: 'trend-ollama-timeout',
        type: TASK_TYPE_TREND_RESEARCH,
        payload: {
          keyword: 'cozy'
        }
      });
      engine.enqueueTask('trend-ollama-timeout');

      const execution = await engine.executeTask('trend-ollama-timeout');
      assert.equal(execution.success, true);
      assert.equal(observedAbort, true);
      assert.equal(execution.output.analysis.unavailable, true);
      assert.equal(execution.output.analysis.reason, 'ollama_timeout');
      assert.ok(Array.isArray(execution.output.ranked), 'ranked output must remain present');
      assert.ok(Array.isArray(execution.output.scored), 'scored output must remain present');
      assert.ok(Array.isArray(execution.output.candidates), 'candidates output must remain present');
      assert.ok(execution.output.evidence && Array.isArray(execution.output.evidence.scoredSignals), 'evidence must remain present');
    });
  });
});

test('UI files do not import or call the Ollama provider for TrendResearch analysis', () => {
  for (const file of collectJs(UI_DIR)) {
    const source = readFileSync(file, 'utf8');
    const relPath = relative(ROOT, file);
    assert.equal(/integrations\/llm\/providers\/ollamaProvider|ollamaProvider|127\.0\.0\.1:11434|\/api\/generate/.test(source), false, relPath);
  }
});
