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
