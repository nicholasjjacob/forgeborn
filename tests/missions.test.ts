import { describe, expect, it } from 'vitest';
import { migrate } from '../src/core/save';
import {
  DAILY_TASKS, JOURNEY_MILESTONES, JOURNEY_TASKS, MILESTONES, WEEKLY_TASKS, daysBetween, weekKey,
} from '../src/sim/missions';
import { Sim, freshSave } from '../src/sim/sim';

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h);

describe('calendar helpers', () => {
  it('weeks start on Monday', () => {
    expect(weekKey(at(2026, 11, 16))).toBe('W2026-11-16'); // Monday
    expect(weekKey(at(2026, 11, 22))).toBe('W2026-11-16'); // Sunday, same week
    expect(weekKey(at(2026, 11, 23))).toBe('W2026-11-23'); // next Monday
  });
  it('counts days between keys across months', () => {
    expect(daysBetween('2026-11-28', '2026-12-03')).toBe(5);
  });
  it('every board sums to 100 points', () => {
    const sum = (ts: { points: number }[]) => ts.reduce((s, t) => s + t.points, 0);
    expect(sum(DAILY_TASKS)).toBe(100);
    expect(sum(WEEKLY_TASKS)).toBe(100);
    expect(MILESTONES.at(-1)).toBe(100);
    expect(sum(JOURNEY_TASKS.flat())).toBe(JOURNEY_MILESTONES.at(-1));
  });
});

describe('daily and weekly boards', () => {
  it('rolls over at midnight, counts the login, and tracks progress from the reset', () => {
    const sim = new Sim(freshSave(), 1);
    const m = sim.missions;
    m.update(at(2026, 11, 21, 9));
    expect(sim.save.stats.logins).toBe(1);
    const login = DAILY_TASKS.find((t) => t.id === 'd-login')!;
    expect(m.canClaimTask('daily', login, at(2026, 11, 21, 9))).toBe(true);
    expect(m.claimTask('daily', 'd-login', at(2026, 11, 21, 9))).toBe(true);
    expect(m.claimTask('daily', 'd-login', at(2026, 11, 21, 9))).toBe(false); // once only
    expect(m.board('daily').points).toBe(login.points);

    // Kills before the reset don't count toward tomorrow's board.
    sim.save.kills += 500;
    m.update(at(2026, 11, 21, 23));
    expect(sim.save.stats.logins).toBe(1); // same day: no extra login
    m.update(at(2026, 11, 22, 0));
    expect(sim.save.stats.logins).toBe(2);
    const kills = DAILY_TASKS.find((t) => t.stat === 'kills')!;
    expect(m.progress('daily', kills)).toBe(0);
    expect(m.board('daily').claimed).toEqual([]);
    sim.save.kills += 300;
    expect(m.progress('daily', kills)).toBe(300);
  });

  it('opens points chests once the milestone is reached', () => {
    const sim = new Sim(freshSave(), 2);
    const m = sim.missions;
    const now = at(2026, 11, 21);
    m.update(now);
    expect(m.claimChest('daily', 0)).toBeNull();
    m.board('daily').points = 40;
    const gold = sim.save.gold, shards = sim.save.shards;
    expect(m.claimChest('daily', 0)).not.toBeNull();
    expect(m.claimChest('daily', 1)).not.toBeNull();
    expect(m.claimChest('daily', 1)).toBeNull();
    expect(m.claimChest('daily', 2)).toBeNull();
    expect(sim.save.gold > gold || sim.save.shards > shards).toBe(true);
  });

  it('weekly board resets on Monday, not daily', () => {
    const sim = new Sim(freshSave(), 3);
    const m = sim.missions;
    m.update(at(2026, 11, 18)); // Wednesday
    const key = m.board('weekly').key;
    m.update(at(2026, 11, 20));
    expect(m.board('weekly').key).toBe(key);
    m.update(at(2026, 11, 23)); // Monday
    expect(m.board('weekly').key).not.toBe(key);
    expect(sim.save.stats.logins).toBe(3);
  });
});

describe('attendance', () => {
  it('pays one reward per calendar day and cycles through 7 days', () => {
    const sim = new Sim(freshSave(), 4);
    const m = sim.missions;
    for (let d = 0; d < 7; d++) {
      const now = at(2026, 11, 1 + d);
      expect(m.claimAttendance(now)).not.toBeNull();
      expect(m.claimAttendance(now)).toBeNull();
    }
    expect(sim.save.missions.attendance.day).toBe(0); // wrapped after day 7
    expect(sim.save.embers).toBeGreaterThan(0);        // day 7 grand prize includes embers
    expect(sim.save.missions.gems).toBeGreaterThan(0);
  });
});

describe('7-day journey', () => {
  it('unlocks one day of tasks per calendar day', () => {
    const sim = new Sim(freshSave(), 5);
    const m = sim.missions;
    m.update(at(2026, 11, 21));
    sim.save.kills += 5000;
    const day1 = JOURNEY_TASKS[0][0], day3 = JOURNEY_TASKS[2][0];
    expect(m.canClaimTask('journey', day1, at(2026, 11, 21))).toBe(true);
    expect(m.canClaimTask('journey', day3, at(2026, 11, 21))).toBe(false);
    expect(m.canClaimTask('journey', day3, at(2026, 11, 23))).toBe(true);
    expect(m.journeyActive(at(2026, 12, 20))).toBe(false); // long after the end
  });
});

describe('codex', () => {
  it('records kills per monster and pays gems per tier', () => {
    const sim = new Sim(freshSave(), 6);
    const m = sim.missions;
    for (let i = 0; i < 60; i++) m.recordKill(0, 1);
    expect(m.codexKills(0, 1)).toBe(60);
    expect(m.claimCodex(0, 1)).not.toBeNull();
    expect(m.claimCodex(0, 1)).toBeNull(); // next tier needs 250
    expect(sim.save.missions.gems).toBeGreaterThan(0);
  });

  it('real kills in play feed the codex', () => {
    const sim = new Sim(freshSave(), 7);
    for (let i = 0; i < 30 * 60; i++) { sim.tick(); sim.events.clear(); }
    const total = [0, 1, 2].reduce((s, k) => s + sim.missions.codexKills(0, k), 0);
    expect(total).toBe(sim.save.kills);
  });
});

describe('gem shop', () => {
  it('spends gems and refuses when short', () => {
    const sim = new Sim(freshSave(), 8);
    sim.save.missions.gems = 50;
    expect(sim.missions.buy('shards')).not.toBeNull();
    expect(sim.save.shards).toBe(60);
    expect(sim.missions.buy('shards')).toBeNull();
    expect(sim.save.missions.gems).toBe(10);
  });
});

describe('migration', () => {
  it('v3 saves gain empty missions without losing progress', () => {
    const s = migrate({ v: 3, stage: 12, embers: 7, stats: { stages: 11 } });
    expect(s.v).toBe(5);
    expect(s.stage).toBe(12);
    expect(s.embers).toBe(7);
    expect(s.stats.stages).toBe(11);
    expect(s.stats.logins).toBe(0);
    expect(s.missions.gems).toBe(0);
    expect(s.missions.attendance.day).toBe(0);
  });
});
