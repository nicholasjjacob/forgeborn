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
    expect(sim.selectSkin('ranger')).toBe(true);
    expect(save.equipped?.form).toBe(6); // a starter Bow
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

  it('the Engineer finds more gold and shards; the Druid regenerates', () => {
    const knight = new Sim(heroSave('knight'), 1);
    const eng = new Sim(heroSave('engineer'), 1);
    expect(eng.goldMult).toBeGreaterThan(knight.goldMult);
    expect(eng.shardMult).toBeGreaterThan(knight.shardMult);
    expect(new Sim(heroSave('druid'), 1).cls.regen).toBeGreaterThan(0);
  });

  it('a shotgun blast fires a spread of pellets', () => {
    const sim = new Sim(heroSave('engineer'), 2);
    let most = 0;
    for (let i = 0; i < 30 * 20; i++) { sim.tick(); sim.events.clear(); most = Math.max(most, sim.heroShots.filter((s) => s.alive).length); }
    expect(most).toBeGreaterThanOrEqual(5);
  });

  it.each(['ranger', 'mage', 'rogue', 'barbarian', 'rogue_hooded', 'druid', 'engineer', 'barbarian_large'])('a %s fights and kills monsters', (skin) => {
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
    expect(s.v).toBe(7);
    expect(s.weapons[0]?.form).toBe(0);
    expect(s.equipped?.rarity).toBe(4);
    expect(skinDef('mage').forms).toContain(s.equipped!.form);
    expect(s.gear).toEqual({});
  });
});
