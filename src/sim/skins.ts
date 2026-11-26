import type { Form } from './weapons';

/**
 * Heroes: each one is a class with its own weapon types and a class perk. The Knight is free;
 * the rest are bought with gems in the Heroes screen (the Warlord also needs hero level 40). Weapons are class-locked: the forge makes
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
  dmg?: number;       // damage multiplier
  regen?: number;     // extra HP regenerated per second (share of max HP)
  gold?: number;      // added gold find
  shards?: number;    // added shard drops
}

/** A style: model pieces hidden (by mesh name) and, for the Knight, the visor closed. */
export interface LookDef { id: string; name: string; hide?: readonly string[]; visor?: boolean }

export interface SkinDef {
  id: string;
  name: string;
  /** Class title shown under the name. */
  role: string;
  blurb: string;
  /** Gem price (the starting hero, chosen on first launch, is owned without paying). */
  cost: number;
  /** Hero level needed before it can be unlocked (on top of the gems). */
  minLevel?: number;
  /** Weapon types this hero wields (FORMS indexes); the first is the starter weapon. */
  forms: readonly Form[];
  /** The class perk, in words. */
  perk: string;
  mods: ClassMods;
  /** Optional styles (cosmetic); the first is the default. */
  looks?: readonly LookDef[];
  /** Colour schemes: the model's own palette plus public/models/tex/<palette>_A/B/C.png. */
  palette?: string;
  /** Animation rig ('large' for the Warlord) and size relative to the other heroes. */
  rig?: 'medium' | 'large';
  scale?: number;
}

export const SKINS: readonly SkinDef[] = [
  { id: 'knight', name: 'Knight', role: 'Guardian', blurb: 'Plate armour, a crested helm and a red cape.', cost: 250,
    forms: [0, 3], perk: '+40% HP and takes 20% less damage', mods: { hp: 1.4, dmgTaken: 0.8 }, palette: 'knight',
    looks: [{ id: 'open', name: 'Visor up' }, { id: 'visor', name: 'Visor down', visor: true }, { id: 'bare', name: 'No helmet', hide: ['Knight_Helmet', 'Knight_HelmetVisor'] }] },
  { id: 'barbarian', name: 'Barbarian', role: 'Berserker', blurb: 'Bear-skin hat, bare arms, big attitude.', cost: 150,
    forms: [1, 2], perk: 'Rage: up to +60% damage as HP drops · wider swings', mods: { rage: 0.6, arc: 1.2, hp: 1.1 }, palette: 'barbarian',
    looks: [{ id: 'hat', name: 'Bear hat' }, { id: 'nohat', name: 'No hat', hide: ['Barbarian_BearHat'] }] },
  { id: 'rogue', name: 'Rogue', role: 'Duelist', blurb: 'Light leathers for quick work.', cost: 150,
    forms: [4, 5], perk: '+25% attack speed and +10% crit chance', mods: { aspd: 1.25, crit: 0.1 }, palette: 'rogue',
    looks: [{ id: 'cape', name: 'Cape' }, { id: 'nocape', name: 'No cape', hide: ['Rogue_Cape'] }] },
  { id: 'ranger', name: 'Ranger', role: 'Archer', blurb: 'A woodland scout in a green hood.', cost: 250,
    forms: [6, 7], perk: 'Arrows pierce one more enemy · +15% move speed', mods: { pierce: 1, move: 1.15 }, palette: 'ranger',
    looks: [{ id: 'full', name: 'Cape & quiver' }, { id: 'noquiver', name: 'No quiver', hide: ['Ranger_Quiver'] }, { id: 'nocape', name: 'No cape', hide: ['Ranger_Cape'] }] },
  { id: 'mage', name: 'Mage', role: 'Sorcerer', blurb: 'Robes, a tall hat and a head full of lightning.', cost: 250,
    forms: [8, 9], perk: '+15% chain shock chance · shocks jump to 5 enemies', mods: { shock: 0.15, shockJumps: 2 }, palette: 'mage',
    looks: [{ id: 'hat', name: 'Hat' }, { id: 'nohat', name: 'No hat', hide: ['Mage_Hat'] }] },
  { id: 'druid', name: 'Druid', role: 'Warden', blurb: 'A wanderer of the deep woods, never far from home.', cost: 300,
    forms: [12], perk: 'Regenerates 2.5% HP per second · +15% HP', mods: { regen: 0.025, hp: 1.15 }, palette: 'druid',
    looks: [{ id: 'pack', name: 'Backpack' }, { id: 'nopack', name: 'No backpack', hide: ['Druid_Backpack'] }] },
  { id: 'engineer', name: 'Engineer', role: 'Tinkerer', blurb: 'Goggles, a full pack and a fix for everything.', cost: 300,
    forms: [13, 14], perk: '+30% gold and +30% shard drops', mods: { gold: 0.3, shards: 0.3 }, palette: 'engineer',
    looks: [{ id: 'full', name: 'Goggles & pack' }, { id: 'nogoggles', name: 'No goggles', hide: ['Engineer_Goggles'] }, { id: 'nopack', name: 'No backpack', hide: ['Engineer_Backpack'] }] },
  { id: 'rogue_hooded', name: 'Shadow Rogue', role: 'Assassin', blurb: 'The rogue, hooded and masked.', cost: 400,
    forms: [10, 11], perk: 'Ambush: hits on unhurt enemies always crit · +80% crit damage', mods: { ambush: true, critDmg: 0.8 }, palette: 'rogue',
    looks: [{ id: 'mask', name: 'Mask' }, { id: 'nomask', name: 'No mask', hide: ['RogueHooded_Mask'] }] },
  { id: 'barbarian_large', name: 'Warlord', role: 'Giant', blurb: 'A towering barbarian chieftain. Hard to earn.', cost: 2500, minLevel: 40,
    forms: [15, 16], perk: '+80% HP and +40% damage · towers over the battlefield', mods: { hp: 1.8, dmg: 1.4 }, palette: 'barbarian',
    rig: 'large', scale: 1.4,
    looks: [{ id: 'full', name: 'Full gear' }, { id: 'nohat', name: 'No hat', hide: ['Barbarian_Large_BearHat'] },
      { id: 'bare', name: 'Bare', hide: ['Barbarian_Large_BearHat', 'Barbarian_Large_BearPelt', 'Barbarian_Large_ShoulderpadLeft', 'Barbarian_Large_ShoulderpadRight'] }] },
];

export const DEFAULT_SKIN = 'knight';

/** The heroes a new player chooses between on first launch (the rest are unlocked later). */
export const STARTERS: readonly string[] = ['knight', 'ranger', 'mage'];

export function skinDef(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/** The style hero `skin` wears, given the saved choices (falls back to its default). */
export function lookOf(skin: string, looks: Record<string, string>): string {
  const all = skinDef(skin).looks;
  if (!all) return '';
  const want = looks[skin];
  return all.some((l) => l.id === want) ? want : all[0].id;
}

/** Can hero `skin` wield weapon type `form`? */
export function canWield(skin: string, form: Form): boolean {
  return skinDef(skin).forms.includes(form);
}

/** Which heroes can wield weapon type `form` (for labels like "Knight"). */
export function wieldersOf(form: Form): SkinDef[] {
  return SKINS.filter((s) => s.forms.includes(form));
}
