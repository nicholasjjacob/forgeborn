import { forestRegion } from './forest';
import type { GameMap } from './map';

/**
 * Walking routes for the World Map's "go there": A* over a grid of the forest (STEP-unit cells),
 * where a cell is walkable if the hero fits at its centre: inside a region, clear of rocks, trees,
 * ponds and barricades that are still closed. The cell path is then pulled taut into a few
 * straight runs (each one checked clear), so the hero walks naturally round the borders and
 * through the open passes.
 */

const STEP = 20;
/** Clearance kept from props while planning (a touch more than the hero's radius). */
const CLEAR = 8;

let cache: { key: string; map: GameMap; cols: number; rows: number; ok: Uint8Array } | null = null;

function walkGrid(map: GameMap, gateOpen: (zone: number) => boolean, key: string) {
  if (cache && cache.map === map && cache.key === key) return cache;
  const cols = Math.ceil(map.w / STEP), rows = Math.ceil(map.h / STEP);
  const ok = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * STEP, y = (r + 0.5) * STEP;
      ok[r * cols + c] = forestRegion(x, y) >= 0 && !map.blockedWith(x, y, CLEAR, gateOpen) ? 1 : 0;
    }
  }
  cache = { key, map, cols, rows, ok };
  return cache;
}

/** Is the straight line between two points clear for the hero? */
function clearLine(map: GameMap, gateOpen: (zone: number) => boolean, x0: number, y0: number, x1: number, y1: number): boolean {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6);
  for (let i = 1; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    if (forestRegion(x, y) < 0 || map.blockedWith(x, y, CLEAR - 2, gateOpen)) return false;
  }
  return true;
}

/**
 * Waypoints from (sx, sy) to (tx, ty), ending `keepOut` short of the destination (outside a lair).
 * `gateOpen` says which barricades will be open. Null if there's no way there.
 */
export function forestRoute(
  map: GameMap, sx: number, sy: number, tx: number, ty: number, gateOpen: (zone: number) => boolean, keepOut = 0,
): { x: number; y: number }[] | null {
  const key = Array.from({ length: 32 }, (_, z) => (gateOpen(z) ? 1 : 0)).join('');
  const g = walkGrid(map, gateOpen, key);
  const { cols, rows, ok } = g;
  const cellOf = (x: number, y: number) =>
    Math.max(0, Math.min(rows - 1, Math.floor(y / STEP))) * cols + Math.max(0, Math.min(cols - 1, Math.floor(x / STEP)));
  // The nearest walkable cell to a point (a destination among a haunt's rocks, say).
  const nearestOk = (x: number, y: number): number => {
    const c0 = cellOf(x, y);
    if (ok[c0]) return c0;
    const cx = c0 % cols, cy = Math.floor(c0 / cols);
    for (let rad = 1; rad < 12; rad++) {
      let best = -1, bd = Infinity;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const c = cx + dx, r = cy + dy;
          if (c < 0 || r < 0 || c >= cols || r >= rows || !ok[r * cols + c]) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = r * cols + c; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  const start = nearestOk(sx, sy), goal = nearestOk(tx, ty);
  if (start < 0 || goal < 0) return null;

  // A* (8 directions, no corner cutting) with a binary heap.
  const n = cols * rows;
  const gs = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const f = new Float32Array(n), heap: number[] = [];
  const gx = goal % cols, gy = Math.floor(goal / cols);
  const h = (c: number) => {
    const dx = Math.abs((c % cols) - gx), dy = Math.abs(Math.floor(c / cols) - gy);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  const push = (c: number) => {
    heap.push(c);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (f[heap[p]] <= f[heap[i]]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
        if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  gs[start] = 0; f[start] = h(start); push(start);
  let found = false;
  while (heap.length) {
    const u = pop();
    if (done[u]) continue;
    if (u === goal) { found = true; break; }
    done[u] = 1;
    const ux = u % cols, uy = Math.floor(u / cols);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const vx = ux + dx, vy = uy + dy;
        if (vx < 0 || vy < 0 || vx >= cols || vy >= rows) continue;
        const v = vy * cols + vx;
        if (!ok[v] || done[v]) continue;
        if (dx && dy && (!ok[uy * cols + vx] || !ok[vy * cols + ux])) continue; // no cutting corners
        const ng = gs[u] + (dx && dy ? 1.414 : 1);
        if (ng < gs[v]) { gs[v] = ng; prev[v] = u; f[v] = ng + h(v); push(v); }
      }
    }
  }
  if (!found) return null;
  const cells: { x: number; y: number }[] = [];
  for (let c = goal; c >= 0; c = prev[c]) cells.unshift({ x: ((c % cols) + 0.5) * STEP, y: (Math.floor(c / cols) + 0.5) * STEP });
  cells[cells.length - 1] = { x: tx, y: ty };

  // Pull the path taut: from each point, jump to the furthest later point in a clear line.
  const pts: { x: number; y: number }[] = [];
  let cur = { x: sx, y: sy };
  for (let i = 0; i < cells.length;) {
    let j = cells.length - 1;
    while (j > i && !clearLine(map, gateOpen, cur.x, cur.y, cells[j].x, cells[j].y)) j--;
    pts.push(cells[j]);
    cur = cells[j];
    i = j + 1;
  }

  if (keepOut <= 0) return pts;
  // Stop where the route first comes within `keepOut` of the destination.
  const out: { x: number; y: number }[] = [];
  let px = sx, py = sy;
  for (const p of pts) {
    if (Math.hypot(p.x - tx, p.y - ty) > keepOut) { out.push(p); px = p.x; py = p.y; continue; }
    const dx = px - p.x, dy = py - p.y, len = Math.hypot(dx, dy) || 1;
    let lo = 0, hi = len;
    for (let k = 0; k < 20; k++) {
      const m = (lo + hi) / 2;
      if (Math.hypot(p.x + (dx / len) * m - tx, p.y + (dy / len) * m - ty) > keepOut) hi = m; else lo = m;
    }
    out.push({ x: p.x + (dx / len) * hi, y: p.y + (dy / len) * hi });
    break;
  }
  return out;
}
