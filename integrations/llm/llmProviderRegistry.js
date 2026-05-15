import { ollamaProvider } from './providers/ollamaProvider.js';

const DEFAULT_LLM_PROVIDER_ID = 'ollama';
const providers = new Map();

function normalizeProviderId(providerId) {
  return String(providerId || DEFAULT_LLM_PROVIDER_ID).trim().toLowerCase();
}

function isValidLlmProvider(provider) {
  return provider && typeof provider.generateText === 'function';
}

export function registerLlmProvider(providerId, provider) {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (!normalizedProviderId) {
    throw new Error('llm_provider_id_required');
  }

  if (!isValidLlmProvider(provider)) {
    throw new Error(`invalid_llm_provider:${normalizedProviderId}`);
  }

  providers.set(normalizedProviderId, provider);
  return provider;
}

export function resolveLlmProvider(providerId = DEFAULT_LLM_PROVIDER_ID) {
  const normalizedProviderId = normalizeProviderId(providerId);
  const provider = providers.get(normalizedProviderId);
  if (!provider) {
    throw new Error(`llm_provider_not_supported:${normalizedProviderId}`);
  }

  return provider;
}

export async function generateTextViaLlmProvider(request = {}, providerId = DEFAULT_LLM_PROVIDER_ID) {
  return resolveLlmProvider(providerId).generateText(request);
}

registerLlmProvider(DEFAULT_LLM_PROVIDER_ID, ollamaProvider);

export { DEFAULT_LLM_PROVIDER_ID };
