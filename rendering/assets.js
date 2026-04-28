export class AssetLoader {
  constructor() {
    this.assets = {};
  }

  loadImage(path) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load: ${path}`));
      img.src = path;
    });
  }

  async loadAll(paths) {
    for (const path of paths) {
      const filename = path.split('/').pop();
      try {
        const image = await this.loadImage(path);
        this.assets[filename] = image;
      } catch {
        console.warn(`Asset not found, skipping: ${path}`);
      }
    }

    return this.assets;
  }
}

export const assetPaths = [
  // ── Agent sprites ──────────────────────────────────────────────────────────
  // base: cropped individual sprite (435×381 RGBA). Used by entity layer at desk positions.
  'assets/slothworldassets/sloth_worker_desk_facing_right_back_01.png',
  // sceneLayers: full-scene RGB layer sprites (1376×768, no alpha). Preloaded; not active
  // in rendering while sceneBackground image mode is in use — blend-mode compositing
  // over a photographic background is not viable without alpha. Enable in SCENE_COMPOSITE
  // once a compositing strategy for image mode is decided.
  'assets/slothworldassets/sloth_worker_desk_facing_left_back_01.png',
  'assets/slothworldassets/sloth_worker_desk_facing_left_front_01.png',
  'assets/slothworldassets/sloth_worker_desk_facing_left_front_02.png',
  // largeFront: tall individual sprite (875×1216 RGB, no alpha). Preloaded; not yet wired
  // into rendering — intended use (blend mode / crop / position) to be determined.
  'assets/slothworldassets/sloth_worker_desk_facing_right_front_01.png',

  // ── Unified scene background ───────────────────────────────────────────────
  // Place the reference image at this path to activate the image-backed mode.
  // When absent the renderer falls back to the procedural room (drawRoomScene).
  'assets/slothworldassets/scene_background_01.jpg',

  // ── Environment — core tree ────────────────────────────────────────────────
  'assets/slothworldassets/core_tree_01.png',
  'assets/slothworldassets/core_tree_03.png',

  // ── Environment — architectural layers (full-scene, 1376×768) ─────────────
  'assets/slothworldassets/env_bookshelf_tall_01.png',
  'assets/slothworldassets/env_tree_arch_door_01.png',

  // ── Zone desk / shelf sprites ──────────────────────────────────────────────
  'assets/slothworldassets/desk_terminal_organic_01.png',
  'assets/slothworldassets/desk_wood_02.png',
  'assets/slothworldassets/storage_shelf_moss_01.png',

  // ── Decor ──────────────────────────────────────────────────────────────────
  'assets/slothworldassets/decor_plant_01.png',
  'assets/slothworldassets/decor_plant_small_01.png',
  'assets/slothworldassets/decor_plant_small_02.png',
  'assets/slothworldassets/decor_plant_small_03.png',
  'assets/slothworldassets/decor_vine_01.png',
  'assets/slothworldassets/decor_leaf_tray_01.png',
  'assets/slothworldassets/decor_leaf_tray_02.png',
  'assets/slothworldassets/decor_leaf_tray_03.png',
  'assets/slothworldassets/decor_books_stack_01.png',

  // ── Task props ─────────────────────────────────────────────────────────────
  'assets/slothworldassets/task_bundle_01.png',
  'assets/slothworldassets/task_files_01.png',
  'assets/slothworldassets/task_files_02.png',
  'assets/slothworldassets/task_scroll_01.png',
  'assets/slothworldassets/task_scroll_02.png',
  'assets/slothworldassets/task_scroll_03.png',
  'assets/slothworldassets/task_stack_01.png',

  // ── Lighting / effects ─────────────────────────────────────────────────────
  'assets/slothworldassets/light_glow_orb_01.png',
  'assets/slothworldassets/light_glow_orb_02.png',
  'assets/slothworldassets/light_glow_orb_03.png',
  'assets/slothworldassets/light_lantern_02.png',
  'assets/slothworldassets/light_tree_glow_01.png',

  // ── Flow / stream ──────────────────────────────────────────────────────────
  'assets/slothworldassets/flow_stream_01.png',
  'assets/slothworldassets/flow_stream_cascade_01.png',

  // ── UI overlays ────────────────────────────────────────────────────────────
  'assets/slothworldassets/ui_floating_display_01.png',
  'assets/slothworldassets/ui_panel_small_01.png',

  // ── Unclassified ───────────────────────────────────────────────────────────
  'assets/slothworldassets/other_unknown_07.png',
  'assets/slothworldassets/other_unknown_08.png',
];

/**
 * Fixed asset mapping for the WorldScene renderer.
 *
 * Keys are filename strings only — no semantic meaning is inferred from them.
 * All arrays are frozen; selection from arrays must be deterministic (no Math.random).
 *
 * Sprite size notes:
 *  - agents.base        → 435×381 RGBA cropped individual sprite (entity layer, desk positions)
 *  - agents.sceneLayers → 1376×768 RGB full-scene layers (no alpha; preloaded, not active in
 *                         image mode — blend-mode strategy over photo background TBD)
 *  - agents.largeFront  → 875×1216 RGB tall sprite (no alpha; preloaded, wiring TBD)
 *  - environment.bookshelf / archDoor → 1376×768 full-scene layers (composited at canvas scale)
 *  - all other keys     → individual sprites drawn at specific positions
 */
export const ASSET_MAPPING = Object.freeze({
  agents: Object.freeze({
    // Cropped individual sprite (435×381 RGBA) — drawn centred on resolved desk position.
    base: 'sloth_worker_desk_facing_right_back_01.png',
    // Full-scene RGB layer sprites (1376×768, no alpha) — preloaded for future use.
    // Not active in rendering: SCENE_COMPOSITE.slothSceneLayers = false.
    sceneLayers: Object.freeze([
      'sloth_worker_desk_facing_left_back_01.png',
      'sloth_worker_desk_facing_left_front_01.png',
      'sloth_worker_desk_facing_left_front_02.png',
    ]),
    // Large front sprite (875×1216 RGB, no alpha) — preloaded; rendering use TBD.
    largeFront: 'sloth_worker_desk_facing_right_front_01.png',
  }),
  zones: Object.freeze({
    CREATED:  'desk_wood_02.png',
    ENQUEUED: 'desk_terminal_organic_01.png',
    ACKED:    'storage_shelf_moss_01.png',
  }),
  environment: Object.freeze({
    // Unified room background — entire scene in one image (1376×768 or similar).
    // When present this is drawn full-canvas as Layer 1; procedural room is the fallback.
    sceneBackground: 'scene_background_01.jpg',
    core:       'core_tree_01.png',
    coreAccent: 'core_tree_03.png',
    vine:       'decor_vine_01.png',
    books:      'decor_books_stack_01.png',
    // Full-scene architectural layer sprites (1376×768, drawn at canvas scale).
    // Inactive while sceneBackground is in use — kept for fallback reference only.
    bookshelf:  'env_bookshelf_tall_01.png',
    archDoor:   'env_tree_arch_door_01.png',
    trays: Object.freeze([
      'decor_leaf_tray_01.png',
      'decor_leaf_tray_02.png',
      'decor_leaf_tray_03.png',
    ]),
    // groundDecor[0] = large plant, [1-3] = small plant variants, [4] = vine
    groundDecor: Object.freeze([
      'decor_plant_01.png',
      'decor_plant_small_01.png',
      'decor_plant_small_02.png',
      'decor_plant_small_03.png',
      'decor_vine_01.png',
    ]),
  }),
  props: Object.freeze({
    task: Object.freeze([
      'task_bundle_01.png',
      'task_files_01.png',
      'task_files_02.png',
      'task_scroll_01.png',
      'task_scroll_02.png',
      'task_scroll_03.png',
      'task_stack_01.png',
    ]),
    books: Object.freeze([
      'decor_books_stack_01.png',
    ]),
  }),
  effects: Object.freeze({
    glow: Object.freeze([
      'light_glow_orb_01.png',
      'light_glow_orb_02.png',
      'light_glow_orb_03.png',
    ]),
    lantern:  'light_lantern_02.png',
    coreGlow: 'light_tree_glow_01.png',
    flow: Object.freeze([
      'flow_stream_01.png',
      'flow_stream_cascade_01.png',
    ]),
    ui: Object.freeze([
      'ui_floating_display_01.png',
      'ui_panel_small_01.png',
    ]),
  }),
});

export const loadedAssets = {};

const assetLoader = new AssetLoader();
assetLoader
  .loadAll(assetPaths)
  .then((assets) => {
    Object.assign(loadedAssets, assets);
    console.log('Loaded asset filenames:', Object.keys(assets));
  })
  .catch((error) => {
    console.error('Asset loading failed:', error.message);
  });
