import { enemyGold } from './balance';
import { xpForKill } from './level';
import {
  DAILY_TASKS, JOURNEY_DAYS, JOURNEY_MILESTONES, JOURNEY_TASKS, MILESTONES, SHOP, WEEKLY_TASKS,
  attendanceReward, boardChestReward, codexReward, codexTiers, dayKey, daysBetween, freshBoard, weekKey,
  type Board, type MStat, type Reward, type TaskDef, addRewards,
} from './missions';
import { offlineReward } from './offline';
import { zoneArea } from './zones';
import type { Sim } from './sim';

export type BoardKind = 'daily' | 'weekly' | 'journey';
const ALL_STATS: MStat[] = ['kills', 'stages', 'elites', 'bosses', 'forged', 'merges', 'gold', 'reforges', 'legendaries', 'quests', 'play', 'logins'];
/** The journey can still be finished for a week after its last day unlocks. */
const JOURNEY_GRACE_DAYS = 14;

/**
 * Applies the mission rules to a running game. `update(now)` handles day/week rollovers and
 * login counting; everything else is a query or a claim. The UI calls `update` every few seconds.
 */
export class MissionSystem {
  constructor(private readonly sim: Sim) {}

  private get m() { return this.sim.save.missions; }

  private snapshot(): Partial<Record<MStat, number>> {
    const base: Partial<Record<MStat, number>> = {};
    for (const k of ALL_STATS) base[k] = this.sim.statValue(k);
    return base;
  }

  private newBoard(key: string): Board {
    return { ...freshBoard(), key, base: this.snapshot() };
  }

  /** Roll daily/weekly boards over and count a login when the calendar day changes. */
  update(now: Date): void {
    const m = this.m, day = dayKey(now), week = weekKey(now);
    const newDay = m.daily.key !== day;
    if (newDay) m.daily = this.newBoard(day);
    if (m.weekly.key !== week) m.weekly = this.newBoard(week);
    if (!m.journey.key) m.journey = this.newBoard(day);
    // Count the login after snapshotting, so today's "Log in" task shows 1/1.
    if (newDay) this.sim.save.stats.logins++;
  }

  // --- Boards ------------------------------------------------------------------

  board(kind: BoardKind): Board { return this.m[kind]; }

  tasks(kind: BoardKind): TaskDef[] {
    return kind === 'daily' ? DAILY_TASKS : kind === 'weekly' ? WEEKLY_TASKS : JOURNEY_TASKS.flat();
  }

  milestones(kind: BoardKind): number[] { return kind === 'journey' ? JOURNEY_MILESTONES : MILESTONES; }

  progress(kind: BoardKind, t: TaskDef): number {
    const b = this.board(kind);
    return Math.max(0, this.sim.statValue(t.stat) - (b.base[t.stat] ?? 0));
  }

  /** Journey day (0-based) for `now`; tasks for days ≤ this are unlocked. */
  journeyDay(now: Date): number {
    const j = this.m.journey;
    return j.key ? daysBetween(j.key, dayKey(now)) : 0;
  }

  journeyActive(now: Date): boolean {
    const j = this.m.journey;
    if (!j.key) return true;
    if (j.chests.length >= JOURNEY_MILESTONES.length) return false;
    return this.journeyDay(now) < JOURNEY_GRACE_DAYS;
  }

  taskUnlocked(kind: BoardKind, t: TaskDef, now: Date): boolean {
    if (kind !== 'journey') return true;
    const day = Number(t.id.slice(1, t.id.indexOf('-'))) - 1;
    return day <= Math.min(JOURNEY_DAYS - 1, this.journeyDay(now));
  }

  canClaimTask(kind: BoardKind, t: TaskDef, now: Date): boolean {
    const b = this.board(kind);
    return !b.claimed.includes(t.id) && this.taskUnlocked(kind, t, now) && this.progress(kind, t) >= t.target
      && (kind !== 'journey' || this.journeyActive(now));
  }

  claimTask(kind: BoardKind, id: string, now: Date): boolean {
    const t = this.tasks(kind).find((x) => x.id === id);
    if (!t || !this.canClaimTask(kind, t, now)) return false;
    const b = this.board(kind);
    b.claimed.push(t.id);
    b.points += t.points;
    return true;
  }

  canClaimChest(kind: BoardKind, i: number): boolean {
    const b = this.board(kind);
    return !b.chests.includes(i) && b.points >= this.milestones(kind)[i];
  }

  chestReward(kind: BoardKind, i: number): Reward {
    return boardChestReward(kind, i, this.sim.save.bestEver);
  }

  claimChest(kind: BoardKind, i: number): Reward | null {
    if (!this.canClaimChest(kind, i)) return null;
    this.board(kind).chests.push(i);
    const r = this.chestReward(kind, i);
    this.apply(r);
    return r;
  }

