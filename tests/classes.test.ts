import { describe, expect, it } from 'vitest';
import { Sim, freshSave, type SaveData } from '../src/sim/sim';
import { SKINS, skinDef } from '../src/sim/skins';
import { FORMS, starterWeapon } from '../src/sim/weapons';
import { migrate } from '../src/core/save';

function heroSave(skin: string): SaveData {
  const save = freshSave();
  save.skins = SKINS.map((s) => s.id);
  save.skin = skin;
  save.equipped = starterWeapon(skinDef(skin).forms[0]);
  return save;
}

describe('hero classes', () => {
  it('every hero wields known weapon types, and the starter is one of them', () => {
    for (const s of SKINS) {
      expect(s.forms.length).toBeGreaterThan(0);
      for (const f of s.forms) expect(FORMS[f]).toBeDefined();
    }
  });

  it('the forge only makes weapons the current hero can wield', () => {
    const save = heroSave('mage');
    save.shards = 1e6;
    const sim = new Sim(save, 3);
    sim.forge(20);
    const made = save.weapons.filter((w) => w);
    expect(made.length).toBe(20);
    for (const w of made) expect(skinDef('mage').forms).toContain(w!.form);
  });

  it('weapons of another class cannot be equipped', () => {
    const save = heroSave('knight');
    save.weapons[0] = { id: 50, rarity: 2, form: 6, traits: [] }; // a Bow
    const sim = new Sim(save, 1);
    expect(sim.equip(0)).toBe(false);
    expect(save.equipped?.form).toBe(0);
  });

  it('each hero keeps their own weapon when switching', () => {
    const save = heroSave('knight');
    save.equipped = { id: 77, rarity: 3, form: 3, traits: [] }; // Epic Greatsword
    const sim = new Sim(save, 1);
    expect(sim.selectSkin('mage')).toBe(true);
    expect(save.equipped?.form).toBe(8); // a starter Staff
    expect(sim.ranged).not.toBeNull();
    expect(sim.selectSkin('knight')).toBe(true);
    expect(save.equipped?.id).toBe(77);
    expect(sim.ranged).toBeNull();
  });

  it('class perks change the hero: the Knight is tougher than the Rogue', () => {
    const knight = new Sim(heroSave('knight'), 1);
    const rogue = new Sim(heroSave('rogue'), 1);
    expect(knight.hero.maxHp).toBeGreaterThan(rogue.hero.maxHp);
    expect(rogue.aspd).toBeGreaterThan(knight.aspd);
  });

  it('the Warlord needs hero level 40 as well as gems', () => {
    const save = freshSave();
    save.missions.gems = 99999;
    const sim = new Sim(save, 1);
    expect(sim.buySkin('barbarian_large')).toBe(false);
    save.level = 40;
    expect(sim.buySkin('barbarian_large')).toBe(true);
    expect(save.skin).toBe('barbarian_large');
  });

  it.each(['mage', 'rogue', 'barbarian', 'rogue_hooded', 'barbarian_large'])('a %s fights and kills monsters', (skin) => {
    // A fresh hero's first minute varies a lot with the monsters it meets: average three runs.
    let kills = 0;
    for (const seed of [5, 6, 7]) {
      const save = heroSave(skin);
      const sim = new Sim(save, seed);
      for (let i = 0; i < 30 * 60; i++) { sim.tick(); sim.events.clear(); }
      kills += save.kills;
    }
    expect(kills / 3).toBeGreaterThan(4);
  });
});

describe('v6 → v7 migration', () => {
  it('Spears become Swords and the equipped weapon fits the current hero', () => {
    const old = { ...freshSave(), v: 6 } as unknown as Record<string, unknown>;
    old.skins = ['knight', 'mage'];
    old.skin = 'mage';
    old.equipped = { id: 9, rarity: 4, form: 1, traits: [] };   // a Legendary Axe on the Mage
    const weapons = Array(20).fill(null);
    weapons[0] = { id: 10, rarity: 2, form: 2, traits: [] };     // an old Spear
    old.weapons = weapons;
    delete old.gear;
    const s = migrate(old);
    expect(s.v).toBe(8);
    expect(s.runs.knight.weapons[0]?.form).toBe(0); // now a Sword, so it goes to the Knight's bag
    expect(s.equipped?.rarity).toBe(4);
    expect(skinDef('mage').forms).toContain(s.equipped!.form);
    expect(s.runs.knight.equipped?.form).toBe(0); // the Knight's own run, with a starter Sword
    expect(s.runs.knight.level).toBe(1);
  });
});

