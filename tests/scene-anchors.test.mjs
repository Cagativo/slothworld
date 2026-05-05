import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCENE_ANCHORS,
  SCENE_CANVAS,
  ZONE_INDICATOR_ANCHORS,
  compareByDepthY,
  getDeskAnchor,
} from '../rendering/scene-anchors.js';
import { buildEntityPositionMap } from '../rendering/zone-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function flattenAnchors(grouped) {
  const anchors = [];
  for (const [groupName, group] of Object.entries(grouped)) {
    for (const [anchorName, anchor] of Object.entries(group)) {
      anchors.push({ groupName, anchorName, anchor });
    }
  }
  return anchors;
}

test('scene anchors: all anchors are finite and within canvas', () => {
  for (const { groupName, anchorName, anchor } of flattenAnchors(SCENE_ANCHORS)) {
    const label = `${groupName}.${anchorName}`;
    assert.ok(Number.isFinite(anchor.x), `${label}.x`);
    assert.ok(Number.isFinite(anchor.y), `${label}.y`);
    assert.ok(Number.isFinite(anchor.scale), `${label}.scale`);
    assert.ok(Number.isFinite(anchor.depthY), `${label}.depthY`);
    assert.ok(anchor.x >= 0 && anchor.x <= SCENE_CANVAS.width, `${label}.x canvas bounds`);
    assert.ok(anchor.y >= 0 && anchor.y <= SCENE_CANVAS.height, `${label}.y canvas bounds`);
    assert.ok(anchor.depthY >= 0 && anchor.depthY <= SCENE_CANVAS.height, `${label}.depthY canvas bounds`);
    assert.ok(anchor.scale > 0 && anchor.scale <= 1.5, `${label}.scale usable range`);

    if (anchor.bounds) {
      assert.ok(anchor.bounds.x >= 0, `${label}.bounds.x`);
      assert.ok(anchor.bounds.y >= 0, `${label}.bounds.y`);
      assert.ok(anchor.bounds.width > 0, `${label}.bounds.width`);
      assert.ok(anchor.bounds.height > 0, `${label}.bounds.height`);
      assert.ok(anchor.bounds.x + anchor.bounds.width <= SCENE_CANVAS.width, `${label}.bounds right`);
      assert.ok(anchor.bounds.y + anchor.bounds.height <= SCENE_CANVAS.height, `${label}.bounds bottom`);
    }
  }
});

test('scene anchors: required diegetic indicator anchors remain available', () => {
  assert.deepStrictEqual(
    Object.keys(ZONE_INDICATOR_ANCHORS).sort(),
    ['ACKED', 'CLAIMED', 'CREATED', 'ENQUEUED', 'EXECUTE_FINISHED'].sort(),
  );
});

test('scene anchors: desk positions preserve assignment-derived placement metadata', () => {
  const components = [
    { componentType: 'agent-sprite', id: 'sloth-1', deskId: 'desk-0', x: 0, y: 0 },
    { componentType: 'agent-sprite', id: 'sloth-2', deskId: 'desk-4', x: 0, y: 0 },
  ];
  const positions = buildEntityPositionMap(components);

  for (const component of components) {
    const anchor = getDeskAnchor(component.deskId);
    const pos = positions.get(component.id);
    assert.deepStrictEqual(pos, {
      x: anchor.x,
      y: anchor.y,
      scale: anchor.scale,
      depthY: anchor.depthY,
      anchorId: component.deskId,
    });
  }
});

test('scene anchors: depth sorting is deterministic with stable tie-breaks', () => {
  const input = [
    { id: 'b', y: 200, depthY: 300 },
    { id: 'c', y: 400, depthY: 300 },
    { id: 'a', y: 100, depthY: 120 },
  ];

  const first = [...input].sort(compareByDepthY).map((item) => item.id);
  const second = [...input].sort(compareByDepthY).map((item) => item.id);

  assert.deepStrictEqual(first, ['a', 'b', 'c']);
  assert.deepStrictEqual(second, first);
});

test('scene anchors: renderer anchoring code does not read raw event or payload sources', () => {
  const files = [
    'rendering/scene-anchors.js',
    'rendering/zone-renderer.js',
    'rendering/agent-entity-renderer.js',
    'rendering/task-chip-renderer.js',
    'rendering/world-scene-layer-renderer.js',
  ];
  const forbidden = [
    /\beventsByTaskId\b/,
    /\beventsByWorkerId\b/,
    /\bgetRawEvents\b/,
    /\bpayload\s*\./,
    /\bevent\s*\.\s*(?:type|payload|taskId|workerId|timestamp)\b/,
    /\bindexedWorldSnapshot\b/,
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

test('scene anchors: debug mode flag remains renderer-only and available', () => {
  const source = readFileSync(resolve(ROOT, 'rendering/world-scene-layer-renderer.js'), 'utf8');
  assert.match(source, /__SLOTHWORLD_RENDER_DEBUG__/);
  assert.match(source, /renderDebug/);
  assert.match(source, /renderZoneLabels\(ctx, components, isRenderDebug\)/);
});