  /** Open every gift on this board that is ready, at once (tapping any ready one). */
  claimReadyChests(kind: BoardKind): Reward | null {
    let total: Reward | null = null;
    this.milestones(kind).forEach((_, i) => {
      const r = this.claimChest(kind, i);
      if (r) total = total ? addRewards(total, r) : r;
    });
    return total;
  }

  // --- Attendance ----------------------------------------------------------------

  canClaimAttendance(now: Date): boolean {
    return this.m.attendance.last !== dayKey(now);
  }

  attendanceReward(day: number): Reward { return attendanceReward(day, this.sim.save.bestEver); }

  claimAttendance(now: Date): Reward | null {
    const a = this.m.attendance;
    if (!this.canClaimAttendance(now)) return null;
    const r = this.attendanceReward(a.day);
    a.day = (a.day + 1) % 7;
    a.last = dayKey(now);
    this.apply(r);
    return r;
  }

  // --- Codex -----------------------------------------------------------------------

  /** Called by the sim on every kill. slot: 0..2 = area monsters, 3 = boss. */
  recordKill(area: number, slot: number): void {
    const k = String(area);
    const row = this.m.codex[k] ?? (this.m.codex[k] = [0, 0, 0, 0]);
    row[slot]++;
  }

  codexKills(area: number, slot: number): number { return this.m.codex[String(area)]?.[slot] ?? 0; }
  codexClaimed(area: number, slot: number): number { return this.m.codexClaimed[String(area)]?.[slot] ?? 0; }

  canClaimCodex(area: number, slot: number): boolean {
    const tier = this.codexClaimed(area, slot);
    const tiers = codexTiers(slot);
    return tier < tiers.length && this.codexKills(area, slot) >= tiers[tier];
  }

  claimCodex(area: number, slot: number): Reward | null {
    if (!this.canClaimCodex(area, slot)) return null;
    const k = String(area);
    const row = this.m.codexClaimed[k] ?? (this.m.codexClaimed[k] = [0, 0, 0, 0]);
    const r = codexReward(slot, row[slot]);
    row[slot]++;
    this.apply(r);
    return r;
  }

  /** Claim every tier of this monster's codex entry that has been reached, at once. */
  claimCodexAll(area: number, slot: number): Reward | null {
    let total: Reward | null = null;
    for (let r = this.claimCodex(area, slot); r; r = this.claimCodex(area, slot)) total = total ? addRewards(total, r) : r;
    return total;
  }

  /** Areas the player has reached (codex pages). */
  codexAreas(): number[] {
    // Terrains reached, plus any whose monsters have been met (the forest's regions borrow them).
    const last = zoneArea(this.sim.save.zoneBest);
    const met = Object.keys(this.m.codex).map(Number).filter((a) => (this.m.codex[String(a)] ?? []).some((k) => k > 0));
    return [...new Set([...Array.from({ length: last + 1 }, (_, i) => i), ...met])].sort((a, b) => a - b);
  }

  // --- Gem shop --------------------------------------------------------------------

  offerReward(id: string): Reward {
    const s = this.sim.save;
    if (id === 'shards') return { shards: 240 };
    if (id === 'gold') return { gold: enemyGold(Math.max(1, s.stage)) * 250 };
    if (id === 'xp') return { xp: xpForKill(Math.max(1, s.bestEver), false) * 300 }; // ~300 kills' worth
    if (id === 'embers') return { embers: 3 };
    const r = offlineReward(s, 2 * 3600, 24);
    return { gold: Math.max(r.gold, enemyGold(s.stage) * 100), shards: r.shards };
  }

  buy(id: string): Reward | null {
    const offer = SHOP.find((o) => o.id === id);
    if (!offer || this.m.gems < offer.cost) return null;
    this.m.gems -= offer.cost;
    const r = this.offerReward(id);
    this.apply(r);
    return r;
  }

  // --- Shared ------------------------------------------------------------------------

  apply(r: Reward): void {
    const s = this.sim.save;
    if (r.gold) { s.gold += r.gold; }
    if (r.shards) s.shards += r.shards;
    if (r.gems) this.m.gems += r.gems;
    if (r.embers) { s.embers += r.embers; s.embersEarned += r.embers; this.sim.recalc(); }
    if (r.xp) this.sim.gainXp(r.xp);
  }

  /** Count of claimable things per section (for red badges). */
  badges(now: Date): { login: number; daily: number; weekly: number; journey: number; codex: number } {
    const count = (kind: BoardKind) =>
      this.tasks(kind).filter((t) => this.canClaimTask(kind, t, now)).length +
      this.milestones(kind).filter((_, i) => this.canClaimChest(kind, i)).length;
    let codex = 0;
    for (const a of this.codexAreas()) for (let s = 0; s < 4; s++) if (this.canClaimCodex(a, s)) codex++;
    return {
      login: this.canClaimAttendance(now) ? 1 : 0,
      daily: count('daily'),
      weekly: count('weekly'),
      journey: this.journeyActive(now) ? count('journey') : 0,
      codex,
    };
  }
}
