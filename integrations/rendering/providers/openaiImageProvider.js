import OpenAI from 'openai';
import { assertProviderExecutionContext } from '../../../core/engine/enforcementRuntime.js';

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

export const openAIImageProvider = {
  id: 'openai',
  async generate(prompt, context = {}) {
    assertProviderExecutionContext();

    const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    const metadata = context && typeof context.metadata === 'object' ? context.metadata : {};
    const normalizedProductId = typeof metadata.productId === 'string' && metadata.productId.trim()
      ? metadata.productId.trim()
      : 'product';

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
      path: '',
      imageUrl: undefined,
      provider: 'openai',
      prompt: normalizedPrompt,
      createdAt,
      mimeType: 'image/png',
      model: 'gpt-5',
      contentBase64: base64Png
    };
  }
};

export async function generateImage({ prompt, productId }) {
  return openAIImageProvider.generate(prompt, {
    metadata: {
      productId
    }
  });
}
