import { areaFor } from '../sim/areas';
import { EXPLORE_CELL, EXPLORE_RADIUS, type Explored } from '../sim/explore';
import { FOREST_PATHS, regionRaster, type ForestInfo } from '../sim/forest';
import type { Sim } from '../sim/sim';

/**
 * Minimap of the forest world (bottom-left): regions in their colours, trails, closed passes
 * (red X), monster territories, boss lairs and the hero (white arrow); anything not yet explored
 * is greyed out until the hero has been there. A window on the land around the hero, in either
 * frame (Settings): a circle or a rounded square, at the same zoom.
 * Tap it to open the World Map. Hidden off the forest.
 *
 * The fog is one persistent layer: built from the explored cells once, then every frame a soft
 * circle is wiped away around the hero, so it clears smoothly as they walk (not in cell steps).
 */

const FOG = '#4a505e';
/** World units from the centre of the round minimap to its rim. */
const VIEW_R = 300;
/** Fog layer pixels per explore cell. */
const FOG_RES = 6;
/** About this many redraws per second (smooth, but no more than needed). */
const FRAME_MS = 1000 / 60;

export class Minimap {
  readonly el: HTMLCanvasElement;
  private bg: HTMLCanvasElement | null = null;
  private bgFor: ForestInfo | null = null;
  private bgK = 0;
  private fog: HTMLCanvasElement | null = null;
  private fogFor: Explored | null = null;
  private drawnAt = 0;
  private heading = -Math.PI / 2;

  constructor(private readonly sim: Sim, onTap: () => void) {
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    this.el.setAttribute('role', 'button');
    this.el.setAttribute('aria-label', 'Minimap: open the World Map');
    this.el.addEventListener('click', onTap);
  }

  /** Redraw (every frame); `alpha` places the hero between the last two sim ticks, like the 3D view. */
  update(now = performance.now(), alpha = 1): void {
    const f = this.sim.map.forest;
    this.el.hidden = !f;
    const square = this.sim.save.minimap === 'square';
    this.el.classList.toggle('square', square);
    if (!f || now - this.drawnAt < FRAME_MS - 2) return;
    this.drawnAt = now;
    const map = this.sim.map;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round((this.el.clientWidth || 104) * dpr), H = Math.round((this.el.clientHeight || 104) * dpr);
    if (this.el.width !== W || this.el.height !== H) { this.el.width = W; this.el.height = H; }
    // Canvas px per world unit, and where the map's origin sits on the canvas.
    const h = this.sim.hero;
    const hx = h.prevX + (h.x - h.prevX) * alpha, hy = h.prevY + (h.y - h.prevY) * alpha;
    // Both shapes show the same land around the hero at the same zoom; only the frame differs.
    const k = W / (2 * VIEW_R);
    const ox = W / 2 - hx * k, oy = H / 2 - hy * k;
    if (!this.bg || this.bgFor !== f || Math.abs(this.bgK - k) > 1e-6) this.bg = this.background(f, map.w, map.h, k);
    const ex = this.sim.explored;
    if (ex && this.fogFor !== ex) this.fog = this.fogLayer(ex);
    if (ex && this.fog) this.clearAround(hx, hy);

    const g = this.el.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.save();
    if (!square) { g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); g.clip(); }
    g.fillStyle = '#2c4a2a'; // beyond the map's edge: deep forest
    g.fillRect(0, 0, W, H);
    g.translate(ox, oy);
    g.drawImage(this.bg, 0, 0);
    const seen = (x: number, y: number) => !ex || ex.seen(x, y);
    const dot = 1;

