/**
 * Fog of war for the forest: which parts of the map the hero has seen, as a grid of CELL-sized
 * cells stored in the save as a base64 bitset. The minimap greys out everything else.
 */
export const EXPLORE_CELL = 40;
/** World units around the hero that count as seen. */
export const EXPLORE_RADIUS = 150;

export class Explored {
  readonly cols: number;
  readonly rows: number;
  private readonly bits: Uint8Array;
  /** Bumped whenever a new cell is revealed (the minimap redraws its fog then). */
  version = 0;

  constructor(w: number, h: number, saved = '') {
    this.cols = Math.ceil(w / EXPLORE_CELL);
    this.rows = Math.ceil(h / EXPLORE_CELL);
    this.bits = new Uint8Array(Math.ceil((this.cols * this.rows) / 8));
    if (saved) {
      try {
        const raw = atob(saved);
        for (let i = 0; i < Math.min(raw.length, this.bits.length); i++) this.bits[i] = raw.charCodeAt(i);
      } catch { /* corrupt: start unexplored */ }
    }
  }

  has(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    const i = cy * this.cols + cx;
    return (this.bits[i >> 3] & (1 << (i & 7))) !== 0;
  }

  /** Has the hero seen this world point? */
  seen(x: number, y: number): boolean { return this.has(Math.floor(x / EXPLORE_CELL), Math.floor(y / EXPLORE_CELL)); }

  /** Mark every cell whose centre lies within r of (x, y). Returns true if anything was new. */
  reveal(x: number, y: number, r = EXPLORE_RADIUS): boolean {
    let changed = false;
    const c0 = Math.max(0, Math.floor((x - r) / EXPLORE_CELL)), c1 = Math.min(this.cols - 1, Math.floor((x + r) / EXPLORE_CELL));
    const r0 = Math.max(0, Math.floor((y - r) / EXPLORE_CELL)), r1 = Math.min(this.rows - 1, Math.floor((y + r) / EXPLORE_CELL));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const dx = (cx + 0.5) * EXPLORE_CELL - x, dy = (cy + 0.5) * EXPLORE_CELL - y;
        if (dx * dx + dy * dy > r * r) continue;
        const i = cy * this.cols + cx;
        if (this.bits[i >> 3] & (1 << (i & 7))) continue;
        this.bits[i >> 3] |= 1 << (i & 7);
        changed = true;
      }
    }
    if (changed) this.version++;
    return changed;
  }

  toString(): string {
    let s = '';
    for (const b of this.bits) s += String.fromCharCode(b);
    return btoa(s);
  }
}
