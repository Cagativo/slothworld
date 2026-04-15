import { openAIImageProvider } from './openaiImageProvider.js';
import { huggingFaceImageProvider } from './huggingfaceImageProvider.js';

const providers = new Map();

function normalizeProviderName(name) {
  return String(name || '').trim().toLowerCase();
}

function isValidProvider(provider) {
  return provider && typeof provider.generate === 'function';
}

export const ProviderRegistry = {
  register(name, provider) {
    const normalizedName = normalizeProviderName(name);
    if (!normalizedName) {
      throw new Error('provider_name_required');
    }

    if (!isValidProvider(provider)) {
      throw new Error(`invalid_provider:${normalizedName}`);
    }

    providers.set(normalizedName, provider);
    return provider;
  },

  get(name) {
    const normalizedName = normalizeProviderName(name);
    const provider = providers.get(normalizedName);
    if (!provider) {
      throw new Error(`provider_not_supported:${normalizedName}`);
    }

    return provider;
  },

  has(name) {
    return providers.has(normalizeProviderName(name));
  },

  list() {
    return Array.from(providers.keys());
  }
};

ProviderRegistry.register('openai', openAIImageProvider);
ProviderRegistry.register('huggingface', huggingFaceImageProvider);
