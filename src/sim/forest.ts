import type { Rng } from '../core/rng';
import type { PropKind } from './areas';

/**
 * The Greenwood: the first terrain as one big hand-laid world instead of three small zone maps.
 * Its three zones are regions stacked south to north, split by cliff walls with one pass each,
 * barricaded until the hero may enter (level + the previous region's boss):
 *
 *   y 0    ┌──────────────── Old Mill Crossing (zone 2) ─── boss: the Old Mill ruins ┐
 *   y 550  ├── wall ─ [pass B] ──────────────────────────────────────────────────────┤
 *          │                 Bloomwood Groves (zone 1) ─── boss: Bloomheart Glade      │
 *   y 1100 ├───────────────────────────────────────────── [pass A] ─ wall ───────────┤
 *          │                 Meadow Outskirts (zone 0) ─── boss: Champion's Ring       │
 *   y 1650 └──────────────────────────────── start ──────────────────────────────────┘
 *
 * Monsters live in territories around named landmarks (the pigeons nest north-east of the
 * Standing Stones, the moss blobs roll around the Mossy Boulders, …): they wander there, chase
 * the hero when he comes close and go home if he runs off. All positions are in world units.
 */

export const FOREST_W = 1500;
export const FOREST_H = 1650;

export interface Territory { zone: number; monster: number; x: number; y: number; r: number; count: number; landmark: string }
export interface Lair { zone: number; x: number; y: number; r: number; name: string }
export interface Landmark { name: string; x: number; y: number; zone: number }
/** A barricaded pass; `zone` is the region it leads into (it opens once that zone is unlocked). */
export interface Gate { zone: number; x: number; y: number }

export interface ForestInfo {
  territories: Territory[];
  lairs: Lair[];
  landmarks: Landmark[];
  gates: Gate[];
  /** Where the hero arrives in each region (start, respawn, fast travel). */
  spawns: { x: number; y: number }[];
  /** y of the walls between regions (north to south). */
  walls: number[];
}

/** Which region (zone) a point lies in. */
export function forestRegion(y: number): number {
  return y < WALL_B ? 2 : y < WALL_A ? 1 : 0;
}

const WALL_A = 1100; // Meadow | Bloomwood
const WALL_B = 550;  // Bloomwood | Old Mill
const PASS_A = 1150; // x of the pass through wall A
const PASS_B = 330;  // x of the pass through wall B
const PASS_HALF = 34; // half-width of a pass

export const FOREST: ForestInfo = {
  walls: [WALL_B, WALL_A],
  gates: [{ zone: 1, x: PASS_A, y: WALL_A }, { zone: 2, x: PASS_B, y: WALL_B }],
  spawns: [{ x: 750, y: 1570 }, { x: PASS_A, y: WALL_A - 60 }, { x: PASS_B, y: WALL_B - 60 }],
  landmarks: [
    { name: 'Mossy Boulders', x: 430, y: 1440, zone: 0 },
    { name: 'Standing Stones', x: 1020, y: 1470, zone: 0 },
    { name: 'Great Oak', x: 700, y: 1230, zone: 0 },
    { name: "Champion's Ring", x: 220, y: 1230, zone: 0 },
    { name: 'Fairy Ring', x: 300, y: 860, zone: 1 },
    { name: 'Twin Spires', x: 820, y: 780, zone: 1 },
    { name: 'Bramble Hollow', x: 1150, y: 930, zone: 1 },
    { name: 'Bloomheart Glade', x: 1260, y: 660, zone: 1 },
    { name: 'Wayfarer Cairn', x: 300, y: 300, zone: 2 },
    { name: 'Hollow Stump', x: 640, y: 420, zone: 2 },
    { name: 'Old Well', x: 820, y: 220, zone: 2 },
    { name: 'Old Mill Ruins', x: 1170, y: 160, zone: 2 },
  ],
  territories: [
    // Meadow Outskirts
    { zone: 0, monster: 0, x: 430, y: 1440, r: 140, count: 6, landmark: 'Mossy Boulders' },
    { zone: 0, monster: 1, x: 1170, y: 1340, r: 120, count: 5, landmark: 'Standing Stones' }, // nests NE of the stones
    { zone: 0, monster: 2, x: 700, y: 1230, r: 110, count: 4, landmark: 'Great Oak' },
    { zone: 0, monster: 0, x: 1290, y: 1540, r: 100, count: 4, landmark: 'Standing Stones' },
    // Bloomwood Groves
    { zone: 1, monster: 2, x: 300, y: 860, r: 130, count: 7, landmark: 'Fairy Ring' },
    { zone: 1, monster: 1, x: 930, y: 680, r: 120, count: 7, landmark: 'Twin Spires' },     // NE of the spires
    { zone: 1, monster: 0, x: 1150, y: 930, r: 120, count: 6, landmark: 'Bramble Hollow' },
    { zone: 1, monster: 0, x: 620, y: 990, r: 100, count: 4, landmark: 'Twin Spires' },
    // Old Mill Crossing
    { zone: 2, monster: 1, x: 420, y: 200, r: 120, count: 7, landmark: 'Wayfarer Cairn' },  // NE of the cairn
    { zone: 2, monster: 2, x: 640, y: 420, r: 120, count: 7, landmark: 'Hollow Stump' },
    { zone: 2, monster: 0, x: 860, y: 260, r: 110, count: 6, landmark: 'Old Well' },
    { zone: 2, monster: 2, x: 1000, y: 430, r: 100, count: 5, landmark: 'Old Well' },
  ],
  lairs: [
    { zone: 0, x: 220, y: 1230, r: 70, name: "Champion's Ring" },
    { zone: 1, x: 1260, y: 660, r: 70, name: 'Bloomheart Glade' },
    { zone: 2, x: 1170, y: 160, r: 85, name: 'Old Mill Ruins' },
  ],
};

