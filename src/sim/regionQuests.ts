import { areaFor } from './areas';
import { enemyGold } from './balance';
import { BIOMES, REGION_MONSTERS, regionRaster, zoneBiome } from './forest';
import { EXPLORE_CELL, type Explored } from './explore';
import type { Reward } from './missions';
import { PLAYABLE_ZONES, zoneBossName, zoneLevel, zoneStage } from './zones';

/**
 * Region quests (the Quest Book): every region of the Greenwood has its own quest ladder that
 * never rerolls: hunt each of its two monsters, slay its elites, defeat its boss and explore it.
 * Each quest has three tiers; every tier claimed earns a star (and gold and shards). Stars add up
 * to region milestones: gems, and on mastering a region (every star) a permanent damage and gold
 * bonus. Progress is lifetime (kept through Reforge), so outgrown regions are worth revisiting.
 * Pure data and functions; the sim records kills and the UI reads from here.
 */

/** Lifetime progress in one region (zone). */
export interface RegionProgress {
  /** Kills of each of the region's two monsters (in REGION_MONSTERS order). */
  hunt: number[];
  elites: number;
  bosses: number;
  /** Tiers claimed per quest (index into regionQuests). */
  claimed: number[];
  /** Milestones claimed (0..MILESTONES.length). */
  milestones: number;
}

export type RegionQuestKind = 'hunt' | 'elites' | 'boss' | 'explore';
export interface RegionQuest {
  kind: RegionQuestKind;
  /** For 'hunt': which of the region's monsters (0-1). */
  slot: number;
  name: string;
  /** Goal text with {n} for the tier's target. */
  verb: string;
  tiers: readonly number[];
  /** Shown as a percentage ('explore'). */
  pct?: boolean;
}

const HUNT_TIERS = [50, 300, 1500];
const ELITE_TIERS = [3, 15, 40];
/** Elites are rarer in the first region. */
const FIRST_ELITE_TIERS = [2, 8, 20];
const BOSS_TIERS = [1, 5, 15];
/** Percent of the region's land seen. Not 100: rocks and ponds hide a few corners. */
const EXPLORE_TIERS = [40, 70, 85];

export const QUESTS_PER_REGION = 5;
export const STARS_PER_REGION = QUESTS_PER_REGION * 3;

const questCache = new Map<number, RegionQuest[]>();

/** The quest ladder of a zone's region. */
export function regionQuests(zone: number): RegionQuest[] {
  let qs = questCache.get(zone);
  if (!qs) questCache.set(zone, (qs = buildQuests(zone)));
  return qs;
}

function buildQuests(zone: number): RegionQuest[] {
  const mons = REGION_MONSTERS[zoneBiome(zone)];
  const hunts: RegionQuest[] = mons.map(([area, slot], i) => {
    const name = areaFor(area).def.monsters[slot].name;
    return { kind: 'hunt', slot: i, name: `${name} Hunter`, verb: `Defeat {n} ${plural(name)}`, tiers: HUNT_TIERS };
  });
  return [
    ...hunts,
    { kind: 'elites', slot: 0, name: 'Elite Slayer', verb: 'Defeat {n} elites here', tiers: zone === 0 ? FIRST_ELITE_TIERS : ELITE_TIERS },
    { kind: 'boss', slot: 0, name: 'Lair Breaker', verb: `Defeat ${zoneBossName(zone)} {n}×`, tiers: BOSS_TIERS },
    { kind: 'explore', slot: 0, name: 'Pathfinder', verb: 'Explore {n}% of the region', tiers: EXPLORE_TIERS, pct: true },
  ];
}

