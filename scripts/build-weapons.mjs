// Copies the weapon models the game uses (CC0, Kay Lousberg) into public/models, one GLB each with
// its texture embedded and unused data pruned:
//   w_<name>.glb   from KayKit Adventurers 2.0 (class gear: wrench, shotgun, druid staff, …)
//   fw_<name>.glb  from KayKit Fantasy Weapons Bits 1.0 (swords, axes, bows, staffs, …)
// Run: node scripts/build-weapons.mjs [Adventurers SOURCE folder] [Fantasy Weapons Bits SOURCE folder]
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const ADV = process.argv[2] ?? join(homedir(), 'Downloads', 'KayKit_Adventurers_2.0_SOURCE');
const FW = process.argv[3] ?? join(homedir(), 'Downloads', 'KayKit_FantasyWeaponsBits_1.0_SOURCE');
const OUT = 'public/models';
for (const d of [ADV, FW]) if (!existsSync(d)) throw new Error(`KayKit folder not found: ${d}`);

const PACKS = [
  { dir: join(ADV, 'Assets', 'gltf'), prefix: 'w_', models: [
    'sword_1handed', 'sword_2handed', 'sword_2handed_color', 'axe_1handed', 'axe_2handed', 'axe_2handed_Large', 'dagger',
    'crossbow_1handed', 'crossbow_2handed', 'bow_withString', 'staff', 'wand', 'druid_staff', 'engineer_Wrench', 'shotgun',
    'arrow_crossbow',
  ] },
  { dir: join(FW, 'Assets', 'gltf'), prefix: 'fw_', models: [
    'sword_A', 'sword_B', 'sword_C', 'sword_D', 'sword_E', 'sword_F', 'sword_G', 'axe_A', 'axe_B', 'axe_C', 'axe_D',
    'dagger_A', 'dagger_B', 'dagger_C', 'bow_A_withString', 'bow_B_withString', 'bow_C_withString',
    'staff_A', 'staff_B', 'staff_C', 'staff_D', 'wand_A', 'wand_B', 'scythe', 'halberd', 'spear_A', 'spear_B',
    'hammer_A', 'hammer_B', 'hammer_C', 'hammer_D', 'fistweapon_A', 'fistweapon_B', 'fistweapon_C_right', 'fistweapon_C_left',
    'arrow_A', 'arrow_B', 'arrow_C',
  ] },
];
const io = new NodeIO();
let total = 0;
for (const { dir, prefix, models } of PACKS) {
  for (const name of models) {
    const doc = await io.read(join(dir, `${name}.gltf`));
    await doc.transform(prune());
    const dst = join(OUT, `${prefix}${name}.glb`);
    await io.write(dst, doc);
    total += statSync(dst).size;
  }
}
console.log('weapons written', Math.round(total / 1024), 'KB');
