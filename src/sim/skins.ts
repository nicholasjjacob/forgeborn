import type { Form } from './weapons';

/**
 * Heroes: each one is a class with its own weapon types and a class perk. The Knight is free;
 * the rest are bought with gems in the Heroes screen. Weapons are class-locked: the forge makes
 * weapons for the hero you're playing, and each hero keeps their own equipped weapon. New heroes
 * are added here (plus a public/models/hero_<id>.glb on the shared rig, see scripts/build-heroes.mjs).
 */

/** Class modifiers. Every field is optional; missing means "no change". */
export interface ClassMods {
  hp?: number;        // max HP multiplier
  dmgTaken?: number;  // damage taken multiplier
  aspd?: number;      // attack speed multiplier
  crit?: number;      // added crit chance
  critDmg?: number;   // added crit damage
  arc?: number;       // swing arc multiplier (melee)
  move?: number;      // move speed multiplier
  pierce?: number;    // extra enemies each projectile passes through
  shock?: number;     // added chain-shock chance
  shockJumps?: number; // extra chain-shock jumps
  rage?: number;      // extra damage at 0 HP, scaling with HP missing
  ambush?: boolean;   // hits on an unhurt enemy always crit
}

export interface SkinDef {
  id: string;
  name: string;
  /** Class title shown under the name. */
  role: string;
  blurb: string;
  /** Gem price; 0 = owned from the start. */
  cost: number;
  /** Weapon types this hero wields (FORMS indexes); the first is the starter weapon. */
  forms: readonly Form[];
  /** The class perk, in words. */
  perk: string;
  mods: ClassMods;
}

export const SKINS: readonly SkinDef[] = [
  { id: 'knight', name: 'Knight', role: 'Guardian', blurb: 'Plate armour, a crested helm and a red cape.', cost: 0,
    forms: [0, 3], perk: '+40% HP and takes 20% less damage', mods: { hp: 1.4, dmgTaken: 0.8 } },
  { id: 'barbarian', name: 'Barbarian', role: 'Berserker', blurb: 'Bear-skin hat, bare arms, big attitude.', cost: 150,
    forms: [1, 2], perk: 'Rage: up to +60% damage as HP drops · wider swings', mods: { rage: 0.6, arc: 1.2, hp: 1.1 } },
  { id: 'rogue', name: 'Rogue', role: 'Duelist', blurb: 'Light leathers for quick work.', cost: 150,
    forms: [4, 5], perk: '+25% attack speed and +10% crit chance', mods: { aspd: 1.25, crit: 0.1 } },
  { id: 'ranger', name: 'Ranger', role: 'Archer', blurb: 'A woodland scout in a green hood.', cost: 250,
    forms: [6, 7], perk: 'Arrows pierce one more enemy · +15% move speed', mods: { pierce: 1, move: 1.15 } },
  { id: 'mage', name: 'Mage', role: 'Sorcerer', blurb: 'Robes, a tall hat and a head full of lightning.', cost: 250,
    forms: [8, 9], perk: '+15% chain shock chance · shocks jump to 5 enemies', mods: { shock: 0.15, shockJumps: 2 } },
  { id: 'rogue_hooded', name: 'Shadow Rogue', role: 'Assassin', blurb: 'The rogue, hooded and masked.', cost: 400,
    forms: [4, 5], perk: 'Ambush: hits on unhurt enemies always crit · +80% crit damage', mods: { ambush: true, critDmg: 0.8 } },
];

export const DEFAULT_SKIN = 'knight';

export function skinDef(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/** Can hero `skin` wield weapon type `form`? */
export function canWield(skin: string, form: Form): boolean {
  return skinDef(skin).forms.includes(form);
}

/** Which heroes can wield weapon type `form` (for labels like "Knight"). */
export function wieldersOf(form: Form): SkinDef[] {
  return SKINS.filter((s) => s.forms.includes(form));
}
