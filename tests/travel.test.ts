import { describe, expect, it } from 'vitest';
import { forestRegion } from '../src/sim/forest';
import { Sim, freshSave } from '../src/sim/sim';
import { bossCooldown } from '../src/sim/zones';

describe('boss lairs', () => {
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

describe('World Map: walking to a spot', () => {
  const walk = (sim: Sim, maxSec: number) => {
    for (let i = 0; i < maxSec * 30 && sim.route.length; i++) { sim.tick(); sim.events.clear(); if (sim.phase !== 'playing') break; }
  };

  it('walks across open regions to a haunt, along the trails', () => {
    const save = freshSave();
    Object.assign(save, { zone: 0, zoneBosses: 3, zoneBest: 2, level: 60, auto: false });
    save.upgrades.hp = 200; save.upgrades.atk = 200; // strong enough not to die on the way
    const sim = new Sim(save, 6);
    sim.recalc(); sim.hero.hp = sim.hero.maxHp;
    const f = sim.map.forest!;
    const t = f.territories.find((x) => x.zone === 2)!;
    const x0 = sim.hero.x, y0 = sim.hero.y;
    expect(sim.walkToSpot(t.x, t.y, t.r * 0.5)).toBe(true);
    expect(sim.route.length).toBeGreaterThan(1); // a trail route, not a straight line
    walk(sim, 240);
    expect(sim.route.length).toBe(0);
    expect(forestRegion(sim.hero.x, sim.hero.y)).toBe(t.biome);
    expect(Math.hypot(sim.hero.x - t.x, sim.hero.y - t.y)).toBeLessThan(t.r * 0.5 + 40);
    expect(Math.hypot(sim.hero.x - x0, sim.hero.y - y0)).toBeGreaterThan(300); // it really walked
  });

  it('stops outside a lair, so the boss only rises when the hero steps in', () => {
    const save = freshSave();
    Object.assign(save, { zone: 0, zoneBosses: 1, zoneBest: 1, level: 30, auto: false });
    save.upgrades.hp = 200;
    const sim = new Sim(save, 7);
    sim.recalc(); sim.hero.hp = sim.hero.maxHp;
    const l = sim.map.forest!.lairs.find((x) => x.zone === 1)!;
    expect(sim.walkToSpot(l.x, l.y, l.r + 26)).toBe(true);
    walk(sim, 240);
    expect(sim.bossActive).toBe(false);
    const d = Math.hypot(sim.hero.x - l.x, sim.hero.y - l.y);
    expect(d).toBeGreaterThan(l.r * 0.75);
    expect(d).toBeLessThan(l.r + 80);
  });

  it('refuses a closed region, and a manual move cancels the walk', () => {
    const sim = new Sim(freshSave(), 8);
    const far = sim.map.forest!.lairs.find((l) => l.zone === 6)!;
    expect(sim.walkToSpot(far.x, far.y, far.r + 26)).toBe(false);
    const t = sim.map.forest!.territories.find((x) => x.zone === 0)!;
    expect(sim.walkToSpot(t.x, t.y, 20)).toBe(true);
    sim.setMove(1, 0);
    expect(sim.route.length).toBe(0);
  });

  it('stops on the map icon itself: every haunt and boss lair of the open regions', () => {
    const save = freshSave();
    Object.assign(save, { zone: 0, zoneBosses: 3, zoneBest: 2, level: 60, auto: false });
    save.upgrades.hp = 400; save.upgrades.atk = 400;
    const sim = new Sim(save, 9);
    const f = sim.map.forest!;
    const spots = [...f.territories.filter((t) => t.zone <= 2), ...f.lairs.filter((l) => l.zone <= 2)];
    for (const t of spots) {
      sim.hero.hp = sim.hero.maxHp;
      expect(sim.walkToSpot(t.x, t.y, 0), `${t.x},${t.y}`).toBe(true);
      walk(sim, 90);
      sim.bossActive = false; // (a lair's boss rose: leave it)
      expect(Math.hypot(sim.hero.x - t.x, sim.hero.y - t.y), `${t.x},${t.y}`).toBeLessThan(25);
    }
  });
});
