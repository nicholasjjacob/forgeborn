// Copies the KayKit Adventurers characters (CC0, Kay Lousberg) into public/models/hero_<id>.glb,
// their alternate colour textures into public/models/tex/, and builds slim animation files with
// only the clips the game plays (the mannequin meshes dropped, unused data pruned):
//   public/models/hero_anims.glb        Rig_Medium (every hero but the Large Barbarian)
//   public/models/hero_anims_large.glb  Rig_Large  (the Large Barbarian; it borrows the medium
//                                        rig's attack clip at runtime: same bone names)
// Animations come from KayKit Character Animations 1.1 (same rigs, many more clips).
// Run: node scripts/build-heroes.mjs [KayKit_Adventurers_2.0_SOURCE folder] [KayKit_Character_Animations_1.1 folder] [KayKit_Skeletons_1.1_SOURCE folder]
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { mergeDocuments, prune, resample } from '@gltf-transform/functions';

const SRC = process.argv[2] ?? join(homedir(), 'Downloads', 'KayKit_Adventurers_2.0_SOURCE');
const OUT = 'public/models';
const ANIM = process.argv[3] ?? join(homedir(), 'Downloads', 'KayKit_Character_Animations_1.1');
for (const d of [SRC, ANIM]) if (!existsSync(d)) throw new Error(`KayKit folder not found: ${d}`);

const HEROES = {
  knight: 'Knight', barbarian: 'Barbarian', rogue: 'Rogue', mage: 'Mage', rogue_hooded: 'Rogue_Hooded',
  barbarian_large: 'Barbarian_Large',
};
for (const [id, file] of Object.entries(HEROES)) {
  const dst = join(OUT, `hero_${id}.glb`);
  copyFileSync(join(SRC, 'Characters', 'gltf', `${file}.glb`), dst);
  console.log('hero', id, statSync(dst).size);
}

// Alternate colour schemes: <name>_texture_alt_A/B/C.png (the default one is inside each model;
// a copy, <name>_0.png, is only used for the colour swatch on the Heroes screen).
mkdirSync(join(OUT, 'tex'), { recursive: true });
for (const name of ['knight', 'barbarian', 'rogue', 'mage']) {
  for (const alt of ['A', 'B', 'C']) copyFileSync(join(SRC, 'Textures', `${name}_texture_alt_${alt}.png`), join(OUT, 'tex', `${name}_${alt}.png`));
  copyFileSync(join(SRC, 'Textures', `${name}_texture.png`), join(OUT, 'tex', `${name}_0.png`)); // for the swatch
}
console.log('textures copied');

// Skeleton forms (mastery rewards) from KayKit Skeletons 1.1: same rigs, texture inside the model.
const SKEL = process.argv[4] ?? join(homedir(), 'Downloads', 'KayKit_Skeletons_1.1_SOURCE');
if (existsSync(SKEL)) {
  for (const name of ['Minion', 'Warrior', 'Rogue', 'Mage', 'Golem']) {
    const dst = join(OUT, `skel_${name.toLowerCase()}.glb`);
    copyFileSync(join(SKEL, 'characters', 'gltf', `Skeleton_${name}.glb`), dst);
    console.log('skeleton', name, statSync(dst).size);
  }
} else console.warn(`Skeletons folder not found (skipped): ${SKEL}`);

