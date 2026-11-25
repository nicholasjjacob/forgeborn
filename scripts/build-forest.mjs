// Copies the KayKit Forest Nature Pack models the forest world uses (CC0, Kay Lousberg) into
// public/models/nf_<name>.glb, WITHOUT their texture: the models of each colourway share one
// texture (public/models/tex/forest_<N>.png, N = the _ColorN suffix), attached at load time (see
// models.ts). Keeps ~100 small files instead of ~100 copies of the same few images.
// Run: node scripts/build-forest.mjs [path to KayKit_Forest_Nature_Pack_1.0_SOURCE folder]
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const SRC = process.argv[2] ?? join(homedir(), 'Downloads', 'KayKit_Forest_Nature_Pack_1.0_SOURCE');
const OUT = 'public/models';
const DIR = join(SRC, 'Assets', 'gltf');
if (!existsSync(DIR)) throw new Error(`KayKit folder not found: ${SRC}`);

// The exact models and colourways the forest uses, straight from the layout code.
const { forestModelList } = await import('../src/sim/forest.ts');
const LIST = forestModelList();

const io = new NodeIO();
let n = 0, total = 0;
const done = new Set();
// Start clean: models the forest no longer uses go away.
for (const f of readdirSync(OUT)) if (f.startsWith('nf_')) rmSync(join(OUT, f));
for (const [name, c] of LIST) {
  {
    {
      const file = `${name}_Color${c}`;
      const dst = join(OUT, `nf_${file}.glb`);
      if (done.has(dst)) continue; // listed in two sets
      done.add(dst);
      const doc = await io.read(join(DIR, `Color${c}`, `${file}.gltf`));
      // Drop the texture (shared, attached at load time): keep the materials and UVs.
      for (const m of doc.getRoot().listMaterials()) m.setBaseColorTexture(null);
      for (const t of doc.getRoot().listTextures()) t.dispose();
      await doc.transform(prune({ keepAttributes: true })); // keep the UVs: the texture comes back at load time
      await io.write(dst, doc);
      n++;
      total += statSync(dst).size;
    }
  }
}
mkdirSync(join(OUT, 'tex'), { recursive: true });
// Each colourway is its own texture (same UVs): tex/forest_<N>.png.
for (let c = 1; c <= 8; c++) copyFileSync(join(DIR, `Color${c}`, 'forest_texture.png'), join(OUT, 'tex', `forest_${c}.png`));
console.log('forest models', n, Math.round(total / 1024), 'KB');
