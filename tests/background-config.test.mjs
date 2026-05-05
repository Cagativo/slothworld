import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetPaths } from '../rendering/assets.js';
import {
  BACKGROUND_ASSET_PREFERENCE,
  isBakedBackgroundActive,
  selectLoadedBackground,
} from '../rendering/background-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

test('background config: preference order is deterministic', () => {
  assert.deepStrictEqual(BACKGROUND_ASSET_PREFERENCE, [
    'scene_background_02.png',
    'scene_background_02.jpg',
    'scene_background_01.jpg',
  ]);
  assert.ok(Object.isFrozen(BACKGROUND_ASSET_PREFERENCE));
});

test('background config: scene_background_02.png is copied into runtime assets', () => {
  assert.ok(existsSync(resolve(ROOT, 'assets/slothworldassets/scene_background_02.png')));
  assert.ok(assetPaths.includes('assets/slothworldassets/scene_background_02.png'));
  assert.ok(assetPaths.includes('assets/slothworldassets/scene_background_02.jpg'));
});

test('background config: scene_background_02.png wins when loaded', () => {
  const image02 = { id: '02' };
  const image01 = { id: '01' };
  const selected = selectLoadedBackground({
    'scene_background_01.jpg': image01,
    'scene_background_02.png': image02,
  });

  assert.equal(selected.filename, 'scene_background_02.png');
  assert.equal(selected.image, image02);
  assert.equal(selected.isPreferredBakedPlate, true);
});

test('background config: missing preferred background falls back to scene_background_01.jpg', () => {
  const image01 = { id: '01' };
  const selected = selectLoadedBackground({
    'scene_background_01.jpg': image01,
  });

  assert.equal(selected.filename, 'scene_background_01.jpg');
  assert.equal(selected.image, image01);
  assert.equal(selected.isPreferredBakedPlate, false);
});

test('background config: baked background helper only matches scene_background_02', () => {
  assert.equal(isBakedBackgroundActive({ 'scene_background_02.jpg': { id: '02' } }), true);
  assert.equal(isBakedBackgroundActive({ 'scene_background_01.jpg': { id: '01' } }), false);
  assert.equal(isBakedBackgroundActive({ filename: 'scene_background_02.png', isPreferredBakedPlate: true }), true);
  assert.equal(isBakedBackgroundActive(null), false);
});

test('background config: runtime modules do not reference docs uiendgoal path', () => {
  const files = [
    'rendering/assets.js',
    'rendering/background-config.js',
    'rendering/world-scene-asset-renderer.js',
  ];
  for (const file of files) {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    assert.ok(!/docs[/\\]ui-references[/\\]uiendgoal\.png/.test(source), `${file} must not load uiendgoal directly`);
  }
});
