import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProviderRegistry } from '../../integrations/rendering/providers/providerRegistry.js';
import { assertProviderExecutionContext, assertWorkerExecutionContext } from '../engine/enforcementRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const GENERATED_ASSETS_DIR = path.join(ROOT_DIR, 'assets', 'generated');

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
  const maxAttemptsRaw = context && typeof context.retryCount === 'number' ? context.retryCount : 0;
  const maxAttempts = Math.max(1, Math.min(3, Math.floor(maxAttemptsRaw) + 1));
  let providerResult = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      providerResult = await runProvider(normalizedProvider, normalizedPrompt, context);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(250 * attempt);
      }
    }
  }

  if (!providerResult) {
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
    return fail(error || 'persist_failed');
  }
}
