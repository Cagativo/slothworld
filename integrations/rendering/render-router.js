import { normalizeDesignIntent, buildProviderPrompt } from './prompt-builder.js';
import { logRenderEvent } from './render-stability.js';
import { generateImage } from '../../core/image-generation.js';
import { warnLegacyExecutionPath } from '../../core/execution-pipeline.js';

function getRequestedProvider(task, payload) {
  const rawProvider = task && typeof task.provider === 'string'
    ? task.provider
    : (payload && typeof payload.provider === 'string' ? payload.provider : 'openai');
  return String(rawProvider || 'openai').toLowerCase();
}

export function normalizeRenderTask(task) {
  const payload = task.payload && typeof task.payload === 'object' ? task.payload : {};
  const context = payload.context && typeof payload.context === 'object' ? payload.context : {};
  const designIntent = normalizeDesignIntent(task.designIntent || payload.designIntent || {}, context);
  const productId = task.productId || payload.productId || task.id;
  const provider = getRequestedProvider(task, payload);
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
  const prompt = buildProviderPrompt(provider, task.designIntent);
  logRenderEvent(task.renderId || task.id, 'RENDER_PROVIDER_EXECUTION', {
    provider,
    productId: task.productId,
    taskId: task.id
  });
  const renderResult = await generateImage({
    provider,
    prompt,
    context: {
      taskId: task.id,
      workflowId: task.renderId || task.id,
      source: task.type === 'discord' ? 'discord' : 'api',
      retryCount: typeof task.retries === 'number' ? task.retries : 0,
      metadata: {
        productId: task.productId,
        renderId: task.renderId || task.id,
        channelId: task.channelId || null
      }
    }
  });

  const asset = renderResult && renderResult.metadata && renderResult.metadata.asset
    ? renderResult.metadata.asset
    : {
      assetId: null,
      productId: task.productId,
      url: renderResult.imageUrl || renderResult.path,
      provider: renderResult.provider || provider,
      prompt: renderResult.prompt || prompt,
      createdAt: renderResult.createdAt || Date.now(),
      manifestUrl: null
    };

  return {
    provider: renderResult.provider || provider,
    prompt: renderResult.prompt || prompt,
    asset,
    metadata: renderResult.metadata || {},
    imageUrl: renderResult.imageUrl || renderResult.path || null
  };
}

export async function executeRenderRoute(taskInput) {
  // LEGACY: browser-side render routing exists for compatibility only.
  // Canonical execution path is createTask -> enqueueTask -> claimTask -> executeTask -> ackTask.
  warnLegacyExecutionPath('integrations/rendering/render-router.executeRenderRoute', {
    reason: 'browser_render_route_bypasses_canonical_task_pipeline',
    disabled: true
  });

  const task = normalizeRenderTask(taskInput || {});
  logRenderEvent(task.renderId || task.id || 'legacy-render-route', 'RENDER_ROUTE_DISABLED', {
    taskId: task.id || null,
    provider: task.provider || null,
    productId: task.productId || null
  });

  return {
    success: false,
    error: 'legacy_execution_disabled'
  };
}