import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSideEffectExecutionContext } from '../engine/enforcementRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GENERATED_ASSETS_DIR = path.resolve(__dirname, '../../assets/generated');

function sanitizePathSegment(value, fallback = 'item') {
  const sanitized = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return sanitized || fallback;
}

export async function persistRenderAssetContract({
  assetId,
  productId,
  provider,
  prompt,
  contentBase64,
  metadata
}) {
  assertSideEffectExecutionContext();

  const safeProductId = sanitizePathSegment(productId, 'product');
  const safeAssetId = sanitizePathSegment(assetId, `asset-${Date.now()}`);

  const targetDir = path.join(GENERATED_ASSETS_DIR, safeProductId);
  await mkdir(targetDir, { recursive: true });

  const assetFilename = `${safeAssetId}.png`;
  const manifestFilename = `${safeAssetId}.json`;
  const assetPath = path.join(targetDir, assetFilename);
  const manifestPath = path.join(targetDir, manifestFilename);
  const publicAssetUrl = `/assets/generated/${safeProductId}/${assetFilename}`;
  const publicManifestUrl = `/assets/generated/${safeProductId}/${manifestFilename}`;
  const createdAt = Date.now();

  await writeFile(assetPath, Buffer.from(contentBase64, 'base64'));
  await writeFile(manifestPath, JSON.stringify({
    assetId: safeAssetId,
    productId: safeProductId,
    url: publicAssetUrl,
    sourceUrl: null,
    provider,
    prompt,
    createdAt,
    mimeType: 'image/png',
    hasContentBase64: true,
    metadata: metadata && typeof metadata === 'object' ? metadata : {}
  }, null, 2), 'utf8');

  return {
    assetId: safeAssetId,
    productId: safeProductId,
    url: publicAssetUrl,
    provider,
    prompt,
    createdAt,
    manifestUrl: publicManifestUrl
  };
}
