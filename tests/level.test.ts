import { describe, expect, it } from 'vitest';
import { migrate } from '../src/core/save';
import { MAX_LEVEL, MILESTONES, levelBonus, milestoneReward, totalXpTo, xpForKill, xpToNext } from '../src/sim/level';
import { Sim, freshSave } from '../src/sim/sim';

describe('hero level curve', () => {
  it('grows steadily and stops at the cap', () => {
    for (let l = 1; l < MAX_LEVEL - 1; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    expect(xpToNext(MAX_LEVEL)).toBe(Infinity);
  });

  it('is quick early and a long-term goal at the top', () => {
    // Level 2 in ~10 early kills; level 100 needs millions of XP.
    expect(xpToNext(1) / xpForKill(1, false)).toBeLessThanOrEqual(10);
    expect(totalXpTo(100)).toBeGreaterThan(2e6);
    expect(xpForKill(20, true)).toBe(xpForKill(20, false) * 20);
  });

  it('has 20 milestones, every 5 levels', () => {
    expect(MILESTONES.length).toBe(20);
    expect(MILESTONES[0]).toBe(5);
    expect(MILESTONES[19]).toBe(100);
  });

  it('gives a permanent bonus that grows with level', () => {
    expect(levelBonus(1)).toEqual({ atk: 1, hp: 1, gold: 1 });
    expect(levelBonus(100).atk).toBeCloseTo(3.97);
  });

  it('sizes rewards to progress and makes big milestones special', () => {
    const early = milestoneReward(5, 5), late = milestoneReward(5, 80);
    expect(late.gold!).toBeGreaterThan(early.gold! * 100);
    expect(milestoneReward(10, 1).gems).toBeGreaterThan(0);
    expect(milestoneReward(5, 1).gems).toBeUndefined();
    expect(milestoneReward(20, 1).weapon?.rarity).toBe(1);
    expect(milestoneReward(60, 1).weapon?.rarity).toBe(2);
    expect(milestoneReward(100, 1).weapon?.rarity).toBe(3);
    expect(milestoneReward(25, 1).embers).toBeGreaterThan(0);
  });
});

describe('levelling in the sim', () => {
  it('levels up from XP, heals, and boosts attack', () => {
    const sim = new Sim(freshSave(), 1);
    const atk = sim.atk;
    sim.hero.hp = 1;
    sim.gainXp(xpToNext(1) + xpToNext(2) + 5);
    expect(sim.save.level).toBe(3);
    expect(sim.save.xp).toBe(5);
    expect(sim.hero.hp).toBe(sim.hero.maxHp);
    expect(sim.atk).toBeGreaterThan(atk);
  });

  it('caps at level 100', () => {
    const sim = new Sim(freshSave(), 1);
    sim.gainXp(1e12);
    expect(sim.save.level).toBe(MAX_LEVEL);
    expect(sim.save.xp).toBe(0);
  });

  it('claims each milestone once, only when reached', () => {
    const save = freshSave();
    save.level = 12;
    const sim = new Sim(save, 1);
    expect(sim.levelRewardsReady()).toBe(2);
    expect(sim.claimLevelReward(15)).toBeNull();
    const gold = save.gold;
    const r = sim.claimLevelReward(5);
    expect(r && r !== 'full' && r.gold).toBeGreaterThan(0);
    expect(save.gold).toBeGreaterThan(gold);
    expect(sim.claimLevelReward(5)).toBeNull();
    expect(sim.levelRewardsReady()).toBe(1);
  });

  it('needs a free slot for weapon rewards', () => {
    const save = freshSave();
    save.level = 20;
    save.weapons = save.weapons.map((_, i) => ({ id: 100 + i, tier: 1, rarity: 0, form: 0, traits: [] }));
    const sim = new Sim(save, 1);
    expect(sim.claimLevelReward(20)).toBe('full');
    save.weapons[3] = null;
    expect(sim.claimLevelReward(20)).not.toBe('full');
    const reward = save.weapons.find((x) => x?.id === save.nextWeaponId - 1);
    expect(reward!.rarity).toBeGreaterThanOrEqual(1);
  });

  it('keeps the level through Reforge and migrates old saves to level 1', () => {
    const save = freshSave();
    Object.assign(save, { stage: 60, highestStage: 60, bestEver: 60, level: 30, xp: 50, levelClaimed: [5, 10] });
    const sim = new Sim(save, 1);
    sim.reforge();
    expect(save.level).toBe(30);
    expect(save.levelClaimed).toEqual([5, 10]);

    const old = migrate({ ...freshSave(), v: 4, level: undefined, xp: undefined, levelClaimed: undefined });
    expect(old.v).toBe(5);
    expect(old.level).toBe(1);
    expect(old.levelClaimed).toEqual([]);
  });
});
