import { areaFor } from '../sim/areas';
import { FOREST_PATHS, type ForestInfo } from '../sim/forest';
import type { Sim } from '../sim/sim';

/**
 * Minimap of the forest world (bottom-left): regions in their colours, trails, cliff walls, closed
 * passes (red), monster territories (dots in the monster's colour), boss lairs (red when the boss
 * is ready) and the hero (white arrow). Tap it to open the World Map. Hidden off the forest.
 */

const REGION_COL = ['#5fae45', '#b98fb0', '#c08a45']; // Meadow, Bloomwood, Old Mill (south → north)

export class Minimap {
  readonly el: HTMLCanvasElement;
  private bg: HTMLCanvasElement | null = null;
  private bgFor: ForestInfo | null = null;
  private drawnAt = 0;

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
    if (!f || now - this.drawnAt < 220) return;
    this.drawnAt = now;
    const map = this.sim.map;
    const cssW = this.el.clientWidth || 100, cssH = this.el.clientHeight || 110;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (this.el.width !== W || this.el.height !== H) { this.el.width = W; this.el.height = H; this.bg = null; }
    if (!this.bg || this.bgFor !== f) this.bg = this.background(f, map.w, map.h, W, H);
    const g = this.el.getContext('2d')!;
    const kx = W / map.w, ky = H / map.h;
    g.clearRect(0, 0, W, H);
    g.drawImage(this.bg, 0, 0);

    // Closed passes: a red bar across the gap.
    g.lineCap = 'round';
    for (const gate of f.gates) {
      if (map.openGates.has(gate.zone)) continue;
      g.strokeStyle = '#ff3b3b'; g.lineWidth = 4 * dpr;
      g.beginPath(); g.moveTo((gate.x - 30) * kx, gate.y * ky); g.lineTo((gate.x + 30) * kx, gate.y * ky); g.stroke();
    }
    // Territories: the monster's colour.
    const mons = areaFor(0).def.monsters;
    for (const t of f.territories) {
      g.fillStyle = mons[t.monster].pal.m;
      g.globalAlpha = 0.35;
      g.beginPath(); g.ellipse(t.x * kx, t.y * ky, t.r * kx, t.r * ky, 0, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      g.beginPath(); g.arc(t.x * kx, t.y * ky, 2.4 * dpr, 0, Math.PI * 2); g.fill();
    }
    // Boss lairs: red when the boss is ready (or fighting), grey while it recovers.
    const s = this.sim.save;
    for (const l of f.lairs) {
      const ready = l.zone >= s.zoneBosses || (s.bossReady[l.zone] ?? 0) <= Date.now();
      const fighting = this.sim.bossActive && l.zone === s.zone;
      g.fillStyle = fighting ? (Math.floor(now / 250) % 2 ? '#ffd23f' : '#ff3b3b') : ready ? '#e0283a' : '#777';
      g.strokeStyle = '#fff'; g.lineWidth = 1.2 * dpr;
      g.beginPath(); g.arc(l.x * kx, l.y * ky, 4.2 * dpr, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // The hero: a white arrow pointing the way he faces.
    const h = this.sim.hero;
    const mvx = h.x - h.prevX, mvy = h.y - h.prevY;
    if (Math.abs(mvx) + Math.abs(mvy) > 0.01) this.heading = Math.atan2(mvy, mvx);
    g.save();
    g.translate(h.x * kx, h.y * ky);
    g.rotate(this.heading + Math.PI / 2);
    g.fillStyle = '#fff'; g.strokeStyle = '#0a1035'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.moveTo(0, -6 * dpr); g.lineTo(4.5 * dpr, 5 * dpr); g.lineTo(0, 2.5 * dpr); g.lineTo(-4.5 * dpr, 5 * dpr); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }
  private heading = -Math.PI / 2;

  /** Regions, trails, walls and landmarks: drawn once. */
  private background(f: ForestInfo, mw: number, mh: number, W: number, H: number): HTMLCanvasElement {
    this.bgFor = f;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const kx = W / mw, ky = H / mh;
    // Regions: north to south between the walls.
    const bands = [0, ...f.walls, mh];
    for (let i = 0; i < bands.length - 1; i++) {
      g.fillStyle = REGION_COL[2 - i] ?? REGION_COL[0];
      g.fillRect(0, bands[i] * ky, W, (bands[i + 1] - bands[i]) * ky);
    }
    g.strokeStyle = 'rgba(244, 222, 170, 0.85)'; g.lineWidth = Math.max(1.5, 14 * kx); g.lineCap = 'round';
    g.beginPath();
    for (const [x0, y0, x1, y1] of FOREST_PATHS) { g.moveTo(x0 * kx, y0 * ky); g.lineTo(x1 * kx, y1 * ky); }
    g.stroke();
    g.strokeStyle = '#4a4e5a'; g.lineWidth = Math.max(2, 22 * ky);
    for (const y of f.walls) {
      const gate = f.gates.find((q) => q.y === y);
      g.beginPath();
      if (gate) { g.moveTo(0, y * ky); g.lineTo((gate.x - 34) * kx, y * ky); g.moveTo((gate.x + 34) * kx, y * ky); g.lineTo(W, y * ky); }
      else { g.moveTo(0, y * ky); g.lineTo(W, y * ky); }
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (const l of f.landmarks) { g.beginPath(); g.arc(l.x * kx, l.y * ky, 1.6 * (W / 100), 0, Math.PI * 2); g.fill(); }
    return c;
  }
}
