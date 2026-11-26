import { describe, expect, it } from 'vitest';
import { migrate } from '../src/core/save';
import { REGION_MONSTERS, zoneBiome } from '../src/sim/forest';
import {
  MASTERY_BONUS, MILESTONES, QUESTS_PER_REGION, STARS_PER_REGION, explorePercents, regionQuests, regionStars,
} from '../src/sim/regionQuests';
import { Sim, freshSave } from '../src/sim/sim';
import { PLAYABLE_ZONES } from '../src/sim/zones';
import { Explored } from '../src/sim/explore';

const tickN = (sim: Sim, n: number) => { for (let i = 0; i < n; i++) { sim.tick(); sim.events.clear(); } };

describe('region quests', () => {
  it('every region has its own five quests, hunting its own two monsters', () => {
    for (let z = 0; z < PLAYABLE_ZONES; z++) {
      const qs = regionQuests(z);
      expect(qs.length).toBe(QUESTS_PER_REGION);
      expect(qs.filter((q) => q.kind === 'hunt').length).toBe(REGION_MONSTERS[zoneBiome(z)].length);
      for (const q of qs) {
        expect(q.tiers.length).toBe(3);
        for (let i = 1; i < 3; i++) expect(q.tiers[i]).toBeGreaterThan(q.tiers[i - 1]);
      }
      expect(new Set(qs.map((q) => q.name)).size).toBe(qs.length);
    }
    expect(MILESTONES[MILESTONES.length - 1].stars).toBe(STARS_PER_REGION);
  });

  it('kills count towards the region they happen in', () => {
    const sim = new Sim(freshSave(), 11);
    tickN(sim, 30 * 90);
    const r = sim.save.regions[0];
    expect(sim.save.kills).toBeGreaterThan(10);
    expect(r.hunt.reduce((a, b) => a + b, 0)).toBe(sim.save.kills);
    for (let z = 1; z < PLAYABLE_ZONES; z++) expect(regionStars(sim.save.regions[z]) + sim.save.regions[z].hunt.reduce((a, b) => a + b, 0)).toBe(0);
    expect(sim.explorePercents()[0]).toBeGreaterThan(0);
  });

  it('claims tiers one at a time for stars and rewards, then milestones', () => {
    const sim = new Sim(freshSave(), 12);
    const r = sim.save.regions[0];
    expect(sim.claimRegionQuest(0, 0)).toBeNull();
    r.hunt[0] = 400; // past tiers I and II
    expect(sim.questBadge()).toBe(1);
    const gold = sim.save.gold, shards = sim.save.shards;
    const rw = sim.claimRegionQuest(0, 0)!;
    expect(rw.gold).toBeGreaterThan(0);
    expect(sim.save.gold).toBeCloseTo(gold + rw.gold!, 6);
    expect(sim.save.shards).toBe(shards + rw.shards!);
    expect(sim.claimRegionQuest(0, 0)).not.toBeNull();
    expect(sim.claimRegionQuest(0, 0)).toBeNull(); // tier III needs 1,500
    expect(r.claimed[0]).toBe(2);
    expect(sim.save.stats.quests).toBe(2);
    expect(sim.canClaimRegionMilestone(0, 0)).toBe(false);

    // Every quest maxed: all milestones in order, and mastery raises damage.
    r.hunt = [1e4, 1e4]; r.elites = 1e3; r.bosses = 1e3;
    sim.explored = new Explored(sim.map.w, sim.map.h);
    for (let y = 0; y < sim.map.h; y += 100) for (let x = 0; x < sim.map.w; x += 100) sim.explored.reveal(x, y, 200);
    expect(sim.explorePercents()[0]).toBe(100);
    for (let qi = 0; qi < QUESTS_PER_REGION; qi++) while (sim.claimRegionQuest(0, qi));
    expect(regionStars(r)).toBe(STARS_PER_REGION);
    expect(sim.claimRegionMilestone(0, 1)).toBeNull(); // in order
    const atk = sim.atk;
    const gems = sim.save.missions.gems;
    for (let i = 0; i < MILESTONES.length; i++) expect(sim.claimRegionMilestone(0, i)).not.toBeNull();
    expect(sim.save.missions.gems).toBeGreaterThan(gems);
    expect(sim.atk).toBeCloseTo(atk * (1 + MASTERY_BONUS), 6);
    expect(sim.questBadge()).toBe(0);
  });

  it('locked regions show their quests but cannot be claimed', () => {
    const sim = new Sim(freshSave(), 13);
    sim.save.regions[4].hunt[0] = 1e4;
    expect(sim.regionOpen(4)).toBe(false);
    expect(sim.claimRegionQuest(4, 0)).toBeNull();
    expect(sim.questBadge()).toBe(0);
  });

  it('progress survives Reforge and old saves migrate', () => {
    const save = freshSave();
    Object.assign(save, { stage: 40, highestStage: 40, bestEver: 40, zone: 8, zoneBosses: 9, zoneBest: 8, level: 60 });
    save.regions[2].hunt[1] = 77;
    save.regions[2].claimed[1] = 1;
    const sim = new Sim(save, 14);
    sim.reforge();
    expect(save.regions[2].hunt[1]).toBe(77);
    expect(save.regions[2].claimed[1]).toBe(1);

    const old = { ...freshSave(), quests: [{ kind: 'kills', start: 0, target: 30, gold: 1, shards: 1 }] } as Record<string, unknown>;
    delete old.regions;
    const m = migrate(old);
    expect(m.regions.length).toBe(PLAYABLE_ZONES);
    expect('quests' in m).toBe(false);
    expect(explorePercents(null).every((p) => p === 0)).toBe(true);
  });

  it('v9 saves: hunts follow their monster to its new place; other quests move up', () => {
    const old = freshSave() as unknown as Record<string, unknown>;
    old.v = 9;
    // Goldenrod (zone 1) used to hunt Sand Alpaca, Dune Dino, Cactling; now Dune Dino, Cactling.
    (old.regions as unknown[])[1] = { hunt: [5, 60, 70], elites: 4, bosses: 2, claimed: [1, 1, 2, 3, 1, 2], milestones: 1 };
    const s = migrate(old);
    expect(s.regions[1].hunt).toEqual([60, 70]);
    expect(s.regions[1].claimed).toEqual([1, 2, 3, 1, 2]);
    expect(s.regions[1].milestones).toBe(1);
  });
});
