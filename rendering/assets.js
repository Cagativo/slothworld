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
  'assets/free-office-pixel-art/writing-table.png'
];

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
