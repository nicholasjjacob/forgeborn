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

  it('starting as the Ranger owns only the Ranger, with a bow', () => {
    const sim = new Sim(freshSave(), 1);
    expect(sim.chooseStarter('ranger')).toBe(true);
    const s = sim.save;
    expect(s.skin).toBe('ranger');
    expect(s.skins).toEqual(['ranger']);
    expect(s.starterChosen).toBe(true);
    expect(canWield('ranger', s.equipped!.form)).toBe(true);
    expect(s.equipped!.form).toBe(skinDef('ranger').forms[0]);
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
    // A Ranger start doesn't get the Knight for free on reload.
    const r = new Sim(freshSave(), 4);
    r.chooseStarter('ranger');
    expect(migrate(JSON.parse(JSON.stringify(r.save))).skins).toEqual(['ranger']);
    expect(STARTERS).toEqual(['knight', 'ranger', 'mage']);
  });
});
