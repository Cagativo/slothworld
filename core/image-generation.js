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
    if (selectedProvider !== 'openai') {
      throw new Error(`provider_not_supported:${selectedProvider}`);
    }

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
  const request = normalizeRequest(configOrProvider, prompt, productId, options);
  const normalizedPrompt = normalizePrompt(request.prompt);
  const context = request.context || {};
  const provider = request.provider || 'openai';
  if (provider !== 'openai') {
    throw new Error(`provider_not_supported:${provider}`);
  }
  const endpoint = '/render/openai/generate';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      provider,
      prompt: normalizedPrompt,
      productId: context && context.metadata ? context.metadata.productId : null,
      taskContext: context
    })
  });

  if (!response.ok) {
    let detail = null;
    try {
      const body = await response.json();
      detail = body && body.error ? String(body.error) : null;
    } catch (_error) {
      detail = null;
    }

    throw new Error(detail
      ? `${provider}_generate_${response.status}:${detail}`
      : `${provider}_generate_${response.status}`);
  }

  const payload = await response.json();
  const result = payload && payload.result ? payload.result : null;
  if (!result) {
    throw new Error(`${provider}_invalid_response`);
  }

  return {
    path: result.asset && result.asset.url ? result.asset.url : '',
    prompt: normalizedPrompt,
    provider,
    createdAt: result.asset && typeof result.asset.createdAt === 'number' ? result.asset.createdAt : Date.now(),
    contentBase64: typeof result.imageBase64 === 'string' ? result.imageBase64 : null,
    mimeType: typeof result.mimeType === 'string' ? result.mimeType : 'image/png',
    metadata: {
      asset: result.asset || null,
      model: result.model || null
    }
  };
}

export async function generateProductImage(prompt, config = {}) {
  return generateImage({
    provider: config.provider || 'openai',
    prompt,
    context: config.context || {}
  });
}
