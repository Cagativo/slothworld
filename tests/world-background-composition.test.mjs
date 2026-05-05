/**
 * world-background-composition.test.mjs
 *
 * Contracts for the static treehouse command-center composition layer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORLD_ZONES } from '../ui/config/worldZones.js';
import {
  WORLD_COMPOSITION_ZONES,
  renderTreehouseBackdrop,
  renderWorldCompositionLayer,
} from '../rendering/world-background-composition.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_PATH = join(ROOT, 'rendering/world-background-composition.js');
const SRC = readFileSync(SRC_PATH, 'utf8');

function isComment(line) {
  return /^\s*(?:\/\*|\*|\/\/)/.test(line);
}

function sourceHits(re) {
  return SRC.split('\n')
    .map((line, idx) => ({ line, lineNumber: idx + 1 }))
    .filter(({ line }) => re.test(line) && !isComment(line));
}

function makeGradient(log, kind) {
  return {
    addColorStop(offset, color) {
      log.push({ kind: 'call', method: `${kind}.addColorStop`, args: [offset, color] });
    },
  };
}

function makeMockCtx() {
  const log = [];
  const store = {
    canvas: { width: 1060, height: 520 },
    createLinearGradient(...args) {
      log.push({ kind: 'call', method: 'createLinearGradient', args });
      return makeGradient(log, 'linearGradient');
    },
    createRadialGradient(...args) {
      log.push({ kind: 'call', method: 'createRadialGradient', args });
      return makeGradient(log, 'radialGradient');
    },
    measureText(text) {
      log.push({ kind: 'call', method: 'measureText', args: [text] });
      return { width: String(text).length * 6 };
    },
  };

  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        log.push({ kind: 'call', method: String(prop), args });
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      log.push({ kind: 'set', prop: String(prop), value });
      return true;
    },
  });

  return { ctx, log };
}

function stableLog(log) {
  return log.map((entry) => ({
    ...entry,
    value: entry.value && typeof entry.value.addColorStop === 'function' ? '[gradient]' : entry.value,
  }));
}

test('world background composition: does not read raw event fields or indexes', () => {
  const forbidden = [
    /\.\s*eventsByTaskId\b/,
    /\.\s*eventsByWorkerId\b/,
    /(?<!\w)\.events\s*[\[.]/,
    /\bpayload\s*\./,
    /\bevent\s*\.\s*(?:type|payload|taskId|workerId|timestamp)\b/,
  ];

  for (const re of forbidden) {
    assert.deepStrictEqual(sourceHits(re), []);
  }
});

test('world background composition: imports no engine, worker, provider, selector, or lifecycle modules', () => {
  const importLines = SRC.split('\n').filter((line) => /^\s*import\b/.test(line));
  const forbiddenImport = /(?:core[/\\]engine|core[/\\]workers|providers[/\\]|ui[/\\]selectors|core[/\\]world)/;
  assert.deepStrictEqual(
    importLines.filter((line) => forbiddenImport.test(line)),
    [],
  );
});

test('world background renderer runs against a mock canvas context', () => {
  const { ctx, log } = makeMockCtx();
  assert.doesNotThrow(() => renderTreehouseBackdrop(ctx, 12));
  assert.doesNotThrow(() => renderWorldCompositionLayer(ctx, { debug: false, frame: 12 }));
  assert.ok(log.some((entry) => entry.method === 'fillRect'), 'expected fillRect calls');
  assert.ok(!log.some((entry) => entry.method === 'fillText'), 'normal mode must not render semantic labels');
});

test('world background composition is deterministic for identical inputs', () => {
  const a = makeMockCtx();
  const b = makeMockCtx();

  renderTreehouseBackdrop(a.ctx, 24);
  renderWorldCompositionLayer(a.ctx, { debug: true, frame: 24 });
  renderTreehouseBackdrop(b.ctx, 24);
  renderWorldCompositionLayer(b.ctx, { debug: true, frame: 24 });

  assert.deepStrictEqual(stableLog(a.log), stableLog(b.log));
});

test('world composition includes every semantic zone exactly once', () => {
  assert.deepStrictEqual(
    WORLD_COMPOSITION_ZONES.map((zone) => zone.id).sort(),
    Object.keys(WORLD_ZONES).sort(),
  );
});

test('semantic zone coordinates remain valid after composition', () => {
  for (const zone of WORLD_COMPOSITION_ZONES) {
    assert.ok(Number.isFinite(zone.position.x), `${zone.id}.position.x`);
    assert.ok(Number.isFinite(zone.position.y), `${zone.id}.position.y`);
    assert.ok(zone.size.width > 0, `${zone.id}.size.width`);
    assert.ok(zone.size.height > 0, `${zone.id}.size.height`);

    const left = zone.position.x - zone.size.width / 2;
    const top = zone.position.y - zone.size.height / 2;
    const right = zone.position.x + zone.size.width / 2;
    const bottom = zone.position.y + zone.size.height / 2;

    assert.ok(left >= 0, `${zone.id} left bound`);
    assert.ok(top >= 0, `${zone.id} top bound`);
    assert.ok(right <= 1060, `${zone.id} right bound`);
    assert.ok(bottom <= 520, `${zone.id} bottom bound`);
  }
});

test('debug overlay draws zone bounds and semantic ids', () => {
  const { ctx, log } = makeMockCtx();
  renderWorldCompositionLayer(ctx, { debug: true, frame: 0 });

  const labels = log
    .filter((entry) => entry.method === 'fillText')
    .map((entry) => entry.args[0]);

  for (const zone of WORLD_COMPOSITION_ZONES) {
    assert.ok(labels.includes(zone.id), `missing debug label ${zone.id}`);
  }
  assert.ok(log.some((entry) => entry.method === 'strokeRect'), 'expected debug bounds');
});

test('normal world composition suppresses semantic zone labels', () => {
  const { ctx, log } = makeMockCtx();
  renderWorldCompositionLayer(ctx, { debug: false, frame: 0 });

  const labels = log
    .filter((entry) => entry.method === 'fillText')
    .map((entry) => entry.args[0]);

  for (const zone of WORLD_COMPOSITION_ZONES) {
    assert.ok(!labels.includes(zone.label), `normal mode must hide semantic label ${zone.label}`);
    assert.ok(!labels.includes(zone.id), `normal mode must hide semantic id ${zone.id}`);
  }
});