const io = new NodeIO();
async function buildAnims(rigName, files, keep, out) {
  const rig = join(ANIM, 'Animations', 'gltf', rigName);
  const doc = await io.read(join(rig, `${rigName}_${files[0]}.glb`));
  for (const f of files.slice(1)) mergeDocuments(doc, await io.read(join(rig, `${rigName}_${f}.glb`)));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) if (!keep.has(a.getName())) a.dispose();
  // The merge brought a second copy of the skeleton. Point every clip at the first skeleton's
  // bones (by name) and drop the copy: loaders rename duplicate bones ("hips_1"), which would leave
  // those clips animating nothing and the hero stuck in its rest pose.
  const [mainScene, ...extraScenes] = root.listScenes();
  const mainBones = new Map();
  mainScene.traverse((n) => { if (!mainBones.has(n.getName())) mainBones.set(n.getName(), n); });
  for (const a of root.listAnimations()) {
    for (const c of a.listChannels()) {
      const t = c.getTargetNode();
      const m = t && mainBones.get(t.getName());
      if (m && m !== t) c.setTargetNode(m);
    }
  }
  // Bones only rotate in these clips (apart from the hips moving the body): drop scale tracks
  // and every other bone's position track. Keeps the files small without changing the motion.
  for (const a of root.listAnimations()) {
    for (const c of a.listChannels()) {
      const path = c.getTargetPath(), node = c.getTargetNode()?.getName() ?? '';
      if (path === 'scale' || (path === 'translation' && node !== 'hips' && node !== 'root')) {
        c.getSampler()?.dispose(); c.dispose();
      }
    }
  }
  for (const sc of extraScenes) sc.dispose();
  const live = new Set();
  mainScene.traverse((n) => live.add(n));
  for (const n of root.listNodes()) if (!live.has(n)) n.dispose();
  // Drop the mannequin meshes (keep the bones the clips animate).
  for (const n of root.listNodes()) { if (n.getMesh()) n.setMesh(null); n.setSkin(null); }
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
  // Everything into one buffer for a valid GLB.
  const buf = root.listBuffers()[0];
  for (const a of root.listAccessors()) a.setBuffer(buf);
  for (const b of root.listBuffers()) if (b !== buf) b.dispose();
  await doc.transform(resample({ tolerance: 2e-3 }), prune()); // resample drops keyframes the motion doesn't need
  // Anything not used by a clip is leftover mannequin mesh data: drop it.
  const used = new Set();
  for (const an of root.listAnimations()) for (const sm of an.listSamplers()) { used.add(sm.getInput()); used.add(sm.getOutput()); }
  for (const acc of root.listAccessors()) if (!used.has(acc)) acc.dispose();
  const dst = join(OUT, out);
  await io.write(dst, doc);
  console.log(out, root.listAnimations().map((a) => a.getName()).join(', '), statSync(dst).size);
}

await buildAnims('Rig_Medium', ['General', 'MovementBasic', 'MovementAdvanced', 'CombatMelee', 'CombatRanged', 'Tools'], new Set([
  'Idle_A', 'Running_A', 'Walking_A', 'Death_A', 'Hit_A',
  'Running_HoldingBow', 'Running_HoldingRifle',
  'Melee_1H_Attack_Chop', 'Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Slice_Horizontal', 'Melee_1H_Attack_Stab',
  'Melee_2H_Attack_Chop', 'Melee_2H_Attack_Slice', 'Melee_2H_Attack_Stab', 'Melee_2H_Idle',
  'Melee_Dualwield_Attack_Slice', 'Melee_Dualwield_Attack_Stab',
  'Ranged_1H_Shoot', 'Ranged_1H_Aiming', 'Ranged_2H_Shoot', 'Ranged_2H_Aiming', 'Ranged_Bow_Idle', 'Ranged_Bow_Release',
  'Ranged_Magic_Shoot', 'Chop', 'Pickaxe',
  // Showcase idles for the Heroes screen (each hero's signature pose, see heroRig SHOWCASE).
  'Melee_Blocking', 'Ranged_Magic_Spellcasting', 'Ranged_Magic_Spellcasting_Long', 'Crouching',
  'Ranged_1H_Reload', 'Ranged_2H_Reload', 'Hammering',
]), 'hero_anims.glb');
await buildAnims('Rig_Large', ['General', 'MovementBasic', 'CombatMelee'], new Set([
  'Idle_A', 'Running_A', 'Walking_A', 'Death_A', 'Hit_A',
  'Melee_2H_Attack', 'Melee_2H_Idle', 'Melee_2H_Slam', 'Melee_1H_Slash', 'Melee_1H_Stab',
]), 'hero_anims_large.glb');
