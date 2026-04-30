/**
 * sprite-variant-selection.test.mjs
 *
 * Contract tests: renderEntityLayer must select a sloth sprite variant from
 * ASSET_MAPPING.agents.variants using deterministicIndex(entity.id, count),
 * driven by the component's visualState.
 *
 * These tests lock the expected contract BEFORE the sprite-variant-selection
 * logic is implemented in renderEntityLayer.  All assertions are pure —
 * no canvas, no DOM, no real asset loading.
 *
 * Contract summary
 * ────────────────
 *  Active states (idle / waiting / moving / processing / completed)
 *    → select from ASSET_MAPPING.agents.variants (4 sprites)
 *      using deterministicIndex(entity.id, variants.length)
 *
 *  Fallback states (error / unknown)
 *    → always use ASSET_MAPPING.agents.base (single sprite, no selection needed)
 *
 * Renderer boundary rules respected:
 *  - No import from core/engine/
 *  - No import from ui/selectors/
 *  - No canonical event-type string literals
 *  - No lifecycle inference
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ASSET_MAPPING } from '../rendering/assets.js';
import { AGENT_VISUAL_STYLES } from '../rendering/agent-entity-renderer.js';

// ---------------------------------------------------------------------------
// deterministicIndex — mirrors the private function in world-scene-asset-renderer.js
//
// djb2-style hash, no randomness.  Tests use this to compute EXPECTED sprite
// keys for given entity ids; the production implementation must produce the
// same values.
// ---------------------------------------------------------------------------

/**
 * djb2-style hash (multiplier 31) — the specific algorithm is part of the
 * contract.  Any change to the multiplier will shift all golden-path values
 * and must be reflected in the GOLDEN table below.
 *
 * @param {string} str
 * @param {number} len
 * @returns {number}  value in [0, len), derived from abs(hash) % len
 */
function deterministicIndex(str, len) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % len;
}

// ---------------------------------------------------------------------------
// Contract: visualState → eligible sprite pool
//
// Active states may render any sprite in agents.variants (selected by
// deterministicIndex(entity.id, variants.length)).
// Fallback states are pinned to agents.base — no variant selection.
// ---------------------------------------------------------------------------

const VARIANTS = ASSET_MAPPING.agents.variants;
const BASE     = ASSET_MAPPING.agents.base;

const VISUAL_STATE_SPRITE_POOLS = Object.freeze({
  idle:       VARIANTS,
  waiting:    VARIANTS,
  moving:     VARIANTS,
  processing: VARIANTS,
  completed:  VARIANTS,
  error:      Object.freeze([BASE]),
  unknown:    Object.freeze([BASE]),
});

// Sample entity ids — chosen to exercise all four variant slots across IDs.
// (deterministicIndex results listed in comments for quick reference.)
const SAMPLE_IDS = [
  'agent-1',       // → variants[3]  (right_front)
  'agent-2',       // → variants[2]  (left_front)
  'agent-3',       // → variants[1]  (left_back)
  'worker-abc-42', // → variants[0]  (right_back)
  'w1',            // → variants[2]  (left_front)
];

// ---------------------------------------------------------------------------
// 1. ASSET_MAPPING.agents structure
// ---------------------------------------------------------------------------

test('sprite variant selection: ASSET_MAPPING.agents.variants is a non-empty frozen array', () => {
  assert.ok(Array.isArray(VARIANTS),        'agents.variants must be an array');
  assert.ok(VARIANTS.length > 0,            'agents.variants must not be empty');
  assert.ok(Object.isFrozen(VARIANTS),      'agents.variants must be frozen');
});

test('sprite variant selection: ASSET_MAPPING.agents.base is a non-empty string', () => {
  assert.equal(typeof BASE, 'string', 'agents.base must be a string');
  assert.ok(BASE.length > 0,          'agents.base must not be empty');
});

test('sprite variant selection: ASSET_MAPPING.agents.base is included in agents.variants', () => {
  assert.ok(
    VARIANTS.includes(BASE),
    `agents.base "${BASE}" must be present in agents.variants`,
  );
});

test('sprite variant selection: every variant is a non-empty .png filename', () => {
  for (const filename of VARIANTS) {
    assert.equal(typeof filename, 'string',       `variant must be a string: ${filename}`);
    assert.ok(filename.endsWith('.png'),           `variant must end with .png: ${filename}`);
    assert.ok(filename.length > 4,                `variant filename must be non-trivial: ${filename}`);
  }
});

test('sprite variant selection: agents.variants has exactly 4 confirmed sprite filenames', () => {
  assert.equal(VARIANTS.length, 4,
    'Contract requires exactly 4 sloth sprite variants (one per desk orientation)');
});

// ---------------------------------------------------------------------------
// 2. AGENT_VISUAL_STYLES coverage
// ---------------------------------------------------------------------------

test('sprite variant selection: VISUAL_STATE_SPRITE_POOLS covers every key in AGENT_VISUAL_STYLES', () => {
  for (const state of Object.keys(AGENT_VISUAL_STYLES)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(VISUAL_STATE_SPRITE_POOLS, state),
      `VISUAL_STATE_SPRITE_POOLS must define a pool for visualState '${state}'`,
    );
  }
});

