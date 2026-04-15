import { normalizeDesignIntent, buildProviderPrompt } from '../../integrations/rendering/prompt-builder.js';
import { runImageRenderWorker } from './imageRenderWorker.js';
import { assertWorkerExecutionContext } from '../engine/enforcementRuntime.js';

function ok(result) {
  return {
    success: true,
    result
  };
}

function fail(error, result = null) {
  return {
    success: false,
    result,
    error: typeof error === 'string' ? error : (error && error.message ? error.message : 'worker_failed')
  };
}

function unwrapOutput(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const output = entry.output;
  if (!output || typeof output !== 'object') {
    return output || null;
  }

  if (Object.prototype.hasOwnProperty.call(output, 'result')) {
    return output.result;
  }

  return output;
}

function isDiscordSnowflake(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

async function executeDiscordTask(task, { getDiscordClient, taskTriggeredMessageIds }) {
  const discordClient = typeof getDiscordClient === 'function' ? getDiscordClient() : null;
  const { channelId, messageId, content } = task.payload || {};

  if (!isDiscordSnowflake(channelId) || !isDiscordSnowflake(messageId)) {
    return ok({
      skipped: true,
      note: 'discord_target_unavailable'
    });
  }

  if (!discordClient || !discordClient.isReady || !discordClient.isReady()) {
    return fail('discordClient is not configured');
  }

  try {
    if (task.action === 'fetch_order' || task.action === 'refund_order') {
      return ok({
        action: task.action,
        note: 'Action received and queued for downstream commerce worker.'
      });
    }

    const channel = await discordClient.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);

    const replyMessage = await message.reply(content);
    if (replyMessage && replyMessage.id && taskTriggeredMessageIds) {
      taskTriggeredMessageIds.add(replyMessage.id);
    }

    return ok({ replied: true });
  } catch (error) {
    console.error('[DISCORD ERROR]', error);
    return fail(error);
  }
}

async function executeShopifyTask(task) {
  const payload = task && task.payload && typeof task.payload === 'object' ? task.payload : {};
  const context = payload && payload.context && typeof payload.context === 'object' ? payload.context : {};
  const action = String(task && task.action ? task.action : '').toLowerCase();

  if (action === 'generate_design_prompt' || action === 'shopify.generate_design_prompt') {
    const keyword = (payload && payload.keyword) || (context && context.keyword) || 'unknown-product';
    const researchEntry = context && context.research_product ? context.research_product : null;
    const researchOutput = unwrapOutput(researchEntry);
    const findings = researchOutput && Array.isArray(researchOutput.findings) ? researchOutput.findings : [];
    return ok({
      keyword,
      prompt: `Design a product visual for ${keyword}. Insights: ${findings.length ? findings.join('; ') : 'general market fit'}`
    });
  }

  if (action === 'create_product_listing' || action === 'shopify.create_product_listing') {
    const keyword = (payload && payload.keyword) || (context && context.keyword) || 'unknown-product';
    const promptEntry = context && context.generate_design_prompt ? context.generate_design_prompt : null;
    const imageEntry = context && context.render_product_image ? context.render_product_image : null;
    const promptOutput = unwrapOutput(promptEntry);
    const imageOutput = unwrapOutput(imageEntry);

    return ok({
      listingId: `listing-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      title: `${keyword} - Automated Listing`,
      description: promptOutput && promptOutput.prompt ? promptOutput.prompt : `Automated listing for ${keyword}`,
      imageUrl: imageOutput && (imageOutput.url || imageOutput.imageUrl) ? (imageOutput.url || imageOutput.imageUrl) : null
    });
  }

  console.log('[SHOPIFY ACTION]', task && task.action, task && task.payload);
  return ok({ processed: true, action: task && task.action ? task.action : 'process_order' });
}

async function executeResearchTask(task) {
  const payload = task && task.payload && typeof task.payload === 'object' ? task.payload : {};
  const context = payload && payload.context && typeof payload.context === 'object' ? payload.context : {};
  const keyword = (payload && payload.keyword) || (context && context.keyword) || 'unknown-product';
  return ok({
    keyword,
    findings: [`Trend around ${keyword}`, `Audience notes for ${keyword}`]
  });
}

async function executeImageRenderTask(task) {
  const payload = task && task.payload && typeof task.payload === 'object' ? task.payload : {};
  const taskContext = payload.context && typeof payload.context === 'object' ? payload.context : {};
  const provider = String(
    (typeof task.provider === 'string' && task.provider)
      || (typeof payload.provider === 'string' && payload.provider)
      || 'openai'
  ).toLowerCase();
  const productId = typeof task.productId === 'string' && task.productId
    ? task.productId
    : (typeof payload.productId === 'string' && payload.productId ? payload.productId : task.id);
  const designIntent = normalizeDesignIntent(task.designIntent || payload.designIntent || {}, taskContext);
  const prompt = buildProviderPrompt(provider, designIntent);

  const workerResult = await runImageRenderWorker({
    provider,
    prompt,
    productId,
    context: {
      ...taskContext,
      taskId: task.id,
      workflowId: payload.renderId || task.id,
      source: task.type === 'discord' ? 'discord' : 'api',
      retryCount: typeof task.retries === 'number' ? task.retries : 0,
      metadata: {
        ...(taskContext && typeof taskContext.metadata === 'object' ? taskContext.metadata : {}),
        productId,
        renderId: payload.renderId || task.id,
        channelId: payload.channelId || null
      }
    }
  });

  if (!workerResult.success) {
    return workerResult;
  }

  const result = workerResult.result;

  return ok({
    assetId: result.asset.assetId,
    productId: result.asset.productId,
    url: result.asset.url,
    provider: result.provider,
    prompt: result.prompt,
    createdAt: result.asset.createdAt,
    imageUrl: result.asset.url,
    mimeType: result.mimeType || 'image/png',
    imageBase64: result.imageBase64,
    manifestUrl: null
  });
}

export async function generateImageFromRequest(renderRequest = {}, env = process.env) {
  void renderRequest;
  void env;
  return fail('legacy_execution_disabled:generateImageFromRequest');
}

export function createTaskExecutionWorker({ getDiscordClient, taskTriggeredMessageIds }) {
  return {
    async executeTask(task) {
      assertWorkerExecutionContext();

      if (!task) {
        return fail('Invalid task');
      }

      console.log('[TASK_EXECUTION_WORKER_RUN]', {
        taskId: task.id,
        type: task.type,
        action: task.action || null
      });

      try {
        const action = String(task.action || '').toLowerCase();

        if (
          action === 'reply_to_message'
          || action === 'summarize_message'
          || action === 'classify_intent'
          || action === 'fetch_order'
          || action === 'refund_order'
        ) {
          return executeDiscordTask(task, { getDiscordClient, taskTriggeredMessageIds });
        }

        if (task.type === 'image_render' || action === 'render_product_image' || action === 'render.route') {
          return executeImageRenderTask(task);
        }

        if (action === 'research_product' || action === 'research.query') {
          return executeResearchTask(task);
        }

        if (task.type === 'shopify') {
          return executeShopifyTask(task);
        }

        if (task.type === 'discord') {
          return executeDiscordTask(task, { getDiscordClient, taskTriggeredMessageIds });
        }

        return fail(`Unsupported task type: ${task.type}`);
      } catch (error) {
        return fail(error);
      }
    }
  };
}
