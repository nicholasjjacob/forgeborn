// Copies the KayKit Forest Nature Pack models the forest world uses (CC0, Kay Lousberg) into
// public/models/nf_<name>.glb, WITHOUT their texture: the models of each colourway share one
// texture (public/models/tex/forest_<N>.png, N = the _ColorN suffix), attached at load time (see
// models.ts). Keeps ~100 small files instead of ~100 copies of the same few images.
// Run: node scripts/build-forest.mjs [path to KayKit_Forest_Nature_Pack_1.0_SOURCE folder]
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const SRC = process.argv[2] ?? join(homedir(), 'Downloads', 'KayKit_Forest_Nature_Pack_1.0_SOURCE');
const OUT = 'public/models';
const DIR = join(SRC, 'Assets', 'gltf');
if (!existsSync(DIR)) throw new Error(`KayKit folder not found: ${SRC}`);

/** Model names (without the _ColorN suffix) and the colour variants used. */
const SETS = [
  // Meadow: bright round and blocky trees
  [['Tree_1_A', 'Tree_1_B', 'Tree_1_C', 'Tree_3_A', 'Tree_3_B', 'Tree_3_C', 'Tree_2_A', 'Tree_2_B'], [1, 3]],
  // Bloomwood: blossom trees (pink, red) among greens
  [['Tree_1_A', 'Tree_1_B', 'Tree_6_A', 'Tree_6_B', 'Tree_7_A', 'Tree_7_B'], [1, 8, 7]],
  // Old Mill: autumn and pines
  [['Tree_4_A', 'Tree_4_B', 'Tree_5_A', 'Tree_5_B', 'Tree_5_C', 'Tree_1_A'], [5, 6, 2]],
  [['Tree_Bare_1_A', 'Tree_Bare_1_B', 'Tree_Bare_1_C', 'Tree_Bare_2_A', 'Tree_Bare_2_B'], [1]],
  [['Bush_1_A', 'Bush_1_B', 'Bush_1_D', 'Bush_1_E', 'Bush_2_D', 'Bush_2_E', 'Bush_3_A', 'Bush_3_B', 'Bush_4_D', 'Bush_4_E'], [1]],
  [['Bush_1_A', 'Bush_1_E', 'Bush_4_D'], [8, 5]],
  [['Grass_1_A', 'Grass_1_B', 'Grass_1_C', 'Grass_1_D', 'Grass_2_A', 'Grass_2_B', 'Grass_2_C', 'Grass_2_D'], [1]],
  // Rocks: boulders, round stones, tall stones, cliff blocks (walls), spires (landmarks)
  [['Rock_3_A', 'Rock_3_B', 'Rock_3_C', 'Rock_3_E', 'Rock_3_H', 'Rock_3_J', 'Rock_5_A', 'Rock_5_B', 'Rock_5_C', 'Rock_5_D', 'Rock_5_E', 'Rock_5_F', 'Rock_5_H',
    'Rock_6_A', 'Rock_6_B', 'Rock_6_E', 'Rock_6_F', 'Rock_1_A', 'Rock_1_B', 'Rock_1_C', 'Rock_1_G', 'Rock_1_H', 'Rock_1_I', 'Rock_1_K', 'Rock_1_L',
    'Rock_2_A', 'Rock_2_B', 'Rock_2_E', 'Rock_2_G', 'Rock_4_D', 'Rock_4_E', 'Rock_4_F', 'Rock_4_G'], [1]],
];

const io = new NodeIO();
let n = 0, total = 0;
const done = new Set();
for (const [names, colors] of SETS) {
  for (const name of names) {
    for (const c of colors) {
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
