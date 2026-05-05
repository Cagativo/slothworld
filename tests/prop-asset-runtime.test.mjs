import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetPaths, loadedAssets } from '../rendering/assets.js';
import { PROP_ASSET_MANIFEST, listPropAssetEntries } from '../rendering/prop-asset-manifest.js';
import { SCENE_ANCHORS } from '../rendering/scene-anchors.js';
import {
  drawRuntimePropAsset,
  getPropAssetEntry,
  resolvePropAnchor,
} from '../rendering/prop-asset-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function makeMockCtx() {
  const calls = [];
  return {
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    drawImage: (...args) => calls.push(['drawImage', ...args]),
    set globalAlpha(value) { calls.push(['setGlobalAlpha', value]); },
    set globalCompositeOperation(value) { calls.push(['setGlobalCompositeOperation', value]); },
  };
}

test('runtime prop assets: manifest is frozen and deterministic', () => {
  assert.ok(Object.isFrozen(PROP_ASSET_MANIFEST));
  assert.ok(Object.isFrozen(PROP_ASSET_MANIFEST.smallPlants));

  const first = JSON.stringify(PROP_ASSET_MANIFEST);
  const second = JSON.stringify(PROP_ASSET_MANIFEST);
  assert.equal(first, second);
});

test('runtime prop assets: every manifest entry has a valid preload path', () => {
  const preloadPaths = new Set(assetPaths);

  for (const entry of listPropAssetEntries()) {
    assert.ok(entry.filename.endsWith('.png'), `${entry.filename} must be a PNG prop`);
    assert.ok(entry.path.startsWith('assets/slothworldassets/'), `${entry.filename} asset root`);
    assert.ok(preloadPaths.has(entry.path), `${entry.path} must be preloaded`);
    assert.ok(Number.isFinite(entry.width) && entry.width > 0, `${entry.filename}.width`);
    assert.ok(Number.isFinite(entry.height) && entry.height > 0, `${entry.filename}.height`);
    assert.ok(Number.isFinite(entry.alpha) && entry.alpha >= 0 && entry.alpha <= 1, `${entry.filename}.alpha`);
  }
});

test('runtime prop assets: anchored manifest entries resolve to scene anchors', () => {
  for (const entry of listPropAssetEntries()) {
    if (!entry.anchor) continue;
    const anchor = resolvePropAnchor(entry.anchor);
    assert.equal(anchor, SCENE_ANCHORS[entry.anchor.group][entry.anchor.key]);
    assert.ok(Number.isFinite(anchor.x), `${entry.filename}.anchor.x`);
    assert.ok(Number.isFinite(anchor.y), `${entry.filename}.anchor.y`);
  }
});

test('runtime prop assets: missing image assets return false and do not throw', () => {
  const ctx = makeMockCtx();
  const previous = loadedAssets['task_stack_01.png'];
  delete loadedAssets['task_stack_01.png'];

  assert.doesNotThrow(() => {
    assert.equal(drawRuntimePropAsset(ctx, 'intakePaperStack'), false);
  });
  assert.ok(!ctx.calls.some((call) => call[0] === 'drawImage'));

  if (previous) loadedAssets['task_stack_01.png'] = previous;
});

test('runtime prop assets: loaded images draw through manifest geometry', () => {
  const ctx = makeMockCtx();
  const previous = loadedAssets['task_stack_01.png'];
  const image = { width: 32, height: 32 };
  loadedAssets['task_stack_01.png'] = image;

  assert.equal(drawRuntimePropAsset(ctx, 'intakePaperStack'), true);
  assert.ok(ctx.calls.some((call) => call[0] === 'drawImage' && call[1] === image));

  if (previous) {
    loadedAssets['task_stack_01.png'] = previous;
  } else {
    delete loadedAssets['task_stack_01.png'];
  }
});

test('runtime prop assets: array variants are selected deterministically', () => {
  assert.equal(getPropAssetEntry('smallPlants', 0).filename, 'decor_plant_small_01.png');
  assert.equal(getPropAssetEntry('smallPlants', 1).filename, 'decor_plant_small_02.png');
  assert.equal(getPropAssetEntry('smallPlants', 4).filename, 'decor_plant_small_02.png');
});

test('runtime prop assets: renderer modules do not read raw event or payload sources', () => {
  const files = [
    'rendering/prop-asset-manifest.js',
    'rendering/prop-asset-renderer.js',
    'rendering/diegetic-indicator-renderer.js',
    'rendering/world-scene-asset-renderer.js',
  ];
  const forbidden = [
    /\beventsByTaskId\b/,
    /\beventsByWorkerId\b/,
    /\bgetRawEvents\b/,
    /\bpayload\s*\./,
    /\bevent\s*\.\s*(?:type|payload|taskId|workerId|timestamp)\b/,
    /\bindexedWorldSnapshot\b/,
    /\bworldIndex\b/,
    /\buiendgoal\b/,
  ];

  for (const file of files) {
    const source = readFileSync(resolve(ROOT, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(?:\/\*|\*|\/\/)/.test(line))
      .join('\n');
    for (const re of forbidden) {
      assert.ok(!re.test(source), `${file} must not match ${re}`);
    }
  }
});

