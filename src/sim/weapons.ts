import type { Rng } from '../core/rng';
import { fmt } from '../core/format';

/**
 * Weapons: forged from shards, one equipped at a time. Rarity is the whole ladder: three of
 * the same type and rarity merge into one of the next rarity (Common → Uncommon → … → Divine).
 * Rarity sets the attack multiplier and how many bonus traits a weapon carries; form (type)
 * changes how the hero swings. The forge's level makes rarer forges likelier and adds attack
 * to whatever is wielded.
 */

export const INVENTORY_SIZE = 20;      // starting slots
export const INVENTORY_STEP = 5;       // slots added per expansion (one grid row)
export const MAX_INVENTORY = 60;
/** Gold to grow the inventory from `size` slots by one row: 1.5K, 4.5K, 13.5K, … */
export function inventoryExpandCost(size: number): number {
  return Math.round(1500 * Math.pow(3, Math.max(0, size - INVENTORY_SIZE) / INVENTORY_STEP));
}
/** Shards per forge at the base forge level (see forgeCost: it grows as the forge levels up). */
export const FORGE_COST = 100;
export const MAX_FORGE_LEVEL = 25;
/**
 * Weapons consumed per merge, by the rarity being merged: this many of the same type and rarity
 * make one of the next. Rises at the top so the best weapons take a real grind: a Divine is worth
 * 3·3·4·4·5·5 = 3,600 Commons.
 */
export const MERGE_COUNTS = [3, 3, 4, 4, 5, 5] as const;
export function mergeCount(rarity: number): number {
  return MERGE_COUNTS[Math.max(0, Math.min(MERGE_COUNTS.length - 1, rarity))];
}

export type Rarity = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const MAX_RARITY: Rarity = 6;
export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Divine'] as const;
export const RARITY_COLORS = ['#c8ccd8', '#5ad83a', '#4fa8ff', '#b06cff', '#ffb52e', '#ff4a6a', '#7af0ff'] as const;
/** Attack multiplier per rarity: each merge (three weapons into one) roughly doubles it. */
const RARITY_MULT = [1, 1.9, 3.6, 6.8, 13, 25, 48];

/** Weapon type: an index into FORMS. Each hero class wields its own types (see skins.ts). */
export type Form = number;
/** How a ranged weapon's projectile flies: speed (units/s), extra enemies it passes through, splash radius. */
export interface RangedDef { speed: number; pierce: number; splash: number; kind: 'arrow' | 'bolt' | 'magic' }
export interface FormDef {
  name: string; range: number; arc: number; speed: number; dmg: number; knockback: number; blurb: string;
  ranged?: RangedDef;
}
export const FORMS: readonly FormDef[] = [
  /* 0 */ { name: 'Sword',    range: 22, arc: 1.25, speed: 1.0,  dmg: 1.0,  knockback: 1.0, blurb: 'Balanced' },
  /* 1 */ { name: 'Axe',      range: 21, arc: 1.65, speed: 0.9,  dmg: 1.1,  knockback: 1.1, blurb: 'Wide sweeps' },
  /* 2 */ { name: 'Greataxe', range: 25, arc: 1.95, speed: 0.7,  dmg: 1.45, knockback: 1.6, blurb: 'Huge, slow sweeps' },
  /* 3 */ { name: 'Greatsword', range: 28, arc: 1.45, speed: 0.78, dmg: 1.35, knockback: 1.5, blurb: 'Long reach, heavy sweeps' },
  /* 4 */ { name: 'Dagger',   range: 17, arc: 0.9,  speed: 1.45, dmg: 0.72, knockback: 0.5, blurb: 'Very fast, close in' },
  /* 5 */ { name: 'Crossbow', range: 80, arc: 0.3,  speed: 0.7,  dmg: 1.15, knockback: 0.9, blurb: 'Ranged, heavy bolts',
            ranged: { speed: 330, pierce: 0, splash: 0, kind: 'bolt' } },
  /* 6 */ { name: 'Bow',      range: 95, arc: 0.3,  speed: 1.1,  dmg: 0.66, knockback: 0.5, blurb: 'Ranged, quick arrows',
            ranged: { speed: 300, pierce: 0, splash: 0, kind: 'arrow' } },
  /* 7 */ { name: 'Longbow',  range: 120, arc: 0.3, speed: 0.75, dmg: 1.0,  knockback: 0.8, blurb: 'Ranged, arrows pierce',
            ranged: { speed: 380, pierce: 1, splash: 0, kind: 'arrow' } },
  /* 8 */ { name: 'Staff',    range: 85, arc: 0.3,  speed: 0.75, dmg: 0.95, knockback: 1.0, blurb: 'Ranged, exploding orbs',
            ranged: { speed: 210, pierce: 0, splash: 22, kind: 'magic' } },
  /* 9 */ { name: 'Wand',     range: 80, arc: 0.3,  speed: 1.25, dmg: 0.64, knockback: 0.4, blurb: 'Ranged, rapid sparks',
            ranged: { speed: 260, pierce: 0, splash: 0, kind: 'magic' } },
];