/** A forest prop: a specific pack model at a target height (or width for `by: 'w'`). */
export interface ForestProp { kind: PropKind; x: number; y: number; r: number; model: string; size: number; by?: 'h' | 'w'; rot: number; gate?: number }

const T = (name: string, c: number) => `nf_${name}_Color${c}`;

/** Trees for each region: [model, height]. */
const TREES: [string, number][][] = [
  [[T('Tree_1_A', 1), 34], [T('Tree_1_B', 1), 32], [T('Tree_1_C', 1), 30], [T('Tree_3_A', 1), 36], [T('Tree_3_B', 1), 34],
    [T('Tree_3_C', 1), 30], [T('Tree_2_A', 1), 34], [T('Tree_2_B', 1), 34], [T('Tree_1_A', 3), 34], [T('Tree_3_A', 3), 34], [T('Tree_1_B', 3), 30]],
  [[T('Tree_1_A', 8), 34], [T('Tree_1_B', 8), 32], [T('Tree_6_A', 8), 38], [T('Tree_7_A', 8), 36], [T('Tree_1_A', 7), 34],
    [T('Tree_6_B', 7), 36], [T('Tree_7_B', 1), 36], [T('Tree_1_A', 1), 34], [T('Tree_6_A', 1), 38], [T('Tree_1_B', 1), 32]],
  [[T('Tree_4_A', 5), 42], [T('Tree_5_A', 5), 40], [T('Tree_5_B', 6), 40], [T('Tree_1_A', 6), 34], [T('Tree_4_B', 6), 42],
    [T('Tree_5_C', 2), 40], [T('Tree_5_A', 2), 42], [T('Tree_1_A', 5), 34], [T('Tree_Bare_1_A', 1), 26], [T('Tree_Bare_2_A', 1), 30]],
];
const BUSHES: [string, number][][] = [
  [[T('Bush_1_A', 1), 9], [T('Bush_1_B', 1), 8], [T('Bush_1_E', 1), 7], [T('Bush_3_A', 1), 7], [T('Bush_4_D', 1), 8], [T('Bush_2_D', 1), 9]],
  [[T('Bush_1_A', 8), 9], [T('Bush_1_E', 8), 8], [T('Bush_4_D', 8), 8], [T('Bush_1_D', 1), 8], [T('Bush_3_B', 1), 7], [T('Bush_2_E', 1), 9]],
  [[T('Bush_1_A', 5), 9], [T('Bush_1_E', 5), 8], [T('Bush_4_D', 5), 8], [T('Bush_4_E', 1), 8], [T('Bush_3_A', 1), 7]],
];
const BOULDERS = ['Rock_3_A', 'Rock_3_B', 'Rock_3_C', 'Rock_3_E', 'Rock_3_H', 'Rock_3_J', 'Rock_5_A', 'Rock_5_B', 'Rock_5_C', 'Rock_5_D'].map((n) => T(n, 1));
const CLIFF = ['Rock_1_A', 'Rock_1_B', 'Rock_1_C', 'Rock_1_G', 'Rock_1_H', 'Rock_1_I', 'Rock_2_A', 'Rock_2_B'].map((n) => T(n, 1));
const SPIRES = ['Rock_4_D', 'Rock_4_E', 'Rock_4_F', 'Rock_4_G'].map((n) => T(n, 1));
const PILE = ['Rock_5_E', 'Rock_5_F', 'Rock_6_E', 'Rock_6_F'].map((n) => T(n, 1));
export const FOREST_GRASS = ['Grass_1_A', 'Grass_1_B', 'Grass_1_C', 'Grass_1_D', 'Grass_2_A', 'Grass_2_B', 'Grass_2_C', 'Grass_2_D'].map((n) => T(n, 1));

