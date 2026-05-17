import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_COMFYUI_BASE_URL = 'http://127.0.0.1:8188';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_CHECKPOINT = 'v1-5-pruned-emaonly.safetensors';
const DEFAULT_NEGATIVE_PROMPT = 'text, watermark, blurry, low quality';
const DEFAULT_FILENAME_PREFIX = 'Slothworld';
const HEALTH_ENDPOINT = '/system_stats';

function resolveBaseUrl() {
  return String(process.env.COMFYUI_BASE_URL || DEFAULT_COMFYUI_BASE_URL).trim()
    || DEFAULT_COMFYUI_BASE_URL;
}

function resolvePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function resolveString(value, fallback) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function resolveGenerationOption(input, context, key, fallback) {
  if (input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, key)) {
    return input[key];
  }

  const metadata = context && typeof context.metadata === 'object' ? context.metadata : {};
  if (Object.prototype.hasOwnProperty.call(metadata, key)) {
    return metadata[key];
  }

  return fallback;
}

function resolveClientId(input, context) {
  return resolveString(
    resolveGenerationOption(input, context, 'clientId', process.env.COMFYUI_CLIENT_ID),
    `slothworld-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  );
}

function resolveFilenamePrefix(input, context) {
  const rawPrefix = resolveString(
    resolveGenerationOption(input, context, 'filenamePrefix', process.env.COMFYUI_FILENAME_PREFIX),
    DEFAULT_FILENAME_PREFIX
  );
  return rawPrefix
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    || DEFAULT_FILENAME_PREFIX;
}

function buildUrl(pathname) {
  const baseUrl = resolveBaseUrl();
  return new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

function createProviderError(code, message = code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.provider = 'comfyui';
  error.status = details.status || 'failed';
  error.retryable = details.retryable === true;

  for (const [key, value] of Object.entries(details)) {
    if (!Object.prototype.hasOwnProperty.call(error, key)) {
      error[key] = value;
    }
  }

  return error;
}

function normalizePrompt(input) {
  const prompt = typeof input === 'string'
    ? input.trim()
    : (input && typeof input.prompt === 'string' ? input.prompt.trim() : '');

  if (!prompt) {
    throw createProviderError('comfyui_prompt_missing', 'comfyui_prompt_missing', {
      status: 'invalid_request',
      retryable: false
    });
  }

  return prompt;
}

function buildMinimalWorkflow(prompt, input = {}, context = {}) {
  const width = resolveInteger(resolveGenerationOption(input, context, 'width', 512), 512);
  const height = resolveInteger(resolveGenerationOption(input, context, 'height', 512), 512);
  const steps = resolveInteger(resolveGenerationOption(input, context, 'steps', 20), 20);
  const seed = resolveInteger(
    resolveGenerationOption(input, context, 'seed', Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
    Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
  );
  const cfg = resolvePositiveNumber(resolveGenerationOption(input, context, 'cfg', 7), 7);
  const sampler = resolveString(resolveGenerationOption(input, context, 'sampler', 'euler'), 'euler');
  const scheduler = resolveString(resolveGenerationOption(input, context, 'scheduler', 'normal'), 'normal');
  const negativePrompt = resolveString(
    resolveGenerationOption(input, context, 'negativePrompt', DEFAULT_NEGATIVE_PROMPT),
    DEFAULT_NEGATIVE_PROMPT
  );

  return {
    '3': {
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0]
      },
      class_type: 'KSampler'
    },
    '4': {
      inputs: {
        ckpt_name: resolveString(process.env.COMFYUI_CHECKPOINT, DEFAULT_CHECKPOINT)
      },
      class_type: 'CheckpointLoaderSimple'
    },
    '5': {
      inputs: {
        width,
        height,
        batch_size: 1
      },
      class_type: 'EmptyLatentImage'
    },
    '6': {
      inputs: {
        text: prompt,
        clip: ['4', 1]
      },
      class_type: 'CLIPTextEncode'
    },
    '7': {
      inputs: {
        text: negativePrompt,
        clip: ['4', 1]
      },
      class_type: 'CLIPTextEncode'
    },
    '8': {
      inputs: {
        samples: ['3', 0],
        vae: ['4', 2]
      },
      class_type: 'VAEDecode'
    },
    '9': {
      inputs: {
        filename_prefix: resolveFilenamePrefix(input, context),
        images: ['8', 0]
      },
      class_type: 'SaveImage'
    }
  };
}

function injectPromptIntoWorkflow(workflow, prompt) {
  const copy = JSON.parse(JSON.stringify(workflow));
  let injected = false;

  for (const node of Object.values(copy)) {
    if (!node || node.class_type !== 'CLIPTextEncode' || !node.inputs) {
      continue;
    }

    if (!injected || node.inputs.text === '{{prompt}}') {
      node.inputs.text = prompt;
      injected = true;
    }
  }

  return copy;
}

function isApiGraph(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).some((node) => (
    node
    && typeof node === 'object'
    && typeof node.class_type === 'string'
    && node.inputs
    && typeof node.inputs === 'object'
  ));
}

function pruneApiGraph(value) {
  const graph = {};

  for (const [nodeId, node] of Object.entries(value || {})) {
    if (
      node
      && typeof node === 'object'
      && typeof node.class_type === 'string'
      && node.inputs
      && typeof node.inputs === 'object'
    ) {
      graph[nodeId] = node;
    }
  }

  return graph;
}

function extractApiGraph(parsed) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && isApiGraph(parsed.prompt)) {
    return pruneApiGraph(parsed.prompt);
  }

  if (isApiGraph(parsed)) {
    return pruneApiGraph(parsed);
  }

  throw createProviderError('comfyui_response_invalid_json', 'comfyui_response_invalid_json', {
    status: 'invalid_workflow',
    retryable: false
  });
}

async function loadWorkflow(prompt, input = {}, context = {}) {
  const workflowPath = String(process.env.COMFYUI_WORKFLOW_PATH || '').trim();
  if (!workflowPath) {
    return buildMinimalWorkflow(prompt, input, context);
  }

  const resolvedPath = path.isAbsolute(workflowPath)
    ? workflowPath
    : path.resolve(process.cwd(), workflowPath);
  let parsed;

  try {
    parsed = JSON.parse(await readFile(resolvedPath, 'utf8'));
  } catch (error) {
    throw createProviderError('comfyui_response_invalid_json', 'comfyui_response_invalid_json', {
      status: 'invalid_workflow',
      retryable: false,
      cause: error
    });
  }

  return injectPromptIntoWorkflow(extractApiGraph(parsed), prompt);
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    throw createProviderError('comfyui_response_invalid_json', 'comfyui_response_invalid_json', {
      status: 'invalid_response',
      retryable: true,
      cause: error
    });
  }
}

async function requestJson(pathname, options = {}) {
  let response;

  try {
    response = await fetch(buildUrl(pathname), options);
  } catch (error) {
    throw createProviderError('comfyui_connection_failed', 'comfyui_connection_failed', {
      status: 'connection_failed',
      retryable: true,
      cause: error
    });
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      detail = '';
    }

    throw createProviderError('comfyui_request_failed', `comfyui_request_failed:${response.status}`, {
      status: 'request_failed',
      httpStatus: response.status,
      detail,
      retryable: response.status >= 500
    });
  }

  return readJsonResponse(response);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractHistoryEntry(history, promptId) {
  if (!history || typeof history !== 'object') {
    return null;
  }

  if (history[promptId] && typeof history[promptId] === 'object') {
    return history[promptId];
  }

  return history;
}

function extractOutputImage(history, promptId) {
  const entry = extractHistoryEntry(history, promptId);
  const outputs = entry && typeof entry.outputs === 'object' ? entry.outputs : null;
  if (!outputs) {
    return null;
  }

  const outputValues = Object.values(outputs);
  for (const output of outputValues) {
    if (!output || !Array.isArray(output.images)) {
      continue;
    }

    const image = output.images.find((item) => item && item.filename);
    if (image) {
      return {
        filename: image.filename,
        subfolder: image.subfolder || '',
        type: image.type || 'output'
      };
    }
  }

  if (outputValues.length > 0) {
    throw createProviderError('comfyui_output_missing', 'comfyui_output_missing', {
      status: 'output_missing',
      retryable: true,
      promptId
    });
  }

  return null;
}

async function pollForImage(promptId, timeoutMs, pollIntervalMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const history = await requestJson(`/history/${encodeURIComponent(promptId)}`, {
      method: 'GET'
    });
    const image = extractOutputImage(history, promptId);

    if (image) {
      return image;
    }

    if (Date.now() + pollIntervalMs > deadline) {
      break;
    }

    await sleep(pollIntervalMs);
  }

  throw createProviderError('comfyui_timeout', 'comfyui_timeout', {
    status: 'timeout',
    retryable: true,
    promptId
  });
}

async function fetchImage({ filename, subfolder, type }) {
  const url = buildUrl('/view');
  url.searchParams.set('filename', filename);
  url.searchParams.set('subfolder', subfolder || '');
  url.searchParams.set('type', type || 'output');

  let response;
  try {
    response = await fetch(url, { method: 'GET' });
  } catch (error) {
    throw createProviderError('comfyui_connection_failed', 'comfyui_connection_failed', {
      status: 'connection_failed',
      retryable: true,
      cause: error
    });
  }

  if (!response.ok) {
    throw createProviderError('comfyui_request_failed', `comfyui_request_failed:${response.status}`, {
      status: 'request_failed',
      httpStatus: response.status,
      retryable: response.status >= 500
    });
  }

  const mimeType = response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('content-type') || 'image/png'
    : 'image/png';
  const contentBase64 = Buffer.from(await response.arrayBuffer()).toString('base64');

  if (!contentBase64) {
    throw createProviderError('comfyui_output_missing', 'comfyui_output_missing', {
      status: 'output_missing',
      retryable: true
    });
  }

  return { mimeType, contentBase64 };
}

export const comfyUiProvider = {
  id: 'comfyui',

  async healthCheck(options = {}) {
    const endpoint = HEALTH_ENDPOINT;
    const baseUrl = resolveBaseUrl();

    try {
      const response = await fetch(buildUrl(endpoint), {
        method: 'GET',
        signal: options.signal
      });

      return {
        ok: response.ok,
        provider: 'comfyui',
        baseUrl,
        endpoint,
        status: response.status
      };
    } catch (error) {
      return {
        ok: false,
        provider: 'comfyui',
        baseUrl,
        endpoint,
        error: error && error.message ? error.message : String(error)
      };
    }
  },

  async generate(input, context = {}) {
    const prompt = normalizePrompt(input);
    const workflow = await loadWorkflow(prompt, input, context);
    const clientId = resolveClientId(input, context);
    const timeoutMs = resolvePositiveNumber(process.env.COMFYUI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    const pollIntervalMs = resolvePositiveNumber(process.env.COMFYUI_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS);
    const submittedAt = Date.now();
    const promptResponse = await requestJson('/prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        prompt: workflow
      })
    });
    const promptId = promptResponse && typeof promptResponse.prompt_id === 'string'
      ? promptResponse.prompt_id.trim()
      : '';

    if (!promptId) {
      throw createProviderError('comfyui_response_invalid_json', 'comfyui_response_invalid_json', {
        status: 'invalid_response',
        retryable: true
      });
    }

    const imageRef = await pollForImage(promptId, timeoutMs, pollIntervalMs);
    if (!imageRef) {
      throw createProviderError('comfyui_output_missing', 'comfyui_output_missing', {
        status: 'output_missing',
        retryable: true,
        promptId
      });
    }

    const image = await fetchImage(imageRef);
    const metadata = context && typeof context.metadata === 'object' ? context.metadata : {};

    return {
      path: '',
      imageUrl: undefined,
      provider: 'comfyui',
      prompt,
      createdAt: submittedAt,
      mimeType: image.mimeType,
      model: metadata.model || process.env.COMFYUI_CHECKPOINT || null,
      contentBase64: image.contentBase64,
      promptId,
      image: imageRef
    };
  }
};

export async function generateImage(input = {}) {
  return comfyUiProvider.generate(input);
}
