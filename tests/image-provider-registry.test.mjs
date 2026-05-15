import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

test('image provider registry resolves OpenAI as the default image provider', () => {
  assert.equal(DEFAULT_IMAGE_PROVIDER_ID, 'openai');
  assert.equal(resolveImageProvider(), openAIImageProvider);
  assert.equal(hasImageProvider('openai'), true);
  assert.equal(hasImageProvider('huggingface'), true);
  assert.deepEqual(listImageProviders(), ['openai', 'huggingface']);
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
