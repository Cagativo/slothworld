import { warnLegacyExecutionPath } from './execution-pipeline.js';

function normalizePrompt(prompt) {
  const normalizedPrompt = String(prompt || '').trim();
  if (!normalizedPrompt) {
    throw new Error('missing_prompt');
  }
  return normalizedPrompt;
}

function normalizeRequest(configOrProvider = {}, prompt, productId, options = {}) {
  if (typeof configOrProvider === 'string') {
    const selectedProvider = String(configOrProvider || 'openai').toLowerCase();

    return {
      provider: selectedProvider,
      prompt,
      context: {
        taskId: options.taskId,
        workflowId: options.workflowId,
        source: options.source || 'api',
        retryCount: options.retryCount,
        metadata: {
          ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
          ...(typeof productId === 'string' && productId.trim() ? { productId: productId.trim() } : {})
        }
      }
    };
  }

  return {
    provider: String(configOrProvider.provider || 'openai').toLowerCase(),
    prompt: configOrProvider.prompt,
    context: configOrProvider.context && typeof configOrProvider.context === 'object'
      ? configOrProvider.context
      : {}
  };
}

export async function generateImage(configOrProvider = {}, prompt, productId, options) {
  // LEGACY: direct render endpoint invocation bypasses createTask->enqueueTask->claimTask.
  // Freeze policy keeps this path for compatibility, but new code must use task pipeline.
  warnLegacyExecutionPath('core/image-generation.generateImage', {
    endpoint: '/render/generate',
    disabled: true
  });

  void configOrProvider;
  void prompt;
  void productId;
  void options;
  throw new Error('legacy_execution_disabled:core/image-generation.generateImage');
}

export async function generateProductImage(prompt, config = {}) {
  return generateImage({
    provider: config.provider || 'openai',
    prompt,
    context: config.context || {}
  });
}
