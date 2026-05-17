import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path, { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TASK_TYPE_IMAGE_RENDER } from '../core/constants.js';
import { createTaskEngine } from '../core/engine/taskEngine.js';
import { createTaskExecutionWorker } from '../core/workers/taskExecutionWorker.js';
import {
  DEFAULT_IMAGE_PROVIDER_ID,
  resolveImageProvider
} from '../integrations/image-generation/imageProviderRegistry.js';
import { openAIImageProvider } from '../integrations/rendering/providers/openaiImageProvider.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_DIR = join(ROOT, 'ui');
const RENDERING_DIR = join(ROOT, 'rendering');
const SERVER_DIR = join(ROOT, 'server');
const IMAGE_RENDER_WORKER_PATH = join(ROOT, 'core', 'workers', 'imageRenderWorker.js');
const ROUTE_FILES = [join(ROOT, 'bridge-server.js'), ...collectJs(SERVER_DIR)];

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

function makeJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function makeImageResponse(bytes, contentType = 'image/png') {
  const buffer = Buffer.from(bytes);

  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? contentType : null;
      }
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
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

function withEnv(overrides, fn) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

test('IMAGE_RENDER executes through ComfyUI on the canonical TaskEngine path', async () => {
  const emittedEvents = [];
  const fetchCalls = [];
  const productId = `comfyui-engine-${Date.now()}`;
  const generatedDir = path.join(ROOT, 'assets', 'generated', productId);

  await withEnv({
    COMFYUI_BASE_URL: 'http://comfy.test:8188',
    COMFYUI_TIMEOUT_MS: '1000',
    COMFYUI_POLL_INTERVAL_MS: '1',
    COMFYUI_WORKFLOW_PATH: undefined
  }, async () => withFetch(async (url, options = {}) => {
    const parsed = new URL(String(url));
    fetchCalls.push({ url: String(url), pathname: parsed.pathname, searchParams: parsed.searchParams, options });

    if (parsed.pathname === '/system_stats') {
      return makeJsonResponse({ system: 'ok' });
    }

    if (parsed.pathname === '/prompt') {
      assert.equal(options.method, 'POST');
      const request = JSON.parse(options.body);
      assert.equal(typeof request.client_id, 'string');
      assert.ok(request.prompt, 'ComfyUI request must include a workflow prompt');
      assert.equal(request.prompt['3'].class_type, 'KSampler');
      assert.equal(Object.prototype.hasOwnProperty.call(request.prompt, 'extra_data'), false);
      assert.ok(
        Object.values(request.prompt).some((node) => (
          node.class_type === 'CLIPTextEncode'
          && node.inputs
          && /Canonical Sloth Mug/.test(node.inputs.text)
        )),
        'workflow prompt should include task design intent'
      );
      return makeJsonResponse({ prompt_id: 'engine-prompt-123' });
    }

    if (parsed.pathname === '/history/engine-prompt-123') {
      return makeJsonResponse({
        'engine-prompt-123': {
          outputs: {
            9: {
              images: [{
                filename: 'slothworld_00042_.png',
                subfolder: 'canonical',
                type: 'output'
              }]
            }
          }
        }
      });
    }

    if (parsed.pathname === '/view') {
      assert.equal(parsed.searchParams.get('filename'), 'slothworld_00042_.png');
      assert.equal(parsed.searchParams.get('subfolder'), 'canonical');
      assert.equal(parsed.searchParams.get('type'), 'output');
      return makeImageResponse('canonical-image-bytes');
    }

    throw new Error(`unexpected fetch ${parsed.pathname}`);
  }, async () => {
    try {
      const engine = createTaskEngine({
        emitEvent: (event) => emittedEvents.push(event),
        executor: createExecutionAdapter()
      });

      engine.createTask({
        id: 'image-render-comfyui-ok',
        type: TASK_TYPE_IMAGE_RENDER,
        payload: {
          provider: 'comfyui',
          productId,
          designIntent: {
            product_name: 'Canonical Sloth Mug',
            prompt: 'A studio product photo for the canonical engine path',
            style: 'clean ecommerce illustration'
          },
          context: {
            providerFallbacks: [],
            providerTimeoutMs: 1000
          }
        }
      });
      engine.enqueueTask('image-render-comfyui-ok');

      const execution = await engine.executeTask('image-render-comfyui-ok');
      assert.equal(execution.success, true);
      assert.equal(execution.output.provider, 'comfyui');
      assert.equal(execution.output.mimeType, 'image/png');
      assert.equal(execution.output.contentBase64, Buffer.from('canonical-image-bytes').toString('base64'));
      assert.equal(execution.output.imageBase64, execution.output.contentBase64);
      assert.equal(execution.output.metadata.promptId, 'engine-prompt-123');
      assert.deepEqual(execution.output.metadata.image, {
        filename: 'slothworld_00042_.png',
        subfolder: 'canonical',
        type: 'output'
      });

      const taskBeforeAck = engine.getTask('image-render-comfyui-ok');
      assert.equal(taskBeforeAck.status, 'awaiting_ack');

      const acked = await engine.ackTask('image-render-comfyui-ok');
      assert.equal(acked.status, 'acknowledged');

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
      assert.deepEqual(fetchCalls.map((call) => call.pathname), [
        '/prompt',
        '/history/engine-prompt-123',
        '/view'
      ]);
    } finally {
      await rm(generatedDir, { recursive: true, force: true });
    }
  }));
});

test('OpenAI remains the default image provider when no provider is selected', () => {
  assert.equal(DEFAULT_IMAGE_PROVIDER_ID, 'openai');
  assert.equal(resolveImageProvider(), openAIImageProvider);
});

test('UI and rendering files still do not import image providers or image provider registry', () => {
  const hits = [];

  for (const dir of [UI_DIR, RENDERING_DIR]) {
    for (const file of collectJs(dir)) {
      const source = readFileSync(file, 'utf8');
      if (/integrations\/(?:image-generation|rendering\/providers)|imageProviderRegistry|openAIImageProvider|huggingFaceImageProvider|comfyUiProvider|openAIImageAdapter/.test(source)) {
        hits.push(relative(ROOT, file));
      }
    }
  }

  assert.deepEqual(hits, []);
});

test('imageRenderWorker still does not import concrete image providers directly', () => {
  const source = readFileSync(IMAGE_RENDER_WORKER_PATH, 'utf8');

  assert.equal(/integrations\/rendering\/providers\/(?:openaiImageProvider|huggingfaceImageProvider|openAIImageAdapter|providerRegistry)\.js/.test(source), false);
  assert.equal(/\b(openAIImageProvider|huggingFaceImageProvider|comfyUiProvider|openAIImageAdapter|ProviderRegistry)\b/.test(source), false);
  assert.match(source, /imageProviderRegistry\.js/);
});

test('no direct ComfyUI HTTP route is exposed by the bridge server', () => {
  const hits = [];

  for (const file of ROUTE_FILES) {
    const source = readFileSync(file, 'utf8');
    if (/['"`]\/comfyui(?:\/|['"`])/.test(source)) {
      hits.push(relative(ROOT, file));
    }
  }

  assert.deepEqual(hits, []);
});