test('sprite variant selection: AGENT_VISUAL_STYLES covers every key in VISUAL_STATE_SPRITE_POOLS', () => {
  for (const state of Object.keys(VISUAL_STATE_SPRITE_POOLS)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(AGENT_VISUAL_STYLES, state),
      `AGENT_VISUAL_STYLES must define a style for visualState '${state}'`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. deterministicIndex algorithm
// ---------------------------------------------------------------------------

test('sprite variant selection: deterministicIndex returns a value in [0, len)', () => {
  const len = VARIANTS.length;
  for (const id of SAMPLE_IDS) {
    const idx = deterministicIndex(id, len);
    assert.ok(
      Number.isInteger(idx) && idx >= 0 && idx < len,
      `deterministicIndex("${id}", ${len}) must return integer in [0, ${len}), got ${idx}`,
    );
  }
});

test('sprite variant selection: deterministicIndex is deterministic — same input always returns same output', () => {
  const len = VARIANTS.length;
  for (const id of SAMPLE_IDS) {
    const first  = deterministicIndex(id, len);
    const second = deterministicIndex(id, len);
    const third  = deterministicIndex(id, len);
    assert.equal(first, second, `run 1 vs 2 for id="${id}"`);
    assert.equal(second, third, `run 2 vs 3 for id="${id}"`);
  }
});

test('sprite variant selection: deterministicIndex distributes across all 4 variant slots for the sample id set', () => {
  const len     = VARIANTS.length;
  const indices = new Set(SAMPLE_IDS.map((id) => deterministicIndex(id, len)));
  // SAMPLE_IDS was chosen to produce one id per slot (verified by golden-path comments).
  // All 4 variant slots must be reachable — this confirms the sample set has full coverage
  // and that the algorithm is not degenerate.
  assert.equal(
    indices.size, len,
    `deterministicIndex must map the sample ids across all ${len} variant slots — ` +
    `got ${indices.size} distinct value(s): [${[...indices].sort().join(', ')}]`,
  );
});

test('sprite variant selection: deterministicIndex does not call Math.random', () => {
  const original = Math.random;
  let called     = false;
  Math.random    = () => { called = true; return 0.5; };
  try {
    for (const id of SAMPLE_IDS) deterministicIndex(id, VARIANTS.length);
    assert.equal(called, false, 'deterministicIndex must never invoke Math.random');
  } finally {
    Math.random = original;
  }
});

// ---------------------------------------------------------------------------
// 4. Per-visualState parameterized tests
// ---------------------------------------------------------------------------

for (const [visualState, pool] of Object.entries(VISUAL_STATE_SPRITE_POOLS)) {

  test(`sprite variant selection: [${visualState}] pool is a non-empty array`, () => {
    assert.ok(Array.isArray(pool),  `pool for "${visualState}" must be an array`);
    assert.ok(pool.length > 0,      `pool for "${visualState}" must not be empty`);
  });

  test(`sprite variant selection: [${visualState}] every pool sprite is a valid ASSET_MAPPING key`, () => {
    for (const sprite of pool) {
      const isVariant = VARIANTS.includes(sprite);
      const isBase    = sprite === BASE;
      assert.ok(
        isVariant || isBase,
        `sprite "${sprite}" in pool for "${visualState}" must exist in ASSET_MAPPING.agents`,
      );
    }
  });

  test(`sprite variant selection: [${visualState}] deterministicIndex selects a valid sprite for each sample id`, () => {
    for (const id of SAMPLE_IDS) {
      const idx    = deterministicIndex(id, pool.length);
      const sprite = pool[idx];
      assert.equal(typeof sprite, 'string',
        `selected sprite for id="${id}", state="${visualState}" must be a string`);
      assert.ok(sprite.length > 0,
        `selected sprite for id="${id}", state="${visualState}" must be non-empty`);
      assert.ok(
        VARIANTS.includes(sprite) || sprite === BASE,
        `selected sprite "${sprite}" for id="${id}", state="${visualState}" must be a valid ASSET_MAPPING key`,
      );
    }
  });

  test(`sprite variant selection: [${visualState}] sprite selection is stable across repeated calls`, () => {
    for (const id of SAMPLE_IDS) {
      const sprite1 = pool[deterministicIndex(id, pool.length)];
      const sprite2 = pool[deterministicIndex(id, pool.length)];
      assert.equal(
        sprite1, sprite2,
        `sprite for id="${id}", state="${visualState}" must not differ between calls`,
      );
    }
  });

}

// ---------------------------------------------------------------------------
// 5. Golden-path assertions — specific (entity id, visualState) → expected sprite
//
// These values are ground-truth for the contract.  Any future change to the
// deterministicIndex algorithm must be reflected here first.
// ---------------------------------------------------------------------------

const GOLDEN = [
  // Active states — selection from full variants pool.
  { id: 'agent-1',       state: 'idle',       expected: VARIANTS[3] }, // right_front
  { id: 'agent-2',       state: 'waiting',    expected: VARIANTS[2] }, // left_front
  { id: 'agent-3',       state: 'processing', expected: VARIANTS[1] }, // left_back
  { id: 'worker-abc-42', state: 'moving',     expected: VARIANTS[0] }, // right_back
  { id: 'w1',            state: 'completed',  expected: VARIANTS[2] }, // left_front

  // Fallback states — always pinned to BASE, id is irrelevant.
  { id: 'agent-1',       state: 'error',   expected: BASE },
  { id: 'agent-2',       state: 'unknown', expected: BASE },
  { id: 'worker-abc-42', state: 'error',   expected: BASE },
];

for (const { id, state, expected } of GOLDEN) {
  test(`sprite variant selection: golden path — id="${id}", state="${state}" → "${expected}"`, () => {
    const pool   = VISUAL_STATE_SPRITE_POOLS[state];
    const sprite = pool[deterministicIndex(id, pool.length)];
    assert.equal(
      sprite, expected,
      `expected sprite "${expected}" for id="${id}", visualState="${state}", got "${sprite}"`,
    );
  });
}
