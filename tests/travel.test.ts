import { describe, expect, it } from 'vitest';
import { forestRegion } from '../src/sim/forest';
import { Sim, freshSave } from '../src/sim/sim';
import { bossCooldown } from '../src/sim/zones';
import { HERO_RADIUS } from '../src/sim/balance';

describe('World Map fast travel to a spot', () => {
  it('lands on free ground by a haunt or just outside a lair, in that region', () => {
    const save = freshSave();
    Object.assign(save, { zone: 2, zoneBosses: 2, zoneBest: 2, level: 12 });
    const sim = new Sim(save, 3);
    const f = sim.map.forest!;
    for (const t of f.territories.filter((x) => x.zone <= 2)) {
      expect(sim.travelToSpot(t.x, t.y, t.r * 0.5)).toBe(true);
      expect(forestRegion(sim.hero.x, sim.hero.y)).toBe(t.biome);
      expect(sim.map.blocked(sim.hero.x, sim.hero.y, HERO_RADIUS)).toBe(false);
      expect(Math.hypot(sim.hero.x - t.x, sim.hero.y - t.y)).toBeLessThan(t.r + 420);
    }
    for (const l of f.lairs.filter((x) => x.zone <= 2)) {
      expect(sim.travelToSpot(l.x, l.y, l.r + 26)).toBe(true);
      expect(Math.hypot(sim.hero.x - l.x, sim.hero.y - l.y)).toBeGreaterThanOrEqual(l.r + 25);
      expect(sim.bossActive).toBe(false);
    }
  });

  it('refuses a region that is still closed', () => {
    const sim = new Sim(freshSave(), 4);
    const far = sim.map.forest!.lairs.find((l) => l.zone === 6)!;
    const x = sim.hero.x, y = sim.hero.y;
    expect(sim.travelToSpot(far.x, far.y, far.r + 26)).toBe(false);
    expect([sim.hero.x, sim.hero.y]).toEqual([x, y]);
  });

  it('counts down each beaten boss until it rises again', () => {
    const save = freshSave();
    Object.assign(save, { zone: 1, zoneBosses: 2, zoneBest: 1, level: 8 });
    const sim = new Sim(save, 5);
    const now = sim.clock();
    save.bossReady[0] = now + 90_000;
    expect(sim.lairCooldownLeft(0, now)).toBeCloseTo(90, 5);
    expect(sim.lairCooldownLeft(1, now)).toBe(0); // never set: ready
    expect(sim.lairCooldownLeft(2, now)).toBe(0); // not beaten yet
    save.bossReady[0] = now + 1e12; // a clock moved backwards can't trap the player
    expect(sim.lairCooldownLeft(0, now)).toBe(bossCooldown(0));
  });
});
