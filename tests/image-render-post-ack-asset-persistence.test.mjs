import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { TASK_TYPE_IMAGE_RENDER } from '../core/constants.js';
import { createTaskEngine } from '../core/engine/taskEngine.js';
import { createTaskExecutionWorker } from '../core/workers/taskExecutionWorker.js';
import {
  persistImageRenderAssetAfterAck,
  projectTaskForSafeAssetRead
} from '../core/workers/assetPersistenceWorker.js';
import { registerImageProvider } from '../integrations/image-generation/imageProviderRegistry.js';

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

function makeImageTask(id, provider, productId) {
  return {
    id,
    type: TASK_TYPE_IMAGE_RENDER,
    payload: {
      provider,
      productId,
      designIntent: {
        product_name: 'Post ACK Asset',
        prompt: 'A generated asset for post ACK persistence'
      },
      context: {
        providerFallbacks: [],
        providerTimeoutMs: 1000
      }
    }
  };
}

async function listFiles(dir) {
  try {
    return await readdir(dir, { recursive: true });
  } catch {
    return [];
  }
}

test('IMAGE_RENDER asset persistence happens only after ACK', async () => {
  const baseDir = join('/tmp', `slothworld-post-ack-assets-${Date.now()}`);
  const providerId = `post-ack-provider-${Date.now()}`;
  const contentBase64 = Buffer.from('post-ack-image-bytes').toString('base64');

  registerImageProvider(providerId, {
    async generate(prompt) {
      return {
        provider: providerId,
        prompt,
        mimeType: 'image/png',
        contentBase64,
        metadata: {
          promptId: 'post-ack-prompt-id'
        }
      };
    }
  });

  const engine = createTaskEngine({
    executor: createExecutionAdapter(),
    onTaskAcked: (task) => persistImageRenderAssetAfterAck(task, { baseDir })
  });

  const taskId = 'post-ack-image-render-ok';
  engine.createTask(makeImageTask(taskId, providerId, 'post-ack-product'));
  engine.enqueueTask(taskId);

  const execution = await engine.executeTask(taskId);
  assert.equal(execution.success, true);
  assert.equal(execution.output.contentBase64, contentBase64);
  assert.deepEqual(await listFiles(baseDir), [], 'no asset files should be written before TASK_ACKED');

  const acked = await engine.ackTask(taskId);
  assert.equal(acked.status, 'acknowledged');

  const files = await listFiles(baseDir);
  const imageFile = files.find((file) => String(file).endsWith('.png'));
  const metadataFile = files.find((file) => String(file).endsWith('.json'));
  assert.ok(imageFile, 'ACK should persist an image file');
  assert.ok(metadataFile, 'ACK should persist a metadata sidecar');

  const imageBytes = await readFile(join(baseDir, imageFile));
  assert.equal(imageBytes.toString(), 'post-ack-image-bytes');

  const metadata = JSON.parse(await readFile(join(baseDir, metadataFile), 'utf8'));
  assert.equal(metadata.taskId, taskId);
  assert.equal(metadata.provider, providerId);
  assert.equal(metadata.mimeType, 'image/png');
  assert.equal(typeof metadata.createdAt, 'number');
  assert.equal(typeof metadata.prompt, 'string');
  assert.equal(metadata.metadata.promptId, 'post-ack-prompt-id');

  const output = engine.getTask(taskId).lastResult.output;
  assert.equal(output.assetId, output.asset.id);
  assert.equal(output.imageUrl, output.asset.path);
  assert.equal(output.path, output.asset.path);
  assert.equal(output.asset.provider, providerId);
  assert.equal(output.asset.mimeType, 'image/png');
  assert.equal(output.asset.path.endsWith('.png'), true);

  const projected = projectTaskForSafeAssetRead({
    id: taskId,
    executionResult: {
      success: true,
      result: output
    }
  });
  assert.equal(projected.executionResult.result.contentBase64, undefined);
  assert.equal(projected.executionResult.result.imageBase64, undefined);
  assert.equal(projected.executionResult.result.assetId, projected.executionResult.result.asset.id);
  assert.equal(projected.executionResult.result.imageUrl, projected.executionResult.result.asset.url);
  assert.equal(projected.executionResult.result.path, projected.executionResult.result.asset.url);
  assert.deepEqual(projected.executionResult.result.asset, {
    id: output.asset.id,
    url: output.asset.path,
    mimeType: 'image/png',
    provider: providerId
  });

  await rm(baseDir, { recursive: true, force: true });
});

test('failed IMAGE_RENDER ACK does not persist an asset', async () => {
  const baseDir = join('/tmp', `slothworld-post-ack-failed-${Date.now()}`);
  const providerId = `post-ack-failing-provider-${Date.now()}`;

  registerImageProvider(providerId, {
    async generate() {
      throw new Error('provider_failed_for_test');
    }
  });

  const engine = createTaskEngine({
    executor: createExecutionAdapter(),
    onTaskAcked: (task) => persistImageRenderAssetAfterAck(task, { baseDir })
  });

  const taskId = 'post-ack-image-render-fail';
  engine.createTask(makeImageTask(taskId, providerId, 'post-ack-failed-product'));
  engine.enqueueTask(taskId);

  const execution = await engine.executeTask(taskId);
  assert.equal(execution.success, false);

  const acked = await engine.ackTask(taskId);
  assert.equal(acked.status, 'failed');
  assert.deepEqual(await listFiles(baseDir), []);

  await rm(baseDir, { recursive: true, force: true });
});

test('image providers and UI/rendering do not write or inspect raw generated image bytes', async () => {
  const providerSources = [
    'integrations/image-generation/providers/comfyUiProvider.js',
    'integrations/rendering/providers/openaiImageProvider.js',
    'integrations/rendering/providers/huggingfaceImageProvider.js'
  ];

  for (const sourcePath of providerSources) {
    const source = await readFile(sourcePath, 'utf8');
    assert.equal(/\b(writeFile|mkdir|createWriteStream)\b/.test(source), false, `${sourcePath} must not write files`);
  }

  for (const dir of ['ui', 'rendering']) {
    const entries = await readdir(dir, { recursive: true });
    for (const entry of entries) {
      const file = join(dir, entry);
      const info = await stat(file);
      if (!info.isFile() || !file.endsWith('.js')) {
        continue;
      }

      const source = await readFile(file, 'utf8');
      assert.equal(/\b(contentBase64|imageBase64)\b/.test(source), false, `${file} must not inspect raw generated image bytes`);
    }
  }
});
