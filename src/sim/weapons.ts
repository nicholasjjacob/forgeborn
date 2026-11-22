import type { Rng } from '../core/rng';
import { fmt } from '../core/format';

/**
 * Weapons: forged from shards, merged two-of-a-tier into the next tier, one equipped at a time.
 * Tier drives the attack multiplier; rarity multiplies it further and sets how many bonus
 * traits the weapon carries; form changes how the hero swings.
 */

export const INVENTORY_SIZE = 20;
export const MAX_TIER = 30;
export const FORGE_COST = 10;          // shards per forge
export const MAX_FORGE_LEVEL = 25;
export const RARITY_UP_CHANCE = 0.06;  // chance a merge bumps rarity

export type Rarity = 0 | 1 | 2 | 3;
export const RARITY_NAMES = ['Common', 'Rare', 'Epic', 'Legendary'] as const;
export const RARITY_COLORS = ['#c8ccd8', '#4fa8ff', '#b06cff', '#ffb52e'] as const;
const RARITY_MULT = [1, 1.25, 1.55, 2.0];

export type Form = 0 | 1 | 2 | 3;
export interface FormDef { name: string; range: number; arc: number; speed: number; dmg: number; knockback: number; blurb: string }
export const FORMS: readonly FormDef[] = [
  { name: 'Sword',  range: 22, arc: 1.25, speed: 1.0,  dmg: 1.0,  knockback: 1.0, blurb: 'Balanced' },
  { name: 'Axe',    range: 21, arc: 1.65, speed: 0.9,  dmg: 1.1,  knockback: 1.1, blurb: 'Wide sweeps' },
  { name: 'Spear',  range: 32, arc: 0.6,  speed: 1.05, dmg: 0.95, knockback: 0.8, blurb: 'Long reach, narrow' },
  { name: 'Hammer', range: 20, arc: 1.25, speed: 0.75, dmg: 1.5,  knockback: 2.2, blurb: 'Slow, heavy hits' },
];

const TIER_NAMES = ['Rusty', 'Iron', 'Steel', 'Silver', 'Runed', 'Mythril', 'Starforged', 'Voidsteel', 'Celestial'];

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
  tier: number;
  rarity: Rarity;
  form: Form;
  traits: Trait[];
}

/** Attack multiplier from tier and rarity (form damage is applied separately). */
export function weaponMult(w: Pick<Weapon, 'tier' | 'rarity'>): number {
  const t = w.tier - 1;
  return (1 + 0.2 * t) * Math.pow(1.22, t) * RARITY_MULT[w.rarity];
}

export function weaponName(w: Weapon): string {
  const prefix = w.tier <= TIER_NAMES.length ? TIER_NAMES[w.tier - 1] : `Ascended ${w.tier - TIER_NAMES.length}`;
  return `${prefix} ${FORMS[w.form].name}`;
}

export function weaponSummary(w: Weapon): string {
  return `ATK x${fmt(weaponMult(w) * FORMS[w.form].dmg)} · ${FORMS[w.form].blurb}`;
}

const traitScale = (tier: number) => 1 + 0.12 * (tier - 1);

function rollTrait(rng: Rng, tier: number, exclude: readonly Trait[]): Trait {
  const pool = TRAIT_IDS.filter((id) => !exclude.some((x) => x.t === id));
  const t = pool[rng.int(pool.length)];
  const d = TRAITS[t];
  return { t, v: Math.min(d.cap, d.base * rng.range(0.8, 1.2) * traitScale(tier)) };
}

function fillTraits(rng: Rng, w: Weapon): void {
  while (w.traits.length < w.rarity) w.traits.push(rollTrait(rng, w.tier, w.traits));
}

/** Rarity odds improve with forge level. Returns [rare, epic, legendary] probabilities. */
export function forgeOdds(level: number): [number, number, number] {
  return [Math.min(0.4, 0.15 + 0.02 * level), Math.min(0.2, 0.03 + 0.012 * level), Math.min(0.06, 0.004 + 0.003 * level)];
}

/** Tier range a forge level produces: mostly `level`, sometimes one lower. */
export function forgeTiers(level: number): [number, number] {
  return [Math.max(1, level - 1), level];
}

export function forgeUpgradeCost(level: number): number {
  return 400 * Math.pow(4, level - 1);
}

export function forgeWeapon(rng: Rng, id: number, level: number): Weapon {
  const [lo, hi] = forgeTiers(level);
  const tier = lo === hi || rng.chance(0.4) ? hi : lo;
  const [pr, pe, pl] = forgeOdds(level);
  const r = rng.next();
  const rarity: Rarity = r < pl ? 3 : r < pl + pe ? 2 : r < pl + pe + pr ? 1 : 0;
  const w: Weapon = { id, tier, rarity, form: rng.int(4) as Form, traits: [] };
  fillTraits(rng, w);
  return w;
}

/** A forged weapon with a guaranteed minimum rarity (Level Road rewards). */
export function bonusWeapon(rng: Rng, id: number, level: number, minRarity: Rarity): Weapon {
  const w = forgeWeapon(rng, id, level);
  if (w.rarity < minRarity) { w.rarity = minRarity; fillTraits(rng, w); }
  return w;
}

export function canMerge(a: Weapon, b: Weapon): boolean {
  return a.id !== b.id && a.tier === b.tier && a.tier < MAX_TIER;
}

/**
 * Merge two same-tier weapons into one of the next tier. The better (higher-rarity) parent
 * keeps its form and trait types, with values rescaled to the new tier; a rarity bump adds a
 * fresh trait. Ties favour `keep` (the weapon the player merged into).
 */
export function mergeWeapons(rng: Rng, id: number, keep: Weapon, other: Weapon): Weapon {
  const base = other.rarity > keep.rarity ? other : keep;
  const tier = keep.tier + 1;
  let rarity = Math.max(keep.rarity, other.rarity) as Rarity;
  if (rarity < 3 && rng.chance(RARITY_UP_CHANCE)) rarity = (rarity + 1) as Rarity;
  const k = traitScale(tier) / traitScale(base.tier);
  const traits = base.traits.map((tr) => ({ t: tr.t, v: Math.min(TRAITS[tr.t].cap, tr.v * k) }));
  const w: Weapon = { id, tier, rarity, form: base.form, traits };
  fillTraits(rng, w);
  return w;
}

export function salvageValue(w: Weapon): number {
  return Math.round(3 * Math.pow(2, w.tier - 1) * (1 + w.rarity));
}

export function starterWeapon(): Weapon {
  return { id: 1, tier: 1, rarity: 0, form: 0, traits: [] };
}

/** Rough "power" for comparing weapons (used for the better-than-equipped marker). */
export function weaponPower(w: Weapon): number {
  let p = weaponMult(w) * FORMS[w.form].dmg * FORMS[w.form].speed;
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
    mult: w ? weaponMult(w) : 1, form: FORMS[w?.form ?? 0],
    crit: 0, critDmg: 0, speed: 0, lifesteal: 0, gold: 0, shock: 0, reach: 0,
  };
  if (w) for (const tr of w.traits) s[tr.t] += tr.v;
  return s;
}
