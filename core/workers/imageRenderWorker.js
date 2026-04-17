import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProviderRegistry } from '../../integrations/rendering/providers/providerRegistry.js';
import { assertProviderExecutionContext, assertWorkerExecutionContext } from '../engine/enforcementRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const GENERATED_ASSETS_DIR = path.join(ROOT_DIR, 'assets', 'generated');
const DEFAULT_PROVIDER_TIMEOUT_MS = Number(process.env.IMAGE_PROVIDER_TIMEOUT_MS || 60_000);
const DEFAULT_PROVIDER_FALLBACKS = String(process.env.IMAGE_PROVIDER_FALLBACKS || 'huggingface')
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

function sanitizePathSegment(value, fallback = 'item') {
  const sanitized = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return sanitized || fallback;
}

function makeAssetId() {
  return `asset-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runProvider(provider, prompt, context) {
  assertProviderExecutionContext();
  const plugin = ProviderRegistry.get(provider);
  return plugin.generate(prompt, context);
}

async function runProviderWithTimeout(provider, prompt, context, timeoutMs) {
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_PROVIDER_TIMEOUT_MS;
  let timeoutHandle = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`provider_timeout:${safeTimeoutMs}`));
    }, safeTimeoutMs);
  });

  try {
    return await Promise.race([
      runProvider(provider, prompt, context),
      timeoutPromise
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function buildProviderPlan(primaryProvider, context) {
  const normalizedPrimary = String(primaryProvider || 'openai').trim().toLowerCase();
  const configuredFallbacks = Array.isArray(context && context.providerFallbacks)
    ? context.providerFallbacks.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : DEFAULT_PROVIDER_FALLBACKS;

  const candidates = [normalizedPrimary, ...configuredFallbacks];
  const unique = [];

  for (const providerName of candidates) {
    if (!providerName || unique.includes(providerName)) {
      continue;
    }

    if (!ProviderRegistry.has(providerName)) {
      continue;
    }

    unique.push(providerName);
  }

  if (!unique.length) {
    return [normalizedPrimary];
  }

  return unique;
}

async function persistImage({ productId, contentBase64 }) {
  const safeProductId = sanitizePathSegment(productId, 'product');
  const assetId = makeAssetId();
  const targetDir = path.join(GENERATED_ASSETS_DIR, safeProductId);
  await mkdir(targetDir, { recursive: true });

  const filename = `${assetId}.png`;
  const assetPath = path.join(targetDir, filename);
  await writeFile(assetPath, Buffer.from(contentBase64, 'base64'));

  return {
    assetId,
    productId: safeProductId,
    url: `/assets/generated/${safeProductId}/${filename}`,
    createdAt: Date.now()
  };
}

function ok(result) {
  return {
    success: true,
    result
  };
}

function fail(error, result = null) {
  return {
    success: false,
    result,
    error: typeof error === 'string' ? error : (error && error.message ? error.message : 'worker_failed')
  };
}

export async function runImageRenderWorker({ provider = 'openai', prompt = '', productId = null, context = {} }) {
  assertWorkerExecutionContext();

  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!normalizedPrompt) {
    return fail('missing_prompt');
  }

  const normalizedProvider = String(provider || 'openai').toLowerCase();
  const providerPlan = buildProviderPlan(normalizedProvider, context);
  const maxAttemptsRaw = context && typeof context.retryCount === 'number' ? context.retryCount : 0;
  const maxAttempts = Math.max(1, Math.min(3, Math.floor(maxAttemptsRaw) + 1));
  const providerTimeoutMs = context && Number.isFinite(context.providerTimeoutMs)
    ? Number(context.providerTimeoutMs)
    : DEFAULT_PROVIDER_TIMEOUT_MS;
  let providerResult = null;
  let lastError = null;

  for (const plannedProvider of providerPlan) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const providerCallStartedAt = Date.now();
      console.log('[IMAGE_RENDER_PROVIDER_CALL_START]', {
        provider: plannedProvider,
        providerPlan,
        productId,
        taskId: context && context.taskId ? context.taskId : null,
        attempt,
        maxAttempts,
        timeoutMs: providerTimeoutMs,
        promptLength: normalizedPrompt.length
      });

      try {
        providerResult = await runProviderWithTimeout(plannedProvider, normalizedPrompt, context, providerTimeoutMs);
        console.log('[IMAGE_RENDER_PROVIDER_CALL_RESOLVED]', {
          provider: plannedProvider,
          providerPlan,
          productId,
          taskId: context && context.taskId ? context.taskId : null,
          attempt,
          durationMs: Date.now() - providerCallStartedAt,
          hasContentBase64: Boolean(providerResult && typeof providerResult.contentBase64 === 'string' && providerResult.contentBase64.trim())
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const errorMessage = error instanceof Error ? error.message : 'provider_execution_failed';
        const errorKind = errorMessage.startsWith('provider_timeout:') ? 'timeout' : 'rejected';
        console.error('[IMAGE_RENDER_PROVIDER_CALL_ERROR]', {
          provider: plannedProvider,
          providerPlan,
          productId,
          taskId: context && context.taskId ? context.taskId : null,
          attempt,
          durationMs: Date.now() - providerCallStartedAt,
          outcome: errorKind,
          error: errorMessage
        });

        if (attempt < maxAttempts) {
          await sleep(250 * attempt);
        }
      }
    }

    if (providerResult) {
      break;
    }
  }

  if (!providerResult) {
    console.error('[IMAGE_RENDER_PROVIDER_CALL_FINAL_FAILURE]', {
      provider: normalizedProvider,
      providerPlan,
      productId,
      taskId: context && context.taskId ? context.taskId : null,
      attempts: maxAttempts,
      error: lastError instanceof Error ? lastError.message : String(lastError || 'provider_execution_failed')
    });
    return fail(lastError || 'provider_execution_failed');
  }

  const contentBase64 = providerResult && typeof providerResult.contentBase64 === 'string'
    ? providerResult.contentBase64.trim()
    : '';

  if (!contentBase64) {
    return fail('provider_missing_content_base64');
  }

  try {
    const asset = await persistImage({
      productId: typeof productId === 'string' && productId.trim()
        ? productId
        : (context && context.metadata && context.metadata.productId ? context.metadata.productId : 'product'),
      contentBase64
    });

    return ok({
      provider: providerResult.provider || normalizedProvider,
      model: providerResult.model || null,
      mimeType: providerResult.mimeType || 'image/png',
      imageBase64: contentBase64,
      prompt: normalizedPrompt,
      path: asset.url,
      imageUrl: asset.url,
      createdAt: asset.createdAt,
      asset
    });
  } catch (error) {
    console.error('[IMAGE_RENDER_PERSIST_ERROR]', {
      provider: normalizedProvider,
      productId,
      taskId: context && context.taskId ? context.taskId : null,
      error: error instanceof Error ? error.message : String(error || 'persist_failed')
    });
    return fail(error || 'persist_failed');
  }
}
