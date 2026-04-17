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

function extractBase64FromImagesGenerate(response) {
  if (!response || !Array.isArray(response.data)) {
    return null;
  }

  for (const item of response.data) {
    if (!item || typeof item.b64_json !== 'string') {
      continue;
    }

    const value = item.b64_json.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function toErrorLog(error) {
  if (!error || typeof error !== 'object') {
    return { message: String(error || 'unknown_error') };
  }

  return {
    name: error.name || 'Error',
    message: error.message || 'unknown_error',
    stack: error.stack || null,
    status: Object.prototype.hasOwnProperty.call(error, 'status') ? error.status : null,
    code: Object.prototype.hasOwnProperty.call(error, 'code') ? error.code : null,
    type: Object.prototype.hasOwnProperty.call(error, 'type') ? error.type : null,
    param: Object.prototype.hasOwnProperty.call(error, 'param') ? error.param : null,
    cause: error.cause || null
  };
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
    const apiTimeoutMs = Number(process.env.OPENAI_IMAGE_API_TIMEOUT_MS || 30_000);
    const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    const responsesImageModel = process.env.OPENAI_RESPONSES_IMAGE_MODEL || 'gpt-5';

    const imagesRequestPayload = {
      model: imageModel,
      prompt: normalizedPrompt,
      size: process.env.OPENAI_IMAGE_SIZE || '1024x1024'
    };

    console.log('[OPENAI_IMAGE_REQUEST_IMAGES_API]', {
      productId: normalizedProductId,
      promptLength: normalizedPrompt.length,
      apiTimeoutMs,
      requestPayload: imagesRequestPayload
    });

    try {
      const response = await client.images.generate(imagesRequestPayload, {
        timeout: apiTimeoutMs
      });
      const base64Png = extractBase64FromImagesGenerate(response);

      console.log('[OPENAI_IMAGE_RESPONSE_IMAGES_API]', {
        productId: normalizedProductId,
        hasDataArray: Boolean(response && Array.isArray(response.data)),
        dataItems: response && Array.isArray(response.data) ? response.data.length : 0,
        hasBase64: Boolean(base64Png)
      });
      console.dir(response, { depth: null, maxArrayLength: null, maxStringLength: null });

      if (base64Png) {
        console.log('[OPENAI_IMAGE_SUCCESS]', {
          productId: normalizedProductId,
          base64Length: base64Png.length,
          path: 'images.generate',
          model: imageModel
        });

        return {
          path: '',
          imageUrl: undefined,
          provider: 'openai',
          prompt: normalizedPrompt,
          createdAt,
          mimeType: 'image/png',
          model: imageModel,
          contentBase64: base64Png
        };
      }

      console.warn('[OPENAI_IMAGE_IMAGES_API_NO_OUTPUT]', {
        productId: normalizedProductId,
        model: imageModel
      });
    } catch (error) {
      console.error('[OPENAI_IMAGE_ERROR_IMAGES_API]', {
        productId: normalizedProductId,
        requestPayload: imagesRequestPayload,
        error: toErrorLog(error)
      });
      console.dir(error, { depth: null, maxArrayLength: null, maxStringLength: null });
    }

    // Fallback path: Responses API image tool.
    const responsesRequestPayload = {
      model: responsesImageModel,
      input: normalizedPrompt,
      tools: [{ type: 'image_generation' }]
    };

    console.log('[OPENAI_IMAGE_REQUEST_RESPONSES_API]', {
      productId: normalizedProductId,
      promptLength: normalizedPrompt.length,
      apiTimeoutMs,
      requestPayload: responsesRequestPayload
    });

    let response;
    try {
      response = await client.responses.create(responsesRequestPayload, {
        timeout: apiTimeoutMs
      });
    } catch (error) {
      console.error('[OPENAI_IMAGE_ERROR_RESPONSES_API]', {
        productId: normalizedProductId,
        requestPayload: responsesRequestPayload,
        error: toErrorLog(error)
      });
      console.dir(error, { depth: null, maxArrayLength: null, maxStringLength: null });
      throw error;
    }

    console.log('[OPENAI_IMAGE_RESPONSE_RESPONSES_API]', {
      productId: normalizedProductId,
      outputItems: Array.isArray(response && response.output) ? response.output.length : 0
    });
    console.dir(response, { depth: null, maxArrayLength: null, maxStringLength: null });

    const base64Png = extractBase64Image(response);
    if (!base64Png) {
      throw new Error('OPENAI_IMAGE_FAILED_NO_OUTPUT');
    }

    console.log('[OPENAI_IMAGE_SUCCESS]', {
      productId: normalizedProductId,
      base64Length: base64Png.length,
      path: 'responses.create',
      model: responsesImageModel
    });

    return {
      path: '',
      imageUrl: undefined,
      provider: 'openai',
      prompt: normalizedPrompt,
      createdAt,
      mimeType: 'image/png',
      model: responsesImageModel,
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
