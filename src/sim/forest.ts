import type { Rng } from '../core/rng';
import type { PropKind } from './areas';

/**
 * The Greenwood: the first terrain as one big hand-designed world. Nine regions ("biomes"), each
 * an organic blob with its own colours, fit together like a patchwork, split by ragged rocky
 * borders with openings between neighbours. Every region is its own zone, a step harder than
 * the last (zone numbers in brackets):
 *
 *        ┌ Crimson Hollow (6) ┐┌ Old Mill Crossing (7) ┐┌──── Emerald Mere (8) ───┐
 *        └ Emberleaf Woods (3) ┘└ Bloomwood Groves (4) ┘└ Tidepine Thicket (5) ┘
 *        └ Goldenrod Fields (1) ┘└ Meadow Outskirts (0) ┘└ Mistwater Glade (2) ┘   ← start
 *
 * Every pass is barricaded until the region it leads into opens (the hero's level + the
 * previous region's boss). Monsters live in territories around named landmarks (some regions are
 * overrun with big hordes); each region's boss waits in its lair. All positions in world units.
 *
 * The regions are a warped Voronoi diagram: a point belongs to the biome whose (stretched) seed
 * is nearest after a smooth noise warp, so borders wander naturally. Everything is precomputed
 * on a RASTER-unit grid at load time (lookups, borders, distance from borders).
 */

export const FOREST_W = 4000;
export const FOREST_H = 3600;
const RASTER = 20;
const RC = FOREST_W / RASTER, RR = FOREST_H / RASTER;

/** One region of the forest. Colours are KayKit colourway numbers (1 green, 2 emerald, 3 lime, 4 teal, 5 gold, 6 orange, 7 red, 8 pink). */
export interface Biome {
  name: string;
  zone: number;
  /** Seed (the region's heart, also where fast travel arrives) and its stretch. */
  x: number; y: number; rx: number; ry: number;
  trees: string[];        // tree model names (without colour)
  foliage: number[];      // tree / bush colourways, the first most common
  rock: number;           // rock colourway
  ground: string;         // ground tint
  map: string;            // minimap / world map colour
  density: number;        // how thickly wooded
  ponds?: [number, number, number][]; // [dx, dy, size] water from the seed
}

export const BIOMES: Biome[] = [
  { name: 'Meadow Outskirts', zone: 0, x: 1900, y: 3000, rx: 560, ry: 540, trees: ['Tree_1_A', 'Tree_1_B', 'Tree_1_C', 'Tree_3_A', 'Tree_3_B', 'Tree_2_A'], foliage: [1, 3], rock: 1, ground: '#86cc55', map: '#6cc24e', density: 0.55 },
  { name: 'Goldenrod Fields', zone: 1, x: 760, y: 2900, rx: 660, ry: 580, trees: ['Tree_1_A', 'Tree_1_C', 'Tree_6_A', 'Tree_2_B'], foliage: [5, 3], rock: 7, ground: '#d9c752', map: '#e0b23a', density: 0.4 },
  { name: 'Mistwater Glade', zone: 2, x: 3000, y: 3060, rx: 660, ry: 480, trees: ['Tree_1_A', 'Tree_6_A', 'Tree_4_A', 'Tree_1_B'], foliage: [4, 1], rock: 4, ground: '#78c8b4', map: '#7cc7e8', density: 0.5,
    ponds: [[260, -180, 1], [-300, 120, 0.8], [120, 230, 0.6]] },
  { name: 'Bloomwood Groves', zone: 4, x: 1820, y: 1740, rx: 740, ry: 720, trees: ['Tree_1_A', 'Tree_6_A', 'Tree_7_A', 'Tree_1_B', 'Tree_6_B'], foliage: [8, 7, 1], rock: 3, ground: '#c6a6c8', map: '#c47fd0', density: 0.75 },
  { name: 'Emberleaf Woods', zone: 3, x: 560, y: 1720, rx: 520, ry: 660, trees: ['Tree_1_A', 'Tree_3_A', 'Tree_6_A', 'Tree_3_B'], foliage: [6, 5], rock: 5, ground: '#d8a04e', map: '#e88a3a', density: 0.8 },
  { name: 'Tidepine Thicket', zone: 5, x: 3200, y: 2000, rx: 640, ry: 560, trees: ['Tree_4_A', 'Tree_4_B', 'Tree_5_A', 'Tree_5_B'], foliage: [4, 2], rock: 4, ground: '#5f9fb0', map: '#3f8fd8', density: 0.9 },
  { name: 'Old Mill Crossing', zone: 7, x: 1760, y: 540, rx: 600, ry: 480, trees: ['Tree_4_A', 'Tree_5_A', 'Tree_5_C', 'Tree_1_A', 'Tree_Bare_1_A'], foliage: [5, 6, 2], rock: 5, ground: '#b99560', map: '#a8743a', density: 0.7 },
  { name: 'Crimson Hollow', zone: 6, x: 640, y: 640, rx: 560, ry: 540, trees: ['Tree_1_A', 'Tree_6_A', 'Tree_7_A', 'Tree_Bare_2_A'], foliage: [7, 6], rock: 6, ground: '#a86a52', map: '#8a3a2a', density: 0.75 },
  { name: 'Emerald Mere', zone: 8, x: 3150, y: 820, rx: 820, ry: 700, trees: ['Tree_3_A', 'Tree_1_A', 'Tree_5_A', 'Tree_3_C'], foliage: [2, 4], rock: 1, ground: '#4ea86a', map: '#2e9e58', density: 0.75,
    ponds: [[200, -150, 1.6], [-260, 160, 0.9], [330, 260, 0.7]] },
];

