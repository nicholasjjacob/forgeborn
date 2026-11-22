import { describe, expect, it } from 'vitest';
import { Sim, freshSave } from '../src/sim/sim';
import { UPGRADES, UPGRADE_IDS, maxAffordable, upgradeCost } from '../src/sim/balance';
import { GameMap, MAP_W } from '../src/sim/map';
import { fmt } from '../src/core/format';

/** Greedy player: always buys the cheapest available upgrade. */
function autoBuy(sim: Sim) {
  for (;;) {
    let best: (typeof UPGRADE_IDS)[number] | null = null;
    let bestCost = Infinity;
    for (const id of UPGRADE_IDS) {
      const q = sim.quote(id);
      if (q.count > 0 && q.cost < bestCost) { best = id; bestCost = q.cost; }
    }
    if (!best || bestCost > sim.gold) return;
    sim.buy(best);
  }
}

function play(minutes: number, seed = 1) {
  const sim = new Sim(freshSave(), seed);
  const steps = minutes * 60 * 30;
  for (let i = 0; i < steps; i++) {
    sim.tick();
    sim.events.clear();
    if (i % 30 === 0) {
      autoBuy(sim);
      if (sim.save.farming && i % (30 * 60) === 0) sim.challengeBoss();
    }
  }
  return sim;
}

describe('balance math', () => {
  it('bulk cost equals the sum of single purchases', () => {
    const def = UPGRADES.atk;
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += upgradeCost(def, 5 + i, 1);
    expect(upgradeCost(def, 5, 10)).toBeCloseTo(sum, 6);
  });

  it('maxAffordable never overspends and respects max level', () => {
    for (const id of UPGRADE_IDS) {
      const def = UPGRADES[id];
      for (const gold of [0, 7, 100, 12345, 1e9]) {
        const n = maxAffordable(def, 3, gold);
        if (n > 0) expect(upgradeCost(def, 3, n)).toBeLessThanOrEqual(gold);
        expect(3 + n).toBeLessThanOrEqual(def.maxLevel);
      }
    }
  });

  it('formats numbers compactly', () => {
    expect(fmt(999)).toBe('999');
    expect(fmt(1234)).toBe('1.23K');
    expect(fmt(999_999)).toBe('999K');
    expect(fmt(4.5e7)).toBe('45.0M');
    expect(fmt(1e15)).toBe('1.00aa');
  });
});

describe('simulation', () => {
  it('is deterministic for a given seed', () => {
    const a = play(3, 42);
    const b = play(3, 42);
    expect(a.save).toEqual({ ...b.save, savedAt: a.save.savedAt });
  });

  it('progresses at a reasonable pace with greedy upgrades', () => {
    const at5 = play(5);
    const at20 = play(20);
    // Pace targets: past the first boss within ~5 min, well beyond it by 20 min.
    expect(at5.save.highestStage).toBeGreaterThanOrEqual(8);
    expect(at20.save.highestStage).toBeGreaterThan(at5.save.highestStage);
    console.log('stage @5m', at5.save.highestStage, '@20m', at20.save.highestStage,
      'upgrades', JSON.stringify(at20.save.upgrades));
  });

  it('a fresh hero with no upgrades eventually dies and recovers instead of soft-locking', () => {
    const sim = new Sim(freshSave(), 7);
    let died = false;
    for (let i = 0; i < 30 * 600; i++) {
      sim.tick();
      if (sim.phase === 'dead') died = true;
      sim.events.clear();
    }
    expect(died).toBe(true);
    expect(sim.hero.hp).toBeGreaterThan(0);
  });

  it('beating an area boss moves the hero to the next area with a new map', () => {
    const save = freshSave();
    save.stage = 10;
    save.upgrades.atk = 60; // strong enough to win quickly
    save.upgrades.hp = 40;
    const sim = new Sim(save, 3);
    expect(sim.bossActive).toBe(true);
    const firstMap = sim.map;
    for (let i = 0; i < 30 * 60 && sim.stage === 10; i++) { sim.tick(); sim.events.clear(); }
    expect(sim.stage).toBe(11);
    expect(sim.area).toBe(1);
    expect(sim.map).not.toBe(firstMap);
  });

  it('auto-hunt never stalls for long (obstacle steering keeps kills flowing)', () => {
    const sim = play(10, 5);
    // Over every 60s window after warm-up, at least one kill must happen.
    let last = sim.save.kills;
    for (let w = 0; w < 6; w++) {
      for (let i = 0; i < 30 * 60; i++) { sim.tick(); sim.events.clear(); }
      expect(sim.save.kills).toBeGreaterThan(last);
      last = sim.save.kills;
    }
  });
});

describe('map', () => {
  it('keeps the spawn area clear and resolves movers out of props', () => {
    const map = new GameMap(0);
    expect(map.blocked(MAP_W / 2, MAP_W / 2, 6)).toBe(false);
    const solid = map.props.find((p) => p.r > 0 && p.x > 40 && p.x < MAP_W - 40)!;
    const pos = { x: solid.x + 0.5, y: solid.y };
    map.resolve(pos, 5);
    expect(Math.hypot(pos.x - solid.x, pos.y - solid.y)).toBeGreaterThanOrEqual(solid.r + 5 - 1e-6);
  });
});


describe('tap-to-move near props', () => {
  it('a tap on a solid prop walks to its edge and stops, without jittering', () => {
    const save = freshSave();
    save.stage = 25; save.bestEver = 25; save.auto = false; // desert: cacti and rocks
    const sim = new Sim(save, 1);
    const s = sim as unknown as { map: GameMap; enemies: { alive: boolean }[]; moveHero(dt: number): void };
    const h = sim.hero;
    let checked = 0;
    for (const p of s.map.props) {
      if (p.r <= 0 || p.x < 60 || p.y < 60 || p.x > MAP_W - 60 || p.y > MAP_W - 60) continue;
      for (let a = 0; a < 4; a++) {
        for (const e of s.enemies) e.alive = false;
        const ang = (a / 4) * Math.PI * 2;
        h.x = p.x + Math.cos(ang) * (p.r + 25); h.y = p.y + Math.sin(ang) * (p.r + 25);
        sim.moveTo(p.x + 1, p.y + 1);
        for (let i = 0; i < 90; i++) s.moveHero(1 / 30);
        const x0 = h.x, y0 = h.y;
        for (let i = 0; i < 30; i++) s.moveHero(1 / 30);
        expect(Math.hypot(h.x - x0, h.y - y0)).toBeLessThan(0.01);
        expect(h.moving).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
