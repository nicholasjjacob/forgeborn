import { describe, expect, it } from 'vitest';
import { Sim, freshSave } from '../src/sim/sim';
import { MASTERY_GOALS } from '../src/sim/mastery';
import { PLAYABLE_ZONES } from '../src/sim/zones';
import { migrate } from '../src/core/save';
import { SKINS, heroModelFile } from '../src/sim/skins';

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

  it('a test unlock (?bones=) lets a hero wear its skeleton form without mastery', () => {
    const save = freshSave();
    save.skins = ['knight']; save.skin = 'knight';
    const sim = new Sim(save, 1);
    expect(sim.setSkeleton('knight', true)).toBe(false);
    sim.testBones.add('knight');
    expect(sim.skeletonUnlocked('knight')).toBe(true);
    expect(sim.setSkeleton('knight', true)).toBe(true);
    expect(sim.skeletonUnlocked('mage')).toBe(false);
  });

  it('the skeleton form unlocks at 100% and can be worn or taken off', () => {
    const save = freshSave();
    save.skins = ['knight', 'mage'];
    const sim = new Sim(save, 1);
    expect(heroModelFile('knight', save.bones)).toBe('hero_knight');
    expect(sim.setSkeleton('knight', true)).toBe(false); // not mastered yet
    save.mastery.knight = MASTERY_GOALS.map((g) => g.target);
    expect(sim.setSkeleton('knight', true)).toBe(true);
    expect(heroModelFile('knight', save.bones)).toBe('skel_minion');
    expect(sim.setSkeleton('barbarian', true)).toBe(false); // not owned
    // Kept through a reload (unknown heroes dropped); taking it off always works.
    const back = migrate(JSON.parse(JSON.stringify({ ...save, bones: { ...save.bones, ranger: true, mage: 'x' } })));
    expect(back.bones).toEqual({ knight: true });
    expect(sim.setSkeleton('knight', false)).toBe(true);
    expect(heroModelFile('knight', save.bones)).toBe('hero_knight');
  });

  it('every hero has a skeleton form', async () => {
    // (Node's fs, loaded by name: the project's types are browser-only.)
    const { existsSync } = await import(/* @vite-ignore */ ['node', 'fs'].join(':')) as { existsSync(p: string): boolean };
    for (const k of SKINS) {
      expect(k.skeleton.model).toMatch(/^skel_/);
      expect(existsSync(`public/models/${k.skeleton.model}.glb`)).toBe(true);
    }
  });
});
