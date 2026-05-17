import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_IMAGE_PROVIDER_ID,
  generateImageViaProvider,
  hasImageProvider,
  listImageProviders,
  registerImageProvider,
  resolveImageProvider
} from '../integrations/image-generation/imageProviderRegistry.js';
import { comfyUiProvider } from '../integrations/image-generation/providers/comfyUiProvider.js';
import { openAIImageProvider } from '../integrations/rendering/providers/openaiImageProvider.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_DIR = join(ROOT, 'ui');
const RENDERING_DIR = join(ROOT, 'rendering');
const IMAGE_RENDER_WORKER_PATH = join(ROOT, 'core', 'workers', 'imageRenderWorker.js');

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

test('image provider registry resolves OpenAI as the default image provider', () => {
  assert.equal(DEFAULT_IMAGE_PROVIDER_ID, 'openai');
  assert.equal(resolveImageProvider(), openAIImageProvider);
  assert.equal(hasImageProvider('openai'), true);
  assert.equal(hasImageProvider('huggingface'), true);
  assert.equal(hasImageProvider('comfyui'), true);
  assert.equal(resolveImageProvider('comfyui'), comfyUiProvider);
  assert.deepEqual(listImageProviders(), ['openai', 'huggingface', 'comfyui']);
});

test('image provider registry dispatches image generation through the resolved provider', async () => {
  const calls = [];
  const providerId = 'test-image-provider';

  registerImageProvider(providerId, {
    async generate(prompt, context) {
      calls.push({ prompt, context });
      return {
        provider: providerId,
        contentBase64: Buffer.from('image-bytes').toString('base64'),
        mimeType: 'image/png'
      };
    }
  });

  const result = await generateImageViaProvider('draw a local scene', {
    metadata: {
      productId: 'local-scene'
    }
  }, providerId);

  assert.equal(result.provider, providerId);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    prompt: 'draw a local scene',
    context: {
      metadata: {
        productId: 'local-scene'
      }
    }
  });
});

test('ComfyUI healthCheck calls the lightweight system stats endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  await withEnv({ COMFYUI_BASE_URL: 'http://comfy.test:8188' }, async () => {
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return makeJsonResponse({ system: 'ok' });
    };

    try {
      const result = await comfyUiProvider.healthCheck();

      assert.equal(result.ok, true);
      assert.equal(result.provider, 'comfyui');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'http://comfy.test:8188/system_stats');
      assert.equal(calls[0].options.method, 'GET');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('image provider registry routes ComfyUI generation through prompt, history, and view endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  await withEnv({
    COMFYUI_BASE_URL: 'http://comfy.test:8188',
    COMFYUI_TIMEOUT_MS: '1000',
    COMFYUI_POLL_INTERVAL_MS: '1',
    COMFYUI_WORKFLOW_PATH: undefined
  }, async () => {
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(String(url));
      calls.push({ url: String(url), pathname: parsed.pathname, searchParams: parsed.searchParams, options });

      if (parsed.pathname === '/prompt') {
        const body = JSON.parse(options.body);
        assert.equal(typeof body.client_id, 'string');
        assert.equal(body.prompt['3'].class_type, 'KSampler');
        assert.equal(body.prompt['4'].inputs.ckpt_name, 'v1-5-pruned-emaonly.safetensors');
        assert.equal(body.prompt['6'].inputs.text, 'draw a local scene');
        assert.equal(body.prompt['7'].inputs.text, 'text, watermark, blurry, low quality');
        assert.equal(body.prompt['9'].inputs.filename_prefix, 'Slothworld');
        assert.equal(Object.prototype.hasOwnProperty.call(body.prompt, 'extra_data'), false);
        const promptNode = Object.values(body.prompt).find((node) => (
          node.class_type === 'CLIPTextEncode'
          && node.inputs
          && node.inputs.text === 'draw a local scene'
        ));
        assert.ok(promptNode, 'minimal workflow includes input prompt');
        return makeJsonResponse({ prompt_id: 'prompt-123' });
      }

      if (parsed.pathname === '/history/prompt-123') {
        return makeJsonResponse({
          'prompt-123': {
            outputs: {
              9: {
                images: [{
                  filename: 'slothworld_00001_.png',
                  subfolder: 'slothworld',
                  type: 'output'
                }]
              }
            }
          }
        });
      }

      if (parsed.pathname === '/view') {
        assert.equal(parsed.searchParams.get('filename'), 'slothworld_00001_.png');
        assert.equal(parsed.searchParams.get('subfolder'), 'slothworld');
        assert.equal(parsed.searchParams.get('type'), 'output');
        return makeImageResponse('image-bytes');
      }

      throw new Error(`unexpected fetch ${parsed.pathname}`);
    };

    try {
      const result = await generateImageViaProvider({
        provider: 'comfyui',
        prompt: 'draw a local scene'
      });

      assert.equal(result.provider, 'comfyui');
      assert.equal(result.prompt, 'draw a local scene');
      assert.equal(result.promptId, 'prompt-123');
      assert.equal(result.mimeType, 'image/png');
      assert.equal(result.contentBase64, Buffer.from('image-bytes').toString('base64'));
      assert.deepEqual(calls.map((call) => call.pathname), [
        '/prompt',
        '/history/prompt-123',
        '/view'
      ]);
      assert.equal(calls[0].options.method, 'POST');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('ComfyUI workflow loader unwraps exported API payload and sends only prompt graph', async () => {
  const originalFetch = globalThis.fetch;
  const workflowPath = join('/tmp', `slothworld-comfyui-payload-${Date.now()}.json`);
  let postedBody = null;

  await writeFile(workflowPath, JSON.stringify({
    client_id: 'exported-client-id',
    prompt: {
      3: {
        inputs: {
          seed: 1,
          steps: 12,
          cfg: 6,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0]
        },
        class_type: 'KSampler'
      },
      4: {
        inputs: { ckpt_name: 'exported.safetensors' },
        class_type: 'CheckpointLoaderSimple'
      },
      6: {
        inputs: { text: '{{prompt}}', clip: ['4', 1] },
        class_type: 'CLIPTextEncode'
      },
      9: {
        inputs: { filename_prefix: 'Exported', images: ['8', 0] },
        class_type: 'SaveImage'
      }
    },
    extra_data: {
      extra_pnginfo: {
        workflow: {
          nodes: [{ id: 3, type: 'KSampler' }]
        }
      }
    }
  }), 'utf8');

  await withEnv({
    COMFYUI_BASE_URL: 'http://comfy.test:8188',
    COMFYUI_TIMEOUT_MS: '1000',
    COMFYUI_POLL_INTERVAL_MS: '1',
    COMFYUI_WORKFLOW_PATH: workflowPath
  }, async () => {
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(String(url));

      if (parsed.pathname === '/prompt') {
        postedBody = JSON.parse(options.body);
        return makeJsonResponse({ prompt_id: 'prompt-exported' });
      }

      if (parsed.pathname === '/history/prompt-exported') {
        return makeJsonResponse({
          'prompt-exported': {
            outputs: {
              9: {
                images: [{ filename: 'exported.png', subfolder: '', type: 'output' }]
              }
            }
          }
        });
      }

      if (parsed.pathname === '/view') {
        return makeImageResponse('exported-image-bytes');
      }

      throw new Error(`unexpected fetch ${parsed.pathname}`);
    };

    try {
      await generateImageViaProvider({
        provider: 'comfyui',
        prompt: 'prompt from exported payload'
      });

      assert.equal(postedBody.client_id.startsWith('slothworld-'), true);
      assert.equal(postedBody.prompt['3'].class_type, 'KSampler');
      assert.equal(postedBody.prompt['6'].inputs.text, 'prompt from exported payload');
      assert.equal(Object.prototype.hasOwnProperty.call(postedBody.prompt, 'extra_data'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(postedBody, 'extra_data'), false);
      assert.equal(Array.isArray(postedBody.prompt.nodes), false);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(workflowPath, { force: true });
    }
  });
});

