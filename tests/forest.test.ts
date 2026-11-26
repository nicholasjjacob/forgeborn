import { describe, expect, it } from 'vitest';
import { BIOMES, FOREST, MISSING_LINKS, REGION_MONSTERS, biomeArrival, borderDepth, forestRegion } from '../src/sim/forest';
import { GameMap } from '../src/sim/map';

describe('the forest world', () => {
  it('every region touches the neighbours it should open onto', () => {
    expect(MISSING_LINKS).toEqual([]);
    expect(FOREST.passes.length).toBe(12);
    // Every pass is barricaded for the harder side, and every region past the first has a way in.
    expect(FOREST.gates.length).toBe(12);
    for (let z = 1; z < 9; z++) expect(FOREST.gates.some((g) => g.zone === z), `zone ${z}`).toBe(true);
    // One region per zone, each with its own boss lair.
    expect(new Set(BIOMES.map((b) => b.zone)).size).toBe(9);
    expect(FOREST.lairs.map((l) => l.zone)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('places landmarks, haunts and lairs inside their own regions, clear of the borders', () => {
    for (const l of FOREST.landmarks) expect(forestRegion(l.x, l.y), l.name).toBe(l.biome);
    for (const t of FOREST.territories) {
      expect(forestRegion(t.x, t.y), t.landmark).toBe(t.biome);
      expect(borderDepth(t.x, t.y)).toBeGreaterThan(40);
    }
    for (const l of FOREST.lairs) expect(BIOMES[l.biome].zone).toBe(l.zone);
    // Some regions are overrun with hordes.
    expect(FOREST.territories.filter((t) => t.horde).length).toBeGreaterThanOrEqual(6);
  });

  it('every arrival point (start, tiers, fast travel) is open ground', () => {
    const map = new GameMap(0);
    for (const sp of FOREST.spawns) expect(map.blocked(sp.x, sp.y, 8)).toBe(false);
    BIOMES.forEach((_, b) => {
      const p = biomeArrival(b);
      expect(forestRegion(p.x, p.y)).toBe(b);
      expect(map.blocked(p.x, p.y, 8)).toBe(false);
    });
  });
});

describe('forest borders', () => {
  /** Regions reachable on foot from the start (flood fill over open ground, 10-unit steps). */
  const reachable = (map: GameMap): Set<number> => {
    const S = 10, cols = Math.ceil(map.w / S), rows = Math.ceil(map.h / S);
    const seen = new Uint8Array(cols * rows);
    const sp = FOREST.spawns[0];
    const q = [Math.floor(sp.y / S) * cols + Math.floor(sp.x / S)];
    seen[q[0]] = 1;
    const regions = new Set<number>();
    for (let h = 0; h < q.length; h++) {
      const i = q[h], c = i % cols, r = (i - c) / cols;
      regions.add(forestRegion((c + 0.5) * S, (r + 0.5) * S));
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (seen[j] || map.blocked((cc + 0.5) * S, (rr + 0.5) * S, 6)) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    regions.delete(-1);
    return regions;
  };

  it('barricades hold: each region opens in turn, and with all open every region is reachable', () => {
    const map = new GameMap(0);
    const zonesReached = () => [...reachable(map)].map((b) => BIOMES[b].zone).sort((a, b) => a - b);
    expect(zonesReached()).toEqual([0]);
    for (let z = 1; z < 9; z++) {
      map.openGates.add(z);
      expect(zonesReached()).toEqual(Array.from({ length: z + 1 }, (_, i) => i));
    }
  });
});

describe('forest monsters', () => {
  it('every region has two monsters of its own (none shared), each with a haunt there', () => {
    expect(REGION_MONSTERS.every((r) => r.length === 2)).toBe(true);
    const all = REGION_MONSTERS.flat().map(([a, s]) => `${a}.${s}`);
    expect(new Set(all).size).toBe(all.length); // no monster lives in two regions
    for (const t of FOREST.territories) {
      expect(REGION_MONSTERS[t.biome].some(([a, s]) => a === t.area && s === t.monster), t.landmark).toBe(true);
    }
    REGION_MONSTERS.forEach((r, b) => r.forEach(([a, s]) => {
      expect(FOREST.territories.some((t) => t.biome === b && t.area === a && t.monster === s), `${b}: ${a}.${s}`).toBe(true);
    }));
  });
});
