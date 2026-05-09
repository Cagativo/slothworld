const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3.1:8b';

function normalizeBaseUrl(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function normalizeModel(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || DEFAULT_MODEL;
}

function resolveBaseUrl() {
  return normalizeBaseUrl(process.env.OLLAMA_BASE_URL);
}

function resolveModel(model) {
  return normalizeModel(model || process.env.OLLAMA_MODEL);
}

function normalizePrompt(prompt) {
  const normalized = typeof prompt === 'string' ? prompt.trim() : '';
  if (!normalized) {
    throw createOllamaError({
      code: 'ollama_prompt_missing',
      message: 'ollama_prompt_missing'
    });
  }

  return normalized;
}

function normalizeTemperature(temperature) {
  if (temperature === undefined || temperature === null || temperature === '') {
    return undefined;
  }

  const value = Number(temperature);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeOptions(options) {
  return options && typeof options === 'object' && !Array.isArray(options)
    ? { ...options }
    : {};
}

function createOllamaError({ code, message, status = null, detail = null, cause = null }) {
  const error = new Error(message || code || 'ollama_error');
  error.name = 'OllamaProviderError';
  error.provider = 'ollama';
  error.code = code || 'ollama_error';
  error.status = status;
  error.detail = detail;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

async function readResponseDetail(response) {
  try {
    const contentType = response && response.headers && typeof response.headers.get === 'function'
      ? String(response.headers.get('content-type') || '')
      : '';

    if (contentType.includes('application/json')) {
      return await response.json();
    }

    return await response.text();
  } catch (error) {
    return {
      error: 'ollama_error_detail_unavailable',
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildGenerateRequest({ prompt, system, model, temperature, options }) {
  const request = {
    model: resolveModel(model),
    prompt: normalizePrompt(prompt),
    stream: false
  };

  if (typeof system === 'string' && system.trim()) {
    request.system = system.trim();
  }

  const normalizedTemperature = normalizeTemperature(temperature);
  const normalizedOptions = normalizeOptions(options);
  if (normalizedTemperature !== undefined) {
    normalizedOptions.temperature = normalizedTemperature;
  }

  if (Object.keys(normalizedOptions).length > 0) {
    request.options = normalizedOptions;
  }

  return request;
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw createOllamaError({
      code: 'ollama_connection_failed',
      message: 'ollama_connection_failed',
      cause: error
    });
  }

  if (!response.ok) {
    const detail = await readResponseDetail(response);
    throw createOllamaError({
      code: 'ollama_request_failed',
      message: `ollama_request_failed:${response.status}`,
      status: response.status,
      detail
    });
  }

  try {
    return await response.json();
  } catch (error) {
    throw createOllamaError({
      code: 'ollama_response_invalid_json',
      message: 'ollama_response_invalid_json',
      cause: error
    });
  }
}

export const ollamaProvider = Object.freeze({
  id: 'ollama',

  async healthCheck() {
    const baseUrl = resolveBaseUrl();
    const response = await fetchJson(`${baseUrl}/api/tags`, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

    return {
      ok: true,
      provider: 'ollama',
      baseUrl,
      models: Array.isArray(response.models)
        ? response.models.map((item) => item && item.name).filter(Boolean)
        : []
    };
  },

  async generateText({ prompt, system, model, temperature, options, signal } = {}) {
    const baseUrl = resolveBaseUrl();
    const request = buildGenerateRequest({ prompt, system, model, temperature, options });
    const response = await fetchJson(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {})
    });

    const text = typeof response.response === 'string' ? response.response : '';
    if (!text) {
      throw createOllamaError({
        code: 'ollama_response_missing_text',
        message: 'ollama_response_missing_text',
        detail: response
      });
    }

    return {
      text,
      provider: 'ollama',
      createdAt: Date.now(),
      metadata: {
        model: response.model || request.model,
        done: Boolean(response.done),
        totalDuration: response.total_duration ?? null,
        loadDuration: response.load_duration ?? null,
        promptEvalCount: response.prompt_eval_count ?? null,
        evalCount: response.eval_count ?? null
      }
    };
  }
});

export function getOllamaConfig() {
  return {
    baseUrl: resolveBaseUrl(),
    model: resolveModel()
  };
}

export { buildGenerateRequest, createOllamaError };