    // Territories: the monster's colour, once found.
    for (const t of f.territories) {
      if (!seen(t.x, t.y)) continue;
      g.fillStyle = areaFor(t.area).def.monsters[t.monster].pal.m;
      g.globalAlpha = 0.35;
      g.beginPath(); g.arc(t.x * k, t.y * k, t.r * k, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      g.beginPath(); g.arc(t.x * k, t.y * k, 2.4 * dpr * dot, 0, Math.PI * 2); g.fill();
    }
    // Fog over everything not yet explored.
    if (this.fog && ex) {
      g.imageSmoothingEnabled = true;
      g.drawImage(this.fog, 0, 0, ex.cols * EXPLORE_CELL * k, ex.rows * EXPLORE_CELL * k);
    }
    // Closed passes (found ones): a red X over the barricade.
    g.lineCap = 'round';
    for (const gate of f.gates) {
      if (map.openGates.has(gate.zone) || !seen(gate.x, gate.y)) continue;
      const x = gate.x * k, y = gate.y * k, d = 3.5 * dpr * dot;
      g.strokeStyle = '#ff3b3b'; g.lineWidth = 2.5 * dpr * dot;
      g.beginPath(); g.moveTo(x - d, y - d); g.lineTo(x + d, y + d); g.moveTo(x + d, y - d); g.lineTo(x - d, y + d); g.stroke();
    }
    // Boss lairs (once found): red when the boss is ready (or fighting), grey while it recovers.
    const s = this.sim.save;
    for (const l of f.lairs) {
      if (!seen(l.x, l.y)) continue;
      const ready = l.zone >= s.zoneBosses || (s.bossReady[l.zone] ?? 0) <= this.sim.clock();
      const fighting = this.sim.bossActive && !this.sim.worldBossActive && l.zone === s.zone;
      g.fillStyle = fighting ? (Math.floor(now / 250) % 2 ? '#ffd23f' : '#ff3b3b') : ready ? '#e0283a' : '#777';
      g.strokeStyle = '#fff'; g.lineWidth = 1.2 * dpr;
      g.beginPath(); g.arc(l.x * k, l.y * k, 4.2 * dpr * dot, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // The world boss's crypt: a bigger purple dot once open (grey while sealed or recovering).
    const wl = f.worldLair;
    if (seen(wl.x, wl.y)) {
      const ready = this.sim.worldBossOpen && this.sim.worldBossCooldownLeft() <= 0;
      g.fillStyle = this.sim.worldBossActive ? (Math.floor(now / 250) % 2 ? '#ffd23f' : '#b04aff') : ready ? '#9a3aff' : '#777';
      g.strokeStyle = '#fff'; g.lineWidth = 1.4 * dpr;
      g.beginPath(); g.arc(wl.x * k, wl.y * k, 5.4 * dpr * dot, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.restore();

    // The hero: a white arrow pointing the way they face (the centre of the round view).
    const mvx = h.x - h.prevX, mvy = h.y - h.prevY;
    if (Math.abs(mvx) + Math.abs(mvy) > 0.01) this.heading = Math.atan2(mvy, mvx);
    g.save();
    g.translate(ox + hx * k, oy + hy * k);
    g.rotate(this.heading + Math.PI / 2);
    const a = Math.max(1, Math.min(W, H) / 110) * dot;
    g.fillStyle = '#fff'; g.strokeStyle = '#0a1035'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.moveTo(0, -6 * a); g.lineTo(4.5 * a, 5 * a); g.lineTo(0, 2.5 * a); g.lineTo(-4.5 * a, 5 * a); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }

  /** Regions (each in its colour), rocky borders, ponds, trails and landmarks of the whole map at `k` px per unit: drawn once. */
  private background(f: ForestInfo, mw: number, mh: number, k: number): HTMLCanvasElement {
    this.bgFor = f; this.bgK = k;
    const c = document.createElement('canvas');
    c.width = Math.ceil(mw * k); c.height = Math.ceil(mh * k);
    const g = c.getContext('2d')!;
    // The region raster, one pixel per cell, scaled up smoothly.
    const R = regionRaster();
    const img = document.createElement('canvas');
    img.width = R.cols; img.height = R.rows;
    const ig = img.getContext('2d')!;
    const px = ig.createImageData(R.cols, R.rows);
    const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const cols = f.biomes.map((b) => rgb(b.map));
    for (let i = 0; i < R.data.length; i++) {
      const v = R.data[i];
      const col = v < 0 ? [34, 56, 34] : R.border[i] ? [96, 98, 104] : cols[v];
      px.data[i * 4] = col[0]; px.data[i * 4 + 1] = col[1]; px.data[i * 4 + 2] = col[2]; px.data[i * 4 + 3] = 255;
    }
    ig.putImageData(px, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, 0, R.cols * R.cell * k, R.rows * R.cell * k);
    g.fillStyle = '#4aa6e0';
    for (const p of f.ponds) { g.beginPath(); g.arc(p.x * k, p.y * k, p.r * k, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = 'rgba(244, 222, 170, 0.85)'; g.lineWidth = Math.max(1, 14 * k); g.lineCap = 'round';
    g.beginPath();
    for (const [x0, y0, x1, y1] of FOREST_PATHS) { g.moveTo(x0 * k, y0 * k); g.lineTo(x1 * k, y1 * k); }
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (const l of f.landmarks) { g.beginPath(); g.arc(l.x * k, l.y * k, Math.max(1.5, 9 * k), 0, Math.PI * 2); g.fill(); }
    return c;
  }

  /** The fog, built once from the explored cells: grey, with a soft hole for each explored cell. */
  private fogLayer(ex: Explored): HTMLCanvasElement {
    this.fogFor = ex;
    const c = document.createElement('canvas');
    const R = FOG_RES;
    c.width = ex.cols * R; c.height = ex.rows * R;
    const g = c.getContext('2d')!;
    g.fillStyle = FOG;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-out';
    const rad = R * 1.25;
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, rad);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.55, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    for (let y = 0; y < ex.rows; y++) {
      for (let x = 0; x < ex.cols; x++) {
        if (!ex.has(x, y)) continue;
        g.setTransform(1, 0, 0, 1, (x + 0.5) * R, (y + 0.5) * R);
        g.fillRect(-rad, -rad, rad * 2, rad * 2);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  /** Wipe the fog away around the hero (a soft-edged circle the size of what they can see). */
  private clearAround(x: number, y: number): void {
    const c = this.fog!;
    const g = c.getContext('2d')!;
    const s = FOG_RES / EXPLORE_CELL; // fog px per world unit
    const cx = x * s, cy = y * s, r = EXPLORE_RADIUS * s;
    const grad = g.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = grad;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.globalCompositeOperation = 'source-over';
  }
}
