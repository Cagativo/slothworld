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
      const image = await this.loadImage(path);
      this.assets[filename] = image;
      console.log(`Loaded asset: ${filename}`);
    }

    return this.assets;
  }
}

export const assetPaths = [
  'assets/free-office-pixel-art/Chair.png',
  'assets/free-office-pixel-art/Julia-Idle.png',
  'assets/free-office-pixel-art/Julia.png',
  'assets/free-office-pixel-art/Julia_Drinking_Coffee.png',
  'assets/free-office-pixel-art/Julia_PC.png',
  'assets/free-office-pixel-art/Julia_walk_Foward.png',
  'assets/free-office-pixel-art/Julia_walk_Left.png',
  'assets/free-office-pixel-art/Julia_walk_Rigth.png',
  'assets/free-office-pixel-art/Julia_walk_Up.png',
  'assets/free-office-pixel-art/PC1.png',
  'assets/free-office-pixel-art/PC2.png',
  'assets/free-office-pixel-art/Trash.png',
  'assets/free-office-pixel-art/boss.png',
  'assets/free-office-pixel-art/cabinet.png',
  'assets/free-office-pixel-art/coffee-maker.png',
  'assets/free-office-pixel-art/desk-with-pc.png',
  'assets/free-office-pixel-art/desk.png',
  'assets/free-office-pixel-art/office-partitions-1.png',
  'assets/free-office-pixel-art/office-partitions-2.png',
  'assets/free-office-pixel-art/plant.png',
  'assets/free-office-pixel-art/printer.png',
  'assets/free-office-pixel-art/sink.png',
  'assets/free-office-pixel-art/stamping-table.png',
  'assets/free-office-pixel-art/water-cooler.png',
  'assets/free-office-pixel-art/worker1.png',
  'assets/free-office-pixel-art/worker2.png',
  'assets/free-office-pixel-art/worker4.png',
  'assets/free-office-pixel-art/writing-table.png',
  // Slothworld assets
  'assets/slothworldassets/sloth_worker_desk_01.png',
  'assets/slothworldassets/core_tree_01.png',
  'assets/slothworldassets/core_tree_03.png',
  'assets/slothworldassets/desk_terminal_organic_01.png',
  'assets/slothworldassets/desk_wood_02.png',
  'assets/slothworldassets/storage_shelf_moss_01.png',
  'assets/slothworldassets/decor_plant_01.png',
  'assets/slothworldassets/decor_plant_small_01.png',
  'assets/slothworldassets/decor_plant_small_02.png',
  'assets/slothworldassets/decor_plant_small_03.png',
  'assets/slothworldassets/decor_vine_01.png',
  'assets/slothworldassets/decor_leaf_tray_01.png',
  'assets/slothworldassets/decor_leaf_tray_02.png',
  'assets/slothworldassets/decor_leaf_tray_03.png',
  'assets/slothworldassets/decor_books_stack_01.png',
  'assets/slothworldassets/task_bundle_01.png',
  'assets/slothworldassets/task_files_01.png',
  'assets/slothworldassets/task_files_02.png',
  'assets/slothworldassets/task_scroll_01.png',
  'assets/slothworldassets/task_scroll_02.png',
  'assets/slothworldassets/task_scroll_03.png',
  'assets/slothworldassets/task_stack_01.png',
  'assets/slothworldassets/light_glow_orb_01.png',
  'assets/slothworldassets/light_glow_orb_02.png',
  'assets/slothworldassets/light_glow_orb_03.png',
  'assets/slothworldassets/light_lantern_02.png',
  'assets/slothworldassets/light_tree_glow_01.png',
  'assets/slothworldassets/flow_stream_01.png',
  'assets/slothworldassets/flow_stream_small_01.png',
  'assets/slothworldassets/ui_floating_display_01.png',
  'assets/slothworldassets/ui_panel_small_01.png',
  'assets/slothworldassets/other_unknown_07.png',
  'assets/slothworldassets/other_unknown_08.png',
];

/**
 * Fixed asset mapping for the WorldScene renderer.
 *
 * Keys are filename strings only — no semantic meaning is inferred from them.
 * All arrays are frozen; selection from arrays must be deterministic (no Math.random).
 */
export const ASSET_MAPPING = Object.freeze({
  agents: Object.freeze({
    base: 'sloth_worker_desk_01.png',
  }),
  zones: Object.freeze({
    CREATED:          'desk_wood_02.png',
    ENQUEUED:         'desk_terminal_organic_01.png',
    CLAIMED:          'desk_terminal_organic_01.png',
    EXECUTE_FINISHED: 'desk_wood_02.png',
    ACKED:            'storage_shelf_moss_01.png',
  }),
  environment: Object.freeze({
    core:        'core_tree_01.png',
    coreAccent:  'core_tree_03.png',
    groundDecor: Object.freeze([
      'decor_plant_01.png',
      'decor_plant_small_01.png',
      'decor_plant_small_02.png',
      'decor_plant_small_03.png',
      'decor_vine_01.png',
      'decor_leaf_tray_01.png',
      'decor_leaf_tray_02.png',
      'decor_leaf_tray_03.png',
    ]),
  }),
  props: Object.freeze([
    'task_bundle_01.png',
    'task_files_01.png',
    'task_files_02.png',
    'task_scroll_01.png',
    'task_scroll_02.png',
    'task_scroll_03.png',
    'task_stack_01.png',
    'decor_books_stack_01.png',
  ]),
  effects: Object.freeze({
    glow: Object.freeze([
      'light_glow_orb_01.png',
      'light_glow_orb_02.png',
      'light_glow_orb_03.png',
      'light_tree_glow_01.png',
    ]),
    lantern: 'light_lantern_02.png',
    flow: Object.freeze([
      'flow_stream_01.png',
      'flow_stream_small_01.png',
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
