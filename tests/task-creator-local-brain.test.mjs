import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildImageRenderTaskPayload, buildLocalBrainTaskPayload } from '../ui/task-creator-panel.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TASK_CREATOR_PATH = resolve(ROOT, 'ui/task-creator-panel.js');

test('task creator: Local Brain Test builds a local_llm task payload', () => {
  const payload = buildLocalBrainTaskPayload({
    title: '  Test local model  ',
    prompt: '  Say hello  '
  });

  assert.deepEqual(payload, {
    type: 'local_llm',
    title: 'Test local model',
    payload: {
      source: 'task_creator_panel',
      prompt: 'Say hello',
      system: 'You are a concise local assistant running inside Slothworld.',
      model: ''
    }
  });
});

test('task creator: Local Brain Test uses default title and prompt', () => {
  const payload = buildLocalBrainTaskPayload();

  assert.equal(payload.type, 'local_llm');
  assert.equal(payload.title, 'Local Brain Test');
  assert.equal(payload.payload.prompt, 'Reply with a short friendly hello from the local Slothworld brain.');
  assert.equal(payload.payload.model, '');
});

test('task creator: Local Brain Test uses injectTask and does not import provider', () => {
  const source = readFileSync(TASK_CREATOR_PATH, 'utf8');

  assert.match(source, /<option value="local_llm">Local Brain Test<\/option>/);
  assert.match(source, /window\.controlAPI\.injectTask\(/);
  assert.equal(/ollamaProvider|integrations\/llm\/providers|fetch\s*\(\s*['"]http:\/\/127\.0\.0\.1:11434/.test(source), false);
});

test('task creator: Image Render builds canonical ComfyUI IMAGE_RENDER task payload', () => {
  const payload = buildImageRenderTaskPayload({
    title: '  Product hero  ',
    prompt: '  render a moss lamp on a table  ',
    negativePrompt: '  blurry, text  ',
    width: '768',
    height: '512',
    steps: '24',
    cfg: '7.5'
  });

  assert.equal(payload.type, 'image_render');
  assert.equal(payload.action, 'render_product_image');
  assert.equal(payload.title, 'Product hero');
  assert.equal(payload.payload.source, 'task_creator_panel');
  assert.equal(payload.payload.provider, 'comfyui');
  assert.equal(payload.payload.prompt, 'render a moss lamp on a table');
  assert.equal(payload.payload.designIntent.prompt, 'render a moss lamp on a table');
  assert.deepEqual(payload.payload.context.metadata, {
    width: 768,
    height: 512,
    steps: 24,
    cfg: 7.5,
    sampler: 'euler',
    scheduler: 'normal',
    negativePrompt: 'blurry, text'
  });
});

test('task creator: Image Render uses safe ComfyUI defaults', () => {
  const payload = buildImageRenderTaskPayload({ prompt: 'small product render' });

  assert.equal(payload.type, 'image_render');
  assert.equal(payload.action, 'render_product_image');
  assert.equal(payload.title, 'Generate Image Render');
  assert.equal(payload.payload.provider, 'comfyui');
  assert.equal(payload.payload.context.metadata.width, 512);
  assert.equal(payload.payload.context.metadata.height, 512);
  assert.equal(payload.payload.context.metadata.steps, 20);
  assert.equal(payload.payload.context.metadata.cfg, 8);
  assert.equal(payload.payload.context.metadata.sampler, 'euler');
  assert.equal(payload.payload.context.metadata.scheduler, 'normal');
  assert.equal(payload.payload.context.metadata.negativePrompt, 'text, watermark, blurry, low quality, distorted');
});

test('task creator: Image Render UI uses task intake and does not call providers', () => {
  const source = readFileSync(TASK_CREATOR_PATH, 'utf8');
  const controlApiSource = readFileSync(resolve(ROOT, 'ui/control-api.js'), 'utf8');

  assert.ok(source.includes('<option value="image_render">Image Render</option>'));
  assert.ok(source.includes('buildImageRenderTaskPayload'));
  assert.ok(source.includes('window.controlAPI.injectTask(buildImageRenderTaskPayload'));
  assert.ok(controlApiSource.includes('normalized.action = task.action.trim()'));
  assert.equal(/imageProviderRegistry|comfyUiProvider|openAIImageProvider|huggingFaceImageProvider/.test(source), false);
  assert.equal(source.includes('/comfyui'), false);
  assert.equal(source.includes('/prompt'), false);
  assert.equal(source.includes('127.0.0.1:8188'), false);
  assert.equal(source.includes('api.openai.com'), false);
  assert.equal(source.includes('huggingface.co'), false);
  assert.equal(/contentBase64|imageBase64/.test(source), false);
});