function plural(name: string): string {
  if (/(s|x|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

export function questGoal(q: RegionQuest, tier: number): string {
  const n = q.tiers[Math.min(tier, q.tiers.length - 1)];
  const text = q.verb.replace('{n}', String(n));
  return n === 1 ? text.replace(' 1×', '').replace('1 elites', '1 elite') : text;
}

export function freshRegion(): RegionProgress {
  return { hunt: [0, 0], elites: 0, bosses: 0, claimed: new Array(QUESTS_PER_REGION).fill(0), milestones: 0 };
}

export function freshRegions(): RegionProgress[] {
  return Array.from({ length: PLAYABLE_ZONES }, freshRegion);
}

/** Each region's three monsters before v10 (when monsters were shared between regions), by biome. */
const OLD_REGION_MONSTERS: [number, number][][] = [
  [[0, 0], [0, 1], [0, 2]], [[2, 2], [2, 1], [2, 0]], [[1, 0], [1, 2], [1, 1]], [[4, 2], [0, 0], [1, 2]], [[5, 0], [5, 2], [2, 1]],
  [[4, 0], [4, 1], [4, 2]], [[5, 1], [3, 2], [0, 2]], [[3, 1], [3, 0], [5, 2]], [[1, 1], [4, 1], [1, 0]],
];

/**
 * v9 → v10: regions went from three shared monsters (six quests) to two of their own (five).
 * A hunt carries over (kills and stars) where its monster still lives in that region; the
 * elites, boss and explore quests move up to their new places.
 */
export function regionsFromV9(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((r: Partial<RegionProgress> | null, zone) => {
    const b = zoneBiome(zone);
    if (!r || typeof r !== 'object' || b < 0) return r;
    const hunt = [0, 0], claimed = [0, 0, 0, 0, 0];
    OLD_REGION_MONSTERS[b].forEach(([a, s], i) => {
      const j = REGION_MONSTERS[b].findIndex(([na, ns]) => na === a && ns === s);
      if (j < 0) return;
      hunt[j] = r.hunt?.[i] ?? 0;
      claimed[j] = r.claimed?.[i] ?? 0;
    });
    for (let q = 0; q < 3; q++) claimed[2 + q] = r.claimed?.[3 + q] ?? 0;
    return { ...r, hunt, claimed };
  });
}

/** Repair saved region progress (missing, short or corrupt entries). */
export function cleanRegions(raw: unknown): RegionProgress[] {
  const arr = Array.isArray(raw) ? raw : [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  return freshRegions().map((fresh, z) => {
    const r = (arr[z] ?? {}) as Partial<RegionProgress>;
    return {
      hunt: fresh.hunt.map((_, i) => num(r.hunt?.[i])),
      elites: num(r.elites),
      bosses: num(r.bosses),
      claimed: fresh.claimed.map((_, i) => Math.min(3, num(r.claimed?.[i]))),
      milestones: Math.min(MILESTONES.length, num(r.milestones)),
    };
  });
}

/** Which of a region's monsters (0-1) an enemy is, or -1. */
export function huntSlot(zone: number, area: number, monster: number): number {
  const b = zoneBiome(zone);
  if (b < 0) return -1;
  return REGION_MONSTERS[b].findIndex(([a, s]) => a === area && s === monster);
}

// --- Exploration per region -------------------------------------------------------

let cellsFor = '';
let zoneCells: number[][] = [];

/** Explore cells (by index) inside each zone's region, away from its rocky border. */
function regionCells(ex: Explored): number[][] {
  const key = `${ex.cols}x${ex.rows}`;
  if (cellsFor === key) return zoneCells;
  const R = regionRaster();
  zoneCells = Array.from({ length: PLAYABLE_ZONES }, () => []);
  for (let cy = 0; cy < ex.rows; cy++) {
    for (let cx = 0; cx < ex.cols; cx++) {
      const rc = Math.floor(((cx + 0.5) * EXPLORE_CELL) / R.cell), rr = Math.floor(((cy + 0.5) * EXPLORE_CELL) / R.cell);
      if (rc >= R.cols || rr >= R.rows) continue;
      const i = rr * R.cols + rc, b = R.data[i];
      if (b < 0 || R.border[i]) continue;
      const z = BIOMES[b].zone;
      if (z >= 0 && z < PLAYABLE_ZONES) zoneCells[z].push(cy * ex.cols + cx);
    }
  }
  cellsFor = key;
  return zoneCells;
}

/** Percent (0-100, whole) of each zone's region the hero has seen. */
export function explorePercents(ex: Explored | null): number[] {
  if (!ex) return new Array(PLAYABLE_ZONES).fill(0);
  return regionCells(ex).map((cells) => {
    if (!cells.length) return 0;
    let n = 0;
    for (const i of cells) if (ex.has(i % ex.cols, Math.floor(i / ex.cols))) n++;
    return Math.floor((100 * n) / cells.length);
  });
}

// --- Progress, rewards and milestones ---------------------------------------------

export function questValue(q: RegionQuest, r: RegionProgress, explorePct: number): number {
  switch (q.kind) {
    case 'hunt': return r.hunt[q.slot] ?? 0;
    case 'elites': return r.elites;
    case 'boss': return r.bosses;
    case 'explore': return explorePct;
  }
}

/** Reward for claiming tier `tier` (0-2) of a quest in `zone`. */
export function tierReward(zone: number, tier: number): Reward {
  const g = enemyGold(zoneStage(zone));
  return {
    gold: Math.round(g * [80, 250, 700][tier]),
    shards: Math.round([20, 60, 150][tier] * (1 + zone * 0.4)),
    gems: tier === 2 ? 5 : 0,
  };
}

export interface Milestone {
  stars: number;
  reward: Reward;
  /** Mastery: a permanent bonus as well. */
  mastery?: boolean;
}

/** Star thresholds for each region's milestones (the last is mastering the region). */
export const MILESTONES: readonly { stars: number; gems: number; mastery?: boolean }[] = [
  { stars: 5, gems: 15 },
  { stars: 10, gems: 30 },
  { stars: STARS_PER_REGION, gems: 60, mastery: true },
];

/** Permanent damage and gold bonus per mastered region. */
export const MASTERY_BONUS = 0.05;

export function milestoneReward(zone: number, i: number): Milestone {
  const m = MILESTONES[i];
  const g = enemyGold(zoneStage(zone));
  return { stars: m.stars, mastery: m.mastery, reward: { gems: m.gems, gold: Math.round(g * 400 * (i + 1)) } };
}

export function regionStars(r: RegionProgress): number {
  return r.claimed.reduce((a, b) => a + b, 0);
}

export function masteredRegions(regions: readonly RegionProgress[]): number {
  const last = MILESTONES.length;
  return regions.filter((r) => r.milestones >= last).length;
}

/** "Reach Lv 14 and defeat the boss before it" for a region not yet open. */
export function regionLockText(zone: number): string {
  return zone === 0 ? '' : `Opens at Lv ${zoneLevel(zone)} after beating the boss before it`;
}

export function regionName(zone: number): string {
  return BIOMES[zoneBiome(zone)]?.name ?? `Region ${zone + 1}`;
}