/** Every model the forest uses (to preload). */
export const FOREST_MODELS: string[] = [...new Set([
  ...TREES.flat().map((t) => t[0]), ...BUSHES.flat().map((b) => b[0]), ...BOULDERS, ...CLIFF, ...SPIRES, ...PILE, ...FOREST_GRASS,
  T('Rock_5_H', 1), T('Rock_6_A', 1), T('Rock_6_B', 1), T('Rock_1_K', 1), T('Rock_1_L', 1), T('Rock_2_E', 1), T('Rock_2_G', 1),
  T('Tree_Bare_1_B', 1), T('Tree_Bare_1_C', 1), T('Tree_Bare_2_B', 1), T('Tree_3_A', 1),
])];

/**
 * Lay out the forest: border, cliff walls with barricaded passes, landmarks, boss lairs, paths
 * kept clear between them, then groves, bushes and boulders filling the rest.
 */
export function buildForest(rng: Rng): { props: ForestProp[]; cover: { x: number; y: number }[] } {
  const props: ForestProp[] = [];
  const W = FOREST_W, H = FOREST_H;
  const pick = <V>(a: readonly V[]) => a[rng.int(a.length)];
  const put = (kind: PropKind, x: number, y: number, r: number, model: string, size: number, by: 'h' | 'w' = 'h', gate?: number) =>
    props.push({ kind, x, y, r, model, size, by, rot: rng.range(0, Math.PI * 2), gate });

  // Kept clear: paths (start → pass A → pass B → the mill) and open ground around lairs/spawns.
  const paths: [number, number, number, number][] = [
    [750, 1600, PASS_A, WALL_A + 40], [PASS_A, WALL_A - 40, 760, 820], [760, 820, PASS_B, WALL_B + 40],
    [PASS_B, WALL_B - 40, 700, 300], [700, 300, 1170, 160],
    // side trails out to the landmarks
    [750, 1450, 430, 1440], [750, 1450, 1020, 1470], [750, 1450, 700, 1230], [700, 1230, 220, 1230],
    [760, 820, 300, 860], [760, 820, 1150, 930], [1000, 780, 1260, 660], [700, 300, 300, 300],
  ];
  const nearPath = (x: number, y: number, pad: number) => paths.some(([x0, y0, x1, y1]) => segDist(x, y, x0, y0, x1, y1) < pad);
  const clearings = [
    ...FOREST.lairs.map((l) => ({ x: l.x, y: l.y, r: l.r + 12 })),
    ...FOREST.spawns.map((s) => ({ x: s.x, y: s.y, r: 60 })),
    ...FOREST.landmarks.map((l) => ({ x: l.x, y: l.y, r: 46 })),
  ];
  const inClearing = (x: number, y: number) => clearings.some((c) => Math.hypot(x - c.x, y - c.y) < c.r);

  // --- Border: a dense band of trees with rocks, so the world's edge reads as deep forest.
  for (let t = 0; t <= W; t += 22) {
    for (const [x, y] of [[t, 8], [t, H - 8], [t, 30], [t, H - 30]] as const) {
      const z = Math.min(2, Math.max(0, 2 - Math.floor(y / 550)));
      const tr = pick(TREES[z]);
      put('tree', x + rng.range(-6, 6), y + rng.range(-6, 6), 8, tr[0], tr[1] * rng.range(0.95, 1.2));
    }
  }
  for (let t = 0; t <= H; t += 22) {
    for (const x of [8, 30, W - 8, W - 30]) {
      const z = forestRegion(t);
      const tr = pick(TREES[z]);
      put('tree', x + rng.range(-6, 6), t + rng.range(-6, 6), 8, tr[0], tr[1] * rng.range(0.95, 1.2));
    }
  }

  // --- Cliff walls between regions, with a barricaded pass each.
  const wall = (y: number, passX: number, gateZone: number) => {
    for (let x = 0; x <= W; x += 15) {
      if (Math.abs(x - passX) < PASS_HALF + 4) continue;
      put('rock', x + rng.range(-2, 2), y + rng.range(-3, 3), 9.5, pick(CLIFF), rng.range(24, 34), 'h');
      if (rng.chance(0.5)) put('rock', x + rng.range(-4, 4), y + rng.range(-16, 16), 7, pick(CLIFF), rng.range(18, 26), 'h');
    }
    // Spires flanking the pass, and the barricade of boulders across it (removed when it opens).
    put('rock', passX - PASS_HALF - 8, y, 9, SPIRES[2], 46);
    put('rock', passX + PASS_HALF + 8, y, 9, SPIRES[3], 44);
    for (let x = passX - PASS_HALF + 6; x <= passX + PASS_HALF - 6; x += 13) {
      put('rock', x, y + rng.range(-3, 3), 9, pick(PILE), rng.range(16, 20), 'w', gateZone);
    }
  };
  wall(WALL_A, PASS_A, 1);
  wall(WALL_B, PASS_B, 2);

  // --- Landmarks.
  const ring = (cx: number, cy: number, rad: number, n: number, models: string[], size: number, r: number, gap = -1) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (gap >= 0 && Math.abs(Math.atan2(Math.sin(a - gap), Math.cos(a - gap))) < 0.5) continue; // an opening
      put('rock', cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, r, pick(models), size * rng.range(0.85, 1.15));
    }
  };
  const L = (name: string) => FOREST.landmarks.find((l) => l.name === name)!;
  { const l = L('Mossy Boulders'); for (let i = 0; i < 6; i++) { const a = i * 1.1; put('rock', l.x + Math.cos(a) * 22, l.y + Math.sin(a) * 16, 9, pick(BOULDERS), rng.range(18, 28), 'w'); } }
  { const l = L('Standing Stones'); ring(l.x, l.y, 34, 7, SPIRES, 34, 5); }
  { const l = L('Great Oak'); put('tree', l.x, l.y, 12, T('Tree_3_A', 1), 64); }
  { const l = L('Fairy Ring'); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; put('bush', l.x + Math.cos(a) * 30, l.y + Math.sin(a) * 30, 0, T('Bush_3_A', 1), 7); } }
  { const l = L('Twin Spires'); put('rock', l.x - 14, l.y, 9, SPIRES[2], 62); put('rock', l.x + 14, l.y + 4, 9, SPIRES[3], 56); }
  { const l = L('Bramble Hollow'); for (let i = 0; i < 9; i++) { const a = i * 0.7; put('bush', l.x + Math.cos(a) * 26, l.y + Math.sin(a) * 26, 6, pick(BUSHES[1])[0], 12); } }
  { const l = L('Wayfarer Cairn'); put('rock', l.x, l.y, 7, T('Rock_5_H', 1), 30); }
  { const l = L('Hollow Stump'); put('tree', l.x, l.y, 8, T('Tree_Bare_1_A', 1), 34); }
  { const l = L('Old Well'); ring(l.x, l.y, 12, 7, [T('Rock_2_E', 1), T('Rock_2_G', 1)], 10, 5); }

  // --- Boss lairs: rings of stone with an opening facing the way in.
  { const l = FOREST.lairs[0]; ring(l.x, l.y, l.r, 16, SPIRES, 30, 5, 0); }
  { const l = FOREST.lairs[1]; ring(l.x, l.y, l.r, 16, [T('Rock_6_A', 1), T('Rock_6_B', 1)], 24, 6, Math.PI); }
  { const l = FOREST.lairs[2];
    ring(l.x, l.y, l.r, 18, [T('Rock_1_K', 1), T('Rock_1_L', 1), ...CLIFF], 22, 7, Math.PI * 0.8);
    put('tree', l.x - 30, l.y - 20, 6, T('Tree_Bare_2_B', 1), 34); put('tree', l.x + 34, l.y - 10, 6, T('Tree_Bare_1_C', 1), 28); }

  // --- Fill: groves of trees, bushes and boulders per region, sparing paths and clearings.
  const solid = (x: number, y: number, r: number) => {
    for (const p of props) {
      if (p.r === 0 && r === 0) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < (p.r + r) + (p.r > 0 && r > 0 ? 16 : 8)) return true; // keep gaps a mover can pass
    }
    return false;
  };
  const free = (x: number, y: number, r: number, pathPad: number) =>
    x > 44 && x < W - 44 && y > 44 && y < H - 44 && !nearPath(x, y, pathPad) && !inClearing(x, y)
    && Math.abs(y - WALL_A) > 28 && Math.abs(y - WALL_B) > 28 && !solid(x, y, r);
  const fill = (zone: number, y0: number, y1: number, groves: number, trees: number, bushes: number, rocks: number) => {
    const centres = Array.from({ length: groves }, () => ({ x: rng.range(80, W - 80), y: rng.range(y0 + 50, y1 - 50) }));
    let n = 0;
    for (let tries = 0; n < trees && tries < trees * 30; tries++) {
      const c = pick(centres);
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * 70;
      const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
      if (y < y0 || y > y1 || !free(x, y, 6, 30)) continue;
      const tr = pick(TREES[zone]);
      put('tree', x, y, 6, tr[0], tr[1] * rng.range(0.72, 1.0)); // tall enough to read as forest, low enough not to bury the hero
      n++;
    }
    for (let i = 0, tries = 0; i < bushes && tries < bushes * 20; tries++) {
      const x = rng.range(50, W - 50), y = rng.range(y0 + 20, y1 - 20);
      if (!free(x, y, 0, 22)) continue;
      const b = pick(BUSHES[zone]);
      put('bush', x, y, 0, b[0], b[1] * rng.range(0.8, 1.3), 'h');
      i++;
    }
    for (let i = 0, tries = 0; i < rocks && tries < rocks * 20; tries++) {
      const x = rng.range(50, W - 50), y = rng.range(y0 + 20, y1 - 20);
      if (!free(x, y, 6, 30)) continue;
      put('rock', x, y, 6, pick(BOULDERS), rng.range(11, 18), 'w');
      i++;
    }
  };
  fill(0, WALL_A, H, 16, 150, 110, 40);  // Meadow: open, a few groves
  fill(1, WALL_B, WALL_A, 22, 230, 140, 35); // Bloomwood: denser blossom groves
  fill(2, 0, WALL_B, 20, 210, 90, 60);   // Old Mill: pines, autumn and stone

  // Ground cover (render only): grass tufts everywhere but the paths.
  const cover: { x: number; y: number }[] = [];
  for (let i = 0; i < 2600; i++) {
    const x = rng.range(20, W - 20), y = rng.range(20, H - 20);
    if (!nearPath(x, y, 14)) cover.push({ x, y });
  }
  return { props, cover };
}

/** Distance from (px, py) to the segment (x0, y0)-(x1, y1). */
function segDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** The paths, for the renderer to paint as dirt trails. */
export const FOREST_PATHS: readonly [number, number, number, number][] = [
  [750, 1600, PASS_A, WALL_A + 40], [PASS_A, WALL_A + 40, PASS_A, WALL_A - 40], [PASS_A, WALL_A - 40, 760, 820], [760, 820, PASS_B, WALL_B + 40],
  [PASS_B, WALL_B + 40, PASS_B, WALL_B - 40], [PASS_B, WALL_B - 40, 700, 300], [700, 300, 1170, 160],
  [750, 1450, 430, 1440], [750, 1450, 1020, 1470], [750, 1450, 700, 1230], [700, 1230, 220, 1230],
  [760, 820, 300, 860], [760, 820, 1150, 930], [1000, 780, 1260, 660], [700, 300, 300, 300],
];