/** Material per rarity, for weapon names ("Runed Axe"). */
const MATERIALS = ['Iron', 'Steel', 'Silver', 'Runed', 'Mythril', 'Starforged', 'Celestial'];

export type TraitId = 'crit' | 'critDmg' | 'speed' | 'lifesteal' | 'gold' | 'shock' | 'reach';
export const TRAIT_IDS: readonly TraitId[] = ['crit', 'critDmg', 'speed', 'lifesteal', 'gold', 'shock', 'reach'];

interface TraitDef { name: string; base: number; cap: number; show: (v: number) => string }
const pctStr = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
export const TRAITS: Record<TraitId, TraitDef> = {
  crit:      { name: 'Crit chance',   base: 0.03, cap: 0.15, show: (v) => `+${pctStr(v)} crit chance` },
  critDmg:   { name: 'Crit damage',   base: 0.25, cap: 2.0,  show: (v) => `+${pctStr(v)} crit damage` },
  speed:     { name: 'Swing speed',   base: 0.06, cap: 0.3,  show: (v) => `+${pctStr(v)} swing speed` },
  lifesteal: { name: 'Lifesteal',     base: 0.03, cap: 0.12, show: (v) => `${pctStr(v)} lifesteal` },
  gold:      { name: 'Gold find',     base: 0.10, cap: 1.0,  show: (v) => `+${pctStr(v)} gold` },
  shock:     { name: 'Chain shock',   base: 0.05, cap: 0.25, show: (v) => `${pctStr(v)} chance to chain shock` },
  reach:     { name: 'Reach',         base: 0.08, cap: 0.4,  show: (v) => `+${pctStr(v)} reach` },
};

export interface Trait { t: TraitId; v: number }

export interface Weapon {
  id: number;
  rarity: Rarity;
  form: Form;
  traits: Trait[];
}

/** Attack multiplier from rarity (form damage is applied separately). */
export function weaponMult(w: Pick<Weapon, 'rarity'>): number {
  return RARITY_MULT[w.rarity] ?? RARITY_MULT[MAX_RARITY];
}

/** Shards to forge one weapon at `level`: better forges make better weapons for more shards. */
export function forgeCost(level: number): number {
  return Math.round(FORGE_COST * Math.pow(1.6, Math.max(0, level - 1)));
}

/**
 * Highest forge level reachable this run: one level per terrain reached on the world map
 * (Meadow → 1, Mirewood → 2, …), given the furthest unlocked zone. Keeps the forge from
 * outrunning the monsters it's meant to help with.
 */
export function forgeLevelCap(maxZone: number): number {
  return Math.min(MAX_FORGE_LEVEL, 1 + Math.floor(Math.max(0, maxZone) / 3));
}

export function weaponName(w: Weapon): string {
  return `${MATERIALS[w.rarity] ?? MATERIALS[MATERIALS.length - 1]} ${(FORMS[w.form] ?? FORMS[0]).name}`;
}

export function weaponSummary(w: Weapon): string {
  const f = FORMS[w.form] ?? FORMS[0];
  return `ATK x${fmt(weaponMult(w) * f.dmg)} · ${f.blurb}`;
}

