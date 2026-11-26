import { Explored } from './explore';
import { FOREST_H, FOREST_W } from './forest';
import { explorePercents } from './regionQuests';
import { RARITY_NAMES, forgeLevelCap } from './weapons';
import { PLAYABLE_ZONES, zoneLevel } from './zones';
import type { HeroRun } from './sim';

/**
 * Hero mastery: what it takes to complete a hero (100%). Each hero works through these on their
 * own run; finishing all of them will earn that hero's special mastery skin. The best value ever
 * reached is kept (in SaveData.mastery), so a Reforge or salvaging a weapon never takes it back.
 * Targets follow the playable map, so they grow as new lands open.
 */
export interface MasteryGoal {
  id: string;
  name: string;
  desc: string;
  target: number;
  /** How a value reads ("6 / 9", "45%", "Epic"). */
  show(v: number): string;
  /** The value on a run (`explore` is the percent of the map explored). */
  value(run: HeroRun, explore: number): number;
}

const LEVEL = zoneLevel(PLAYABLE_ZONES);
const FORGE = forgeLevelCap(PLAYABLE_ZONES - 1);
const EXPLORE = 85;
const RARITY = 4; // Legendary

export const MASTERY_GOALS: readonly MasteryGoal[] = [
  {
    id: 'bosses', name: 'Conqueror', desc: `Defeat all ${PLAYABLE_ZONES} region bosses`, target: PLAYABLE_ZONES,
    show: (v) => `${v} / ${PLAYABLE_ZONES}`, value: (r) => Math.min(PLAYABLE_ZONES, r.zoneBosses),
  },
  {
    id: 'explore', name: 'Pathfinder', desc: `Explore ${EXPLORE}% of the map`, target: EXPLORE,
    show: (v) => `${Math.floor(v)}%`, value: (_r, ex) => ex,
  },
  {
    id: 'level', name: 'Veteran', desc: `Reach hero level ${LEVEL}`, target: LEVEL,
    show: (v) => `Lv ${v}`, value: (r) => r.level,
  },
  {
    id: 'forge', name: 'Master Smith', desc: `Raise the forge to level ${FORGE}`, target: FORGE,
    show: (v) => `Lv ${v}`, value: (r) => r.forgeLevel,
  },
  {
    id: 'weapon', name: 'Legend in Hand', desc: `Own a ${RARITY_NAMES[RARITY]} weapon`, target: RARITY,
    show: (v) => RARITY_NAMES[Math.max(0, Math.min(RARITY_NAMES.length - 1, Math.floor(v)))],
    value: (r) => Math.max(r.equipped?.rarity ?? 0, ...r.weapons.map((w) => w?.rarity ?? 0)),
  },
];

/** Percent of the whole map explored on a run (the regions' average). */
export function exploredPercent(fog: string | Explored | null): number {
  const ex = typeof fog === 'string' ? (fog ? new Explored(FOREST_W, FOREST_H, fog) : null) : fog;
  if (!ex) return 0;
  const pct = explorePercents(ex).slice(0, PLAYABLE_ZONES);
  return pct.reduce((a, b) => a + b, 0) / PLAYABLE_ZONES;
}

/** A run's goal values right now. */
export function masteryValues(run: HeroRun, explore: number): number[] {
  return MASTERY_GOALS.map((g) => g.value(run, explore));
}

/** Keep the best of the recorded and current values. Returns true if anything improved. */
export function recordMastery(best: Record<string, number[]>, skin: string, now: number[]): boolean {
  const old = best[skin] ?? [];
  let up = false;
  const next = MASTERY_GOALS.map((_g, i) => {
    const v = Math.max(old[i] ?? 0, now[i] ?? 0);
    if (v > (old[i] ?? 0)) up = true;
    return v;
  });
  if (up) best[skin] = next;
  return up;
}

export interface MasteryState {
  goals: { goal: MasteryGoal; value: number; done: boolean; frac: number }[];
  done: number;
  /** 0-100, each goal counting equally (partial progress included). */
  pct: number;
  complete: boolean;
}

export function masteryState(values: number[]): MasteryState {
  const goals = MASTERY_GOALS.map((goal, i) => {
    const value = values[i] ?? 0;
    const frac = Math.max(0, Math.min(1, value / goal.target));
    return { goal, value, done: frac >= 1, frac };
  });
  const done = goals.filter((g) => g.done).length;
  const pct = Math.floor((goals.reduce((a, g) => a + g.frac, 0) / goals.length) * 100);
  return { goals, done, pct: done === goals.length ? 100 : Math.min(99, pct), complete: done === goals.length };
}

/** Clean a saved mastery record (unknown shape → empty). */
export function cleanMastery(x: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!x || typeof x !== 'object') return out;
  for (const [k, v] of Object.entries(x)) {
    if (Array.isArray(v)) out[k] = MASTERY_GOALS.map((_, i) => (Number.isFinite(v[i]) ? Math.max(0, v[i]) : 0));
  }
  return out;
}
