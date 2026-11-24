import type * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { skinDef } from '../sim/skins';
import { findClip, loadModel } from './models';

/**
 * Hero animations by rig. Most heroes share the medium rig (hero_anims). The Warlord is on the
 * large rig (hero_anims_large), which has no attack clip: it borrows the medium rig's (both rigs
 * use the same bone names) with only its rotations, so the bigger skeleton keeps its proportions.
 */

export interface HeroAnims { anims: GLTF; attack: THREE.AnimationClip | null }

const borrowed = new Map<THREE.AnimationClip, THREE.AnimationClip>();

/** Model files hero `skin` needs for its animations. */
export function heroAnimFiles(skin: string): string[] {
  return skinDef(skin).rig === 'large' ? ['hero_anims_large', 'hero_anims'] : ['hero_anims'];
}

export async function loadHeroAnims(skin: string): Promise<HeroAnims> {
  const large = skinDef(skin).rig === 'large';
  const medium = await loadModel('hero_anims');
  const anims = large ? await loadModel('hero_anims_large') : medium;
  let attack = findClip(medium, ['Throw', 'Use_Item']);
  if (attack && large) {
    let b = borrowed.get(attack);
    if (!b) {
      b = attack.clone();
      b.tracks = b.tracks.filter((t) => t.name.endsWith('.quaternion'));
      borrowed.set(attack, b);
    }
    attack = b;
  }
  return { anims, attack };
}

/** Weapons in a giant's hands are made chunkier to match. */
export function heroWeaponScale(skin: string): number {
  return skinDef(skin).rig === 'large' ? 1.35 : 1;
}

/** Hero size relative to the others (the Warlord towers over them). */
export function heroScale(skin: string): number {
  return skinDef(skin).scale ?? 1;
}