/** Trait strength grows with rarity. */
const traitScale = (rarity: number) => 1 + 0.25 * rarity;

function rollTrait(rng: Rng, rarity: number, exclude: readonly Trait[]): Trait {
  const pool = TRAIT_IDS.filter((id) => !exclude.some((x) => x.t === id));
  const t = pool[rng.int(pool.length)];
  const d = TRAITS[t];
  return { t, v: Math.min(d.cap, d.base * rng.range(0.8, 1.2) * traitScale(rarity)) };
}

/** One bonus trait per rarity step (Common none, Uncommon one, … Divine six). */
function fillTraits(rng: Rng, w: Weapon): void {
  while (w.traits.length < Math.min(w.rarity, TRAIT_IDS.length)) w.traits.push(rollTrait(rng, w.rarity, w.traits));
}

/**
 * Chance a forge comes out Uncommon, Rare, Epic or Legendary (the rest are Common); better
 * with forge level. Kept low on purpose: good weapons are mostly merged up, a long grind
 * (an active player's first Rare ~15 min, Epic ~1 h, Legendary ~3.5-4 h). Mythic and Divine only
 * come from merging.
 */
export function forgeOdds(level: number): [number, number, number, number] {
  return [
    Math.min(0.25, 0.08 + 0.008 * level),
    Math.min(0.06, 0.008 + 0.002 * level),
    Math.min(0.01, 0.0004 + 0.0003 * level),
    Math.min(0.002, 0.00002 * level),
  ];
}

/** Forge mastery: every forge level past 1 adds this much weapon attack (to whatever you wield). */
export const FORGE_ATK_PER_LEVEL = 0.12;
export const forgeAtkBonus = (level: number) => 1 + FORGE_ATK_PER_LEVEL * Math.max(0, level - 1);

export function forgeUpgradeCost(level: number): number {
  return 400 * Math.pow(4, level - 1);
}

/** Forge one weapon of one of `forms` (the current hero's weapon types). */
export function forgeWeapon(rng: Rng, id: number, level: number, forms: readonly Form[] = [0]): Weapon {
  const [pu, pr, pe, pl] = forgeOdds(level);
  const r = rng.next();
  const rarity: Rarity = r < pl ? 4 : r < pl + pe ? 3 : r < pl + pe + pr ? 2 : r < pl + pe + pr + pu ? 1 : 0;
  const w: Weapon = { id, rarity, form: forms[rng.int(forms.length)] ?? 0, traits: [] };
  fillTraits(rng, w);
  return w;
}

/** A forged weapon with a guaranteed minimum rarity (Level Road rewards). */
export function bonusWeapon(rng: Rng, id: number, level: number, minRarity: Rarity, forms: readonly Form[] = [0]): Weapon {
  const w = forgeWeapon(rng, id, level, forms);
  if (w.rarity < minRarity) { w.rarity = minRarity; fillTraits(rng, w); }
  return w;
}

/**
 * Can `a` and `b` go into the same merge? They must match in type (form) and rarity:
 * mergeCount(rarity) matching weapons (e.g. three Common Swords) make one of the next rarity.
 */
export function canMerge(a: Weapon, b: Weapon): boolean {
  return a.id !== b.id && a.form === b.form && a.rarity === b.rarity && a.rarity < MAX_RARITY;
}

/** What merging `w` gives (before the new trait is rolled): next rarity, traits rescaled. */
export function mergePreview(w: Weapon): Weapon {
  const rarity = Math.min(MAX_RARITY, w.rarity + 1) as Rarity;
  const k = traitScale(rarity) / traitScale(w.rarity);
  return { ...w, rarity, traits: w.traits.map((tr) => ({ t: tr.t, v: Math.min(TRAITS[tr.t].cap, tr.v * k) })) };
}

/**
 * Inventory order: by type (each class's weapons together), then best rarity, empty slots last.
 * Identical weapons end up side by side, which makes merges easy to spot.
 */