describe('each hero has their own run', () => {
  it('switching heroes swaps map progress, level, gold, upgrades, bag and forge', () => {
    const save = heroSave('knight');
    save.skins = ['knight', 'mage'];
    save.level = 20; save.gold = 5000; save.shards = 300; save.forgeLevel = 6; save.upgrades.atk = 12;
    save.zone = 2; save.zoneBosses = 2; save.zoneBest = 2; save.stage = 3;
    save.weapons[0] = { id: 90, rarity: 2, form: 0, traits: [] };
    const sim = new Sim(save, 1);
    expect(sim.selectSkin('mage')).toBe(true);
    expect(save.level).toBe(1);
    expect(save.gold).toBe(0);
    expect(save.shards).toBe(0);
    expect(save.forgeLevel).toBe(1);
    expect(save.upgrades.atk).toBe(0);
    expect(save.zone).toBe(0);
    expect(save.weapons.every((w) => w === null)).toBe(true);
    expect(save.equipped?.form).toBe(8);
    // The Mage earns their own way, then the Knight comes back exactly as left.
    save.gold = 77;
    expect(sim.selectSkin('knight')).toBe(true);
    expect([save.level, save.gold, save.forgeLevel, save.upgrades.atk, save.zone]).toEqual([20, 5000, 6, 12, 2]);
    expect(save.weapons[0]?.id).toBe(90);
    expect(sim.selectSkin('mage')).toBe(true);
    expect(save.gold).toBe(77);
    // Shared across heroes: the furthest zone opened and the best level reached.
    expect(sim.bestZone).toBe(2);
    expect(sim.bestLevel).toBe(20);
  });

  it('Reforge only restarts the current hero', () => {
    const save = heroSave('knight');
    save.skins = ['knight', 'mage'];
    const sim = new Sim(save, 1);
    sim.selectSkin('mage');
    save.gold = 900;
    sim.selectSkin('knight');
    save.highestStage = 40; save.zoneBosses = 2; save.level = 30;
    sim.reforge();
    sim.selectSkin('mage');
    expect(save.gold).toBe(900);
  });

  it('v7 saves: the shared bag is split between the heroes who can wield it', () => {
    const old = { ...freshSave(), v: 7 } as unknown as Record<string, unknown>;
    old.skins = ['knight', 'rogue', 'mage'];
    old.skin = 'knight';
    old.gear = { rogue: { id: 5, rarity: 3, form: 5, traits: [] } }; // an Epic Crossbow
    const weapons = Array(20).fill(null);
    weapons[0] = { id: 10, rarity: 1, form: 0, traits: [] };   // Sword: stays with the Knight
    weapons[1] = { id: 11, rarity: 1, form: 4, traits: [] };   // Dagger: to the Rogue
    weapons[2] = { id: 12, rarity: 1, form: skinDef('mage').forms[0], traits: [] }; // to the Mage
    old.weapons = weapons;
    delete old.runs;
    const s = migrate(old);
    expect(s.v).toBe(8);
    expect(s.weapons.filter((w) => w).map((w) => w!.id)).toEqual([10]);
    expect(s.runs.rogue.weapons.filter((w) => w).map((w) => w!.id)).toEqual([11]);
    expect(s.runs.mage.weapons.filter((w) => w).map((w) => w!.id)).toEqual([12]);
    expect(s.runs.rogue.equipped?.id).toBe(5);
    expect((s as unknown as { gear?: unknown }).gear).toBeUndefined();
    // And a v8 save round-trips.
    const again = migrate(JSON.parse(JSON.stringify(s)));
    expect(again.runs.rogue.weapons.filter((w) => w).map((w) => w!.id)).toEqual([11]);
    expect(again.runs.rogue.equipped?.id).toBe(5);
  });
});
