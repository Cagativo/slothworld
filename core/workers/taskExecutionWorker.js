import {
  ACTION_SEND_CHANNEL_MESSAGE,
  ACTION_REPLY_TO_MESSAGE,
  TASK_TYPE_IMAGE_RENDER,
  ACTION_RENDER_PRODUCT_IMAGE,
  TASK_TYPE_TREND_RESEARCH
} from '../constants.js';
import { normalizeDesignIntent, buildProviderPrompt } from '../../integrations/rendering/prompt-builder.js';
import { runImageRenderWorker } from './imageRenderWorker.js';
import { runCollectSignalsWorker } from './collectSignalsWorker.js';
import { runSignalNormalizationWorker } from './signalNormalizationWorker.js';
import { runScoreTrendsWorker } from './scoreTrendsWorker.js';
import { runSelectCandidatesWorker } from './selectCandidatesWorker.js';
import { runProduceFinalOutputWorker } from './produceFinalOutputWorker.js';
import { runTrendResearchWorkflow } from '../engine/runTrendResearchWorkflow.js';

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

  if (!discordClient || !discordClient.isReady || !discordClient.isReady()) {
    return fail('discordClient is not configured');
  }

  if (!isDiscordSnowflake(channelId)) {
    return fail('payload.channelId must be a Discord snowflake');
  }

  try {
    if (task.action === 'fetch_order' || task.action === 'refund_order') {
      return ok({
        action: task.action,
        note: 'Action received and queued for downstream commerce worker.'
      });
    }

    const channel = await discordClient.channels.fetch(channelId);

    if (task.action === ACTION_SEND_CHANNEL_MESSAGE) {
      const sentMessage = await channel.send(String(content || ''));
      if (sentMessage && sentMessage.id && taskTriggeredMessageIds) {
        taskTriggeredMessageIds.add(sentMessage.id);
      }

      return ok({ sent: true });
    }

    if (!isDiscordSnowflake(messageId)) {
      return fail('payload.messageId must be a Discord snowflake for reply_to_message');
    }

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

async function executeTrendResearchStepTask(task) {
  const payload = task && task.payload && typeof task.payload === 'object' ? task.payload : {};
  const context = payload.context && typeof payload.context === 'object' ? payload.context : {};
  const action = String(task && task.action || '').toLowerCase();

  if (action === 'collectsignals') {
    const keyword = context.keyword || '';
    return await runCollectSignalsWorker({ keyword });
  }

  if (action === 'scoretrends') {
    const collectSignalsOutput = context.collect_signals && context.collect_signals.output;
    const signals = collectSignalsOutput && collectSignalsOutput.result && Array.isArray(collectSignalsOutput.result.signals)
      ? collectSignalsOutput.result.signals
      : [];
    const rawSignals = collectSignalsOutput && collectSignalsOutput.result && Array.isArray(collectSignalsOutput.result.rawSignals)
      ? collectSignalsOutput.result.rawSignals
      : [];

    const normalizedResult = runSignalNormalizationWorker({
      keyword: context.keyword || '',
      signals,
      rawSignals
    });

    if (!normalizedResult.success) {
      return normalizedResult;
    }

    return runScoreTrendsWorker({ normalizedSignals: normalizedResult.result.normalizedSignals });
  }

  if (action === 'selectcandidates') {
    const scoreTrendsOutput = context.score_trends && context.score_trends.output;
    const scored = scoreTrendsOutput && scoreTrendsOutput.result && Array.isArray(scoreTrendsOutput.result.scored)
      ? scoreTrendsOutput.result.scored
      : [];
    return runSelectCandidatesWorker({ scored });
  }

  if (action === 'producefinaloutput') {
    const selectCandidatesOutput = context.select_candidates && context.select_candidates.output;
    const candidates = selectCandidatesOutput && selectCandidatesOutput.result && Array.isArray(selectCandidatesOutput.result.candidates)
      ? selectCandidatesOutput.result.candidates
      : [];
    return runProduceFinalOutputWorker({ candidates });
  }

  return fail(`Unknown TrendResearchWorkflow action: ${action}`);
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
      source: task.type === TASK_TYPE_DISCORD ? 'discord' : 'api',
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
          action === ACTION_SEND_CHANNEL_MESSAGE
          || action === 'discord.send_channel_message'
          || action === 'discord_message'
          || action === 'discord.message'
          || action === ACTION_REPLY_TO_MESSAGE
          || action === 'discord_reply'
          || action === 'discord.reply'
          || action === 'summarize_message'
          || action === 'classify_intent'
          || action === 'fetch_order'
          || action === 'refund_order'
        ) {
          return executeDiscordTask(task, { getDiscordClient, taskTriggeredMessageIds });
        }

        if (task.type === TASK_TYPE_IMAGE_RENDER || action === ACTION_RENDER_PRODUCT_IMAGE || action === 'render.route') {
          return executeImageRenderTask(task);
        }

        if (task.type === TASK_TYPE_TREND_RESEARCH) {
          const result = await runTrendResearchWorkflow(task.payload);

          return ok(result);
        }

        if (action === 'research_product' || action === 'research.query') {
          return executeResearchTask(task);
        }

        if (
          action === 'collectsignals'
          || action === 'scoretrends'
          || action === 'selectcandidates'
          || action === 'producefinaloutput'
        ) {
          return executeTrendResearchStepTask(task);
        }

        if (task.type === TASK_TYPE_SHOPIFY) {
          return executeShopifyTask(task);
        }

        if (task.type === TASK_TYPE_DISCORD) {
          return executeDiscordTask(task, { getDiscordClient, taskTriggeredMessageIds });
        }

        return fail(`Unsupported task type: ${task.type}`);
      } catch (error) {
        return fail(error);
      }
    }
  };
}
