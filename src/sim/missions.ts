import { fmt } from '../core/format';
import { enemyGold } from './balance';
import type { StatKey } from './meta';

/**
 * Engagement loops: daily login calendar, daily and weekly task boards with points chests,
 * a 7-day starter journey, and the monster codex. Pure data + functions over the save; the
 * clock is always passed in, so everything here is deterministic and testable.
 */

export type MStat = StatKey | 'kills';

export interface Reward { gold?: number; shards?: number; gems?: number; embers?: number; xp?: number; wood?: number; stone?: number }

export interface TaskDef { id: string; text: string; stat: MStat; target: number; points: number }

/** One task board period (a day, a week, or the 7-day journey). */
export interface Board {
  key: string;                         // period id, e.g. '2026-11-21' or 'W2026-11-16'
  base: Partial<Record<MStat, number>>; // stat values when the period began
  claimed: string[];                   // task ids already claimed
  points: number;
  chests: number[];                    // milestone indexes already opened
}

export interface MissionSave {
  gems: number;
  attendance: { day: number; last: string | null };
  daily: Board;
  weekly: Board;
  journey: Board;                      // key = start day; ends after JOURNEY_DAYS
  codex: Record<string, number[]>;     // area -> kills per [monster0, monster1, monster2, boss]
  codexClaimed: Record<string, number[]>;
}

export const freshBoard = (): Board => ({ key: '', base: {}, claimed: [], points: 0, chests: [] });
export const freshMissions = (): MissionSave => ({
  gems: 0,
  attendance: { day: 0, last: null },
  daily: freshBoard(),
  weekly: freshBoard(),
  journey: freshBoard(),
  codex: {},
  codexClaimed: {},
});

// --- Calendar helpers (local time) -------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Weeks start on Monday; the key is that Monday's date. */
export function weekKey(d: Date): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return 'W' + dayKey(m);
}
export function daysBetween(a: string, b: string): number {
  const p = (k: string) => { const [y, mo, da] = k.split('-').map(Number); return Date.UTC(y, mo - 1, da); };
  return Math.round((p(b) - p(a)) / 86_400_000);
}
export function msUntilNextDay(now: Date): number {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return t.getTime() - now.getTime();
}
export function msUntilNextWeek(now: Date): number {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  t.setDate(t.getDate() + (7 - ((t.getDay() + 6) % 7)));
  return t.getTime() - now.getTime();
}
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

// --- Content ------------------------------------------------------------------

export const MILESTONES = [20, 40, 60, 80, 100];

export const DAILY_TASKS: TaskDef[] = [
  { id: 'd-login', text: 'Log in', stat: 'logins', target: 1, points: 10 },
  { id: 'd-kills', text: 'Defeat 300 monsters', stat: 'kills', target: 300, points: 15 },
  { id: 'd-elites', text: 'Defeat 5 elites', stat: 'elites', target: 5, points: 15 },
  { id: 'd-boss', text: 'Defeat a boss', stat: 'bosses', target: 1, points: 15 },
  { id: 'd-forge', text: 'Forge 5 weapons', stat: 'forged', target: 5, points: 10 },
  { id: 'd-merge', text: 'Merge weapons 3 times', stat: 'merges', target: 3, points: 10 },
  { id: 'd-quests', text: 'Complete 2 quests', stat: 'quests', target: 2, points: 10 },
  { id: 'd-play', text: 'Play for 10 minutes', stat: 'play', target: 600, points: 15 },
];

export const WEEKLY_TASKS: TaskDef[] = [
  { id: 'w-login', text: 'Log in on 5 days', stat: 'logins', target: 5, points: 20 },
  { id: 'w-kills', text: 'Defeat 3,000 monsters', stat: 'kills', target: 3000, points: 15 },
  { id: 'w-boss', text: 'Defeat 7 bosses', stat: 'bosses', target: 7, points: 15 },
  { id: 'w-elites', text: 'Defeat 40 elites', stat: 'elites', target: 40, points: 15 },
  { id: 'w-forge', text: 'Forge 50 weapons', stat: 'forged', target: 50, points: 10 },
  { id: 'w-merge', text: 'Merge weapons 20 times', stat: 'merges', target: 20, points: 10 },
  { id: 'w-reforge', text: 'Reforge once', stat: 'reforges', target: 1, points: 15 },
];

export const JOURNEY_DAYS = 7;
export const JOURNEY_MILESTONES = [40, 80, 120, 160, 200, 240, 280];
const J = (day: number, i: number, text: string, stat: MStat, target: number): TaskDef =>
  ({ id: `j${day}-${i}`, text, stat, target, points: 10 });
