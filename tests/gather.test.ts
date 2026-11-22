import { describe, expect, it } from 'vitest';
import { migrate } from '../src/core/save';
import { PROP_MATERIAL } from '../src/sim/gather';
import { Sim, freshSave } from '../src/sim/sim';

const tickN = (sim: Sim, n: number) => { for (let i = 0; i < n; i++) { sim.tick(); sim.events.clear(); } };

describe('gathering wood and stone', () => {
  it('scatters pieces next to trees and rocks when an area starts', () => {
    const sim = new Sim(freshSave(), 1);
    const live = sim.gather.pickups.filter((p) => p.alive);
    expect(live.length).toBeGreaterThan(0);
    for (const p of live) expect(sim.map.blocked(p.x, p.y, 2)).toBe(false);
  });

  it('collects a piece when the hero walks over it', () => {
    const save = freshSave();
    const sim = new Sim(save, 2);
    const p = sim.gather.pickups.find((q) => q.alive)!;
    const kind = p.kind;
    sim.hero.x = p.x; sim.hero.y = p.y;
    sim.gather.update(1 / 30);
    expect(p.alive).toBe(false);
    expect(save.materials[kind]).toBe(1);
  });

  it('respawns ground pieces over time, up to a cap', () => {
    const sim = new Sim(freshSave(), 3);
    for (const p of sim.gather.pickups) p.alive = false;
    sim.hero.x = -1000; // far from everything, so nothing gets collected
    for (let i = 0; i < 30 * 200; i++) sim.gather.update(1 / 30);
    const n = sim.gather.alive;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(8);
  });

  it('chopping a tree or rock in the swing arc can knock a piece loose', () => {
    const sim = new Sim(freshSave(), 4);
    for (const p of sim.gather.pickups) p.alive = false;
    const i = sim.map.props.findIndex((p) => PROP_MATERIAL[p.kind] && p.x > 60 && p.x < 580 && p.y > 60 && p.y < 580);
    const prop = sim.map.props[i];
    let drops = 0;
    for (let k = 0; k < 40; k++) {
      sim.hero.x = prop.x - prop.r - 8; sim.hero.y = prop.y;
      (sim.gather as unknown as { chopCd: Map<number, number> }).chopCd.clear();
      const before = sim.gather.alive;
      sim.gather.chop(0, 22, 1.25); // swing facing +x, toward the prop
      if (sim.gather.alive > before) drops++;
      for (const p of sim.gather.pickups) p.alive = false;
    }
    expect(drops).toBeGreaterThan(5);
    expect(drops).toBeLessThan(40);
  });

  it('keeps materials through Reforge and migrates old saves', () => {
    const save = freshSave();
    Object.assign(save, { stage: 60, highestStage: 60, bestEver: 60, materials: { wood: 12, stone: 7 } });
    const sim = new Sim(save, 5);
    sim.reforge();
    expect(save.materials).toEqual({ wood: 12, stone: 7 });
    const old = migrate({ ...freshSave(), materials: undefined });
    expect(old.materials).toEqual({ wood: 0, stone: 0 });
  });

  it('runs alongside normal play without errors', () => {
    const sim = new Sim(freshSave(), 6);
    tickN(sim, 30 * 120);
    expect(sim.save.materials.wood + sim.save.materials.stone).toBeGreaterThanOrEqual(0);
  });
});
