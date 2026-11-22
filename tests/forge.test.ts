import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { migrate } from '../src/core/save';
import { Sim, freshSave } from '../src/sim/sim';
import {
  FORGE_COST, INVENTORY_SIZE, TRAITS, forgeWeapon, mergePreview, mergeWeapons, weaponMult, type Weapon,
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

  it('merging three matches raises tier, keeps form and traits, never lowers rarity', () => {
    const rng = new Rng(4);
    const traits: Weapon['traits'] = [{ t: 'crit', v: 0.03 }, { t: 'gold', v: 0.1 }];
    const keep = w(3, 2, 3, traits);
    const others = [w(3, 2, 3), w(3, 2, 3)];
    for (let i = 0; i < 50; i++) {
      const m = mergeWeapons(rng, 99, keep, others);
      expect(m.tier).toBe(4);
      expect(m.form).toBe(3);
      expect(m.rarity).toBeGreaterThanOrEqual(2);
      expect(m.traits.length).toBe(m.rarity);
      expect(m.traits.slice(0, 2).map((t) => t.t)).toEqual(['crit', 'gold']);
      expect(m.traits[0].v).toBeGreaterThan(0.03); // rescaled up to the new tier
    }
  });

  it('refuses merges without exactly three matching weapons', () => {
    const rng = new Rng(4);
    expect(() => mergeWeapons(rng, 1, w(3, 1, 0), [w(3, 1, 0)])).toThrow();
    expect(() => mergeWeapons(rng, 1, w(3, 1, 0), [w(3, 1, 0), w(3, 2, 0)])).toThrow(); // rarity differs
    expect(() => mergeWeapons(rng, 1, w(3, 1, 0), [w(3, 1, 0), w(3, 1, 2)])).toThrow(); // type differs
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

  it('auto-merge leaves fewer than three of any type/tier/rarity', () => {
    const save = freshSave();
    save.shards = FORGE_COST * 20;
    const sim = new Sim(save, 2);
    sim.forge(20);
    sim.autoMerge();
    const counts = new Map<string, number>();
    for (const x of save.weapons) if (x) { const k = `${x.form}:${x.tier}:${x.rarity}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
    for (const n of counts.values()) expect(n).toBeLessThan(3);
  });

  it('needs three of the same type, tier and rarity to merge', () => {
    const save = freshSave();
    save.weapons[0] = w(3, 0, 0); // common sword
    save.weapons[1] = w(3, 0, 0); // common sword
    save.weapons[2] = w(3, 0, 1); // common axe
    save.weapons[3] = w(3, 1, 0); // rare sword
    const sim = new Sim(save, 5);
    expect(sim.merge(0)).toBe(false);          // only 2 common swords
    expect(sim.merge(0, [1, 2])).toBe(false);  // axe doesn't match
    expect(sim.merge(0, [1, 3])).toBe(false);  // rare doesn't match
    expect(sim.autoMerge()).toEqual([]);
    save.weapons[4] = w(3, 0, 0);              // third common sword
    expect(sim.merge(0)).toBe(true);
    expect(save.weapons[0]!.tier).toBe(4);
    expect(save.weapons[0]!.form).toBe(0);
    expect(save.weapons.filter(Boolean).length).toBe(3); // 3 swords became 1; axe + rare sword stay
  });

  it('upgrades the equipped weapon with two matching weapons from the bag', () => {
    const save = freshSave();
    save.equipped = w(2, 2, 1, [{ t: 'gold', v: 0.1 }]); // epic T2 axe
    save.weapons[0] = w(2, 2, 1);
    save.weapons[5] = w(2, 1, 1); // rare: doesn't match
    const sim = new Sim(save, 7);
    const atk = sim.atk;
    expect(sim.mergeEquipped()).toBe(false); // only 2 of 3
    save.weapons[3] = w(2, 2, 1);
    expect(sim.mergeEquipped()).toBe(true);
    expect(save.equipped!.tier).toBe(3);
    expect(save.equipped!.form).toBe(1);
    expect(save.weapons[0]).toBeNull();
    expect(save.weapons[3]).toBeNull();
    expect(save.weapons[5]).not.toBeNull();
    expect(sim.atk).toBeGreaterThan(atk);
  });

  it('sorts the inventory by type, tier and rarity with empty slots last', () => {
    const save = freshSave();
    save.weapons[4] = w(2, 0, 3); // common T2 hammer
    save.weapons[0] = w(3, 1, 1); // rare T3 axe
    save.weapons[7] = w(3, 2, 1); // epic T3 axe
    save.weapons[2] = w(1, 0, 0); // common T1 sword
    const sim = new Sim(save, 9);
    const keepId = save.weapons[4]!.id;
    const where = sim.sortInventory();
    const order = save.weapons.slice(0, 5).map((x) => x && `${x.form}:${x.tier}:${x.rarity}`);
    expect(order).toEqual(['0:1:0', '1:3:2', '1:3:1', '3:2:0', null]);
    expect(save.weapons[where.get(keepId)!]!.id).toBe(keepId);
    expect(save.weapons.length).toBe(INVENTORY_SIZE);
  });

  it('upgrading the forge raises the equipped weapon attack', () => {
    const save = freshSave();
    save.gold = 1e9;
    const sim = new Sim(save, 8);
    const atk = sim.atk;
    expect(sim.upgradeForge()).toBe(true);
    expect(sim.atk).toBeCloseTo(atk * 1.04);
    expect(sim.attackWith(save.equipped)).toBeCloseTo(sim.atk);
  });

  it('previews a merge result before merging', () => {
    const base = w(4, 1, 0, [{ t: 'crit', v: 0.03 }]);
    const p = mergePreview(base);
    expect(p.tier).toBe(5);
    expect(p.rarity).toBe(1);
    expect(p.traits[0].v).toBeGreaterThan(0.03);
    expect(base.tier).toBe(4); // input untouched
  });

  it('previews attack for a weapon without equipping it', () => {
    const save = freshSave();
    save.weapons[0] = w(6, 1, 0);
    const sim = new Sim(save, 6);
    const before = sim.atk;
    expect(sim.attackWith(save.equipped)).toBeCloseTo(before);
    const preview = sim.attackWith(save.weapons[0]);
    expect(preview).toBeGreaterThan(before);
    sim.equip(0);
    expect(sim.atk).toBeCloseTo(preview);
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