test('ComfyUI generation timeout throws a structured comfyui_timeout error', async () => {
  const originalFetch = globalThis.fetch;

  await withEnv({
    COMFYUI_BASE_URL: 'http://comfy.test:8188',
    COMFYUI_TIMEOUT_MS: '5',
    COMFYUI_POLL_INTERVAL_MS: '1',
    COMFYUI_WORKFLOW_PATH: undefined
  }, async () => {
    globalThis.fetch = async (url) => {
      const parsed = new URL(String(url));

      if (parsed.pathname === '/prompt') {
        return makeJsonResponse({ prompt_id: 'prompt-timeout' });
      }

      if (parsed.pathname === '/history/prompt-timeout') {
        return makeJsonResponse({ 'prompt-timeout': { outputs: {} } });
      }

      throw new Error(`unexpected fetch ${parsed.pathname}`);
    };

    try {
      await assert.rejects(
        async () => generateImageViaProvider({
          provider: 'comfyui',
          prompt: 'draw a slow local scene'
        }),
        (error) => {
          assert.equal(error.code, 'comfyui_timeout');
          assert.equal(error.provider, 'comfyui');
          assert.equal(error.status, 'timeout');
          assert.equal(error.retryable, true);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('UI and rendering files do not import image providers or image provider registry', () => {
  const hits = [];

  for (const dir of [UI_DIR, RENDERING_DIR]) {
    for (const file of collectJs(dir)) {
      const source = readFileSync(file, 'utf8');
      if (/integrations\/(?:image-generation|rendering\/providers)|imageProviderRegistry|openAIImageProvider|huggingFaceImageProvider|openAIImageAdapter/.test(source)) {
        hits.push(relative(ROOT, file));
      }
    }
  }

  assert.deepEqual(hits, []);
});

test('imageRenderWorker does not import concrete image providers directly', () => {
  const source = readFileSync(IMAGE_RENDER_WORKER_PATH, 'utf8');

  assert.equal(/integrations\/rendering\/providers\/(?:openaiImageProvider|huggingfaceImageProvider|openAIImageAdapter|providerRegistry)\.js/.test(source), false);
  assert.equal(/\b(openAIImageProvider|huggingFaceImageProvider|openAIImageAdapter|ProviderRegistry)\b/.test(source), false);
  assert.match(source, /imageProviderRegistry\.js/);
});
