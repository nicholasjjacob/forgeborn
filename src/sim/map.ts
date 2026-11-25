import { Rng } from '../core/rng';
import { areaFor, type PropKind } from './areas';
import { FOREST, FOREST_H, FOREST_W, buildForest, type ForestInfo } from './forest';

export const MAP_W = 640;
export const MAP_H = 640;
const CLEAR_RADIUS = 70;     // open space around the spawn point
const CELL = 32;
export const MAX_MOVER_RADIUS = 14;
const MIN_GAP = 16; // wider than any regular monster or the hero

/** Collision radius per prop kind (0 = walk-through decoration). */
const PROP_RADIUS: Record<PropKind, number> = {
  tree: 6, pine: 5, rock: 6, cactus: 4, crystal: 4, shroom: 0, deadtree: 4, bush: 0,
};

export interface Prop {
  kind: PropKind; x: number; y: number; r: number; variant: number;
  /** Forest props: the pack model, its target size (height, or width for by 'w') and turn. */
  model?: string; size?: number; by?: 'h' | 'w'; rot?: number;
  /** Part of the barricade into this zone: solid until that zone opens (see GameMap.openGates). */
  gate?: number;
}

export interface Decal { x: number; y: number; variant: number }

/** How a map's props are arranged. */
export type Layout = 'scatter' | 'groves' | 'crossroads' | 'arena';

/** Field layout for a zone: each terrain's three zones are scatter, groves and crossroads. */
export function layoutFor(zone: number): Layout {
  return (['scatter', 'groves', 'crossroads'] as const)[zone % 3];
}

/**
 * Ground tint for a zone: daylight in a terrain's first zone, afternoon in the second, dusk in
 * the third, and a warm red glow in boss arenas.
 */
export function zoneTint(zone: number, boss = false): number {
  if (boss) return 0xffe2d8;
  const k = (zone % 3) / 2;
  const rg = Math.round(255 * (1 - 0.17 * k)), b = Math.round(255 * (1 - 0.08 * k));
  return (rg << 16) | (rg << 8) | b;
}

const ARENA_RADIUS = 150;

/**
 * One zone's ground: props (some solid) arranged by the zone's layout, a solid border ring,
 * and a static uniform grid so collision queries only look at nearby props. The terrain
 * (area) decides the props; boss fights use a walled arena version of the zone.
 */
export class GameMap {
  readonly props: Prop[] = [];
  readonly decals: Decal[] = [];
  readonly layout: Layout;
  readonly tint: number;
  /** Size in world units: the old zone maps are MAP_W × MAP_H; the forest world is bigger. */
  readonly w: number;
  readonly h: number;
  /** The forest world's regions, territories, lairs and passes (null for the old zone maps). */
  readonly forest: ForestInfo | null = null;
  /** Barricades (Prop.gate) that are open: walk-through and hidden. */
  readonly openGates = new Set<number>();
  private readonly cols: number;
  private readonly rows: number;
  private readonly grid: number[][];