/** Which neighbours open onto each other (each pass is barricaded for the harder side's zone). */
const LINKS: [number, number][] = [
  [1, 0], [0, 2], [4, 3], [3, 5], [7, 6], [6, 8],
  [1, 4], [0, 3], [2, 5], [4, 7], [3, 6], [5, 8],
];

export interface Territory { zone: number; biome: number; area: number; monster: number; x: number; y: number; r: number; count: number; landmark: string; horde?: boolean }
export interface Lair { zone: number; biome: number; x: number; y: number; r: number; name: string }
export interface Landmark { name: string; x: number; y: number; zone: number; biome: number; style: string }
/** A barricaded pass; `zone` is the tier it leads into (it opens once that zone is unlocked). */
export interface Gate { zone: number; x: number; y: number }
/** An opening between two regions (barricaded when `gate` > 0). */
export interface Pass { a: number; b: number; gate: number; x: number; y: number }
export interface Pond { x: number; y: number; r: number }

export interface ForestInfo {
  biomes: Biome[];
  territories: Territory[];
  lairs: Lair[];
  landmarks: Landmark[];
  gates: Gate[];
  passes: Pass[];
  ponds: Pond[];
  /** Where the hero arrives in each tier (start, respawn, fast travel). */
  spawns: { x: number; y: number }[];
}

// --- The region raster ----------------------------------------------------------------------

function hash2(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in [-1, 1]. */
function noise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** The biome under a point, straight from the warped Voronoi (-1 = outside the forest). */
function regionAt(x: number, y: number): number {
  // Warp: two octaves of noise move the sample point, so borders meander.
  const wx = x + noise(x / 760, y / 760, 1) * 260 + noise(x / 260, y / 260, 3) * 110 + noise(x / 90, y / 90, 5) * 28;
  const wy = y + noise(x / 760, y / 760, 2) * 260 + noise(x / 260, y / 260, 4) * 110 + noise(x / 90, y / 90, 6) * 28;
  let best = -1, bd = Infinity;
  BIOMES.forEach((b, i) => {
    const d = Math.hypot((wx - b.x) / b.rx, (wy - b.y) / b.ry);
    if (d < bd) { bd = d; best = i; }
  });
  // The outer edge of the forest: past the nearest seed's reach (ragged), or the map edge.
  if (bd > 1.16 || x < 60 || y < 60 || x > FOREST_W - 60 || y > FOREST_H - 60) return -1;
  return best;
}

const raster = new Int8Array(RC * RR);
for (let r = 0; r < RR; r++) for (let c = 0; c < RC; c++) raster[r * RC + c] = regionAt((c + 0.5) * RASTER, (r + 0.5) * RASTER);
const at = (c: number, r: number) => (c < 0 || r < 0 || c >= RC || r >= RR ? -1 : raster[r * RC + c]);

/** The region that is a given zone. */
export const zoneBiome = (zone: number) => BIOMES.findIndex((b) => b.zone === zone);

/** Which biome a point lies in (-1: outside, in the deep forest past the border). */
export function forestRegion(x: number, y: number): number {
  return at(Math.floor(x / RASTER), Math.floor(y / RASTER));
}
/** Which zone a point lies in (its region's), or -1 outside the regions. */
export function forestZone(x: number, y: number): number {
  const b = forestRegion(x, y);
  return b >= 0 ? BIOMES[b].zone : -1;
}

/** Border cells: a region cell next to another region (or the outside). */
const border = new Uint8Array(RC * RR);
for (let r = 0; r < RR; r++) for (let c = 0; c < RC; c++) {
  const v = at(c, r);
  if (v < 0) continue;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (at(c + dc, r + dr) !== v) { border[r * RC + c] = 1; break; }
  }
}
/** Cells from the nearest border, inside each region (BFS). */
const depth = new Int16Array(RC * RR).fill(-1);
{
  const q: number[] = [];
  for (let i = 0; i < RC * RR; i++) if (border[i]) { depth[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], c = i % RC, r = (i - c) / RC;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= RC || rr >= RR) continue;
      const j = rr * RC + cc;
      if (depth[j] >= 0 || raster[j] < 0) continue;
      depth[j] = depth[i] + 1;
      q.push(j);
    }
  }
}
/** How far (world units) a point is inside its region's border (0 on the border, -1 outside). */
export function borderDepth(x: number, y: number): number {
  const c = Math.floor(x / RASTER), r = Math.floor(y / RASTER);
  if (c < 0 || r < 0 || c >= RC || r >= RR) return -1;
  const d = depth[r * RC + c];
  return d < 0 ? -1 : d * RASTER;
}