export const JOURNEY_TASKS: TaskDef[][] = [
  [J(1, 0, 'Defeat 100 monsters', 'kills', 100), J(1, 1, 'Defeat 3 elites', 'elites', 3), J(1, 2, 'Forge 3 weapons', 'forged', 3), J(1, 3, 'Complete a quest', 'quests', 1)],
  [J(2, 0, 'Defeat 300 monsters', 'kills', 300), J(2, 1, 'Defeat 6 elites', 'elites', 6), J(2, 2, 'Merge 3 times', 'merges', 3), J(2, 3, 'Defeat a boss', 'bosses', 1)],
  [J(3, 0, 'Defeat 600 monsters', 'kills', 600), J(3, 1, 'Defeat 10 elites', 'elites', 10), J(3, 2, 'Forge 15 weapons', 'forged', 15), J(3, 3, 'Complete 4 quests', 'quests', 4)],
  [J(4, 0, 'Defeat 1,000 monsters', 'kills', 1000), J(4, 1, 'Defeat 3 bosses', 'bosses', 3), J(4, 2, 'Merge 10 times', 'merges', 10), J(4, 3, 'Play for 30 minutes', 'play', 1800)],
  [J(5, 0, 'Defeat 1,500 monsters', 'kills', 1500), J(5, 1, 'Defeat 20 elites', 'elites', 20), J(5, 2, 'Forge 40 weapons', 'forged', 40), J(5, 3, 'Complete 8 quests', 'quests', 8)],
  [J(6, 0, 'Defeat 2,200 monsters', 'kills', 2200), J(6, 1, 'Defeat 6 bosses', 'bosses', 6), J(6, 2, 'Merge 25 times', 'merges', 25), J(6, 3, 'Log in on 5 days', 'logins', 5)],
  [J(7, 0, 'Defeat 3,000 monsters', 'kills', 3000), J(7, 1, 'Defeat 30 elites', 'elites', 30), J(7, 2, 'Reforge once', 'reforges', 1), J(7, 3, 'Forge 80 weapons', 'forged', 80)],
];

/** Login calendar rewards (day 7 is the big one). Gold scales with progress. */
export function attendanceReward(day: number, bestEver: number): Reward {
  const g = enemyGold(Math.max(1, bestEver)) * 150;
  return [
    { gold: g },
    { shards: 160 },
    { gems: 30 },
    { gold: g * 2 },
    { shards: 320 },
    { gems: 50 },
    { gems: 150, shards: 600, embers: 5 },
  ][day % 7];
}

export function boardChestReward(kind: 'daily' | 'weekly' | 'journey', index: number, bestEver: number): Reward {
  const g = enemyGold(Math.max(1, bestEver)) * 80 * (index + 1);
  if (kind === 'daily') return [{ gold: g }, { shards: 80 }, { gems: 15 }, { shards: 160 }, { gems: 40, gold: g }][index];
  if (kind === 'weekly') return [{ gems: 30 }, { shards: 320 }, { gems: 60 }, { shards: 600 }, { gems: 150, embers: 3 }][index];
  return [{ gems: 20 }, { shards: 200 }, { gems: 40 }, { shards: 400, gold: g }, { gems: 80 }, { shards: 800 }, { gems: 250, embers: 10 }][index];
}

// --- Codex ---------------------------------------------------------------------

export const CODEX_TIERS = [50, 250, 1000];
export const CODEX_BOSS_TIERS = [1, 3, 10];
export const codexTiers = (slot: number) => (slot === 3 ? CODEX_BOSS_TIERS : CODEX_TIERS);
export const codexReward = (slot: number, tier: number): Reward => ({ gems: (slot === 3 ? 10 : 5) * (tier + 1) * (tier + 1) });

// --- Gem shop --------------------------------------------------------------------

export interface ShopOffer { id: string; name: string; desc: string; cost: number }
export const SHOP: ShopOffer[] = [
  { id: 'gold', name: 'Gold Chest', desc: 'A big pile of gold for your zone', cost: 30 },
  { id: 'shards', name: 'Shard Pouch', desc: 'Shards for the forge', cost: 40 },
  { id: 'mats', name: 'Builder\'s Crate', desc: 'Wood and stone for building', cost: 25 },
  { id: 'xp', name: 'Battle Tome', desc: 'Hero XP, sized to your zone', cost: 60 },
  { id: 'warp', name: 'Time Warp', desc: '2 hours of offline earnings', cost: 120 },
  { id: 'embers', name: 'Ember Spark', desc: 'Embers for Reforge perks', cost: 150 },
];

export function describeReward(r: Reward): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${fmt(r.gold)} gold`);
  if (r.shards) parts.push(`${fmt(r.shards)} shards`);
  if (r.gems) parts.push(`${fmt(r.gems)} gems`);
  if (r.embers) parts.push(`${fmt(r.embers)} embers`);
  if (r.xp) parts.push(`${fmt(r.xp)} XP`);
  if (r.wood) parts.push(`${fmt(r.wood)} wood`);
  if (r.stone) parts.push(`${fmt(r.stone)} stone`);
  return parts.join(' · ');
}