  constructor(readonly area: number, readonly zone = area * 3, readonly boss = false) {
    const rng = new Rng(0xa5ea + area * 7919 + zone * 104729 + (boss ? 31 : 0));
    // The first terrain is one big forest world holding all three of its zones.
    const isForest = area === 0 && !boss;
    this.w = isForest ? FOREST_W : MAP_W;
    this.h = isForest ? FOREST_H : MAP_H;
    this.cols = Math.ceil(this.w / CELL);
    this.rows = Math.ceil(this.h / CELL);
    if (isForest) {
      this.forest = FOREST;
      this.layout = 'groves';
      this.tint = 0xffffff;
      const built = buildForest(rng);
      for (const fp of built.props) this.props.push({ kind: fp.kind, x: fp.x, y: fp.y, r: fp.r, variant: 0, model: fp.model, size: fp.size, by: fp.by, rot: fp.rot, gate: fp.gate });
      for (const c of built.cover) this.decals.push({ x: c.x, y: c.y, variant: 0 });
      this.grid = this.buildGrid();
      return;
    }
    const { def } = areaFor(area);
    const depth = 1 + (zone % 3) * 4; // 1, 5, 9: deeper zones lean toward the terrain's rarer props
    this.layout = boss ? 'arena' : layoutFor(zone);
    this.tint = zoneTint(zone, boss);
    const weights = def.props.map((p, i) => p.weight * (i === 0 ? 1.3 - 0.06 * depth : i === def.props.length - 1 ? 0.4 + 0.15 * depth : 1));
    const total = weights.reduce((s, w) => s + w, 0);
    const pick = (): PropKind => {
      let r = rng.next() * total;
      for (let i = 0; i < def.props.length; i++) { if ((r -= weights[i]) < 0) return def.props[i].kind; }
      return def.props[0].kind;
    };

    // Border ring: dense solid props just inside the edge (rocks + area's tallest prop).
    const solid = def.props.filter((p) => PROP_RADIUS[p.kind] > 0).map((p) => p.kind);
    for (let t = 0; t < MAP_W; t += 14) {
      for (const [x, y] of [[t, 6], [t, MAP_H - 4], [6, t], [MAP_W - 6, t]] as const) {
        const kind = solid[rng.int(solid.length)] ?? 'rock';
        this.add(kind, x + rng.range(-3, 3), y + rng.range(-3, 3), rng.int(4), PROP_RADIUS[kind] + 2);
      }
    }

    // Interior scatter, keeping the centre clear and props from stacking.
    const cx = MAP_W / 2, cy = MAP_H / 2;
    let placed = 0;
    // Gaps between solid props are either sealed (clusters) or at least MIN_GAP wide, so no
    // mover can wedge itself into a crack it doesn't fit through.
    const layout = this.layout;
    const inside = (x: number, y: number) => {
      if (x <= 44 || x >= MAP_W - 44 || y <= 44 || y >= MAP_H - 44) return false;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= CLEAR_RADIUS) return false;
      // Crossroads: two open roads through the middle.
      if (layout === 'crossroads' && (Math.abs(x - cx) < 30 || Math.abs(y - cy) < 30)) return false;
      // Arena: an open ring of ground inside the wall, and a clear lane outside it.
      if (layout === 'arena' && d < ARENA_RADIUS + 26) return false;
      return true;
    };

    if (layout === 'arena') {
      // Boss arena: a wall of touching solids (sealed) with four wide gates.
      const kind = solid.includes('rock') ? 'rock' : solid[0] ?? 'rock';
      const r = PROP_RADIUS[kind];
      const step = (2 * r - 1) / ARENA_RADIUS;
      const gate0 = rng.range(0, Math.PI / 2);
      for (let a = 0; a < Math.PI * 2; a += step) {
        const g = ((a - gate0) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2);
        if (g < 0.24) continue; // ~36 units: a gate
        this.add(kind, cx + Math.cos(a) * ARENA_RADIUS, cy + Math.sin(a) * ARENA_RADIUS, rng.int(4), r);
      }
    }

    // Groves: props bunch up around a handful of centres, leaving open meadows between.
    const groves: { x: number; y: number }[] = [];
    if (layout === 'groves') {
      for (let i = 0; i < 18; i++) groves.push({ x: rng.range(70, MAP_W - 70), y: rng.range(70, MAP_H - 70) });
    }
    const target = layout === 'arena' ? 110 : layout === 'groves' ? 150 : 120 + depth * 7;

    for (let tries = 0; placed < target && tries < 3000; tries++) {
      let x = rng.range(44, MAP_W - 44), y = rng.range(44, MAP_H - 44);
      if (groves.length) {
        const g = groves[rng.int(groves.length)];
        const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * 46;
        x = g.x + Math.cos(a) * d; y = g.y + Math.sin(a) * d;
      }
      if (!inside(x, y)) continue;
      const kind = pick();
      const r = PROP_RADIUS[kind];
      if (!this.spaceFor(x, y, r)) continue;
      this.add(kind, x, y, rng.int(4), r);
      placed++;
      // Occasionally cluster a second prop for natural-looking groves: solids overlap (sealed).
      if (rng.chance(0.35)) {
        const k2 = pick();
        const r2 = PROP_RADIUS[k2];
        const a = rng.range(0, Math.PI * 2);
        const d = r > 0 && r2 > 0 ? r + r2 - 1 : rng.range(12, 18);
        const x2 = x + Math.cos(a) * d, y2 = y + Math.sin(a) * d;
        if (inside(x2, y2) && this.spaceFor(x2, y2, r2, this.props.length - 1)) this.add(k2, x2, y2, rng.int(4), r2);
      }
    }

    for (let i = 0; i < 220; i++) {
      // Grass tufts only (flower and pebble decals read as clutter).
      this.decals.push({ x: rng.range(10, MAP_W - 10), y: rng.range(10, MAP_H - 10), variant: 0 });
    }

