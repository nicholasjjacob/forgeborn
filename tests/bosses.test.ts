import { describe, expect, it } from 'vitest';
import { Sim, freshSave } from '../src/sim/sim';
import { monsterModel } from '../src/sim/areas';
import { FOREST, forestRegion } from '../src/sim/forest';
import {
  CODEX_WORLD_PAGE, PLAYABLE_ZONES, WORLD_BOSS, codexEntries, codexEntry, regionBossKey, zoneBoss, zoneBossName,
} from '../src/sim/zones';
import { migrate } from '../src/core/save';

describe('region and world bosses', () => {
  it('gives each of the nine regions a named giant of one of its own monsters', () => {
    const names = new Set<string>();
    for (let z = 0; z < PLAYABLE_ZONES; z++) {
      const b = zoneBoss(z);
      expect(b.slot).toBeLessThan(3); // a giant regular monster, never a terrain boss
      expect(codexEntries(z).slice(0, 2)).toContainEqual([b.area, b.slot]); // one of the region's own
      const name = zoneBossName(z);
      expect(name).not.toMatch(/Champion|^The /);
      names.add(name);
    }
    expect(names.size).toBe(PLAYABLE_ZONES);
  });

  it('puts the Necromancer in its own crypt in the last region, with its model built', async () => {
    const { existsSync } = await import(['node', 'fs'].join(':')) as { existsSync(p: string): boolean };
    const l = FOREST.worldLair;
    expect(l.world).toBe(true);
    expect(l.zone).toBe(PLAYABLE_ZONES - 1);
    expect(forestRegion(l.x, l.y)).toBe(l.biome);
    expect(FOREST.lairs.every((q) => Math.hypot(q.x - l.x, q.y - l.y) > q.r + l.r)).toBe(true);
    expect(monsterModel(WORLD_BOSS.area, WORLD_BOSS.slot)).toBe('boss_necromancer');
    expect(existsSync('public/models/boss_necromancer.glb')).toBe(true);
  });

  it('keeps the crypt sealed until every region boss falls, then the Necromancer rises', () => {
    const at = (sim: Sim) => {
      const l = sim.map.forest!.worldLair;
      sim.hero.x = sim.hero.prevX = l.x; sim.hero.y = sim.hero.prevY = l.y;
      sim.tick();
    };
    const save = freshSave();
    save.level = 60; save.zone = 8; save.stage = 33; save.zoneBosses = 8;
    const sealed = new Sim(save, 1);
    at(sealed);
    expect(sealed.bossActive).toBe(false);

    const open = freshSave();
    open.level = 60; open.zone = 8; open.stage = 33; open.zoneBosses = PLAYABLE_ZONES;
    const sim = new Sim(open, 2);
    at(sim);
    expect(sim.worldBossActive).toBe(true);
    const boss = sim.enemies.find((e) => e.alive && e.boss)!;
    expect([boss.area, boss.monster]).toEqual([WORLD_BOSS.area, WORLD_BOSS.slot]);
    const gems = open.missions.gems;
    boss.hp = 1;
    // Defeat it: a big first-win reward, the Codex counts it, and it rests before a rematch.
    (sim as unknown as { kill(e: typeof boss): void }).kill(boss);
    expect(open.worldBosses).toBe(1);
    expect(open.missions.gems).toBeGreaterThan(gems);
    expect(sim.missions.codexKills(WORLD_BOSS.area, WORLD_BOSS.slot)).toBe(1);
    expect(sim.worldBossCooldownLeft()).toBeGreaterThan(0);
  });
});

describe('codex by region', () => {
  it('shows only regions reached, each with its two monsters and its boss', () => {
    const sim = new Sim(freshSave(), 3);
    expect(sim.missions.codexPages()).toEqual([0]);
    expect(codexEntries(0)).toHaveLength(3);
    // Killing a Meadow monster doesn't reveal any other region's page (no monster is shared).
    sim.missions.recordKill(0, 0);
    expect(sim.missions.codexPages()).toEqual([0]);
    expect(codexEntry(regionBossKey(1), 3).name).toBe(zoneBossName(1));
    const save = freshSave();
    save.zoneBest = 2;
    expect(new Sim(save, 4).missions.codexPages()).toEqual([0, 1, 2]);
    save.zoneBest = 8; save.zoneBosses = PLAYABLE_ZONES; save.level = 60; save.zone = 8;
    expect(new Sim(save, 5).missions.codexPages()).toContain(CODEX_WORLD_PAGE);
  });

  it('v8 saves: region boss kills become their Codex entries; the old Greenwood boss goes to Emerald Mere', () => {
    const old = freshSave() as unknown as Record<string, unknown>;
    old.v = 8;
    const m = old.missions as { codex: Record<string, number[]>; codexClaimed: Record<string, number[]> };
    m.codex['0'] = [10, 0, 0, 3];
    m.codexClaimed['0'] = [0, 0, 0, 1];
    (old.regions as Record<number, { bosses: number }>)[1].bosses = 4;
    const s = migrate(old);
    expect(s.missions.codex['0'][3]).toBe(0);
    expect(s.missions.codex[String(regionBossKey(8))][3]).toBe(3);
    expect(s.missions.codexClaimed[String(regionBossKey(8))][3]).toBe(1);
    expect(s.missions.codex[String(regionBossKey(1))][3]).toBe(4);
    expect(s.worldBosses).toBe(0);
  });
});
