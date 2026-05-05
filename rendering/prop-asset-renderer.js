/**
 * prop-asset-renderer.js
 *
 * Thin PNG runtime prop renderer. Returns false when an asset is missing so
 * callers can keep their procedural canvas fallback.
 */

import { loadedAssets } from './assets.js';
import { SCENE_ANCHORS } from './scene-anchors.js';
import { PROP_ASSET_MANIFEST } from './prop-asset-manifest.js';

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function resolvePropAnchor(anchorRef, anchors = SCENE_ANCHORS) {
  if (!anchorRef || !anchorRef.group || !anchorRef.key) return null;
  return anchors[anchorRef.group]?.[anchorRef.key] ?? null;
}

export function getPropAssetEntry(assetKey, variantIndex = 0, manifest = PROP_ASSET_MANIFEST) {
  const entry = manifest[assetKey];
  if (Array.isArray(entry)) {
    if (entry.length === 0) return null;
    const idx = Math.abs(Math.trunc(finite(variantIndex, 0))) % entry.length;
    return entry[idx];
  }
  return entry ?? null;
}

export function drawRuntimePropAsset(ctx, assetKey, options = {}) {
  if (!ctx) return false;

  const entry = getPropAssetEntry(assetKey, options.variantIndex);
  if (!entry) return false;

  const image = loadedAssets[entry.filename];
  if (!image) return false;

  const anchor = options.anchor || resolvePropAnchor(entry.anchor);
  const scale = finite(options.scale, finite(anchor?.scale, 1));
  const x = finite(options.x, finite(anchor?.x, 0));
  const y = finite(options.y, finite(anchor?.y, 0));
  const width = finite(options.width, entry.width) * scale;
  const height = finite(options.height, entry.height) * scale;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }

  ctx.save();
  ctx.globalAlpha = finite(options.alpha, entry.alpha);
  ctx.globalCompositeOperation = options.blend || entry.blend || 'source-over';
  ctx.drawImage(image, x - width / 2, y - height / 2, width, height);
  ctx.restore();

  return true;
}