    this.grid = this.buildGrid();
  }

  private buildGrid(): number[][] {
    const grid: number[][] = Array.from({ length: this.cols * this.rows }, () => []);
    this.props.forEach((p, i) => {
      if (p.r <= 0) return;
      // Register in every cell the circle overlaps, padded by the largest mover radius so a
      // query of just the mover's own cell finds every prop it could touch.
      const reach = p.r + MAX_MOVER_RADIUS;
      const c0 = this.col(p.x - reach), c1 = this.col(p.x + reach);
      const r0 = this.row(p.y - reach), r1 = this.row(p.y + reach);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r * this.cols + c].push(i);
    });
    return grid;
  }

  /** Is prop `p` currently solid? (Barricades stop being solid once their zone opens.) */
  private solidProp(p: Prop): boolean {
    return p.gate === undefined || !this.openGates.has(p.gate);
  }

  private add(kind: PropKind, x: number, y: number, variant: number, r: number): void {
    this.props.push({ kind, x, y, r, variant });
  }

  private col(x: number) { return Math.max(0, Math.min(this.cols - 1, Math.floor(x / CELL))); }
  private row(y: number) { return Math.max(0, Math.min(this.rows - 1, Math.floor(y / CELL))); }

  /** Placement rule: solids keep ≥ MIN_GAP clearance from other solids (except `allowTouch`). */
  private spaceFor(x: number, y: number, r: number, allowTouch = -1): boolean {
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      const d = Math.hypot(p.x - x, p.y - y);
      if (r === 0 || p.r === 0) { if (d < 12) return false; continue; }
      if (i === allowTouch) continue;
      if (d - p.r - r < MIN_GAP) return false;
    }
    return true;
  }

  /** Push a circle out of any solid props it overlaps, and keep it inside the map. Mutates `out`. */
  resolve(out: { x: number; y: number }, radius: number): void {
    const cell = this.grid[this.row(out.y) * this.cols + this.col(out.x)];
    for (let k = 0; k < cell.length; k++) {
      const p = this.props[cell[k]];
      if (!this.solidProp(p)) continue;
      const dx = out.x - p.x, dy = out.y - p.y;
      const min = p.r + radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.001;
      out.x = p.x + (dx / d) * min;
      out.y = p.y + (dy / d) * min;
    }
    out.x = Math.max(16, Math.min(this.w - 16, out.x));
    out.y = Math.max(16, Math.min(this.h - 16, out.y));
  }

  /**
   * Obstacle avoidance: bend a unit direction (dx, dy) around solid props just ahead, so
   * movers slide around trees/rocks instead of pushing into them head-on. Writes to `out`.
   */
  steer(x: number, y: number, radius: number, dx: number, dy: number, out: { x: number; y: number }): void {
    let sx = dx, sy = dy;
    const cell = this.grid[this.row(y) * this.cols + this.col(x)];
    for (let k = 0; k < cell.length; k++) {
      const p = this.props[cell[k]];
      if (!this.solidProp(p)) continue;
      const px = p.x - x, py = p.y - y;
      const d = Math.hypot(px, py);
      const look = p.r + radius + 8;
      if (d > look || d === 0) continue;
      const fwd = (px * dx + py * dy) / d; // how directly we're heading into it
      if (fwd <= 0.2) continue;
      // Steer along the tangent on whichever side we're already leaning toward.
      const side = px * dy - py * dx >= 0 ? 1 : -1;
      const tx = (-py / d) * side, ty = (px / d) * side;
      const w = fwd * (1 - d / look) * 2.5 + fwd * 0.6;
      sx += tx * w; sy += ty * w;
    }
    const len = Math.hypot(sx, sy) || 1;
    out.x = sx / len;
    out.y = sy / len;
  }

  /** True if a circle at (x, y) would overlap a solid prop. */
  blocked(x: number, y: number, radius: number): boolean {
    const cell = this.grid[this.row(y) * this.cols + this.col(x)];
    for (let k = 0; k < cell.length; k++) {
      const p = this.props[cell[k]];
      if (!this.solidProp(p)) continue;
      const min = p.r + radius;
      if ((x - p.x) ** 2 + (y - p.y) ** 2 < min * min) return true;
    }
    return x < 20 || y < 20 || x > this.w - 20 || y > this.h - 20;
  }
}
