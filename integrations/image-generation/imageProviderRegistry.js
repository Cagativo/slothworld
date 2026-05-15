import { openAIImageProvider } from '../rendering/providers/openaiImageProvider.js';
import { huggingFaceImageProvider } from '../rendering/providers/huggingfaceImageProvider.js';

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

export async function generateImageViaProvider(prompt, context = {}, providerId = DEFAULT_IMAGE_PROVIDER_ID) {
  return resolveImageProvider(providerId).generate(prompt, context);
}

registerImageProvider(DEFAULT_IMAGE_PROVIDER_ID, openAIImageProvider);
registerImageProvider('huggingface', huggingFaceImageProvider);

export { DEFAULT_IMAGE_PROVIDER_ID };
