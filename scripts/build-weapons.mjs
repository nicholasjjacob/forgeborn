// Copies the KayKit Adventurers weapon, shield and projectile models (CC0, Kay Lousberg) into
// public/models/w_<name>.glb (one file each, texture embedded, unused data pruned).
// Run: node scripts/build-weapons.mjs [path to KayKit_Adventurers_2.0_FREE folder]
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const SRC = process.argv[2] ?? join(homedir(), 'Downloads', 'KayKit_Adventurers_2.0_FREE', 'KayKit_Adventurers_2.0_FREE');
const OUT = 'public/models';
const DIR = join(SRC, 'Assets', 'gltf');
if (!existsSync(DIR)) throw new Error(`KayKit folder not found: ${SRC}`);

const MODELS = [
  'sword_1handed', 'sword_2handed', 'sword_2handed_color', 'axe_1handed', 'axe_2handed', 'dagger',
  'crossbow_1handed', 'bow_withString', 'staff', 'wand', 'shield_badge_color',
  'arrow_bow', 'arrow_crossbow',
];
const io = new NodeIO();
for (const name of MODELS) {
  const doc = await io.read(join(DIR, `${name}.gltf`));
  await doc.transform(prune());
  const dst = join(OUT, `w_${name}.glb`);
  await io.write(dst, doc);
  console.log(name, statSync(dst).size);
}
