import { assertProviderExecutionContext } from '../../../core/engine/enforcementRuntime.js';
const DEFAULT_MODEL = process.env.HUGGINGFACE_MODEL || 'stable-diffusion-1.5';

function normalizePrompt(prompt) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!normalizedPrompt) {
    throw new Error('huggingface_prompt_missing');
  }

  return normalizedPrompt;
}

function resolveModel(context) {
  const metadata = context && typeof context.metadata === 'object' ? context.metadata : {};
  const override = typeof metadata.model === 'string' ? metadata.model.trim() : '';
  return override || DEFAULT_MODEL;
}

export const huggingFaceImageProvider = {
  id: 'huggingface',
  async generate(prompt, context = {}) {
    assertProviderExecutionContext();

    const normalizedPrompt = normalizePrompt(prompt);
    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) {
      throw new Error('huggingface_api_key_missing');
    }

    const model = resolveModel(context);
    console.log('[HUGGINGFACE_IMAGE_REQUEST]', {
      model,
      promptLength: normalizedPrompt.length
    });

    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: normalizedPrompt })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`huggingface_request_failed_${response.status}:${detail}`);
    }

    const contentBase64 = Buffer.from(await response.arrayBuffer()).toString('base64');
    const createdAt = Date.now();

    console.log('[HUGGINGFACE_IMAGE_SUCCESS]', {
      model,
      imageBytesApprox: Math.floor((contentBase64.length * 3) / 4)
    });

    return {
      path: '',
      imageUrl: undefined,
      provider: 'huggingface',
      prompt: normalizedPrompt,
      createdAt,
      mimeType: 'image/png',
      model,
      contentBase64
    };
  }
};

export async function generateImage({ prompt, context = {} }) {
  return huggingFaceImageProvider.generate(prompt, context);
}
