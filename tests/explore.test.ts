import { describe, expect, it } from 'vitest';
import { Explored } from '../src/sim/explore';
import { Sim, freshSave } from '../src/sim/sim';

describe('forest fog of war', () => {
  it('reveals around a point and survives a save round trip', () => {
    const ex = new Explored(1500, 1650);
    expect(ex.seen(400, 400)).toBe(false);
    expect(ex.reveal(400, 400)).toBe(true);
    expect(ex.seen(400, 400)).toBe(true);
    expect(ex.seen(1200, 1200)).toBe(false);
    expect(ex.reveal(400, 400)).toBe(false); // nothing new
    const back = new Explored(1500, 1650, ex.toString());
    expect(back.seen(400, 400)).toBe(true);
    expect(back.seen(1200, 1200)).toBe(false);
  });

  it('the hero uncovers the map as they walk, and it is saved', () => {
    const save = freshSave();
    const sim = new Sim(save, 1);
    sim.tick();
    expect(save.explored).not.toBe('');
    expect(sim.explored!.seen(sim.hero.x, sim.hero.y)).toBe(true);
    expect(sim.explored!.seen(100, 100)).toBe(false);
  });
});
