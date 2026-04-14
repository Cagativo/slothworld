import OpenAI from 'openai';

function extractBase64Image(response) {
  if (!response || !Array.isArray(response.output)) {
    return null;
  }

  for (const output of response.output) {
    if (!output || output.type !== 'image_generation_call') {
      continue;
    }

    if (typeof output.result === 'string' && output.result.trim()) {
      return output.result.trim();
    }
  }

  return null;
}

export async function generateImage({ prompt, productId }) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const normalizedProductId = typeof productId === 'string' && productId.trim() ? productId.trim() : 'product';

  if (!normalizedPrompt) {
    throw new Error('missing_prompt');
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('openai_api_key_missing');
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const createdAt = Date.now();
  console.log('[OPENAI_IMAGE_REQUEST]', {
    productId: normalizedProductId,
    promptLength: normalizedPrompt.length,
    model: 'gpt-5'
  });

  const response = await client.responses.create({
    model: 'gpt-5',
    input: normalizedPrompt,
    tools: [{ type: 'image_generation' }]
  });

  const base64Png = extractBase64Image(response);
  if (!base64Png) {
    throw new Error('OPENAI_IMAGE_FAILED_NO_OUTPUT');
  }

  console.log('[OPENAI_IMAGE_SUCCESS]', {
    productId: normalizedProductId,
    base64Length: base64Png.length
  });

  return {
    provider: 'openai',
    prompt: normalizedPrompt,
    createdAt,
    mimeType: 'image/png',
    model: 'gpt-5',
    contentBase64: base64Png
  };
}
