import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_TYPE_IMAGE_RENDER } from '../constants.js';
import { assertSideEffectExecutionContext } from '../engine/enforcementRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const ASSETS_GENERATED_DIR = path.join(ROOT_DIR, 'assets', 'generated');
const GENERATED_ASSETS_DIR = path.join(ROOT_DIR, 'generated-assets');

function sanitizePathSegment(value, fallback = 'item') {
  const sanitized = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return sanitized || fallback;
}

function resolveExtension(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) {
    return 'jpg';
  }

  if (normalized.includes('webp')) {
    return 'webp';
  }

  return 'png';
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveAssetRoot(baseDir) {
  if (baseDir) {
    return {
      dir: baseDir,
      publicPrefix: null
    };
  }

  if (await pathExists(ASSETS_GENERATED_DIR)) {
    return {
      dir: ASSETS_GENERATED_DIR,
      publicPrefix: '/assets/generated'
    };
  }

  return {
    dir: GENERATED_ASSETS_DIR,
    publicPrefix: '/generated-assets'
  };
}

function getImageRenderOutput(task) {
  const output = task && task.lastResult && task.lastResult.output && typeof task.lastResult.output === 'object'
    ? task.lastResult.output
    : null;

  if (output && output.result && typeof output.result === 'object') {
    return output.result;
  }

  return output;
}

function buildSafeAssetProjection(asset) {
  if (!asset || typeof asset !== 'object') {
    return null;
  }

  return {
    id: asset.id || asset.assetId || null,
    url: asset.url || asset.path || null,
    mimeType: asset.mimeType || 'image/png',
    provider: asset.provider || null
  };
}

export function projectSafeImageRenderOutput(output) {
  if (!output || typeof output !== 'object') {
    return output;
  }

  const projected = { ...output };
  delete projected.contentBase64;
  delete projected.imageBase64;

  if (projected.asset) {
    projected.asset = buildSafeAssetProjection(projected.asset);
    projected.assetId = projected.asset ? projected.asset.id : null;
    projected.imageUrl = projected.asset ? projected.asset.url : null;
    projected.path = projected.asset ? projected.asset.url : null;
  }

  return projected;
}

export function projectTaskForSafeAssetRead(task) {
  if (!task || typeof task !== 'object') {
    return task;
  }

  const projected = { ...task };
  if (projected.executionResult && typeof projected.executionResult === 'object') {
    const executionResult = { ...projected.executionResult };
    if (executionResult.result && typeof executionResult.result === 'object') {
      executionResult.result = projectSafeImageRenderOutput(executionResult.result);
    }
    projected.executionResult = executionResult;
  }

  return projected;
}

export async function persistImageRenderAssetAfterAck(task, options = {}) {
  assertSideEffectExecutionContext();

  if (!task || task.type !== TASK_TYPE_IMAGE_RENDER || task.status !== 'acknowledged') {
    return null;
  }

  const output = getImageRenderOutput(task);
  const contentBase64 = output && typeof output.contentBase64 === 'string'
    ? output.contentBase64.trim()
    : '';

  if (!contentBase64) {
    return null;
  }

  const mimeType = typeof output.mimeType === 'string' && output.mimeType.trim()
    ? output.mimeType.trim()
    : 'image/png';
  const extension = resolveExtension(mimeType);
  const provider = typeof output.provider === 'string' && output.provider.trim()
    ? output.provider.trim()
    : 'unknown';
  const createdAt = Date.now();
  const taskId = sanitizePathSegment(task.id, 'task');
  const assetId = sanitizePathSegment(output.assetId || `asset-${taskId}`, `asset-${createdAt}`);
  const root = await resolveAssetRoot(options.baseDir || process.env.IMAGE_ASSET_DIR || null);
  const targetDir = path.join(root.dir, taskId);

  await mkdir(targetDir, { recursive: true });

  const filename = `${assetId}.${extension}`;
  const metadataFilename = `${assetId}.json`;
  const assetPath = path.join(targetDir, filename);
  const metadataPath = path.join(targetDir, metadataFilename);
  const url = root.publicPrefix ? `${root.publicPrefix}/${taskId}/${filename}` : null;
  const metadataUrl = root.publicPrefix ? `${root.publicPrefix}/${taskId}/${metadataFilename}` : null;
  const providerMetadata = output.metadata && typeof output.metadata === 'object'
    ? output.metadata
    : {};

  await writeFile(assetPath, Buffer.from(contentBase64, 'base64'));
  await writeFile(metadataPath, JSON.stringify({
    taskId: task.id,
    provider,
    mimeType,
    createdAt,
    prompt: typeof output.prompt === 'string' ? output.prompt : null,
    metadata: providerMetadata
  }, null, 2), 'utf8');

  const asset = {
    id: assetId,
    assetId,
    taskId: task.id,
    path: assetPath,
    url,
    mimeType,
    provider,
    createdAt,
    metadataPath,
    metadataUrl
  };

  output.asset = asset;
  output.assetId = asset.id;
  output.imageUrl = asset.url || asset.path;
  output.path = asset.url || asset.path;
  output.manifestUrl = metadataUrl || metadataPath;

  return asset;
}

export async function persistRenderAssetContract({
  assetId,
  productId,
  provider,
  prompt,
  contentBase64,
  mimeType = 'image/png',
  metadata
}) {
  assertSideEffectExecutionContext();

  const safeProductId = sanitizePathSegment(productId, 'product');
  const safeAssetId = sanitizePathSegment(assetId, `asset-${Date.now()}`);
  const extension = resolveExtension(mimeType);

  const targetDir = path.join(ASSETS_GENERATED_DIR, safeProductId);
  await mkdir(targetDir, { recursive: true });

  const assetFilename = `${safeAssetId}.${extension}`;
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
    mimeType,
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
