import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getOllamaConfig,
  ollamaProvider
} from '../integrations/llm/providers/ollamaProvider.js';
import {
  DEFAULT_LLM_PROVIDER_ID,
  generateTextViaLlmProvider,
  resolveLlmProvider
} from '../integrations/llm/llmProviderRegistry.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROVIDER_PATH = join(ROOT, 'integrations', 'llm', 'providers', 'ollamaProvider.js');
const UI_DIR = join(ROOT, 'ui');
const RENDERING_DIR = join(ROOT, 'rendering');
const WORKERS_DIR = join(ROOT, 'core', 'workers');

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

  if (Object.prototype.hasOwnProperty.call(env, 'OLLAMA_BASE_URL')) {
    process.env.OLLAMA_BASE_URL = env.OLLAMA_BASE_URL;
  } else {
    delete process.env.OLLAMA_BASE_URL;
  }

  if (Object.prototype.hasOwnProperty.call(env, 'OLLAMA_MODEL')) {
    process.env.OLLAMA_MODEL = env.OLLAMA_MODEL;
  } else {
    delete process.env.OLLAMA_MODEL;
  }

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

test('Ollama provider uses default local config when env is not set', async () => {
  await withOllamaEnv({}, async () => {
    assert.deepEqual(getOllamaConfig(), {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b'
    });
  });
});

test('Ollama provider builds the expected generate request', async () => {
  const calls = [];

  await withOllamaEnv({
    OLLAMA_BASE_URL: 'http://ollama.local:11434/',
    OLLAMA_MODEL: 'qwen2.5:7b'
  }, async () => withFetch(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'qwen2.5:7b',
        response: 'hello from ollama',
        done: true,
        total_duration: 123,
        load_duration: 45,
        prompt_eval_count: 6,
        eval_count: 7
      })
    };
  }, async () => {
    const result = await ollamaProvider.generateText({
      prompt: '  Say hello  ',
      system: '  Be concise  ',
      temperature: 0.2
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://ollama.local:11434/api/generate');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(calls[0].options.headers, {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    });
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      model: 'qwen2.5:7b',
      prompt: 'Say hello',
      system: 'Be concise',
      stream: false,
      options: {
        temperature: 0.2
      }
    });
    assert.equal(result.text, 'hello from ollama');
    assert.equal(result.provider, 'ollama');
    assert.equal(result.metadata.model, 'qwen2.5:7b');
  }));
});

test('Ollama provider handles failed responses as structured errors', async () => {
  await withOllamaEnv({}, async () => withFetch(async () => ({
    ok: false,
    status: 500,
    headers: {
      get: () => 'application/json'
    },
    json: async () => ({
      error: 'model failed'
    })
  }), async () => {
    await assert.rejects(
      () => ollamaProvider.generateText({ prompt: 'hello' }),
      (error) => {
        assert.equal(error.name, 'OllamaProviderError');
        assert.equal(error.provider, 'ollama');
        assert.equal(error.code, 'ollama_request_failed');
        assert.equal(error.status, 500);
        assert.deepEqual(error.detail, { error: 'model failed' });
        assert.equal(error.message, 'ollama_request_failed:500');
        return true;
      }
    );
  }));
});

test('LLM provider registry resolves Ollama as the default text provider', async () => {
  const calls = [];

  assert.equal(DEFAULT_LLM_PROVIDER_ID, 'ollama');
  assert.equal(resolveLlmProvider(), ollamaProvider);

  await withOllamaEnv({
    OLLAMA_BASE_URL: 'http://ollama.local:11434',
    OLLAMA_MODEL: 'llama3.1:8b'
  }, async () => withFetch(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'llama3.1:8b',
        response: 'registry response',
        done: true
      })
    };
  }, async () => {
    const result = await generateTextViaLlmProvider({ prompt: 'hello registry' });

    assert.equal(result.provider, 'ollama');
    assert.equal(result.text, 'registry response');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://ollama.local:11434/api/generate');
  }));
});

test('Ollama provider does not import TaskEngine', () => {
  const source = readFileSync(PROVIDER_PATH, 'utf8');
  assert.equal(/from\s+['"][^'"]*taskEngine\.js['"]/.test(source), false);
  assert.equal(/\bcreateTaskEngine\b/.test(source), false);
  assert.equal(/\backTask\b/.test(source), false);
});

test('UI files do not import the Ollama provider', () => {
  const hits = [];

  for (const file of collectJs(UI_DIR)) {
    const source = readFileSync(file, 'utf8');
    if (/integrations\/llm\/providers\/ollamaProvider|ollamaProvider/.test(source)) {
      hits.push(relative(ROOT, file));
    }
  }

  assert.deepEqual(hits, []);
});

test('UI and rendering files do not import LLM providers or registry', () => {
  const hits = [];

  for (const dir of [UI_DIR, RENDERING_DIR]) {
    for (const file of collectJs(dir)) {
      const source = readFileSync(file, 'utf8');
      if (/integrations\/llm|llmProviderRegistry|ollamaProvider/.test(source)) {
        hits.push(relative(ROOT, file));
      }
    }
  }

  assert.deepEqual(hits, []);
});

test('workers do not import the Ollama provider directly', () => {
  const hits = [];

  for (const file of collectJs(WORKERS_DIR)) {
    const source = readFileSync(file, 'utf8');
    if (/from\s+['"][^'"]*integrations\/llm\/providers\/ollamaProvider\.js['"]|import\s+\{\s*ollamaProvider\s*\}/.test(source)) {
      hits.push(relative(ROOT, file));
    }
  }

  assert.deepEqual(hits, []);
});
