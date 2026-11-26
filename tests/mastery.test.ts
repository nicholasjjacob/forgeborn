import { describe, expect, it } from 'vitest';
import { Sim, freshSave } from '../src/sim/sim';
import { MASTERY_GOALS } from '../src/sim/mastery';
import { PLAYABLE_ZONES } from '../src/sim/zones';
import { migrate } from '../src/core/save';

describe('hero mastery', () => {
  it('starts near 0% and reaches 100% when every goal is met', () => {
    const save = freshSave();
    const sim = new Sim(save, 1);
    expect(sim.mastery('knight').complete).toBe(false);
    expect(sim.mastery('knight').pct).toBeLessThan(20);
    const values = MASTERY_GOALS.map((g) => g.target);
    save.mastery.knight = values;
    const m = sim.mastery('knight');
    expect(m.complete).toBe(true);
    expect(m.pct).toBe(100);
    expect(m.done).toBe(MASTERY_GOALS.length);
  });

  it('progress is per hero, and a Reforge never takes it back', () => {
    const save = freshSave();
    save.skins = ['knight', 'mage'];
    save.missions.gems = 0;
    const sim = new Sim(save, 1);
    save.level = 30; save.zoneBosses = PLAYABLE_ZONES; save.highestStage = 60; save.forgeLevel = 9;
    save.equipped = { id: 99, rarity: 4, form: 0, traits: [] };
    const before = sim.mastery('knight');
    expect(before.goals.find((g) => g.goal.id === 'bosses')!.done).toBe(true);
    expect(before.goals.find((g) => g.goal.id === 'weapon')!.done).toBe(true);
    expect(sim.mastery('mage').pct).toBe(0);
    sim.reforge();
    expect(save.level).toBeLessThan(30);
    const after = sim.mastery('knight');
    expect(after.pct).toBe(before.pct);
    // Switching heroes keeps the Knight's record too.
    sim.selectSkin('mage');
    expect(sim.mastery('knight').pct).toBe(before.pct);
    expect(sim.mastery('mage').pct).toBeLessThan(before.pct);
  });

  it('saved records survive migration and bad data is dropped', () => {
    const s = freshSave();
    s.mastery = { knight: [3, 40, 20, 5, 2] };
    const again = migrate(JSON.parse(JSON.stringify({ ...s, mastery: { ...s.mastery, junk: 'x' } })));
    expect(again.mastery.knight).toEqual([3, 40, 20, 5, 2]);
    expect(again.mastery.junk).toBeUndefined();
  });
});
