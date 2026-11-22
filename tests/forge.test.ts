import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { migrate } from '../src/core/save';
import { Sim, freshSave } from '../src/sim/sim';
import {
  FORGE_COST, INVENTORY_SIZE, TRAITS, forgeWeapon, mergeWeapons, weaponMult, type Weapon,
} from '../src/sim/weapons';

const w = (tier: number, rarity: 0 | 1 | 2 | 3, form: 0 | 1 | 2 | 3 = 0, traits: Weapon['traits'] = []): Weapon =>
  ({ id: Math.random(), tier, rarity, form, traits });

describe('weapon rules', () => {
  it('higher tier and rarity are always stronger', () => {
    for (let t = 1; t < 30; t++) {
      expect(weaponMult({ tier: t + 1, rarity: 0 })).toBeGreaterThan(weaponMult({ tier: t, rarity: 0 }));
      expect(weaponMult({ tier: t, rarity: 3 })).toBeGreaterThan(weaponMult({ tier: t, rarity: 2 }));
    }
  });

  it('forged weapons get exactly one trait per rarity step, all distinct and within caps', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 500; i++) {
      const f = forgeWeapon(rng, i, 10);
      expect(f.traits.length).toBe(f.rarity);
      expect(new Set(f.traits.map((t) => t.t)).size).toBe(f.traits.length);
      for (const t of f.traits) expect(t.v).toBeLessThanOrEqual(TRAITS[t.t].cap);
      expect(f.tier === 9 || f.tier === 10).toBe(true);
    }
  });

  it('merging raises tier, keeps the better parent\'s form and traits, never lowers rarity', () => {
    const rng = new Rng(4);
    const keep = w(3, 0, 1);
    const better = w(3, 2, 3, [{ t: 'crit', v: 0.03 }, { t: 'gold', v: 0.1 }]);
    for (let i = 0; i < 50; i++) {
      const m = mergeWeapons(rng, 99, keep, better);
      expect(m.tier).toBe(4);
      expect(m.form).toBe(3);
      expect(m.rarity).toBeGreaterThanOrEqual(2);
      expect(m.traits.length).toBe(m.rarity);
      expect(m.traits.slice(0, 2).map((t) => t.t)).toEqual(['crit', 'gold']);
      expect(m.traits[0].v).toBeGreaterThan(0.03); // rescaled up to the new tier
    }
  });
});

describe('forge commands', () => {
  it('forges into free slots, spends shards, and stops when full', () => {
    const save = freshSave();
    save.shards = FORGE_COST * (INVENTORY_SIZE + 5);
    const sim = new Sim(save, 1);
    expect(sim.forge(INVENTORY_SIZE + 5).length).toBe(INVENTORY_SIZE);
    expect(sim.freeSlots()).toBe(0);
    expect(save.shards).toBe(FORGE_COST * 5);
  });

  it('auto-merge combines every same-tier pair and leaves no duplicates', () => {
    const save = freshSave();
    save.shards = FORGE_COST * 16;
    const sim = new Sim(save, 2);
    sim.forge(16);
    sim.autoMerge();
    const tiers = save.weapons.filter(Boolean).map((x) => x!.tier);
    expect(new Set(tiers).size).toBe(tiers.length);
  });

  it('equipping swaps with the inventory and changes attack', () => {
    const save = freshSave();
    save.weapons[0] = w(6, 1, 0, [{ t: 'crit', v: 0.05 }]);
    const sim = new Sim(save, 3);
    const before = sim.atk;
    sim.equip(0);
    expect(save.equipped!.tier).toBe(6);
    expect(save.weapons[0]!.tier).toBe(1); // starter moved into the grid
    expect(sim.atk).toBeGreaterThan(before * 3);
    expect(sim.crit).toBeCloseTo(0.1, 5);
  });

  it('monsters drop shards over time', () => {
    const sim = new Sim(freshSave(), 4);
    for (let i = 0; i < 30 * 120; i++) { sim.tick(); sim.events.clear(); }
    expect(sim.save.shards).toBeGreaterThan(0);
  });
});

describe('save migration', () => {
  it('upgrades a v1 save, keeping progress and granting the starter weapon', () => {
    const v1 = { v: 1, stage: 23, highestStage: 25, gold: 1234, kills: 999, farming: false,
      upgrades: { atk: 10, hp: 5, aspd: 1, crit: 0, gold: 2 }, buyMode: 10, fps: 30, savedAt: 1 };
    const s = migrate(v1);
    expect(s.v).toBe(5);
    expect(s.bestEver).toBe(25);
    expect(s.perks.might).toBe(0);
    expect(s.stage).toBe(23);
    expect(s.upgrades.atk).toBe(10);
    expect(s.equipped?.tier).toBe(1);
    expect(s.weapons.length).toBe(INVENTORY_SIZE);
    expect(s.shards).toBe(0);
    expect(s.auto).toBe(true);
  });

  it('rejects garbage and unknown versions', () => {
    expect(migrate(null).stage).toBe(1);
    expect(migrate({ v: 99, stage: 50 }).stage).toBe(1);
  });

  it('repairs a short inventory and a stale weapon id counter', () => {
    const s = migrate({ ...freshSave(), weapons: [w(2, 0)], nextWeaponId: 0, equipped: { ...w(1, 0), id: 50 } });
    expect(s.weapons.length).toBe(INVENTORY_SIZE);
    expect(s.nextWeaponId).toBeGreaterThan(50);
  });
});
