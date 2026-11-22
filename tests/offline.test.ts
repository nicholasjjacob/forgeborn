import { describe, expect, it } from 'vitest';
import { migrate } from '../src/core/save';
import {
  MIN_OFFLINE_SECONDS, OFFLINE_CAP_HOURS, OFFLINE_EFFICIENCY, OFFLINE_SHARD_EFFICIENCY, formatDuration, offlineReward,
} from '../src/sim/offline';
import { Sim, freshSave } from '../src/sim/sim';

const rates = (gold: number, shards: number) => ({ rates: { gold, shards } });

describe('offline rewards', () => {
  it('pays the efficiency share of the saved rate', () => {
    const r = offlineReward(rates(10, 0.2), 3600);
    expect(r.seconds).toBe(3600);
    expect(r.gold).toBeCloseTo(10 * 3600 * OFFLINE_EFFICIENCY);
    expect(r.shards).toBe(Math.floor(0.2 * 3600 * OFFLINE_SHARD_EFFICIENCY));
  });

  it('caps credited time but reports the real absence', () => {
    const r = offlineReward(rates(1, 0), 30 * 3600);
    expect(r.seconds).toBe(OFFLINE_CAP_HOURS * 3600);
    expect(r.away).toBe(30 * 3600);
  });

  it('ignores short absences, clock skew and bad rates', () => {
    expect(offlineReward(rates(10, 1), MIN_OFFLINE_SECONDS - 1).gold).toBe(0);
    expect(offlineReward(rates(10, 1), -5000).gold).toBe(0);
    expect(offlineReward(rates(10, 1), NaN).gold).toBe(0);
    expect(offlineReward(rates(-10, -1), 3600).gold).toBe(0);
  });

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(600)).toBe('10m');
    expect(formatDuration(3 * 3600 + 7 * 60)).toBe('3h 7m');
  });
});

describe('earning-rate tracking', () => {
  it('measures a positive rate after a few minutes of play', () => {
    const sim = new Sim(freshSave(), 11);
    for (let i = 0; i < 30 * 180; i++) { sim.tick(); sim.events.clear(); }
    expect(sim.save.rates.gold).toBeGreaterThan(0);
    // The rate should roughly match actual earnings over the window (no upgrades bought).
    expect(sim.save.rates.gold * 180).toBeLessThan(sim.save.gold * 1.5);
  });

  it('keeps the saved rate until a minute of live data exists', () => {
    const save = freshSave();
    save.rates = { gold: 123, shards: 4 };
    const sim = new Sim(save, 12);
    for (let i = 0; i < 30 * 30; i++) { sim.tick(); sim.events.clear(); }
    expect(sim.save.rates.gold).toBe(123);
  });

  it('old saves without rates migrate to zero rates', () => {
    const s = migrate({ v: 2, stage: 5 });
    expect(s.rates).toEqual({ gold: 0, shards: 0 });
  });
});