/** Nudge a point toward its biome's seed until it is at least `inset` inside that biome. */
function settle(b: number, x: number, y: number, inset: number): { x: number; y: number } {
  const s = BIOMES[b];
  for (let k = 0; k < 40; k++) {
    if (forestRegion(x, y) === b && borderDepth(x, y) >= inset) return { x, y };
    x += (s.x - x) * 0.08; y += (s.y - y) * 0.08;
  }
  return { x: s.x, y: s.y };
}

// --- Passes ---------------------------------------------------------------------------------

const PASS_HALF = 44;
/** Links whose regions don't touch (a layout mistake: the tests check this stays empty). */
export const MISSING_LINKS: string[] = [];
const PASSES: Pass[] = LINKS.flatMap(([a, b]): Pass[] => {
  const A = BIOMES[a], B = BIOMES[b];
  const gate = Math.max(A.zone, B.zone);
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  let best: Pass | null = null, bd = Infinity;
  for (let r = 0; r < RR; r++) for (let c = 0; c < RC; c++) {
    if (raster[r * RC + c] !== a) continue;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (at(c + dc, r + dr) !== b) continue;
      const x = (c + 0.5 + dc / 2) * RASTER, y = (r + 0.5 + dr / 2) * RASTER;
      // The shared border nearest the middle between the two hearts, away from the outside.
      let edge = 0;
      for (let k = -4; k <= 4; k++) for (let l = -4; l <= 4; l++) if (at(c + k, r + l) < 0) edge = 1;
      const d = Math.hypot(x - mx, y - my) + edge * 2000;
      if (d < bd) { bd = d; best = { a, b, gate, x, y }; }
    }
  }
  if (!best) { MISSING_LINKS.push(`${A.name} / ${B.name}`); return []; }
  return [best];
});

// --- Landmarks, territories, lairs ---------------------------------------------------------

/** [biome, name, dx, dy, style] from the biome's seed. */
const LANDMARKS: [number, string, number, number, string][] = [
  [0, 'Meadow Ring', 20, -80, 'lair'], [2, 'Sunken Stones', -40, -110, 'lair'], [4, 'Ember Ring', 130, -210, 'lair'],
  [5, 'Frostpine Circle', -210, -150, 'lair'], [7, 'Crimson Pit', -210, -180, 'lair'], [8, 'Mere Shrine', 40, 230, 'lair'],
  [0, 'Mossy Boulders', -330, -60, 'boulders'], [0, 'Standing Stones', 300, 110, 'stones'], [0, 'Great Oak', -40, -300, 'oak'], [0, 'Old Watchtree', 250, -260, 'stump'],
  [1, "Champion's Ring", -180, -40, 'lair'], [1, 'Sunflower Steps', 280, 220, 'cairn'], [1, 'Harvest Stones', 260, -300, 'stones'], [1, 'Golden Barrow', -330, 300, 'boulders'],
  [2, 'Mirror Pond', 260, -180, 'none'], [2, 'Heron Stones', -260, -230, 'stones'], [2, 'Drowned Oak', -330, 260, 'stump'], [2, 'Mossy Ford', 300, 260, 'boulders'],
  [3, 'Bloomheart Glade', 0, -90, 'lair'], [3, 'Fairy Ring', -360, 160, 'fairy'], [3, 'Twin Spires', 330, 230, 'spires'], [3, 'Petal Falls', -260, -330, 'bramble'],
  [4, 'Bramble Hollow', -200, -260, 'bramble'], [4, 'Ember Stump', 260, 160, 'stump'], [4, 'Fox Den', -250, 300, 'boulders'],
  [5, 'Tidepine Spire', 220, -250, 'spires'], [5, 'Driftwood Hollow', -270, 210, 'stump'], [5, 'Blue Cairn', 280, 300, 'cairn'],
  [6, 'Old Mill Ruins', 120, -160, 'lair'], [6, 'Old Well', -300, 140, 'well'], [6, 'Wayfarer Cairn', 330, 260, 'cairn'], [6, 'Hollow Stump', -280, -260, 'stump'],
  [7, 'Bloodroot Altar', 160, -150, 'stones'], [7, 'Crimson Spires', -260, 240, 'spires'], [7, 'Raven Stump', 300, 260, 'stump'],
  [8, 'Sunken Shrine', -300, -250, 'stones'], [8, 'Heron Isle', 330, -60, 'boulders'], [8, 'Mossback Barrow', -220, 300, 'boulders'],
];

const LMK: Landmark[] = LANDMARKS.map(([b, name, dx, dy, style]) => {
  const s = BIOMES[b];
  const p = settle(b, s.x + dx, s.y + dy, 90);
  return { name, x: p.x, y: p.y, zone: s.zone, biome: b, style };
});
const L = (name: string) => LMK.find((l) => l.name === name)!;

