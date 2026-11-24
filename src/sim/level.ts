import { enemyGold } from './balance';
import type { Reward } from './missions';
import type { Rarity } from './weapons';

/**
 * Hero level: XP from every kill, levels 1–100. Levels persist through Reforge (they're the
 * account-wide progression), give a small permanent stat bonus, and every 5th level unlocks a
 * Level Road reward that scales with how far the player has pushed.
 */

export const MAX_LEVEL = 100;
export const MILESTONE_STEP = 5;
export const MILESTONES: readonly number[] = Array.from({ length: MAX_LEVEL / MILESTONE_STEP }, (_, i) => (i + 1) * MILESTONE_STEP);

/** XP needed to go from `level` to `level + 1`. Early levels take minutes, the last ones days. */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return Infinity;
  return Math.round(20 * Math.pow(level, 1.9));
}

/** Total XP from level 1 to `level` (for tests and tuning). */
export function totalXpTo(level: number): number {
  let t = 0;
  for (let l = 1; l < level; l++) t += xpToNext(l);
  return t;
}

/**
 * XP for one kill, by zone difficulty (stage units): about ×1.36 per zone, so the furthest zone
 * you can handle is always the fastest place to level. Bosses give 20×.
 */
export function xpForKill(stage: number, boss: boolean): number {
  const base = Math.ceil(6 * Math.pow(1.08, stage - 1));
  return boss ? base * 20 : base;
}

/** Permanent bonuses from the hero's level. */
export function levelBonus(level: number): { atk: number; hp: number; gold: number } {
  const l = Math.max(0, Math.min(MAX_LEVEL, level) - 1);
  return { atk: 1 + 0.03 * l, hp: 1 + 0.03 * l, gold: 1 + 0.01 * l };
}

/** Badge colour tier: bronze → silver → gold → ruby → diamond (level 100). */
export function levelTier(level: number): { name: string; color: number; css: string } {
  if (level >= 100) return { name: 'Diamond', color: 0x8ff3ff, css: '#8ff3ff' };
  if (level >= 75) return { name: 'Ruby', color: 0xff6b8a, css: '#ff6b8a' };
  if (level >= 50) return { name: 'Gold', color: 0xffd23f, css: '#ffd23f' };
  if (level >= 25) return { name: 'Silver', color: 0xdfe8f2, css: '#dfe8f2' };
  return { name: 'Bronze', color: 0xf0b07a, css: '#f0b07a' };
}

export interface MilestoneReward extends Reward {
  /** A bonus weapon: forged at the current forge level with at least `rarity`. */
  weapon?: { rarity: Rarity };
}

/**
 * The reward for milestone `level` (5, 10, … 100), sized to the player's progress when claimed:
 * gold and shards scale with the furthest zone reached (in stage units), so a reward is never trivial or absurd.
 *  - every milestone: gold (worth ~a few minutes of farming) + shards for the forge
 *  - every 10 levels: gems for the shop
 *  - every 20 levels: a bonus weapon (better rarity the higher you go)
 *  - every 25 levels: embers (Reforge currency)
 *  - level 100: a legendary weapon and a big gem/ember haul
 */
export function milestoneReward(level: number, bestStage: number): MilestoneReward {
  const stage = Math.max(1, bestStage);
  const shardPer = 1 + Math.floor(stage / 12);
  const r: MilestoneReward = {
    gold: Math.round(enemyGold(stage) * (30 + 3 * level)),
    shards: Math.round(shardPer * (10 + level / 2)),
  };
  if (level % 10 === 0) r.gems = 20 + level;
  if (level % 25 === 0) r.embers = level === 100 ? 25 : level / 5;
  if (level % 20 === 0) {
    // Rare, Epic from 60, Legendary at 100.
    const rarity: Rarity = level >= 100 ? 4 : level >= 60 ? 3 : 2;
    r.weapon = { rarity };
  }
  if (level === 100) r.gems = 500;
  return r;
}

