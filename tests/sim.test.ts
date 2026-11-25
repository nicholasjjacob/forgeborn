import { starterWeapon } from '../src/sim/weapons';
import { PLAYABLE_ZONES, bossCooldown } from '../src/sim/zones';
import { describe, expect, it } from 'vitest';
import { Sim, freshSave, type Enemy } from '../src/sim/sim';
import { UPGRADES, UPGRADE_IDS, maxAffordable, upgradeCost } from '../src/sim/balance';
import { GameMap, MAP_W, layoutFor, zoneTint } from '../src/sim/map';
import { zoneLevel, zoneStage } from '../src/sim/zones';
import { fmt } from '../src/core/format';
import { migrate } from '../src/core/save';

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

/** Forest bosses wait in their lairs: put the hero in the current region's lair (one tick). */
function enterLair(sim: Sim) {
  const lair = sim.map.forest!.lairs.find((l) => l.zone === sim.save.zone)!;
  sim.hero.x = sim.hero.prevX = lair.x; sim.hero.y = sim.hero.prevY = lair.y;
  sim.tick();
}

function play(minutes: number, seed = 1) {
  const sim = new Sim(freshSave(), seed);
  sim.clock = () => 1e12 + sim.time * 1000; // boss cooldowns on simulated time: runs repeat exactly
  const steps = minutes * 60 * 30;
  for (let i = 0; i < steps; i++) {
    sim.tick();
    sim.events.clear();
    if (i % 30 === 0) {
      autoBuy(sim);
      // Player: try the zone boss once a minute until it falls, then move on when allowed.
      if (i % (30 * 60) === 0 && !sim.zoneBossBeaten) sim.challengeBoss();
      if (sim.maxZone > sim.save.zone && !sim.isBossStage) sim.travel(sim.maxZone);
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
    // Pace targets: into the second region within ~5 min, the whole forest open by 20 min.
    expect(at5.maxZone).toBeGreaterThanOrEqual(1);
    expect(at20.maxZone).toBe(PLAYABLE_ZONES - 1);
    expect(at20.save.level).toBeGreaterThan(at5.save.level);
  });

  it('a fresh hero with no upgrades eventually dies and recovers instead of soft-locking', () => {
    // The Rogue (no defensive perk): the Knight's armour can outlast this test.
    const save = freshSave();
    save.skins.push('rogue'); save.skin = 'rogue'; save.equipped = starterWeapon(4);
    const sim = new Sim(save, 7);
    let died = false;
    for (let i = 0; i < 30 * 600; i++) {
      sim.tick();
      if (sim.phase === 'dead') died = true;
      sim.events.clear();
    }
    expect(died).toBe(true);
    expect(sim.hero.hp).toBeGreaterThan(0);
  });

  it('lands past the forest stay locked (coming soon)', () => {
    const save = freshSave();
    save.zoneBosses = 3; save.level = zoneLevel(3);
    const sim = new Sim(save, 3);
    expect(sim.zoneUnlocked(PLAYABLE_ZONES)).toBe(false);
    expect(sim.travel(PLAYABLE_ZONES)).toBe(false);
    expect(sim.map.forest).toBeTruthy();
  });

  it('a region boss rises in its lair and can be beaten there', () => {
    const save = freshSave();
    save.upgrades.atk = 60; save.upgrades.hp = 40;
    const sim = new Sim(save, 3);
    expect(sim.challengeBoss()).toBe(true); // walks the hero toward the lair
    expect(sim.bossActive).toBe(false);
    enterLair(sim);
    expect(sim.bossActive).toBe(true);
    for (let i = 0; i < 30 * 60 && save.zoneBosses === 0; i++) { sim.tick(); sim.events.clear(); }
    expect(save.zoneBosses).toBe(1);
    expect(sim.map.forest).toBeTruthy(); // no separate arena
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

describe('zone maps', () => {
  it('every zone has its own layout and an open centre; boss fights use an arena', () => {
    const seen = new Set<string>();
    for (let zone = 0; zone < 18; zone++) {
      for (const boss of [false, true]) {
        const map = new GameMap(Math.floor(zone / 3), zone, boss);
        expect(map.blocked(MAP_W / 2, MAP_W / 2, 7)).toBe(false);
        seen.add(map.props.slice(0, 12).map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join('|'));
        expect(map.layout === 'arena').toBe(boss);
      }
    }
    expect(seen.size).toBe(36);
    expect(layoutFor(0)).not.toBe(layoutFor(1));
    expect(zoneTint(0)).not.toBe(zoneTint(2));
  });
});

describe('world map zones', () => {
  const beatBoss = (sim: Sim) => {
    enterLair(sim);
    const boss = sim.enemies.find((e) => e.alive && e.boss)!;
    boss.hp = 0;
    (sim as unknown as { kill(e: Enemy): void }).kill(boss);
  };

  it('a zone opens with the hero level AND the previous zone boss', () => {
    const save = freshSave();
    const sim = new Sim(save, 2);
    expect(sim.maxZone).toBe(0);
    expect(sim.travel(1)).toBe(false);
    save.level = zoneLevel(1);
    expect(sim.zoneUnlocked(1)).toBe(false); // boss not beaten yet
    beatBoss(sim);
    expect(save.zoneBosses).toBe(1);
    expect(sim.zoneUnlocked(1)).toBe(true);
    // The pass into the next region opens.
    sim.tick();
    expect(sim.map.openGates.has(1)).toBe(true);
    expect(sim.travel(1)).toBe(true);
    sim.tick();
    expect(save.zone).toBe(1);
    expect(save.stage).toBe(zoneStage(1));
    // Back to an easier region any time.
    expect(sim.travel(0)).toBe(true);
    sim.tick();
    expect(save.zone).toBe(0);
  });

  it('beating the boss pays a first-clear bonus once, then sends the hero back to the field', () => {
    const save = freshSave();
    const sim = new Sim(save, 3);
    const gems = save.missions.gems;
    beatBoss(sim);
    expect(save.missions.gems).toBe(gems + 10);
    expect(sim.bossActive).toBe(false);
    for (let i = 0; i < 90; i++) sim.tick();
    expect(sim.map.forest).toBeTruthy(); // stays in the forest
    sim.clock = () => Date.now() + 1e9; // cooldown over
    beatBoss(sim); // rematch: no second bonus, no extra unlock
    expect(save.missions.gems).toBe(gems + 10);
    expect(save.zoneBosses).toBe(1);
  });

  it('higher zones give more XP per kill and tougher monsters', () => {
    const lo = new Sim(freshSave(), 1), hiSave = freshSave();
    hiSave.zone = 6; hiSave.zoneBosses = 6; hiSave.level = 100;
    const hi = new Sim(hiSave, 1);
    type Inner = { enemies: Enemy[]; setEnemy(e: Enemy, m: number, boss: boolean, x: number, y: number): void };
    (lo as unknown as Inner).setEnemy(lo.enemies[0], 0, false, 100, 100);
    (hi as unknown as Inner).setEnemy(hi.enemies[0], 0, false, 100, 100);
    expect(hi.enemies[0].maxHp).toBeGreaterThan(lo.enemies[0].maxHp * 10);
    const xp0 = lo.save.xp;
    (lo as unknown as { kill(e: Enemy): void }).kill(lo.enemies[0]);
    const loXp = lo.save.xp - xp0 + (lo.save.level - 1) * 0;
    hiSave.level = 50; hiSave.xp = 0;
    (hi as unknown as { kill(e: Enemy): void }).kill(hi.enemies[0]);
    expect(hiSave.xp).toBeGreaterThan(loXp * 3);
  });

  it('old stage saves become zone progress', () => {
    const old = { ...freshSave(), v: 5, stage: 28, highestStage: 28, bestEver: 28, level: 11 } as unknown as Record<string, unknown>;
    delete old.zone; delete old.zoneBosses; delete old.zoneBest;
    const save = migrate(old);
    expect(save.zoneBosses).toBe(6); // zoneStage(6) = 25 was passed; zoneStage(7) = 29 was not
    expect(save.zone).toBeGreaterThan(0);
    expect(save.level).toBeGreaterThanOrEqual(zoneLevel(save.zone));
  });
});

describe('monster skills', () => {
  type Inner = { enemies: Enemy[]; setEnemy(e: Enemy, m: number, boss: boolean, x: number, y: number, elite?: boolean): void; updateEnemies(dt: number): void; updateShots(dt: number): void };
  const setup = (_stage: number, zone = 0) => {
    const save = freshSave();
    save.zone = zone; save.zoneBosses = zone; save.level = 100;
    const sim = new Sim(save, 4);
    const s = sim as unknown as Inner;
    for (const e of s.enemies) e.alive = false;
    sim.hero.hp = sim.hero.maxHp = 1e9;
    return { sim, s };
  };
  const run = (_sim: Sim, s: Inner, secs: number) => {
    for (let i = 0; i < secs * 30; i++) { s.updateEnemies(1 / 30); s.updateShots(1 / 30); }
  };

  it('dashers wind up, then charge and hit', () => {
    const { sim, s } = setup(2); // meadow: the pigeon dashes
    const e = s.enemies[0];
    s.setEnemy(e, 1, false, sim.hero.x + 50, sim.hero.y);
    e.spawnT = 0; e.aggro = true; e.skillCd = 0;
    s.updateEnemies(1 / 30);
    expect(e.windT).toBeGreaterThan(0);
    run(sim, s, 1);
    expect(sim.hero.hp).toBeLessThan(1e9);
  });

  it('spitters hit the hero from range with projectiles', () => {
    const { sim, s } = setup(0, 3); // mirewood: the spider spits
    const e = s.enemies[0];
    s.setEnemy(e, 1, false, sim.hero.x + 60, sim.hero.y);
    e.spawnT = 0; e.aggro = true; e.skillCd = 0;
    let shot = false;
    for (let i = 0; i < 60 && !shot; i++) { s.updateEnemies(1 / 30); s.updateShots(1 / 30); shot = sim.shots.some((p) => p.alive); }
    expect(shot).toBe(true);
    run(sim, s, 1.5);
    expect(sim.hero.hp).toBeLessThan(1e9);
    expect(Math.hypot(e.x - sim.hero.x, e.y - sim.hero.y)).toBeGreaterThan(30); // kept its distance
  });

  it('elites are tougher and richer', () => {
    const { sim, s } = setup(5);
    s.setEnemy(s.enemies[0], 0, false, 100, 100);
    s.setEnemy(s.enemies[1], 0, false, 100, 140, true);
    expect(s.enemies[1].maxHp).toBeCloseTo(s.enemies[0].maxHp * 3);
    expect(s.enemies[1].gold).toBeCloseTo(s.enemies[0].gold * 4);
    expect(sim).toBeTruthy();
  });
});

describe('boss rematch cooldown', () => {
  it('lets a beaten boss be rematched only after a cooldown that grows with the zone', () => {
    expect(bossCooldown(0)).toBe(120);
    expect(bossCooldown(2)).toBeGreaterThan(bossCooldown(1) * 1.4); // terrain boss: +50%
    expect(bossCooldown(17)).toBeGreaterThan(bossCooldown(5));
    const save = freshSave();
    save.zoneBosses = 1; // zone 0's boss already beaten
    const sim = new Sim(save, 3);
    let t = 1_000_000;
    sim.clock = () => t;
    expect(sim.challengeBoss()).toBe(true);              // no cooldown recorded yet
    enterLair(sim);
    expect(sim.bossActive).toBe(true);                   // the rematch starts the cooldown
    sim.travel(0);                                       // leave (the fight is abandoned)
    sim.hero.x = sim.hero.prevX = 750; sim.hero.y = sim.hero.prevY = 1570; sim.tick();
    expect(sim.bossActive).toBe(false);
    t += 1000;
    expect(sim.challengeBoss()).toBe(false);             // recovering
    expect(sim.bossCooldownLeft()).toBeCloseTo(119, 0);
    enterLair(sim);
    expect(sim.bossActive).toBe(false);                  // the lair stays quiet
    t += 120_000;
    expect(sim.challengeBoss()).toBe(true);              // ready again
  });

  it('never blocks a boss that has not been beaten yet', () => {
    const sim = new Sim(freshSave(), 4);
    expect(sim.challengeBoss(0)).toBe(true);
    sim.bossActive = false;
    expect(sim.challengeBoss(1)).toBe(true);
  });
});
