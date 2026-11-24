// Copies the KayKit Adventurers characters (CC0, Kay Lousberg) into public/models/hero_<id>.glb and
// builds one slim animation file (public/models/hero_anims.glb) with only the clips the game plays:
// the mannequin meshes are dropped and unused data pruned.
// Run: node scripts/build-heroes.mjs [path to KayKit_Adventurers_2.0_FREE folder]
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { mergeDocuments, prune, resample } from '@gltf-transform/functions';

const SRC = process.argv[2] ?? join(homedir(), 'Downloads', 'KayKit_Adventurers_2.0_FREE', 'KayKit_Adventurers_2.0_FREE');
const OUT = 'public/models';
if (!existsSync(SRC)) throw new Error(`KayKit folder not found: ${SRC}`);

const HEROES = { knight: 'Knight', barbarian: 'Barbarian', rogue: 'Rogue', ranger: 'Ranger', mage: 'Mage', rogue_hooded: 'Rogue_Hooded' };
for (const [id, file] of Object.entries(HEROES)) {
  const dst = join(OUT, `hero_${id}.glb`);
  copyFileSync(join(SRC, 'Characters', 'gltf', `${file}.glb`), dst);
  console.log('hero', id, statSync(dst).size);
}

const KEEP = new Set(['Idle_A', 'Running_A', 'Walking_A', 'Death_A', 'Hit_A', 'Throw', 'Use_Item', 'Interact']);
const io = new NodeIO();
const rig = join(SRC, 'Animations', 'gltf', 'Rig_Medium');
const doc = await io.read(join(rig, 'Rig_Medium_General.glb'));
mergeDocuments(doc, await io.read(join(rig, 'Rig_Medium_MovementBasic.glb')));
const root = doc.getRoot();
for (const a of root.listAnimations()) if (!KEEP.has(a.getName())) a.dispose();
// Drop the mannequin meshes (keep the bones the clips animate).
for (const n of root.listNodes()) { if (n.getMesh()) n.setMesh(null); n.setSkin(null); }
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
// Everything into one buffer for a valid GLB.
const buf = root.listBuffers()[0];
for (const a of root.listAccessors()) a.setBuffer(buf);
for (const b of root.listBuffers()) if (b !== buf) b.dispose();
await doc.transform(resample(), prune()); // resample drops redundant keyframes
const anims = join(OUT, 'hero_anims.glb');
await io.write(anims, doc);
console.log('anims', root.listAnimations().map((a) => a.getName()).join(', '), statSync(anims).size);
