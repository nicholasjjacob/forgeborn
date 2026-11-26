import { describe, expect, it } from 'vitest';
import { migrate } from '../src/core/save';
import { Sim, freshSave } from '../src/sim/sim';
import { STARTERS, skinDef } from '../src/sim/skins';
import { canWield } from '../src/sim/skins';

describe('first-launch hero choice', () => {
  it('a new save has not chosen yet; an old save counts as chosen', () => {
    expect(freshSave().starterChosen).toBe(false);
    const old = { ...freshSave() } as Record<string, unknown>;
    delete old.starterChosen;
    expect(migrate(old).starterChosen).toBe(true);
    expect(migrate({ ...freshSave() }).starterChosen).toBe(false); // opened but not chosen yet
  });

  it('starting as the Rogue owns only the Rogue, with a dagger', () => {
    const sim = new Sim(freshSave(), 1);
    expect(sim.chooseStarter('rogue')).toBe(true);
    const s = sim.save;
    expect(s.skin).toBe('rogue');
    expect(s.skins).toEqual(['rogue']);
    expect(s.starterChosen).toBe(true);
    expect(canWield('rogue', s.equipped!.form)).toBe(true);
    expect(s.equipped!.form).toBe(skinDef('rogue').forms[0]);
    expect(sim.ownsSkin('knight')).toBe(false);
    expect(sim.ownsSkin('mage')).toBe(false);
    // Only once, and only a starter.
    expect(sim.chooseStarter('mage')).toBe(false);
    expect(new Sim(freshSave(), 2).chooseStarter('barbarian_large')).toBe(false);
  });

  it('the other starters can be bought later, and the pick survives a reload', () => {
    const sim = new Sim(freshSave(), 3);
    sim.chooseStarter('mage');
    sim.save.missions.gems = 1000;
    expect(sim.buySkin('knight')).toBe(true);
    expect([...sim.save.skins].sort()).toEqual(['knight', 'mage']);
    const back = migrate(JSON.parse(JSON.stringify(sim.save)));
    expect([...back.skins].sort()).toEqual(['knight', 'mage']);
    expect(back.skin).toBe(sim.save.skin);
    expect(back.starterChosen).toBe(true);
    // A Rogue start doesn't get the Knight for free on reload.
    const r = new Sim(freshSave(), 4);
    r.chooseStarter('rogue');
    expect(migrate(JSON.parse(JSON.stringify(r.save))).skins).toEqual(['rogue']);
    expect(STARTERS).toEqual(['knight', 'barbarian', 'rogue', 'mage', 'rogue_hooded']);
  });

  it('retired heroes (Ranger, Druid, Engineer) are refunded and leave the save', () => {
    // Playing the Knight, also owning the Ranger and Druid.
    const a = { ...freshSave(), starterChosen: true, skins: ['knight', 'ranger', 'druid'], skin: 'knight' } as Record<string, unknown>;
    (a.missions as { gems: number }).gems = 10;
    const ma = migrate(JSON.parse(JSON.stringify(a)));
    expect(ma.skins).toEqual(['knight']);
    expect(ma.missions.gems).toBe(10 + 250 + 300);
    expect(ma.runs.ranger).toBeUndefined();
    // Only once: a reload doesn't refund again.
    expect(migrate(JSON.parse(JSON.stringify(ma))).missions.gems).toBe(560);

    // Playing the Ranger, also owning the Mage: carry on as the Mage, on the Mage's own run.
    const sim = new Sim(freshSave(), 5);
    sim.chooseStarter('mage');
    sim.save.gold = 1234;
    const b = JSON.parse(JSON.stringify(sim.save));
    b.runs = { mage: { ...b, runs: undefined } };
    b.skins = ['ranger', 'mage']; b.skin = 'ranger'; b.gold = 5;
    const mb = migrate(b);
    expect(mb.skin).toBe('mage');
    expect(mb.skins).toEqual(['mage']);
    expect(mb.gold).toBe(1234);
    expect(mb.runs.mage).toBeUndefined();
    expect(canWield('mage', mb.equipped!.form)).toBe(true);

    // Only the Ranger: choose a hero again.
    const c = { ...freshSave(), starterChosen: true, skins: ['ranger'], skin: 'ranger', gold: 50 } as Record<string, unknown>;
    const mc = migrate(c);
    expect(mc.starterChosen).toBe(false);
    expect(mc.missions.gems).toBe(freshSave().missions.gems + 250);
    expect(mc.gold).toBe(0);
  });
});