export function compareWeapons(a: Weapon, b: Weapon): number {
  return a.form - b.form || b.rarity - a.rarity || a.id - b.id;
}

/** Inventory slots holding weapons that can merge with `w` (which may be the equipped one). */
export function matchingSlots(inv: readonly (Weapon | null)[], w: Weapon | null): number[] {
  const out: number[] = [];
  if (w) inv.forEach((o, i) => { if (o && canMerge(w, o)) out.push(i); });
  return out;
}

/** Inventory slots holding weapons that can merge with the one in `slot` (excluding it). */
export function mergePartners(inv: readonly (Weapon | null)[], slot: number): number[] {
  const w = inv[slot];
  if (!w) return [];
  const out: number[] = [];
  inv.forEach((o, i) => { if (o && i !== slot && canMerge(w, o)) out.push(i); });
  return out;
}

/**
 * Merge `keep` with matching weapons (`others`, mergeCount - 1 of them) into one of the next
 * rarity. `keep` (the weapon the player chose) passes on its traits, strengthened for the new
 * rarity, and gains one fresh trait.
 */
export function mergeWeapons(rng: Rng, id: number, keep: Weapon, others: readonly Weapon[]): Weapon {
  if (others.length !== mergeCount(keep.rarity) - 1 || others.some((o) => !canMerge(keep, o))) throw new Error('invalid merge');
  const w: Weapon = { ...mergePreview(keep), id };
  fillTraits(rng, w);
  return w;
}

/**
 * Shards back from melting a weapon: a quarter of a forge at the current forge level, doubling
 * per rarity. Making a weapon of a rarity costs about 3^rarity forges, so forging just to
 * salvage never pays.
 */
export function salvageValue(w: Weapon, forgeLevel = 1): number {
  return Math.max(1, Math.round(0.25 * forgeCost(forgeLevel) * Math.pow(2, w.rarity)));
}

export function starterWeapon(form: Form = 0, id = 1): Weapon {
  return { id, rarity: 0, form, traits: [] };
}

/**
 * Pre-rarity-ladder saves stored a tier (1-30) and four rarities. Map them onto the ladder:
 * old Rare/Epic/Legendary become Rare/Epic/Legendary, and every 5 tiers above 1 adds a step.
 */
export function upgradeOldWeapon(w: Weapon & { tier?: number }): Weapon {
  if (w.tier === undefined) return w;
  const old = Math.max(0, Math.min(3, w.rarity));
  const base = old === 0 ? 0 : old + 1;
  const rarity = Math.min(MAX_RARITY, base + Math.floor(Math.max(0, w.tier - 1) / 5)) as Rarity;
  const { tier: _t, ...rest } = w;
  void _t;
  const traits = rest.traits.slice(0, rarity);
  return { ...rest, rarity, traits };
}

/** Rough "power" for comparing weapons (used for the better-than-equipped marker). */
export function weaponPower(w: Weapon): number {
  const f = FORMS[w.form] ?? FORMS[0];
  let p = weaponMult(w) * f.dmg * f.speed;
  for (const tr of w.traits) {
    if (tr.t === 'crit') p *= 1 + tr.v * 1.5;
    else if (tr.t === 'critDmg') p *= 1 + tr.v * 0.15;
    else if (tr.t === 'speed') p *= 1 + tr.v;
    else if (tr.t === 'shock') p *= 1 + tr.v * 1.2;
    else p *= 1.03;
  }
  return p;
}

/** Totals from the equipped weapon, already capped. */
export interface WeaponStats {
  mult: number; form: FormDef;
  crit: number; critDmg: number; speed: number; lifesteal: number; gold: number; shock: number; reach: number;
}

export function weaponStats(w: Weapon | null): WeaponStats {
  const s: WeaponStats = {
    mult: w ? weaponMult(w) : 1, form: FORMS[w?.form ?? 0] ?? FORMS[0],
    crit: 0, critDmg: 0, speed: 0, lifesteal: 0, gold: 0, shock: 0, reach: 0,
  };
  if (w) for (const tr of w.traits) s[tr.t] += tr.v;
  return s;
}