/**
 * Each region's own three monsters, borrowed from every terrain's roster: [terrain, slot].
 * Terrains: 0 Greenwood, 1 Mirewood, 2 Sunscar, 3 Hollow Deep, 4 Frostveil, 5 Emberforge.
 */
export const REGION_MONSTERS: [number, number][][] = [
  [[0, 0], [0, 1], [0, 2]], // Meadow Outskirts: Moss Blob, Meadow Pigeon, Mushnub
  [[2, 2], [2, 1], [2, 0]], // Goldenrod Fields: Sand Alpaca, Dune Dino, Cactling
  [[1, 0], [1, 2], [1, 1]], // Mistwater Glade: Spiky Blob, Mire Bee, Bog Glub
  [[4, 2], [0, 0], [1, 2]], // Bloomwood Groves: Snow Sprite, Moss Blob, Mire Bee
  [[5, 0], [5, 2], [2, 1]], // Emberleaf Woods: Cinder Orc, Ember Demon, Dune Dino
  [[4, 0], [4, 1], [4, 2]], // Tidepine Thicket: Frost Yeti, Ice Squid, Snow Sprite
  [[5, 1], [3, 2], [0, 2]], // Old Mill Crossing: Bone Brute, Golemite, Mushnub
  [[3, 1], [3, 0], [5, 2]], // Crimson Hollow: Cave Ghost, Cave Alien, Ember Demon
  [[1, 1], [4, 1], [1, 0]], // Emerald Mere: Bog Glub, Ice Squid, Spiky Blob
];
/** Every monster model the forest's regions use (to preload). */
export const FOREST_MONSTERS: string[] = [...new Set(REGION_MONSTERS.flat().map(([a, s]) => `m${a}_${s}`))];

/** [landmark, which of the region's monsters (0-2), dx, dy, radius, count, horde] (the haunt sits off its landmark). */
const HAUNTS: [string, number, number, number, number, number, boolean?][] = [
  // Meadow tier
  ['Mossy Boulders', 0, 40, 30, 140, 6], ['Standing Stones', 1, 110, -90, 120, 5], ['Great Oak', 2, 0, 60, 110, 4], ['Old Watchtree', 0, -60, 40, 110, 4],
  ['Sunflower Steps', 1, -40, -90, 150, 6], ['Harvest Stones', 2, -80, 60, 130, 5], ['Golden Barrow', 0, 80, -60, 210, 15, true],
  ['Heron Stones', 1, 90, 80, 120, 6], ['Drowned Oak', 0, 80, -40, 130, 6], ['Mossy Ford', 2, -70, -40, 200, 14, true],
  // Bloomwood tier
  ['Fairy Ring', 2, 60, -40, 140, 7], ['Twin Spires', 1, 110, -110, 120, 7], ['Petal Falls', 0, 60, 80, 210, 16, true],
  ['Bramble Hollow', 0, 40, 60, 130, 7], ['Ember Stump', 2, -60, -70, 130, 7], ['Fox Den', 1, 80, -60, 210, 16, true],
  ['Tidepine Spire', 1, -80, 70, 130, 7], ['Driftwood Hollow', 2, 70, -50, 140, 7], ['Blue Cairn', 0, -80, -60, 120, 6],
  // Old Mill tier
  ['Old Well', 0, 70, -50, 130, 7], ['Wayfarer Cairn', 1, 100, -100, 120, 7], ['Hollow Stump', 2, 60, 60, 140, 8],
  ['Bloodroot Altar', 2, -70, 70, 220, 18, true], ['Crimson Spires', 1, 90, -70, 130, 8], ['Raven Stump', 0, -80, -60, 130, 8],
  ['Sunken Shrine', 1, 90, 70, 140, 8], ['Heron Isle', 2, -90, 80, 130, 8], ['Mossback Barrow', 0, 90, -70, 220, 18, true],
];

/** The forest is crowded: every haunt holds about twice its listed pack (hordes nearly so). */
const CROWD = 2, HORDE_CROWD = 1.75, SPREAD = 1.2;
const TERRITORIES: Territory[] = HAUNTS.map(([name, monster, dx, dy, r0, count0, horde]) => {
  const l = L(name);
  const r = r0 * SPREAD, count = Math.round(count0 * (horde ? HORDE_CROWD : CROWD));
  const p = settle(l.biome, l.x + dx, l.y + dy, r * 0.55);
  const [area, slot] = REGION_MONSTERS[l.biome][monster];
  return { zone: l.zone, biome: l.biome, area, monster: slot, x: p.x, y: p.y, r, count, landmark: name, horde };
});

/** One boss lair per region (its 'lair' landmark): bigger the deeper the zone. */
const LAIRS: Lair[] = LMK.filter((l) => l.style === 'lair')
  .map((l) => ({ zone: l.zone, biome: l.biome, x: l.x, y: l.y, r: 72 + l.zone * 2.5, name: l.name }))
  .sort((a, b) => a.zone - b.zone);

