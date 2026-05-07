/**
 * background-config.js
 *
 * Deterministic scene plate preference for the Slothworld canvas.
 *
 * scene_background_02 is the dressed room plate: static desks, shelves,
 * decorative sloths, monitors, props, plants, and room clutter may be baked
 * into it. Runtime renderers should add only live state, interactions, debug
 * diagnostics, and subtle state glows.
 */

export const BACKGROUND_ASSET_PREFERENCE = Object.freeze([
  'scene_background_02.png',
  'scene_background_02.jpg',
  'scene_background_01.jpg',
]);

export const BACKGROUND_BOOT_POLICY = Object.freeze({
  BAKED_READY: 'baked-ready',
  BAKED_PENDING: 'baked-pending',
  FALLBACK_ALLOWED: 'fallback-allowed',
});

export function selectLoadedBackground(loadedAssets) {
  if (!loadedAssets || typeof loadedAssets !== 'object') return null;
  for (const filename of BACKGROUND_ASSET_PREFERENCE) {
    const image = loadedAssets[filename];
    if (image) {
      return Object.freeze({ filename, image, isPreferredBakedPlate: filename.startsWith('scene_background_02.') });
    }
  }
  return null;
}

export function isBakedBackgroundActive(backgroundOrAssets) {
  if (!backgroundOrAssets || typeof backgroundOrAssets !== 'object') return false;
  const selected = typeof backgroundOrAssets.filename === 'string'
    ? backgroundOrAssets
    : selectLoadedBackground(backgroundOrAssets);
  return selected ? selected.isPreferredBakedPlate === true : false;
}

export function isProceduralFallbackAllowed(options = {}) {
  if (options && (options.debug === true || options.calibration === true || options.allowProceduralFallback === true)) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  if (window.__SLOTHWORLD_ALLOW_PROCEDURAL_FALLBACK__ === true) {
    return true;
  }

  try {
    return window.localStorage?.getItem('slothworld.allowProceduralFallback') === '1';
  } catch (_error) {
    return false;
  }
}

export function getBackgroundBootPolicy(loadedAssets, options = {}) {
  const selected = selectLoadedBackground(loadedAssets);
  if (selected && selected.image) {
    return BACKGROUND_BOOT_POLICY.BAKED_READY;
  }
  if (isProceduralFallbackAllowed(options)) {
    return BACKGROUND_BOOT_POLICY.FALLBACK_ALLOWED;
  }
  return BACKGROUND_BOOT_POLICY.BAKED_PENDING;
}
