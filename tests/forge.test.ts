import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { migrate } from '../src/core/save';
import { Sim, freshSave } from '../src/sim/sim';
import {
  mergeCount,
  FORGE_COST, INVENTORY_SIZE, forgeCost, forgeLevelCap, forgeOdds, salvageValue, TRAITS, forgeWeapon, mergePreview, mergeWeapons,
  upgradeOldWeapon, weaponMult, type Rarity, type Weapon,
} from '../src/sim/weapons';

const w = (rarity: Rarity, form: 0 | 1 | 2 | 3 = 0, traits: Weapon['traits'] = []): Weapon =>
  ({ id: Math.random(), rarity, form, traits });

describe('weapon rules', () => {
  it('each rarity is clearly stronger than the last', () => {
    for (let r = 0; r < 6; r++) {
      expect(weaponMult({ rarity: (r + 1) as Rarity })).toBeGreaterThan(weaponMult({ rarity: r as Rarity }) * 1.5);
    }
  });

  it('forged weapons get exactly one trait per rarity step, all distinct and within caps', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 500; i++) {
      const f = forgeWeapon(rng, i, 10);
      expect(f.traits.length).toBe(f.rarity);
      expect(new Set(f.traits.map((t) => t.t)).size).toBe(f.traits.length);
      for (const t of f.traits) expect(t.v).toBeLessThanOrEqual(TRAITS[t.t].cap);
      expect(f.rarity).toBeLessThanOrEqual(4); // Mythic and Divine only come from merging
    }
  });

  it('higher rarities need more weapons to merge (3, 3, 4, 4, 5, 5)', () => {
    expect([0, 1, 2, 3, 4, 5].map(mergeCount)).toEqual([3, 3, 4, 4, 5, 5]);
  });

  it('merging matches gives the next rarity, keeps form and traits, adds one trait', () => {
    const rng = new Rng(4);
    const traits: Weapon['traits'] = [{ t: 'crit', v: 0.03 }, { t: 'gold', v: 0.1 }];
    const keep = w(2, 3, traits);
    const others = [w(2, 3), w(2, 3), w(2, 3)]; // Rare needs 4
    for (let i = 0; i < 50; i++) {
      const m = mergeWeapons(rng, 99, keep, others);
      expect(m.rarity).toBe(3);
      expect(m.form).toBe(3);
      expect(m.traits.length).toBe(3);
      expect(m.traits.slice(0, 2).map((t) => t.t)).toEqual(['crit', 'gold']);
      expect(m.traits[0].v).toBeGreaterThan(0.03); // strengthened for the new rarity
    }
    expect(() => mergeWeapons(rng, 1, w(2, 3), [w(2, 3), w(2, 3)])).toThrow(); // too few for a Rare
    expect(() => mergeWeapons(rng, 1, w(6), [w(6), w(6)])).toThrow(); // Divine is the top
  });

  it('refuses merges without exactly three matching weapons', () => {
    const rng = new Rng(4);
    expect(() => mergeWeapons(rng, 1, w(1, 0), [w(1, 0)])).toThrow();
    expect(() => mergeWeapons(rng, 1, w(1, 0), [w(1, 0), w(2, 0)])).toThrow(); // rarity differs
    expect(() => mergeWeapons(rng, 1, w(1, 0), [w(1, 0), w(1, 2)])).toThrow(); // type differs
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

  it('auto-merge leaves fewer than three of any type and rarity', () => {
    const save = freshSave();
    save.shards = FORGE_COST * 20;
    const sim = new Sim(save, 2);
    sim.forge(20);
    sim.autoMerge();
    const counts = new Map<string, number>();
    for (const x of save.weapons) if (x) { const k = `${x.form}:${x.rarity}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
    for (const n of counts.values()) expect(n).toBeLessThan(3);
  });

  it('needs three of the same type and rarity to merge', () => {
    const save = freshSave();
    save.weapons[0] = w(0, 0); // common sword
    save.weapons[1] = w(0, 0); // common sword
    save.weapons[2] = w(0, 1); // common axe
    save.weapons[3] = w(1, 0); // uncommon sword
    const sim = new Sim(save, 5);
    expect(sim.merge(0)).toBe(false);          // only 2 common swords
    expect(sim.merge(0, [1, 2])).toBe(false);  // axe doesn't match
    expect(sim.merge(0, [1, 3])).toBe(false);  // rare doesn't match
    expect(sim.autoMerge()).toEqual([]);
    save.weapons[4] = w(0, 0);                 // third common sword
    expect(sim.merge(0)).toBe(true);
    expect(save.weapons[0]!.rarity).toBe(1);   // three Commons make an Uncommon
    expect(save.weapons[0]!.form).toBe(0);
    expect(save.weapons.filter(Boolean).length).toBe(3); // 3 swords became 1; axe + rare sword stay
  });

  it('upgrades the equipped weapon with matching weapons from the bag', () => {
    const save = freshSave();
    save.equipped = w(2, 1, [{ t: 'gold', v: 0.1 }]); // rare axe
    save.weapons[0] = w(2, 1);
    save.weapons[5] = w(1, 1); // uncommon: doesn't match
    const sim = new Sim(save, 7);
    const atk = sim.atk;
    expect(sim.mergeEquipped()).toBe(false); // only 2 of 4 (Rare merges need 4)
    save.weapons[3] = w(2, 1);
    expect(sim.mergeEquipped()).toBe(false); // 3 of 4
    save.weapons[4] = w(2, 1);
    expect(sim.mergeEquipped()).toBe(true);
    expect(save.equipped!.rarity).toBe(3);
    expect(save.equipped!.form).toBe(1);
    expect(save.weapons[0]).toBeNull();
    expect(save.weapons[3]).toBeNull();
    expect(save.weapons[4]).toBeNull();
    expect(save.weapons[5]).not.toBeNull();
    expect(sim.atk).toBeGreaterThan(atk);
  });

  it('sorts the inventory by type and rarity with empty slots last', () => {
    const save = freshSave();
    save.weapons[4] = w(0, 3); // common greatsword
    save.weapons[0] = w(1, 1); // uncommon axe
    save.weapons[7] = w(2, 1); // rare axe
    save.weapons[2] = w(0, 0); // common sword
    const sim = new Sim(save, 9);
    const keepId = save.weapons[4]!.id;
    const where = sim.sortInventory();
    const order = save.weapons.slice(0, 5).map((x) => x && `${x.form}:${x.rarity}`);
    expect(order).toEqual(['0:0', '1:2', '1:1', '3:0', null]);
    expect(save.weapons[where.get(keepId)!]!.id).toBe(keepId);
    expect(save.weapons.length).toBe(INVENTORY_SIZE);
  });

  it('expands the inventory a row at a time with gold, up to the maximum', () => {
    const save = freshSave();
    const sim = new Sim(save, 10);
    expect(sim.expandInventory()).toBe(false); // no gold
    save.gold = 1e12;
    expect(sim.expandInventory()).toBe(true);
    expect(save.weapons.length).toBe(INVENTORY_SIZE + 5);
    while (sim.expandInventory());
    expect(save.weapons.length).toBe(60);
    save.weapons[59] = w(0, 0);
    Object.assign(save, { stage: 60, highestStage: 60, bestEver: 60 });
    sim.reforge();
    expect(save.weapons.length).toBe(60); // extra slots survive Reforge
    expect(migrate({ ...save, weapons: save.weapons.slice(0, 33) }).weapons.length).toBe(35); // whole rows
  });

  it('upgrading the forge raises the equipped weapon attack', () => {
    const save = freshSave();
    save.gold = 1e9;
    save.zoneBosses = 3; save.level = 100; // forge level 2 unlocks in the second terrain
    const sim = new Sim(save, 8);
    const atk = sim.atk;
    expect(sim.upgradeForge()).toBe(true);
    expect(sim.atk).toBeCloseTo(atk * 1.12);
    expect(sim.attackWith(save.equipped)).toBeCloseTo(sim.atk);
  });

  it('previews a merge result before merging', () => {
    const base = w(1, 0, [{ t: 'crit', v: 0.03 }]);
    const p = mergePreview(base);
    expect(p.rarity).toBe(2);
    expect(p.traits[0].v).toBeGreaterThan(0.03);
    expect(base.rarity).toBe(1); // input untouched
  });

  it('previews attack for a weapon without equipping it', () => {
    const save = freshSave();
    save.weapons[0] = w(2, 0);
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
    save.weapons[0] = w(3, 0, [{ t: 'crit', v: 0.05 }]);
    const sim = new Sim(save, 3);
    const before = sim.atk;
    sim.equip(0);
    expect(save.equipped!.rarity).toBe(3);
    expect(save.weapons[0]!.rarity).toBe(0); // starter moved into the grid
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
    expect(s.v).toBe(9);
    expect(s.bestEver).toBe(25);
    expect(s.perks.might).toBe(0);
    expect(s.stage).toBe(23);
    expect(s.upgrades.atk).toBe(10);
    expect(s.equipped?.rarity).toBe(0);
    expect(s.weapons.length).toBe(INVENTORY_SIZE);
    expect(s.shards).toBe(0);
    expect(s.auto).toBe(true);
  });

  it('turns old tiered weapons into rarities', () => {
    const old = (tier: number, rarity: number) => ({ id: 1, form: 2, traits: [], tier, rarity }) as unknown as Weapon;
    expect(upgradeOldWeapon(old(1, 0)).rarity).toBe(0);   // Common T1 -> Common
    expect(upgradeOldWeapon(old(1, 1)).rarity).toBe(2);   // old Rare -> Rare
    expect(upgradeOldWeapon(old(11, 3)).rarity).toBe(6);  // Legendary T11 -> Divine
    expect('tier' in upgradeOldWeapon(old(4, 2))).toBe(false);
    const s = migrate({ ...freshSave(), weapons: [old(6, 0)], equipped: old(3, 2) });
    expect(s.weapons[0]!.rarity).toBe(1);
    expect(s.equipped!.rarity).toBe(3);
  });

  it('rejects garbage and unknown versions', () => {
    expect(migrate(null).stage).toBe(1);
    expect(migrate({ v: 99, stage: 50 }).stage).toBe(1);
  });

  it('repairs a short inventory and a stale weapon id counter', () => {
    const s = migrate({ ...freshSave(), weapons: [w(0)], nextWeaponId: 0, equipped: { ...w(0), id: 50 } });
    expect(s.weapons.length).toBe(INVENTORY_SIZE);
    expect(s.nextWeaponId).toBeGreaterThan(50);
  });
});

describe('forge balance', () => {
  it('forge level is capped by the furthest zone reached this run', () => {
    const save = freshSave();
    save.gold = 1e12;
    const sim = new Sim(save, 3);
    expect(sim.upgradeForge()).toBe(false); // first region: level 1 only
    save.zoneBosses = 1; save.level = 100; // second region open
    expect(sim.upgradeForge()).toBe(true);
    expect(sim.upgradeForge()).toBe(true);
    expect(sim.upgradeForge()).toBe(false); // second region: level 3
    expect(forgeLevelCap(2)).toBe(5);
  });

  it('forging just to salvage never pays, on average', () => {
    const wr = (r: number): Weapon => ({ id: 1, rarity: r as Rarity, form: 0, traits: [] });
    for (let level = 1; level <= 25; level++) {
      const [pu, pr, pe, pl] = forgeOdds(level);
      const p = [1 - pu - pr - pe - pl, pu, pr, pe, pl];
      const back = p.reduce((sum, pi, r) => sum + pi * salvageValue(wr(r), level), 0);
      expect(back).toBeLessThan(forgeCost(level));
      // and a merged weapon is worth less melted than the three it took
      for (let r = 1; r <= 6; r++) expect(salvageValue(wr(r), level)).toBeLessThan(3 * salvageValue(wr(r - 1), level));
    }
  });
});
