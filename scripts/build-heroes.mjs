// Copies the KayKit Adventurers characters (CC0, Kay Lousberg) into public/models/hero_<id>.glb,
// their alternate colour textures into public/models/tex/, and builds slim animation files with
// only the clips the game plays (the mannequin meshes dropped, unused data pruned):
//   public/models/hero_anims.glb        Rig_Medium (every hero but the Large Barbarian)
//   public/models/hero_anims_large.glb  Rig_Large  (the Large Barbarian; it borrows the medium
//                                        rig's attack clip at runtime: same bone names)
// Run: node scripts/build-heroes.mjs [path to KayKit_Adventurers_2.0_SOURCE folder]
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { mergeDocuments, prune, resample } from '@gltf-transform/functions';

const SRC = process.argv[2] ?? join(homedir(), 'Downloads', 'KayKit_Adventurers_2.0_SOURCE');
const OUT = 'public/models';
if (!existsSync(SRC)) throw new Error(`KayKit folder not found: ${SRC}`);

const HEROES = {
  knight: 'Knight', barbarian: 'Barbarian', rogue: 'Rogue', ranger: 'Ranger', mage: 'Mage', rogue_hooded: 'Rogue_Hooded',
  druid: 'Druid', engineer: 'Engineer', barbarian_large: 'Barbarian_Large',
};
for (const [id, file] of Object.entries(HEROES)) {
  const dst = join(OUT, `hero_${id}.glb`);
  copyFileSync(join(SRC, 'Characters', 'gltf', `${file}.glb`), dst);
  console.log('hero', id, statSync(dst).size);
}

// Alternate colour schemes: <name>_texture_alt_A/B/C.png (the default one is inside each model;
// a copy, <name>_0.png, is only used for the colour swatch on the Heroes screen).
mkdirSync(join(OUT, 'tex'), { recursive: true });
for (const name of ['knight', 'barbarian', 'rogue', 'ranger', 'mage', 'druid', 'engineer']) {
  for (const alt of ['A', 'B', 'C']) copyFileSync(join(SRC, 'Textures', `${name}_texture_alt_${alt}.png`), join(OUT, 'tex', `${name}_${alt}.png`));
  copyFileSync(join(SRC, 'Textures', `${name}_texture.png`), join(OUT, 'tex', `${name}_0.png`)); // for the swatch
}
console.log('textures copied');

const io = new NodeIO();
async function buildAnims(rigName, keep, out) {
  const rig = join(SRC, 'Animations', 'gltf', rigName);
  const doc = await io.read(join(rig, `${rigName}_General.glb`));
  mergeDocuments(doc, await io.read(join(rig, `${rigName}_MovementBasic.glb`)));
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
  await doc.transform(resample(), prune()); // resample drops redundant keyframes
  const dst = join(OUT, out);
  await io.write(dst, doc);
  console.log(out, root.listAnimations().map((a) => a.getName()).join(', '), statSync(dst).size);
}

await buildAnims('Rig_Medium', new Set(['Idle_A', 'Running_A', 'Walking_A', 'Death_A', 'Hit_A', 'Throw', 'Use_Item', 'Interact']), 'hero_anims.glb');
await buildAnims('Rig_Large', new Set(['Idle_A', 'Running_A', 'Walking_A', 'Death_A', 'Hit_A']), 'hero_anims_large.glb');
