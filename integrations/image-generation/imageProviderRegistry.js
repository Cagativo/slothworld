import { openAIImageProvider } from '../rendering/providers/openaiImageProvider.js';
import { huggingFaceImageProvider } from '../rendering/providers/huggingfaceImageProvider.js';
import { comfyUiProvider } from './providers/comfyUiProvider.js';

const DEFAULT_IMAGE_PROVIDER_ID = 'openai';
const providers = new Map();

function normalizeProviderId(providerId) {
  return String(providerId || DEFAULT_IMAGE_PROVIDER_ID).trim().toLowerCase();
}

function isValidImageProvider(provider) {
  return provider && typeof provider.generate === 'function';
}

export function registerImageProvider(providerId, provider) {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (!normalizedProviderId) {
    throw new Error('image_provider_id_required');
  }

  if (!isValidImageProvider(provider)) {
    throw new Error(`invalid_image_provider:${normalizedProviderId}`);
  }

  providers.set(normalizedProviderId, provider);
  return provider;
}

export function resolveImageProvider(providerId = DEFAULT_IMAGE_PROVIDER_ID) {
  const normalizedProviderId = normalizeProviderId(providerId);
  const provider = providers.get(normalizedProviderId);
  if (!provider) {
    throw new Error(`image_provider_not_supported:${normalizedProviderId}`);
  }

  return provider;
}

export function hasImageProvider(providerId) {
  return providers.has(normalizeProviderId(providerId));
}

export function listImageProviders() {
  return Array.from(providers.keys());
}

export async function generateImageViaProvider(promptOrOptions, context = {}, providerId = DEFAULT_IMAGE_PROVIDER_ID) {
  if (
    promptOrOptions
    && typeof promptOrOptions === 'object'
    && !Array.isArray(promptOrOptions)
  ) {
    const {
      prompt = '',
      provider = DEFAULT_IMAGE_PROVIDER_ID,
      context: optionsContext,
      ...metadata
    } = promptOrOptions;
    const resolvedContext = optionsContext || context || {};
    const contextWithMetadata = Object.keys(metadata).length
      ? {
          ...resolvedContext,
          metadata: {
            ...(resolvedContext && typeof resolvedContext.metadata === 'object' ? resolvedContext.metadata : {}),
            ...metadata
          }
        }
      : resolvedContext;

    return resolveImageProvider(provider).generate(prompt, contextWithMetadata);
  }

  return resolveImageProvider(providerId).generate(promptOrOptions, context);
}

registerImageProvider(DEFAULT_IMAGE_PROVIDER_ID, openAIImageProvider);
registerImageProvider('huggingface', huggingFaceImageProvider);
registerImageProvider('comfyui', comfyUiProvider);

export { DEFAULT_IMAGE_PROVIDER_ID };
