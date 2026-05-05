/**
 * prop-asset-manifest.js
 *
 * Rendering-only manifest for transparent PNG runtime props. Entries are
 * filename/path data plus draw defaults; state remains owned by callers.
 */

const ASSET_ROOT = 'assets/slothworldassets/';

function entry(filename, config = {}) {
  return Object.freeze({
    filename,
    path: `${ASSET_ROOT}${filename}`,
    anchor: config.anchor ? Object.freeze({ ...config.anchor }) : null,
    width: config.width,
    height: config.height,
    alpha: config.alpha ?? 1,
    blend: config.blend ?? 'source-over',
  });
}

export const PROP_ASSET_MANIFEST = Object.freeze({
  engineCrystalGlow: entry('light_tree_glow_01.png', {
    anchor: { group: 'crystal', key: 'engineCrystal' },
    width: 76,
    height: 76,
    alpha: 0.46,
    blend: 'screen',
  }),
  intakePaperStack: entry('task_stack_01.png', {
    anchor: { group: 'shelves', key: 'intakeShelf' },
    width: 34,
    height: 28,
    alpha: 0.84,
  }),
  queueRuneStone: entry('light_glow_orb_02.png', {
    anchor: { group: 'shelves', key: 'queueRunes' },
    width: 34,
    height: 34,
    alpha: 0.42,
    blend: 'screen',
  }),
  monitorGlow: entry('ui_floating_display_01.png', {
    anchor: { group: 'indicators', key: 'claimedMonitor' },
    width: 36,
    height: 22,
    alpha: 0.30,
    blend: 'screen',
  }),
  approvalMarker: entry('createtaskselected.png', {
    anchor: { group: 'approvalDesk', key: 'deliveryDesk' },
    width: 30,
    height: 30,
    alpha: 0.52,
    blend: 'screen',
  }),
  archiveGlow: entry('light_glow_orb_03.png', {
    anchor: { group: 'shelves', key: 'archiveShelf' },
    width: 38,
    height: 38,
    alpha: 0.32,
    blend: 'screen',
  }),
  anomalyShelfLight: entry('light_glow_orb_03.png', {
    anchor: { group: 'warningShelf', key: 'anomalyShelf' },
    width: 32,
    height: 32,
    alpha: 0.38,
    blend: 'screen',
  }),
  dataStreamSoft: entry('flow_stream_small_01.png', {
    width: 18,
    height: 9,
    alpha: 0.12,
    blend: 'screen',
  }),
  dataStreamMain: entry('flow_stream_01.png', {
    width: 22,
    height: 11,
    alpha: 0.18,
    blend: 'screen',
  }),
  deskTerminal: entry('desk_terminal_organic_01.png', {
    anchor: { group: 'decor', key: 'deskTerminal' },
    width: 42,
    height: 30,
    alpha: 0.74,
  }),
  archiveShelf: entry('env_bookshelf_tall_01.png', {
    anchor: { group: 'decor', key: 'archiveShelf' },
    width: 96,
    height: 160,
    alpha: 0.58,
  }),
  mossShelf: entry('storage_shelf_moss_01.png', {
    anchor: { group: 'decor', key: 'mossShelf' },
    width: 80,
    height: 64,
    alpha: 0.62,
  }),
  foregroundVine: entry('decor_vine_01.png', {
    anchor: { group: 'decor', key: 'foregroundVine' },
    width: 76,
    height: 252,
    alpha: 0.64,
  }),
  smallPlants: Object.freeze([
    entry('decor_plant_small_01.png', {
      anchor: { group: 'decor', key: 'smallPlants' },
      width: 28,
      height: 32,
      alpha: 0.78,
    }),
    entry('decor_plant_small_02.png', {
      anchor: { group: 'decor', key: 'smallPlants' },
      width: 26,
      height: 30,
      alpha: 0.78,
    }),
    entry('decor_plant_small_03.png', {
      anchor: { group: 'decor', key: 'smallPlants' },
      width: 24,
      height: 28,
      alpha: 0.78,
    }),
  ]),
  booksStack: entry('decor_books_stack_01.png', {
    anchor: { group: 'decor', key: 'booksStack' },
    width: 44,
    height: 42,
    alpha: 0.72,
  }),
});

export function listPropAssetEntries(manifest = PROP_ASSET_MANIFEST) {
  return Object.values(manifest).flatMap((value) => Array.isArray(value) ? value : [value]);
}
