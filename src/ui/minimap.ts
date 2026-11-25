import { areaFor } from '../sim/areas';
import { EXPLORE_CELL, type Explored } from '../sim/explore';
import { FOREST_PATHS, type ForestInfo } from '../sim/forest';
import type { Sim } from '../sim/sim';

/**
 * Round minimap of the forest world, centred on the hero (bottom-left): regions in their colours,
 * trails, cliff walls, closed passes (red), monster territories, boss lairs and the hero (white
 * arrow). Only the part around the hero shows, and anything not yet explored is greyed out until
 * the hero has been there. Tap it to open the World Map. Hidden off the forest.
 */

const REGION_COL = ['#5fae45', '#b98fb0', '#c08a45']; // Meadow, Bloomwood, Old Mill (south → north)
const FOG = '#4a505e';
/** World units from the centre of the minimap to its rim. */
const VIEW_R = 300;
/** Fog layer pixels per explore cell (soft, round edges). */
const FOG_RES = 6;

export class Minimap {
  readonly el: HTMLCanvasElement;
  private bg: HTMLCanvasElement | null = null;
  private bgFor: ForestInfo | null = null;
  private bgK = 0;
  private fog: HTMLCanvasElement | null = null;
  private fogFor: Explored | null = null;
  private fogVersion = -1;
  private drawnAt = 0;
  private heading = -Math.PI / 2;

  constructor(private readonly sim: Sim, onTap: () => void) {
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    this.el.setAttribute('role', 'button');
    this.el.setAttribute('aria-label', 'Minimap: open the World Map');
    this.el.addEventListener('click', onTap);
  }

  /** Redraw (a few times a second). */
  update(now = performance.now()): void {
    const f = this.sim.map.forest;
    this.el.hidden = !f;
    if (!f || now - this.drawnAt < 120) return;
    this.drawnAt = now;
    const map = this.sim.map;
    const css = this.el.clientWidth || 104;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(css * dpr);
    if (this.el.width !== W || this.el.height !== W) { this.el.width = W; this.el.height = W; }
    const k = W / (2 * VIEW_R); // canvas px per world unit
    if (!this.bg || this.bgFor !== f || this.bgK !== k) this.bg = this.background(f, map.w, map.h, k);
    const ex = this.sim.explored;
    if (ex && (this.fogFor !== ex || this.fogVersion !== ex.version)) this.fog = this.fogLayer(ex);

    const g = this.el.getContext('2d')!;
    const h = this.sim.hero;
    const c = W / 2;
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#2c4a2a'; // beyond the map's edge: deep forest
    g.fillRect(0, 0, W, W);
    g.translate(c - h.x * k, c - h.y * k);
    g.drawImage(this.bg, 0, 0);
    const seen = (x: number, y: number) => !ex || ex.seen(x, y);

    // Closed passes: a red bar across the gap.
    g.lineCap = 'round';
    for (const gate of f.gates) {
      if (map.openGates.has(gate.zone) || !seen(gate.x, gate.y)) continue;
      g.strokeStyle = '#ff3b3b'; g.lineWidth = 4 * dpr;
      g.beginPath(); g.moveTo((gate.x - 30) * k, gate.y * k); g.lineTo((gate.x + 30) * k, gate.y * k); g.stroke();
    }
    // Territories: the monster's colour, once found.
    const mons = areaFor(0).def.monsters;
    for (const t of f.territories) {
      if (!seen(t.x, t.y)) continue;
      g.fillStyle = mons[t.monster].pal.m;
      g.globalAlpha = 0.35;
      g.beginPath(); g.arc(t.x * k, t.y * k, t.r * k, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      g.beginPath(); g.arc(t.x * k, t.y * k, 2.4 * dpr, 0, Math.PI * 2); g.fill();
    }
    // Fog over everything not yet explored (soft-edged: the cell grid is scaled up smoothly).
    if (this.fog && ex) {
      g.imageSmoothingEnabled = true;
      g.drawImage(this.fog, 0, 0, ex.cols * EXPLORE_CELL * k, ex.rows * EXPLORE_CELL * k);
    }
    // Boss lairs (once found): red when the boss is ready (or fighting), grey while it recovers.
    const s = this.sim.save;
    for (const l of f.lairs) {
      if (!seen(l.x, l.y)) continue;
      const ready = l.zone >= s.zoneBosses || (s.bossReady[l.zone] ?? 0) <= this.sim.clock();
      const fighting = this.sim.bossActive && l.zone === s.zone;
      g.fillStyle = fighting ? (Math.floor(now / 250) % 2 ? '#ffd23f' : '#ff3b3b') : ready ? '#e0283a' : '#777';
      g.strokeStyle = '#fff'; g.lineWidth = 1.2 * dpr;
      g.beginPath(); g.arc(l.x * k, l.y * k, 4.2 * dpr, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.restore();

    // The hero, always in the middle: a white arrow pointing the way they face.
    const mvx = h.x - h.prevX, mvy = h.y - h.prevY;
    if (Math.abs(mvx) + Math.abs(mvy) > 0.01) this.heading = Math.atan2(mvy, mvx);
    g.save();
    g.translate(c, c);
    g.rotate(this.heading + Math.PI / 2);
    const a = Math.max(1, W / 110);
    g.fillStyle = '#fff'; g.strokeStyle = '#0a1035'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.moveTo(0, -6 * a); g.lineTo(4.5 * a, 5 * a); g.lineTo(0, 2.5 * a); g.lineTo(-4.5 * a, 5 * a); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }

  /** Regions, trails, walls and landmarks of the whole map at `k` px per unit: drawn once. */
  private background(f: ForestInfo, mw: number, mh: number, k: number): HTMLCanvasElement {
    this.bgFor = f; this.bgK = k;
    const c = document.createElement('canvas');
    c.width = Math.ceil(mw * k); c.height = Math.ceil(mh * k);
    const g = c.getContext('2d')!;
    const bands = [0, ...f.walls, mh];
    for (let i = 0; i < bands.length - 1; i++) {
      g.fillStyle = REGION_COL[2 - i] ?? REGION_COL[0];
      g.fillRect(0, bands[i] * k, c.width, (bands[i + 1] - bands[i]) * k);
    }
    g.strokeStyle = 'rgba(244, 222, 170, 0.85)'; g.lineWidth = Math.max(1.5, 14 * k); g.lineCap = 'round';
    g.beginPath();
    for (const [x0, y0, x1, y1] of FOREST_PATHS) { g.moveTo(x0 * k, y0 * k); g.lineTo(x1 * k, y1 * k); }
    g.stroke();
    g.strokeStyle = '#4a4e5a'; g.lineWidth = Math.max(2, 22 * k);
    for (const y of f.walls) {
      const gate = f.gates.find((q) => q.y === y);
      g.beginPath();
      if (gate) { g.moveTo(0, y * k); g.lineTo((gate.x - 34) * k, y * k); g.moveTo((gate.x + 34) * k, y * k); g.lineTo(c.width, y * k); }
      else { g.moveTo(0, y * k); g.lineTo(c.width, y * k); }
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (const l of f.landmarks) { g.beginPath(); g.arc(l.x * k, l.y * k, Math.max(2, 9 * k), 0, Math.PI * 2); g.fill(); }
    return c;
  }

  /** Grey everywhere, with a soft round hole punched for each explored cell (FOG_RES px per cell). */
  private fogLayer(ex: Explored): HTMLCanvasElement {
    this.fogFor = ex; this.fogVersion = ex.version;
    const c = this.fog ?? document.createElement('canvas');
    const R = FOG_RES;
    c.width = ex.cols * R; c.height = ex.rows * R;
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
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
}
