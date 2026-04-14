import { normalizeDesignIntent, buildProviderPrompt } from './prompt-builder.js';
import { persistRenderedAsset } from './asset-store.js';
import { logRenderEvent } from './render-stability.js';
import { openAIImageAdapter } from './providers/openAIImageAdapter.js';

const adapters = {
  openai: openAIImageAdapter
};

function getRequestedProvider() {
  return 'openai';
}

export function normalizeRenderTask(task) {
  const payload = task.payload && typeof task.payload === 'object' ? task.payload : {};
  const context = payload.context && typeof payload.context === 'object' ? payload.context : {};
  const designIntent = normalizeDesignIntent(task.designIntent || payload.designIntent || {}, context);
  const productId = task.productId || payload.productId || task.id;
  const provider = getRequestedProvider();
  const renderId = task.renderId || payload.renderId || task.id;
  const content = typeof task.content === 'string'
    ? task.content
    : (typeof payload.content === 'string' ? payload.content : '');
  const channelId = task.channelId || payload.channelId || null;

  return {
    ...task,
    renderId,
    productId,
    provider,
    content,
    channelId,
    designIntent,
    payload,
    status: task.status || 'pending'
  };
}

async function runProvider(task, provider) {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`render_provider_missing:${provider}`);
  }

  const prompt = buildProviderPrompt(provider, task.designIntent);
  logRenderEvent(task.renderId || task.id, 'RENDER_PROVIDER_EXECUTION', {
    provider,
    productId: task.productId,
    taskId: task.id
  });
  const renderResult = await adapter.render(task, prompt);
  const asset = await persistRenderedAsset({
    productId: task.productId,
    provider,
    prompt,
    renderResult
  });

  return {
    provider,
    prompt,
    asset,
    metadata: renderResult.metadata || {}
  };
}

export async function executeRenderRoute(taskInput) {
  const task = normalizeRenderTask(taskInput);
  logRenderEvent(task.renderId || task.id, 'RENDER_ROUTE_EXECUTION_STARTED', {
    taskId: task.id,
    provider: 'openai',
    productId: task.productId
  });

  try {
    const result = await runProvider(task, 'openai');
    logRenderEvent(task.renderId || task.id, 'RENDER_ROUTE_EXECUTION_COMPLETED', {
      provider: 'openai',
      taskId: task.id,
      productId: task.productId,
      assetId: result.asset && result.asset.assetId ? result.asset.assetId : null
    });
    return {
      success: true,
      asset: result.asset,
      renderId: task.renderId,
      provider: result.provider,
      prompt: result.prompt,
      designIntent: task.designIntent,
      metadata: result.metadata
    };
  } catch (error) {
    logRenderEvent(task.renderId || task.id, 'RENDER_PROVIDER_FAILED', {
      provider: 'openai',
      taskId: task.id,
      error: error && error.message ? error.message : 'render_failed'
    });
    return {
      success: false,
      error: error && error.message ? error.message : 'render_failed'
    };
  }
}