/** Water: a cluster of overlapping circles per pond. */
const PONDS: Pond[] = [];
BIOMES.forEach((b, i) => {
  for (const [dx, dy, size] of b.ponds ?? []) {
    const c = settle(i, b.x + dx, b.y + dy, 110 * size + 40);
    const n = 3 + Math.round(size * 2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i, d = k === 0 ? 0 : 38 * size;
      PONDS.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d * 0.8, r: (48 + hash2(i, k, 9) * 22) * size });
    }
  }
});
const inPond = (x: number, y: number, pad: number) => PONDS.some((p) => Math.hypot(x - p.x, y - p.y) < p.r + pad);

// Arrival points, one per zone (start, respawn, fast travel): each region's heart.
const START = settle(0, BIOMES[0].x, BIOMES[0].y + 180, 120);
const arrival = (b: number) => (b === 0 ? START : settle(b, BIOMES[b].x, BIOMES[b].y + 60, 100));
const SPAWNS = BIOMES.map((_, z) => arrival(zoneBiome(z)));

export const FOREST: ForestInfo = {
  biomes: BIOMES,
  territories: TERRITORIES,
  lairs: LAIRS,
  landmarks: LMK,
  gates: PASSES.filter((p) => p.gate > 0).map((p) => ({ zone: p.gate, x: p.x, y: p.y })),
  passes: PASSES,
  ponds: PONDS,
  spawns: SPAWNS,
};

/** Where fast travel to a region arrives: its heart, kept clear. */
export function biomeArrival(b: number): { x: number; y: number } {
  return arrival(b);
}

// --- Trails ---------------------------------------------------------------------------------

/** Dirt trails: each region's heart to its passes (and on through them) and to its landmarks. */
function buildPaths(): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const wiggle = (x0: number, y0: number, x1: number, y1: number, seed: number) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 110));
    const nx = -(y1 - y0), ny = x1 - x0, len = Math.hypot(nx, ny) || 1;
    let px = x0, py = y0;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const off = k === n ? 0 : noise(seed * 3.7 + t * 2.3, seed, 7) * 38;
      const x = x0 + (x1 - x0) * t + (nx / len) * off, y = y0 + (y1 - y0) * t + (ny / len) * off;
      out.push([px, py, x, y]);
      px = x; py = y;
    }
  };
  BIOMES.forEach((_b, i) => {
    const hub = biomeArrival(i);
    PASSES.forEach((p, k) => {
      if (p.a !== i && p.b !== i) return;
      const other = BIOMES[p.a === i ? p.b : p.a];
      // Through the pass: aim a little short of it, then straight across.
      const dx = other.x - p.x, dy = other.y - p.y, dl = Math.hypot(dx, dy) || 1;
      wiggle(hub.x, hub.y, p.x - (dx / dl) * 50, p.y - (dy / dl) * 50, i * 13 + k);
      out.push([p.x - (dx / dl) * 50, p.y - (dy / dl) * 50, p.x + (dx / dl) * 50, p.y + (dy / dl) * 50]);
    });
    LMK.filter((l) => l.biome === i).forEach((l, k) => wiggle(hub.x, hub.y, l.x, l.y, i * 31 + k + 100));
  });
  return out;
}
export const FOREST_PATHS: readonly [number, number, number, number][] = buildPaths();

// --- Props ----------------------------------------------------------------------------------

/** A forest prop: a specific pack model at a target height (or width for `by: 'w'`). */
export interface ForestProp { kind: PropKind; x: number; y: number; r: number; model: string; size: number; by?: 'h' | 'w'; rot: number; gate?: number; invisible?: boolean }

const T = (name: string, c: number) => `nf_${name}_Color${c}`;
const TREE_H: Record<string, number> = { Tree_1: 34, Tree_2: 34, Tree_3: 36, Tree_4: 42, Tree_5: 40, Tree_6: 38, Tree_7: 36, Tree_Bare_1: 28, Tree_Bare_2: 30 };
const treeHeight = (name: string) => TREE_H[name.replace(/_[A-Z]$/, '')] ?? 34;
const BUSH = ['Bush_1_A', 'Bush_1_E', 'Bush_4_D', 'Bush_2_D'];
const BOULDER = ['Rock_3_A', 'Rock_3_C', 'Rock_3_E', 'Rock_5_A', 'Rock_5_C'];
const CLIFF = ['Rock_1_A', 'Rock_1_B', 'Rock_1_C', 'Rock_1_G', 'Rock_1_H', 'Rock_2_A', 'Rock_2_B'];
const SPIRE = ['Rock_4_D', 'Rock_4_E', 'Rock_4_F', 'Rock_4_G'];
const PILE = ['Rock_5_E', 'Rock_5_F', 'Rock_6_E', 'Rock_6_F'];
export const FOREST_GRASS = ['Grass_1_A', 'Grass_1_B', 'Grass_2_A', 'Grass_2_C'];

