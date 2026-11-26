import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { skinDef } from '../sim/skins';
import { findClip, loadModel } from './models';

/**
 * Hero animations (KayKit Character Animations, built by scripts/build-heroes.mjs). Most heroes
 * share the medium rig (hero_anims); the Warlord is on the large rig (hero_anims_large). Each
 * weapon type picks its own idle, run and attack clips (WEAPON_ANIMS), so a bow is drawn and
 * released, a greatsword swung two-handed, a staff casts, and so on.
 */

export interface HeroAnims { anims: GLTF }

/** Clips for one weapon type. `attacks` take turns; `upright`: hold the weapon upright in idle. */
export interface WeaponAnims { idle: string; run: string; attacks: readonly string[]; upright: boolean }

const ONE_HAND: WeaponAnims = { idle: 'Idle_A', run: 'Running_A', attacks: ['Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Chop', 'Melee_1H_Attack_Slice_Horizontal'], upright: true };
const TWO_HAND: WeaponAnims = { idle: 'Melee_2H_Idle', run: 'Running_A', attacks: ['Melee_2H_Attack_Slice', 'Melee_2H_Attack_Chop'], upright: false };
const MAGIC: WeaponAnims = { idle: 'Idle_A', run: 'Running_A', attacks: ['Ranged_Magic_Shoot'], upright: true };
const BOW: WeaponAnims = { idle: 'Ranged_Bow_Idle', run: 'Running_HoldingBow', attacks: ['Ranged_Bow_Release'], upright: false };

/** Medium rig, by weapon type (FORMS index). */
const MEDIUM: Record<number, WeaponAnims> = {
  0: ONE_HAND,
  1: { ...ONE_HAND, attacks: ['Melee_1H_Attack_Chop', 'Melee_1H_Attack_Slice_Diagonal'] },
  2: TWO_HAND,
  3: TWO_HAND,
  4: { ...ONE_HAND, attacks: ['Melee_1H_Attack_Stab', 'Melee_1H_Attack_Slice_Diagonal'] },
  5: { idle: 'Ranged_1H_Aiming', run: 'Running_A', attacks: ['Ranged_1H_Shoot'], upright: false },
  6: BOW,
  7: BOW,
  8: MAGIC,
  9: MAGIC,
  10: { ...ONE_HAND, attacks: ['Melee_1H_Attack_Slice_Horizontal', 'Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Stab'] },
  11: { idle: 'Idle_A', run: 'Running_A', attacks: ['Melee_Dualwield_Attack_Slice', 'Melee_Dualwield_Attack_Stab'], upright: false },
  12: MAGIC,
  13: { idle: 'Ranged_2H_Aiming', run: 'Running_HoldingRifle', attacks: ['Ranged_2H_Shoot'], upright: false },
  14: ONE_HAND,
};

/** Large rig (the Warlord). */
const LARGE: Record<number, WeaponAnims> = {
  15: { idle: 'Melee_2H_Idle', run: 'Running_A', attacks: ['Melee_2H_Attack', 'Melee_2H_Slam'], upright: false },
  16: { idle: 'Melee_2H_Idle', run: 'Running_A', attacks: ['Melee_1H_Stab', 'Melee_2H_Attack'], upright: false },
};

export function weaponAnims(skin: string, form: number): WeaponAnims {
  const large = skinDef(skin).rig === 'large';
  return (large ? LARGE[form] ?? LARGE[15] : MEDIUM[form]) ?? ONE_HAND;
}

/**
 * Each hero's signature idle on the Heroes screen (a livelier showcase than the calm battle
 * idle): by hero, then by weapon type; anything not listed uses the battle idle.
 */
const SHOWCASE: Record<string, Record<number, string>> = {
  knight: { 0: 'Melee_Blocking' },                      // sword up on guard (greatsword: the 2H stance)
  barbarian: { 1: 'Melee_2H_Idle' },                    // axe across the body, like the greataxe
  rogue: { 4: 'Melee_Blocking', 5: 'Ranged_1H_Reload' }, // dagger on guard; cranking the crossbow
  mage: { 8: 'Ranged_Magic_Spellcasting', 9: 'Ranged_Magic_Spellcasting' },
  rogue_hooded: { 11: 'Crouching' },                     // claws low and ready (the long katana is held upright)
};

/** The Heroes-screen idle for a hero holding a weapon type. */
export function showcaseIdle(skin: string, form: number): string {
  return SHOWCASE[skin]?.[form] ?? weaponAnims(skin, form).idle;
}

/** Hold the weapon upright on the Heroes screen? Only in the arms-down standing idles. */
export function showcaseUpright(skin: string, form: number): boolean {
  return weaponAnims(skin, form).upright && /^Idle_/.test(showcaseIdle(skin, form));
}

/** Model files hero `skin` needs for its animations. */
export function heroAnimFiles(skin: string): string[] {
  return skinDef(skin).rig === 'large' ? ['hero_anims_large'] : ['hero_anims'];
}

export async function loadHeroAnims(skin: string): Promise<HeroAnims> {
  return { anims: await loadModel(heroAnimFiles(skin)[0]) };
}

/**
 * Idles that are really a move into a pose (raising a gun to aim): looped, they snap back to the
 * start every cycle, so they play once and hold the final pose.
 */
export function holdsPose(clip: string): boolean {
  return /_Aiming$/.test(clip);
}

/** A clip by name from a hero's animations (falls back to the idle). */
export function heroClip(anims: GLTF, name: string): THREE.AnimationClip | null {
  return findClip(anims, [name]) ?? findClip(anims, ['Idle_A']);
}

/**
 * Where to start an attack clip and how fast to play it: the sim lands the hit the moment the
 * attack starts, so skip most of the wind-up and reach the strike quickly.
 */
export function attackPlayback(clip: THREE.AnimationClip, ranged: boolean): { from: number; speed: number } {
  const d = clip.duration;
  return ranged ? { from: d * 0.15, speed: Math.max(1.4, d * 1.6) } : { from: d * 0.25, speed: Math.max(1.3, d * 2.0) };
}

/** Weapons in a giant's hands are made chunkier to match. */
export function heroWeaponScale(skin: string): number {
  return skinDef(skin).rig === 'large' ? 1.35 : 1;
}

/** Hero size relative to the others (the Warlord towers over them). */
export function heroScale(skin: string): number {
  return skinDef(skin).scale ?? 1;
}
