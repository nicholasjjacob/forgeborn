import { Rng } from '../core/rng';
import { areaFor, type PropKind } from './areas';

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

export interface Prop { kind: PropKind; x: number; y: number; r: number; variant: number }

export interface Decal { x: number; y: number; variant: number }

/**
 * One area's arena: scattered props (some solid) plus a solid border ring, and a static
 * uniform grid so collision queries only look at nearby props.
 */
export class GameMap {
  readonly props: Prop[] = [];
  readonly decals: Decal[] = [];
  private readonly cols = Math.ceil(MAP_W / CELL);
  private readonly rows = Math.ceil(MAP_H / CELL);
  private readonly grid: number[][];

  constructor(readonly area: number) {
    const rng = new Rng(0xa5ea + area * 7919);
    const { def } = areaFor(area);
    const total = def.props.reduce((s, p) => s + p.weight, 0);
    const pick = (): PropKind => {
      let r = rng.next() * total;
      for (const p of def.props) { if ((r -= p.weight) < 0) return p.kind; }
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
    const inside = (x: number, y: number) =>
      x > 44 && x < MAP_W - 44 && y > 44 && y < MAP_H - 44 && Math.hypot(x - cx, y - cy) > CLEAR_RADIUS;
    for (let tries = 0; placed < 150 && tries < 2000; tries++) {
      const x = rng.range(44, MAP_W - 44), y = rng.range(44, MAP_H - 44);
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
      this.decals.push({ x: rng.range(10, MAP_W - 10), y: rng.range(10, MAP_H - 10), variant: rng.int(3) });
    }

    this.grid = Array.from({ length: this.cols * this.rows }, () => []);
    this.props.forEach((p, i) => {
      if (p.r <= 0) return;
      // Register in every cell the circle overlaps, padded by the largest mover radius so a
      // query of just the mover's own cell finds every prop it could touch.
      const reach = p.r + MAX_MOVER_RADIUS;
      const c0 = this.col(p.x - reach), c1 = this.col(p.x + reach);
      const r0 = this.row(p.y - reach), r1 = this.row(p.y + reach);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.grid[r * this.cols + c].push(i);
    });
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
      const dx = out.x - p.x, dy = out.y - p.y;
      const min = p.r + radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.001;
      out.x = p.x + (dx / d) * min;
      out.y = p.y + (dy / d) * min;
    }
    out.x = Math.max(16, Math.min(MAP_W - 16, out.x));
    out.y = Math.max(16, Math.min(MAP_H - 16, out.y));
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
      const min = p.r + radius;
      if ((x - p.x) ** 2 + (y - p.y) ** 2 < min * min) return true;
    }
    return x < 20 || y < 20 || x > MAP_W - 20 || y > MAP_H - 20;
  }
}