/** Grass colourway per biome: greens stay, the warm colours get lime grass, pink gets green. */
const grassColour = (b: Biome) => ([1, 2, 3, 4].includes(b.foliage[0]) ? b.foliage[0] : b.foliage[0] === 8 ? 1 : 3);

/** Every model name (and colourway) the forest uses: [name, colourway]. For the asset build. */
export function forestModelList(): [string, number][] {
  const set = new Map<string, [string, number]>();
  const add = (n: string, c: number) => set.set(`${n}|${c}`, [n, c]);
  for (const b of BIOMES) {
    for (const t of b.trees) for (const c of b.foliage) add(t, c);
    for (const n of BUSH) for (const c of b.foliage) add(n, c);
    for (const n of [...BOULDER, ...CLIFF, ...SPIRE]) add(n, b.rock);
    for (const n of FOREST_GRASS) add(n, grassColour(b));
  }
  for (const n of PILE) add(n, 1);
  for (const n of ['Rock_2_E', 'Rock_2_G', 'Rock_5_H', 'Rock_6_A', 'Rock_6_B', 'Rock_1_K', 'Rock_1_L', 'Bush_3_A', 'Tree_3_A', 'Tree_Bare_1_A', 'Tree_Bare_2_B']) add(n, 1);
  return [...set.values()];
}
/** Every model the forest uses (to preload). */
export const FOREST_MODELS: string[] = forestModelList().map(([n, c]) => T(n, c));
/** The grass tuft models for a point (its biome's colour). */
export function grassAt(x: number, y: number): string[] {
  const b = forestRegion(x, y);
  const c = grassColour(BIOMES[b < 0 ? 0 : b]);
  return FOREST_GRASS.map((n) => T(n, c));
}

let built: { props: ForestProp[]; cover: { x: number; y: number }[] } | null = null;

/**
 * Lay out the forest's scenery: rocky borders with openings (barricaded between tiers), deep
 * forest beyond the edge, landmarks, boss lairs and ponds, then groves, bushes and boulders
 * filling each region, sparing trails and clearings. Deterministic; built once and shared.
 */
