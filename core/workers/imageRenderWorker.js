import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateImage as generateOpenAIProviderImage } from '../../integrations/rendering/providers/openaiImageProvider.js';

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

async function runOpenAIProvider(prompt, context) {
  return generateOpenAIProviderImage({
    prompt,
    productId: context && context.metadata ? context.metadata.productId : null
  });
}

async function runProvider(provider, prompt, context) {
  if (provider === 'openai') {
    return runOpenAIProvider(prompt, context);
  }

  throw new Error(`provider_not_supported:${provider}`);
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

export async function runImageRenderWorker({ provider = 'openai', prompt = '', productId = null, context = {} }) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!normalizedPrompt) {
    throw new Error('missing_prompt');
  }

  const normalizedProvider = String(provider || 'openai').toLowerCase();
  const providerResult = await runProvider(normalizedProvider, normalizedPrompt, context);
  const contentBase64 = providerResult && typeof providerResult.contentBase64 === 'string'
    ? providerResult.contentBase64.trim()
    : '';

  if (!contentBase64) {
    throw new Error('provider_missing_content_base64');
  }

  const asset = await persistImage({
    productId: typeof productId === 'string' && productId.trim()
      ? productId
      : (context && context.metadata && context.metadata.productId ? context.metadata.productId : 'product'),
    contentBase64
  });

  return {
    provider: providerResult.provider || normalizedProvider,
    model: providerResult.model || null,
    mimeType: providerResult.mimeType || 'image/png',
    imageBase64: contentBase64,
    prompt: normalizedPrompt,
    asset
  };
}
