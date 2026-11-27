import { fmt } from '../core/format';

/**
 * Long-term progression: Reforge (prestige) with ember perks, region quests (regionQuests.ts), and
 * achievements that grant small permanent bonuses. All pure data + functions.
 */

// --- Lifetime stats -----------------------------------------------------------

export type StatKey = 'stages' | 'elites' | 'bosses' | 'forged' | 'merges' | 'gold' | 'reforges' | 'legendaries' | 'quests' | 'play' | 'logins';
export type Stats = Record<StatKey, number>;
export const freshStats = (): Stats => ({
  stages: 0, elites: 0, bosses: 0, forged: 0, merges: 0, gold: 0, reforges: 0, legendaries: 0,
  quests: 0,   // quest tiers (stars) claimed
  play: 0,     // seconds of active play
  logins: 0,   // distinct calendar days played
});

// --- Reforge (prestige) --------------------------------------------------------

/**
 * Reforge opens on reaching the Greenwood's last region (stage 9) while it is the only playable
 * terrain; it moves later again as new terrains arrive.
 */
export const REFORGE_MIN_STAGE = 9;

/** Embers earned by reforging after reaching `runBest` this run. */
/** Ember Glow: every ember ever earned permanently boosts damage and HP (spent or not). */
export const GLOW_DMG = 0.02;
export const GLOW_HP = 0.01;

export function embersFor(runBest: number): number {
  return runBest < REFORGE_MIN_STAGE ? 0 : Math.floor(0.5 * Math.pow(runBest - 3, 1.5));
}

export type PerkId = 'might' | 'vigor' | 'fortune' | 'shards' | 'forgemaster' | 'headstart' | 'swift' | 'offline';
export const PERK_IDS: readonly PerkId[] = ['might', 'vigor', 'fortune', 'shards', 'swift', 'forgemaster', 'headstart', 'offline'];

export interface PerkDef {
  id: PerkId;
  name: string;
  baseCost: number;
  growth: number;
  maxLevel: number;
  icon: string;
  color: string;
  /** Human-readable effect at a level. */
  effect(level: number): string;
}

export const PERKS: Record<PerkId, PerkDef> = {
  might:       { id: 'might', name: 'Ember Might', baseCost: 1, growth: 1.35, maxLevel: Infinity, icon: '⚔', color: '#e4572e', effect: (l) => `+${l * 25}% damage` },
  vigor:       { id: 'vigor', name: 'Ember Vigor', baseCost: 1, growth: 1.35, maxLevel: Infinity, icon: '♥', color: '#4caf50', effect: (l) => `+${l * 25}% max HP` },
  fortune:     { id: 'fortune', name: 'Fortune', baseCost: 2, growth: 1.4, maxLevel: Infinity, icon: '◆', color: '#ffb300', effect: (l) => `+${l * 20}% gold` },
  shards:      { id: 'shards', name: 'Shard Sense', baseCost: 3, growth: 1.5, maxLevel: 20, icon: '✦', color: '#b06cff', effect: (l) => `+${l * 15}% shard drops` },
  swift:       { id: 'swift', name: 'Swiftness', baseCost: 4, growth: 1.6, maxLevel: 10, icon: '»', color: '#29b6f6', effect: (l) => `+${l * 4}% move & attack speed` },
  forgemaster: { id: 'forgemaster', name: 'Forgemaster', baseCost: 5, growth: 2, maxLevel: 10, icon: '⚒', color: '#ff8a3a', effect: (l) => `Start runs at forge level ${1 + l}` },
  headstart:   { id: 'headstart', name: 'Head Start', baseCost: 8, growth: 1.8, maxLevel: 10, icon: '⇥', color: '#5ff0ff', effect: (l) => `Start runs at hero level ${1 + l * 5}` },
  offline:     { id: 'offline', name: 'Night Watch', baseCost: 3, growth: 1.5, maxLevel: 16, icon: '☾', color: '#8aa4ff', effect: (l) => `+${l}h offline earnings cap` },
};

export function perkCost(def: PerkDef, level: number): number {
  return Math.ceil(def.baseCost * Math.pow(def.growth, level));
}

export type Perks = Record<PerkId, number>;
export const freshPerks = (): Perks => ({ might: 0, vigor: 0, fortune: 0, shards: 0, forgemaster: 0, headstart: 0, swift: 0, offline: 0 });

// --- Achievements --------------------------------------------------------------

export const ACH_BONUS_PER_TIER = 0.03; // +3% damage and gold per tier unlocked

export type AchStat = 'kills' | 'bestEver' | 'zones' | StatKey;
export interface AchDef { id: string; name: string; stat: AchStat; tiers: number[]; verb: string }

export const ACHIEVEMENTS: readonly AchDef[] = [
  { id: 'slayer', name: 'Slayer', stat: 'kills', tiers: [100, 1000, 10_000, 100_000, 1_000_000], verb: 'Defeat {n} monsters' },
  { id: 'explorer', name: 'Explorer', stat: 'zones', tiers: [3, 6, 9, 15, 24], verb: 'Unlock {n} zones' },
  { id: 'hunter', name: 'Boss Hunter', stat: 'bosses', tiers: [1, 10, 50, 200, 1000], verb: 'Defeat {n} bosses' },
  { id: 'smith', name: 'Smith', stat: 'forged', tiers: [10, 100, 1000, 5000], verb: 'Forge {n} weapons' },
  { id: 'alchemist', name: 'Alchemist', stat: 'merges', tiers: [5, 50, 500, 2500], verb: 'Merge {n} times' },
  { id: 'tycoon', name: 'Tycoon', stat: 'gold', tiers: [1e4, 1e6, 1e9, 1e12, 1e15], verb: 'Earn {n} gold' },
  { id: 'reborn', name: 'Reborn', stat: 'reforges', tiers: [1, 5, 25, 100], verb: 'Reforge {n} times' },
  { id: 'quester', name: 'Quest Master', stat: 'quests', tiers: [5, 25, 75, 162], verb: 'Earn {n} quest stars' },
  { id: 'legend', name: 'Legend Wielder', stat: 'legendaries', tiers: [1, 10, 50], verb: 'Obtain {n} legendary weapons' },
];

export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
export function achGoal(a: AchDef, tier: number): string {
  const n = a.tiers[tier];
  const text = a.verb.replace('{n}', fmt(n));
  if (n !== 1) return text;
  // Singular forms for the first tiers ("Defeat 1 boss", "Reforge once").
  return text.replace('1 bosses', '1 boss').replace('1 legendary weapons', '1 legendary weapon').replace('1 times', 'once');
}