export function buildForest(rng: Rng): { props: ForestProp[]; cover: { x: number; y: number }[] } {
  if (built) return built;
  const props: ForestProp[] = [];
  const pick = <V>(a: readonly V[]) => a[rng.int(a.length)];
  // Placement grid, so "is anything solid here?" checks stay cheap on a map this size.
  const PG = 40, pcols = Math.ceil(FOREST_W / PG), prows = Math.ceil(FOREST_H / PG);
  const pgrid: number[][] = Array.from({ length: pcols * prows }, () => []);
  const put = (kind: PropKind, x: number, y: number, r: number, model: string, size: number, by: 'h' | 'w' = 'h', gate?: number, invisible?: boolean) => {
    props.push({ kind, x, y, r, model, size, by, rot: rng.range(0, Math.PI * 2), gate, invisible });
    if (r > 0) {
      const c = Math.floor(x / PG), rr = Math.floor(y / PG);
      if (c >= 0 && rr >= 0 && c < pcols && rr < prows) pgrid[rr * pcols + c].push(props.length - 1);
    }
  };
  const crowded = (x: number, y: number, r: number) => {
    const c0 = Math.floor(x / PG), r0 = Math.floor(y / PG);
    for (let rr = r0 - 1; rr <= r0 + 1; rr++) for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || rr < 0 || c >= pcols || rr >= prows) continue;
      for (const i of pgrid[rr * pcols + c]) {
        const p = props[i];
        if (Math.hypot(p.x - x, p.y - y) < p.r + r + 16) return true; // keep gaps a mover can pass
      }
    }
    return false;
  };

  // Kept clear: trails, hearts of regions, landmarks, lairs, passes.
  const PC = 60;
  const pathGrid = new Map<number, [number, number, number, number][]>();
  for (const s of FOREST_PATHS) {
    const [x0, y0, x1, y1] = s;
    for (let c = Math.floor((Math.min(x0, x1) - 40) / PC); c <= Math.floor((Math.max(x0, x1) + 40) / PC); c++)
      for (let r = Math.floor((Math.min(y0, y1) - 40) / PC); r <= Math.floor((Math.max(y0, y1) + 40) / PC); r++) {
        const k = r * 1000 + c;
        if (!pathGrid.has(k)) pathGrid.set(k, []);
        pathGrid.get(k)!.push(s);
      }
  }
  const nearPath = (x: number, y: number, pad: number) =>
    (pathGrid.get(Math.floor(y / PC) * 1000 + Math.floor(x / PC)) ?? []).some(([x0, y0, x1, y1]) => segDist(x, y, x0, y0, x1, y1) < pad);
  const clearings = [
    ...LAIRS.map((l) => ({ x: l.x, y: l.y, r: l.r + 14 })),
    ...BIOMES.map((_, i) => ({ ...biomeArrival(i), r: 80 })),
    ...SPAWNS.map((s) => ({ x: s.x, y: s.y, r: 70 })),
    ...LMK.map((l) => ({ x: l.x, y: l.y, r: 50 })),
    ...PASSES.map((p) => ({ x: p.x, y: p.y, r: PASS_HALF + 40 })),
  ];
  const inClearing = (x: number, y: number) => clearings.some((c) => Math.hypot(x - c.x, y - c.y) < c.r);

  // --- Ponds: water is solid (invisible circles; the renderer draws the water), stones on the rim.
  for (const p of PONDS) put('rock', p.x, p.y, p.r + 2, '', 0, 'h', undefined, true);
  for (const p of PONDS) {
    for (let k = 0; k < Math.round(p.r / 9); k++) {
      const a = rng.range(0, Math.PI * 2), x = p.x + Math.cos(a) * (p.r + 4), y = p.y + Math.sin(a) * (p.r + 4);
      if (inPond(x, y, -2)) continue;
      const b = forestRegion(x, y);
      if (b >= 0) put('rock', x, y, 0, T(pick(BOULDER), BIOMES[b].rock), rng.range(5, 9), 'w');
    }
  }

  // --- Borders: rocks along every border cell, open (or barricaded) at the passes.
  const passAt = (x: number, y: number) => PASSES.find((p) => Math.hypot(x - p.x, y - p.y) < PASS_HALF);
  for (let r = 0; r < RR; r++) for (let c = 0; c < RC; c++) {
    if (!border[r * RC + c]) continue;
    const b = raster[r * RC + c];
    const x = (c + 0.5) * RASTER + rng.range(-3, 3), y = (r + 0.5) * RASTER + rng.range(-3, 3);
    const pass = passAt(x, y);
    if (pass) {
      if (pass.gate > 0) put('rock', x, y, 11, T(pick(PILE), 1), rng.range(16, 20), 'w', pass.gate);
      continue;
    }
    put('rock', x, y, 11, T(pick(CLIFF), BIOMES[b].rock), rng.range(22, 34));
    if (rng.chance(0.25)) put('rock', x + rng.range(-8, 8), y + rng.range(-8, 8), 0, T(pick(BOULDER), BIOMES[b].rock), rng.range(9, 14), 'w');
  }
  // Spires flank every pass, so the openings read from afar.
  for (const p of PASSES) {
    const A = BIOMES[p.a], B = BIOMES[p.b];
    const dx = B.x - A.x, dy = B.y - A.y, l = Math.hypot(dx, dy) || 1;
    const sx = -dy / l, sy = dx / l; // along the border
    for (const s of [-1, 1]) put('rock', p.x + sx * s * (PASS_HALF + 12), p.y + sy * s * (PASS_HALF + 12), 0, T(SPIRE[s > 0 ? 2 : 3], BIOMES[p.a].rock), 48);
  }

  // --- Outside the regions: deep forest near the edge (visual only; the border rocks are the wall).
  for (let r = 0; r < RR; r += 2) for (let c = 0; c < RC; c += 2) {
    if (at(c, r) >= 0) continue;
    let near = -1;
    for (let k = -8; k <= 8 && near < 0; k += 2) for (let l = -8; l <= 8; l += 2) { const v = at(c + k, r + l); if (v >= 0) { near = v; break; } }
    if (near < 0 || !rng.chance(0.8)) continue;
    const bm = BIOMES[near];
    const name = pick(bm.trees), col = pick(bm.foliage);
    put('tree', (c + 1) * RASTER + rng.range(-12, 12), (r + 1) * RASTER + rng.range(-12, 12), 0, T(name, col), treeHeight(name) * rng.range(0.95, 1.25));
  }

  // --- Landmarks.
  const ring = (cx: number, cy: number, rad: number, n: number, models: string[], size: number, r: number, gap = -100) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - gap), Math.cos(a - gap))) < 0.55) continue; // an opening
      put('rock', cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, r, pick(models), size * rng.range(0.85, 1.15));
    }
  };
  for (const l of LMK) {
    const bm = BIOMES[l.biome], rk = (n: string) => T(n, bm.rock), fol = bm.foliage[0];
    switch (l.style) {
      case 'boulders': for (let i = 0; i < 6; i++) { const a = i * 1.1; put('rock', l.x + Math.cos(a) * 22, l.y + Math.sin(a) * 16, 9, rk(pick(BOULDER)), rng.range(18, 28), 'w'); } break;
      case 'stones': ring(l.x, l.y, 34, 7, SPIRE.map(rk), 34, 5); break;
      case 'oak': put('tree', l.x, l.y, 12, T('Tree_3_A', 1), 64); break;
      case 'fairy': for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; put('bush', l.x + Math.cos(a) * 30, l.y + Math.sin(a) * 30, 0, T('Bush_3_A', 1), 7); } break;
      case 'spires': put('rock', l.x - 14, l.y, 9, rk(SPIRE[2]), 62); put('rock', l.x + 14, l.y + 4, 9, rk(SPIRE[3]), 56); break;
      case 'bramble': for (let i = 0; i < 9; i++) { const a = i * 0.7; put('bush', l.x + Math.cos(a) * 26, l.y + Math.sin(a) * 26, 6, T(pick(BUSH), fol), 12); } break;
      case 'cairn': put('rock', l.x, l.y, 7, T('Rock_5_H', 1), 30); break;
      case 'stump': put('tree', l.x, l.y, 8, T(l.biome >= 6 ? 'Tree_Bare_2_B' : 'Tree_Bare_1_A', 1), 34); break;
      case 'well': ring(l.x, l.y, 12, 7, [T('Rock_2_E', 1), T('Rock_2_G', 1)], 10, 5); break;
    }
  }
  // --- Boss lairs: rings of stone with an opening toward the region's heart.
  for (const l of LAIRS) {
    const rk = (n: string) => T(n, BIOMES[l.biome].rock);
    const toHub = Math.atan2(BIOMES[l.biome].y - l.y, BIOMES[l.biome].x - l.x);
    if (l.zone === 8 || l.zone === 7) {
      ring(l.x, l.y, l.r, 18, [T('Rock_1_K', 1), T('Rock_1_L', 1), ...CLIFF.map(rk)], 22, 7, toHub);
      put('tree', l.x - 30, l.y - 20, 6, T('Tree_Bare_2_B', 1), 34);
    } else if (l.zone % 2 === 0) ring(l.x, l.y, l.r, 16, SPIRE.map(rk), 30, 5, toHub);
    else ring(l.x, l.y, l.r, 16, [T('Rock_6_A', 1), T('Rock_6_B', 1)], 24, 6, toHub);
  }

  // --- Fill each region: groves of trees, bushes, boulders.
  const free = (b: number, x: number, y: number, r: number, pathPad: number) =>
    forestRegion(x, y) === b && borderDepth(x, y) >= 40 && !nearPath(x, y, pathPad) && !inClearing(x, y) && !inPond(x, y, 16) && !crowded(x, y, r);
  BIOMES.forEach((bm, b) => {
    let cells = 0;
    for (let i = 0; i < raster.length; i++) if (raster[i] === b) cells++;
    const area = cells * RASTER * RASTER / 10000; // in 100×100 units
    const groves = Math.round(area / 9);
    const centres: { x: number; y: number }[] = [];
    for (let k = 0; centres.length < groves && k < groves * 20; k++) {
      const x = rng.range(bm.x - bm.rx * 1.2, bm.x + bm.rx * 1.2), y = rng.range(bm.y - bm.ry * 1.2, bm.y + bm.ry * 1.2);
      if (forestRegion(x, y) === b && borderDepth(x, y) > 60) centres.push({ x, y });
    }
    const trees = Math.round(area * bm.density * 2.2);
    for (let n = 0, tries = 0; n < trees && tries < trees * 25 && centres.length; tries++) {
      const c = pick(centres);
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * 90;
      const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
      if (!free(b, x, y, 6, 30)) continue;
      const name = pick(bm.trees), col = rng.chance(0.65) ? bm.foliage[0] : pick(bm.foliage);
      put('tree', x, y, 6, T(name, col), treeHeight(name) * rng.range(0.72, 1.0));
      n++;
    }
    const bushes = Math.round(area * 1.0);
    for (let i = 0, tries = 0; i < bushes && tries < bushes * 15; tries++) {
      const x = rng.range(bm.x - bm.rx * 1.3, bm.x + bm.rx * 1.3), y = rng.range(bm.y - bm.ry * 1.3, bm.y + bm.ry * 1.3);
      if (!free(b, x, y, 0, 22)) continue;
      put('bush', x, y, 0, T(pick(BUSH), pick(bm.foliage)), rng.range(7, 11), 'h');
      i++;
    }
    const rocks = Math.round(area * 0.25);
    for (let i = 0, tries = 0; i < rocks && tries < rocks * 15; tries++) {
      const x = rng.range(bm.x - bm.rx * 1.3, bm.x + bm.rx * 1.3), y = rng.range(bm.y - bm.ry * 1.3, bm.y + bm.ry * 1.3);
      if (!free(b, x, y, 6, 30)) continue;
      put('rock', x, y, 6, T(pick(BOULDER), bm.rock), rng.range(11, 18), 'w');
      i++;
    }
  });

  // Ground cover (render only): grass tufts in the regions, off the trails and out of the water.
  const cover: { x: number; y: number }[] = [];
  for (let i = 0; i < 16000 && cover.length < 9000; i++) {
    const x = rng.range(20, FOREST_W - 20), y = rng.range(20, FOREST_H - 20);
    if (forestRegion(x, y) >= 0 && !nearPath(x, y, 14) && !inPond(x, y, 4)) cover.push({ x, y });
  }
  built = { props, cover };
  return built;
}

/** Distance from (px, py) to the segment (x0, y0)-(x1, y1). */
function segDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** A coarse picture of the regions for maps: one entry per RASTER cell (-1 outside). */
export function regionRaster(): { cols: number; rows: number; cell: number; data: Int8Array; border: Uint8Array } {
  return { cols: RC, rows: RR, cell: RASTER, data: raster, border };
}
