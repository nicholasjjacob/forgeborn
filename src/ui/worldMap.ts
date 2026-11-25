import { monsterSlot, monsterSnapshot, paintMonsterPortraits } from './monsterPreview';
import { gi } from './icons';
import { sfx } from '../audio/sfx';
import { fmt } from '../core/format';
import { xpForKill } from '../sim/level';
import { EXPLORE_CELL, type Explored } from '../sim/explore';
import { forestRegion, regionRaster, type ForestInfo } from '../sim/forest';
import type { Sim } from '../sim/sim';
import { OVERVIEW_ELEV, overviewPoint, type Overview, type Rect } from '../render/world3d';
import { zoneBossName, zoneLevel, zoneName, zoneStage } from '../sim/zones';
import { bindSheetTaps } from './tap';

/**
 * The World Map: the whole Greenwood Forest as one big 3D picture (the real scenery, drawn from
 * high above), greyed out wherever the hero hasn't been yet. Tap a region to fly in: a sharper
 * close-up of it (drag to look around), what's been found there (monster haunts, hordes, the boss
 * lair, landmarks) and fast travel. Locked regions show what they need.
 *
 * The view works in map coordinates: X = world x, D = how far down the tilted picture a point
 * sits ((y - mapH / 2) · sin(tilt) - height · cos(tilt)), so the whole-map picture and the
 * region close-ups line up exactly.
 */

/** The colour unexplored land fades towards. */
const HAZE: [number, number, number] = [118, 124, 138];
const FOG_RES = 6;           // fog mask pixels per explore cell
const ZOOM_MS = 320;
const SIN = Math.sin(OVERVIEW_ELEV), COS = Math.cos(OVERVIEW_ELEV);

interface View { x: number; d: number; s: number } // map point at the canvas centre, canvas px per world unit

export class WorldMapUI {
  private wrap: HTMLElement | null = null;
  private sig = '';
  /** Which region (biome) is zoomed into (-1 = the whole map). */
  private region = -1;
  /** The whole map, and region close-ups (made on demand), for the current scenery. */
  private ov: Overview | null = null;
  private detail = new Map<number, Overview>();
  private ovKey = '';
  /** Greyed copies of each picture (how unexplored land looks). */
  private readonly grey = new Map<Overview, HTMLCanvasElement>();
  private view: View = { x: 0, d: 0, s: 1 };
  private anim: { from: View; to: View; t0: number } | null = null;
  private raf = 0;
  private drawnAt = 0;
  private heading = -Math.PI / 2;
  private readonly icons = new Map<number, HTMLImageElement>();
  /** Draws the scenery from above (set by main: the 3D world renderer). */
  overview: ((widthPx: number, rect?: Rect) => Overview | null) | null = null;

  constructor(
    private readonly sim: Sim,
    private readonly toast: (m: string) => void,
    private readonly codexIcon: (area: number, slot: number) => string,
  ) {}

  get isOpen(): boolean { return this.wrap !== null; }

  open(): void {
    if (this.wrap && !this.wrap.isConnected) this.close();
    if (this.wrap) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal sheet-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'World map');
    wrap.innerHTML = `
      <div class="sheet map-sheet">
        <div class="ribbon"><span class="ribbon-text">World Map</span></div>
        <button type="button" class="sheet-x" aria-label="Close">✕</button>
        <div class="sheet-body">
          <div class="map-you"></div>
          <div class="wm-view">
            <canvas class="wm-canvas"></canvas>
            <div class="wm-labels"></div>
            <button type="button" class="wm-back" data-act="back" hidden>◀ Whole map</button>
            <p class="wm-wait">Drawing the map…</p>
          </div>
          <div class="wm-info"></div>
        </div>
      </div>`;
    bindSheetTaps(wrap, (act) => this.run(act));
    document.addEventListener('keydown', this.onKey);
    document.body.appendChild(wrap);
    this.wrap = wrap;
    this.sig = '';
    this.region = -1;
    this.bindCanvas(wrap.querySelector<HTMLCanvasElement>('.wm-canvas')!);
    this.shown = false;
    this.refresh();
    // The work is split over two frames so neither drops: this one builds the sheet (fading in),
    // the next draws the map. A picture warmed at load already sets the map's shape now, so
    // nothing jumps; otherwise the 3D map is drawn once the sheet is on screen.
    if (this.ov && this.ovKey === this.overviewKey()) {
      wrap.querySelector<HTMLElement>('.wm-wait')!.hidden = true;
      wrap.querySelector<HTMLElement>('.wm-view')!.style.setProperty('--ar', String(this.ov.canvas.width / this.ov.canvas.height));
      requestAnimationFrame(() => this.prepare());
    } else requestAnimationFrame(() => requestAnimationFrame(() => this.prepare()));
  }

  close(): void {
    if (!this.wrap) return;
    this.wrap.remove();
    this.wrap = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener('keydown', this.onKey);
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (this.region >= 0) this.zoomTo(-1); else this.close();
  };

  private run(action: string): void {
    if (action === 'close') { this.close(); return; }
    const [act, arg] = action.split(':');
    if (act === 'back') { sfx.play('tick'); this.zoomTo(-1); }
    else if (act === 'region') { sfx.play('tick'); this.zoomTo(Number(arg)); }
    else if (act === 'travel') {
      if (this.sim.bossActive) { this.toast('Finish the boss fight first'); return; }
      if (this.sim.travelTo(Number(arg))) { sfx.play('area'); this.close(); }
    } else if (act === 'locked') {
      sfx.play('tick');
      this.toast(this.lockText(Number(arg)));
    }
  }

  private lockText(z: number): string {
    const s = this.sim.save;
    const needBoss = z > s.zoneBosses;
    const needLv = s.level < zoneLevel(z);
    if (needBoss && needLv) return `Reach Lv ${zoneLevel(z)} and beat the ${zoneBossName(z - 1)}`;
    if (needBoss) return `Beat the ${zoneBossName(z - 1)} in ${zoneName(z - 1)} to open the way`;
    return `Reach hero level ${zoneLevel(z)} to enter`;
  }

  private get forest(): ForestInfo | null { return this.sim.map.forest ?? null; }

  // --- The 3D pictures ------------------------------------------------------------------------

  private get pc(): boolean { return document.documentElement.classList.contains('pc'); }

  /** The whole-map picture, drawn again only when the scenery changes (a pass opens). */
  private overviewKey(): string {
    const map = this.sim.map;
    return `${map.w}x${map.h}|${[...map.openGates].sort().join(',')}`;
  }

  private ensureOverview(): boolean {
    const key = this.overviewKey();
    if (this.ov && this.ovKey === key) return true;
    const ov = this.overview?.(this.pc ? 2200 : 1500) ?? null;
    if (!ov) return false; // scenery still loading
    this.ov = ov;
    this.ovKey = key;
    this.detail.clear();
    this.grey.clear();
    return true;
  }

  /**
   * Behind the loading screen: draw the map picture, its grey copy, the fog mask and the monsters' stills
   * now, so the first time the map opens there's nothing left to draw.
   */
  warm(): void {
    const f = this.sim.map.forest;
    if (!f || !this.ensureOverview() || !this.ov) return;
    // Its grey copy, the shrunk copies of both, and the fog mask.
    this.sized(this.ov.canvas, 0);
    this.sized(this.greyOf(this.ov), 0);
    if (this.sim.explored) this.fogMaskNow(this.sim.explored);
    for (const t of f.territories) monsterSnapshot(t.area, t.monster);
    // Rehearse a whole open, unseen: the browser builds and lays out the sheet, creates its
    // drawing surfaces and moves the pictures to the graphics card now, not on the first tap.
    // The hero's region gets its close-up too.
    this.open();
    const wrap = this.wrap;
    if (!wrap) return;
    wrap.style.visibility = 'hidden';
    wrap.style.animation = 'none';
    this.draw(true);
    if (this.sim.biome >= 0) this.ensureDetail(this.sim.biome);
    this.canvas().getContext('2d')!.getImageData(0, 0, 1, 1); // run the queued drawing now
    this.close();
  }

  /** Draw (or reuse) the whole-map picture. */
  /** The map has been drawn in this sheet (the first draw waits a frame after opening). */
  private shown = false;

  private prepare(): void {
    if (!this.wrap) return;
    this.shown = true;
    if (!this.ensureOverview() || !this.ov) { setTimeout(() => this.prepare(), 400); return; }
    this.wrap.querySelector<HTMLElement>('.wm-wait')!.hidden = true;
    this.wrap.querySelector<HTMLElement>('.wm-view')!.style.setProperty('--ar', String(this.ov.canvas.width / this.ov.canvas.height));
    this.view = this.viewFor(this.region);
    if (this.region >= 0) this.ensureDetail(this.region);
    this.draw(true);
  }

  /** A sharp close-up of one region (made once per scenery state). */
  private ensureDetail(b: number): void {
    if (this.detail.has(b) || !this.overview) return;
    const r = this.regionRect(b, 60);
    const cv = this.canvas();
    const want = Math.min(this.pc ? 2000 : 1400, Math.max(600, cv.width * 1.4));
    const ov = this.overview(want, r);
    if (ov) this.detail.set(b, ov);
  }

  /** The ground rectangle around a region (from the region raster), padded. */
  private regionRect(b: number, pad: number): Rect {
    const R = regionRaster();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let r = 0; r < R.rows; r++) for (let c = 0; c < R.cols; c++) {
      if (R.data[r * R.cols + c] !== b) continue;
      x0 = Math.min(x0, c * R.cell); x1 = Math.max(x1, (c + 1) * R.cell);
      y0 = Math.min(y0, r * R.cell); y1 = Math.max(y1, (r + 1) * R.cell);
    }
    const map = this.sim.map;
    return { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(map.w, x1 + pad), y1: Math.min(map.h, y1 + pad) };
  }

  /** Halved copies of each picture (made once), for cheap smooth downscaling. */
  private readonly mips = new WeakMap<HTMLCanvasElement, HTMLCanvasElement[]>();

  /**
   * The smallest copy of `img` (itself, or halved again and again) at least `want` px wide: drawn
   * from there with plain bilinear smoothing it looks as smooth as a high-quality downscale.
   */
  private sized(img: HTMLCanvasElement, want: number): HTMLCanvasElement {
    let list = this.mips.get(img);
    if (!list) {
      list = [img];
      for (let src = img; src.width >= 600;) {
        const c = document.createElement('canvas');
        c.width = Math.round(src.width / 2); c.height = Math.round(src.height / 2);
        const g = c.getContext('2d')!;
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'low';
        g.drawImage(src, 0, 0, c.width, c.height);
        list.push(c);
        src = c;
      }
      this.mips.set(img, list);
    }
    let pick = list[0];
    for (const c of list) if (c.width >= want * 0.95) pick = c;
    return pick;
  }

  /** The grey, hazy copy of a picture (how unexplored land looks), made once per picture. */
  private greyOf(ov: Overview): HTMLCanvasElement {
    let grey = this.grey.get(ov);
    if (!grey) { grey = greyed(ov.canvas); this.grey.set(ov, grey); }
    return grey;
  }

  private mask: { ver: number; ex: Explored | null; img: HTMLCanvasElement } | null = null;
  /** The fog mask (opaque where unexplored), redrawn only when the hero has seen somewhere new. */
  private fogMaskNow(ex: Explored): HTMLCanvasElement {
    if (!this.mask || this.mask.ex !== ex || this.mask.ver !== ex.version) this.mask = { ver: ex.version, ex, img: fogMask(ex) };
    return this.mask.img;
  }

  /** Scratch canvas the size of the view, for laying the fog over a picture. */
  private scratch: HTMLCanvasElement | null = null;
  private maskView: HTMLCanvasElement | null = null;

  /**
   * Draw a picture into the view at (x, y, w, h), with everything unexplored swapped for its grey
   * version. The fog is laid at view size each draw (a few small draws) rather than rebuilt over
   * the full 2200 px picture, which hitched the map's open on PC.
   */
  private paintFogged(g: CanvasRenderingContext2D, ov: Overview, x: number, y: number, w: number, h: number): void {
    g.drawImage(this.sized(ov.canvas, w), x, y, w, h);
    const ex = this.sim.explored;
    if (!ex) return;
    const W = g.canvas.width, H = g.canvas.height;
    const t = this.scratch ??= document.createElement('canvas');
    if (t.width !== W || t.height !== H) { t.width = W; t.height = H; }
    const tg = t.getContext('2d')!;
    tg.globalCompositeOperation = 'source-over';
    tg.clearRect(0, 0, W, H);
    tg.imageSmoothingEnabled = true;
    tg.imageSmoothingQuality = 'low';
    tg.drawImage(this.sized(this.greyOf(ov), w), x, y, w, h);
    // The mask, laid over the whole map's ground rectangle (rows are linear in y on this tilted
    // view); the strip above the north edge follows the first row. Outside it stays clear.
    const f = w / ov.canvas.width;
    const tl = overviewPoint(ov, 0, 0), br = overviewPoint(ov, ex.cols * EXPLORE_CELL, ex.rows * EXPLORE_CELL);
    const mask = this.fogMaskNow(ex);
    const mx = x + tl.u * f, my = y + tl.v * f, mw = (br.u - tl.u) * f, mh = (br.v - tl.v) * f;
    const mv = this.maskView ??= document.createElement('canvas');
    if (mv.width !== W || mv.height !== H) { mv.width = W; mv.height = H; }
    const mg = mv.getContext('2d')!;
    mg.clearRect(0, 0, W, H);
    mg.imageSmoothingEnabled = true;
    mg.drawImage(mask, mx, my, mw, mh);
    if (my > y) mg.drawImage(mask, 0, 0, mask.width, 1, mx, y, mw, my - y + 1);
    // One composite: it also clears everything outside the mask.
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(mv, 0, 0);
    g.drawImage(t, 0, 0);
  }

  /** Map coordinates of a ground point raised by h. */
  private toMap(x: number, y: number, h = 0): { x: number; d: number } {
    const mh = this.sim.map.h;
    return { x, d: (y - mh / 2) * SIN - h * COS };
  }

  /** Whole map, or one region fitted to the view. */
  private viewFor(region: number): View {
    const cv = this.canvas();
    const cw = cv.width || 1, ch = cv.height || 1;
    const map = this.sim.map;
    if (region < 0 || !this.forest) {
      const top = this.toMap(0, 0, 40).d, bottom = this.toMap(0, map.h).d;
      return { x: map.w / 2, d: (top + bottom) / 2, s: Math.min(cw / map.w, ch / (bottom - top)) };
    }
    const r = this.regionRect(region, 40);
    const top = this.toMap(0, r.y0, 40).d, bottom = this.toMap(0, r.y1).d;
    const s = Math.min(cw / (r.x1 - r.x0), ch / (bottom - top));
    return { x: (r.x0 + r.x1) / 2, d: (top + bottom) / 2, s };
  }

  /** Keep a zoomed view over its region. */
  private clamp(v: View): View {
    if (this.region < 0) return v;
    const cv = this.canvas();
    const r = this.regionRect(this.region, 120);
    const hw = cv.width / v.s / 2, hh = cv.height / v.s / 2;
    const top = this.toMap(0, r.y0, 40).d, bottom = this.toMap(0, r.y1).d;
    const x = hw * 2 >= r.x1 - r.x0 ? (r.x0 + r.x1) / 2 : Math.min(r.x1 - hw, Math.max(r.x0 + hw, v.x));
    const d = hh * 2 >= bottom - top ? (top + bottom) / 2 : Math.min(bottom - hh, Math.max(top + hh, v.d));
    return { x, d, s: v.s };
  }

  private zoomTo(region: number): void {
    this.region = region;
    this.sig = '';
    this.refresh();
    if (!this.ov) return;
    this.anim = { from: { ...this.view }, to: this.viewFor(region), t0: performance.now() };
    this.loop();
  }

  private loop(): void {
    cancelAnimationFrame(this.raf);
    const step = () => {
      this.raf = 0;
      if (!this.wrap || !this.anim) return;
      const t = Math.min(1, (performance.now() - this.anim.t0) / ZOOM_MS);
      const e = 1 - (1 - t) ** 3;
      const { from, to } = this.anim;
      // Zoom in log space so it feels even.
      const s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e);
      this.view = { x: from.x + (to.x - from.x) * e, d: from.d + (to.d - from.d) * e, s };
      this.draw(true);
      if (t < 1) { this.raf = requestAnimationFrame(step); return; }
      this.anim = null;
      // Arrived: swap in the region's sharp close-up.
      if (this.region >= 0) { this.ensureDetail(this.region); this.draw(true); }
    };
    this.raf = requestAnimationFrame(step);
  }

  private canvas(): HTMLCanvasElement { return this.wrap!.querySelector<HTMLCanvasElement>('.wm-canvas')!; }

  /** Paint the picture, the markers and the labels for the current view. */
  private draw(force = false): void {
    if (!this.wrap || !this.ov) return;
    const now = performance.now();
    if (!force && now - this.drawnAt < 200) return;
    this.drawnAt = now;
    const cv = this.canvas();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) {
      cv.width = W; cv.height = H;
      if (!this.anim) this.view = this.viewFor(this.region);
    }
    const v = this.view, f = this.forest;
    const g = cv.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1b2a1c';
    g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    // Plain bilinear on a pre-shrunk copy (see sized()): 'high' quality redoes a 2200 px
    // downscale on every draw (~30 ms), which hitched the open and the zoom on PC.
    g.imageSmoothingQuality = 'low';
    const cx = (x: number) => (x - v.x) * v.s + W / 2;
    const cy = (d: number) => (d - v.d) * v.s + H / 2;
    // Pictures: the whole map, then (zoomed, once made) the sharp close-up on top.
    const paint = (ov: Overview) => {
      const tl = this.toMap(ov.x0, (ov.y0 + ov.y1) / 2); // the picture's centre row sits at its own vTop
      const d0 = tl.d - ov.vTop;                          // map D of the picture's top row
      this.paintFogged(g, ov, cx(ov.x0), cy(d0), (ov.canvas.width / ov.k) * v.s, (ov.canvas.height / ov.k) * v.s);
    };
    paint(this.ov);
    const det = this.region >= 0 ? this.detail.get(this.region) : undefined;
    if (det && !this.anim) paint(det);
    if (!f) return;

    const ex = this.sim.explored;
    const seen = (x: number, y: number) => !ex || ex.seen(x, y);
    const at = (x: number, y: number, h = 0) => { const p = this.toMap(x, y, h); return { x: cx(p.x), y: cy(p.d) }; };
    const zoomed = this.region >= 0;
    const scale = Math.max(1, dpr) * (zoomed ? 1.2 : 0.9);

    // Closed passes (found ones): a red X.
    for (const gate of f.gates) {
      if (this.sim.map.openGates.has(gate.zone) || !seen(gate.x, gate.y)) continue;
      const p = at(gate.x, gate.y), r = 6 * scale;
      g.strokeStyle = '#ff3b3b'; g.lineWidth = 3 * scale; g.lineCap = 'round';
      g.beginPath(); g.moveTo(p.x - r, p.y - r); g.lineTo(p.x + r, p.y + r); g.moveTo(p.x + r, p.y - r); g.lineTo(p.x - r, p.y + r); g.stroke();
    }

    if (zoomed) {
      // Monster haunts (found ones): the monster's portrait on a light disc; hordes get a red ring.
      for (const t of f.territories) {
        if (t.biome !== this.region || !seen(t.x, t.y)) continue;
        const p = at(t.x, t.y);
        const r = (t.horde ? 17 : 13) * scale;
        const disc = g.createRadialGradient(p.x, p.y - r * 0.3, r * 0.1, p.x, p.y, r);
        disc.addColorStop(0, '#f4f7ff'); disc.addColorStop(1, '#b9c6ea');
        g.fillStyle = disc;
        g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
        // The monster's real 3D model (a still); its codex sprite only until the model has loaded.
        const snap = monsterSnapshot(t.area, t.monster);
        const icon = snap ? null : this.icon(t.area, t.monster);
        if (snap) {
          g.save();
          g.beginPath(); g.arc(p.x, p.y, r - 1, 0, Math.PI * 2); g.clip();
          g.drawImage(snap, p.x - r * 1.05, p.y - r * 1.0, r * 2.1, r * 2.1);
          g.restore();
        }
        else if (icon?.complete && icon.naturalWidth) g.drawImage(icon, p.x - r * 0.85, p.y - r * 0.85, r * 1.7, r * 1.7);
        g.strokeStyle = t.horde ? '#ff4040' : '#0a1035'; g.lineWidth = (t.horde ? 2.5 : 2) * scale;
        g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.stroke();
      }
      // Landmark names (found ones), on top, just above their landmark.
      g.font = `600 ${11 * scale}px Fredoka, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      for (const l of f.landmarks) {
        if (l.biome !== this.region || !seen(l.x, l.y) || f.lairs.some((q) => q.name === l.name)) continue;
        const p = at(l.x, l.y);
        g.lineWidth = 3 * scale; g.strokeStyle = 'rgba(10,16,53,0.85)'; g.fillStyle = '#fff';
        g.strokeText(l.name, p.x, p.y - 4 * scale);
        g.fillText(l.name, p.x, p.y - 4 * scale);
      }
    }

    // Boss lairs (found ones): a skull badge, red when the boss is ready, grey while it recovers.
    const s = this.sim.save;
    for (const l of f.lairs) {
      if (!seen(l.x, l.y)) continue;
      const p = at(l.x, l.y);
      const ready = l.zone >= s.zoneBosses || (s.bossReady[l.zone] ?? 0) <= this.sim.clock();
      const r = 10 * scale;
      g.fillStyle = ready ? '#e0283a' : '#6b6f7a';
      g.strokeStyle = '#fff'; g.lineWidth = 2 * scale;
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = `${12 * scale}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('☠', p.x, p.y + 0.5 * scale);
      if (zoomed && l.biome === this.region) {
        g.font = `600 ${11 * scale}px Fredoka, system-ui, sans-serif`; g.textBaseline = 'top';
        g.lineWidth = 3 * scale; g.strokeStyle = 'rgba(10,16,53,0.85)'; g.fillStyle = '#ffd6d6';
        g.strokeText(l.name, p.x, p.y + r + 3 * scale); g.fillText(l.name, p.x, p.y + r + 3 * scale);
      }
    }

    // The hero: a white arrow in a pulsing ring.
    const h = this.sim.hero;
    const mvx = h.x - h.prevX, mvy = h.y - h.prevY;
    if (Math.abs(mvx) + Math.abs(mvy) > 0.01) this.heading = Math.atan2(mvy, mvx);
    const hp = at(h.x, h.y);
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    g.strokeStyle = `rgba(255,255,255,${0.35 + 0.4 * pulse})`; g.lineWidth = 2 * scale;
    g.beginPath(); g.arc(hp.x, hp.y, (11 + 4 * pulse) * scale, 0, Math.PI * 2); g.stroke();
    g.save();
    g.translate(hp.x, hp.y);
    g.rotate(this.heading + Math.PI / 2);
    const a = 1.5 * scale;
    g.fillStyle = '#fff'; g.strokeStyle = '#0a1035'; g.lineWidth = 1.5 * scale;
    g.beginPath(); g.moveTo(0, -6 * a); g.lineTo(4.5 * a, 5 * a); g.lineTo(0, 2.5 * a); g.lineTo(-4.5 * a, 5 * a); g.closePath();
    g.fill(); g.stroke();
    g.restore();

    this.placeLabels(at, W, H);
  }

  /** Region name tags over the whole map (tap one to fly in). */
  private placeLabels(at: (x: number, y: number) => { x: number; y: number }, W: number, H: number): void {
    const box = this.wrap!.querySelector<HTMLElement>('.wm-labels')!;
    const f = this.forest;
    if (this.region >= 0 || !f) { box.innerHTML = ''; return; }
    if (!box.childElementCount) {
      box.innerHTML = f.biomes.map((_, b) => `<button type="button" class="wm-region" data-act="region:${b}"></button>`).join('');
    }
    box.querySelectorAll<HTMLButtonElement>('.wm-region').forEach((el) => {
      const b = Number(el.dataset.act!.split(':')[1]);
      const bm = f.biomes[b];
      const open = this.sim.zoneUnlocked(bm.zone);
      const here = b === this.sim.biome;
      const html = `<b>${here ? gi('position-marker', 'red') : open ? '' : gi('padlock', 'grey')}${bm.name}</b><small>${open ? `Lv ${zoneLevel(bm.zone)}+` : `Locked · Lv ${zoneLevel(bm.zone)}`}</small>`;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.classList.toggle('locked', !open);
      el.classList.toggle('here', here);
      // A region whose boss lair is near its heart: the tag moves off it, clear of the lair's skull.
      const lair = f.lairs.find((l) => l.biome === b);
      const near = lair && Math.hypot(lair.x - bm.x, lair.y - bm.y) < 260;
      const p = at(bm.x, bm.y + (near ? (lair.y > bm.y ? -120 : 120) : 0)); // away from the lair
      el.style.left = `${(p.x / W) * 100}%`;
      el.style.top = `${(p.y / H) * 100}%`;
    });
  }

  private icon(area: number, slot: number): HTMLImageElement | null {
    let im = this.icons.get(area * 4 + slot);
    if (!im) {
      const src = this.codexIcon(area, slot);
      if (!src) return null;
      im = new Image();
      im.src = src;
      this.icons.set(area * 4 + slot, im);
    }
    return im;
  }

  /** Drag to look around (zoomed in); a tap on the whole map flies into the region under it. */
  private bindCanvas(cv: HTMLCanvasElement): void {
    let drag: { id: number; x: number; y: number; vx: number; vd: number; moved: boolean } | null = null;
    cv.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: this.view.x, vd: this.view.d, moved: false };
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id || !this.ov) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      if (!drag.moved || this.region < 0) return;
      const dpr = cv.width / (cv.getBoundingClientRect().width || 1);
      this.anim = null;
      this.view = this.clamp({ x: drag.vx - (dx * dpr) / this.view.s, d: drag.vd - (dy * dpr) / this.view.s, s: this.view.s });
      this.draw(true);
    });
    const up = (e: PointerEvent) => {
      const d = drag;
      drag = null;
      if (!d || e.pointerId !== d.id || d.moved || !this.ov || this.region >= 0) return;
      // Tap on the whole map: which region is under it?
      const r = cv.getBoundingClientRect();
      const dpr = cv.width / r.width;
      const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
      const x = (px - cv.width / 2) / this.view.s + this.view.x;
      const dd = (py - cv.height / 2) / this.view.s + this.view.d;
      const y = this.sim.map.h / 2 + dd / SIN;
      const b = forestRegion(x, y);
      if (b < 0) return;
      sfx.play('tick');
      this.zoomTo(b);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { drag = null; });
  }

  // --- Text: where you are, and the region details ------------------------------------------

  /** Re-render when progress changes (and redraw the hero marker). Called by the HUD ~10×/s. */
  refresh(): void {
    if (!this.wrap) return;
    if (this.ov && !this.anim && this.shown) this.draw();
    const sim = this.sim, s = sim.save;
    const f = this.forest;
    const ex = sim.explored;
    const zone = this.region >= 0 && f ? f.biomes[this.region].zone : -1;
    const cool = zone >= 0 ? Math.ceil(this.cooldown(zone)) : 0;
    const sig = `${s.zone}|${sim.biome}|${s.zoneBosses}|${s.level}|${sim.maxZone}|${sim.bossActive}|${this.region}|${ex?.version ?? 0}|${cool}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const where = f && sim.biome >= 0 ? f.biomes[sim.biome].name : zoneName(s.zone);
    this.wrap.querySelector('.map-you')!.innerHTML = `📍 <b>${where}</b> · Hero Lv ${s.level}`;
    this.wrap.querySelector<HTMLElement>('.wm-back')!.hidden = this.region < 0;
    const info = this.wrap.querySelector<HTMLElement>('.wm-info')!;
    if (this.region < 0 || !f) {
      info.innerHTML = `
        <p class="sheet-note">Tap a region to look closer. Grey land is still unexplored: walk there to uncover it.</p>
        <div class="map-area mystery compact"><div class="map-area-head"><span class="map-ico">${gi('compass', 'gold')}</span><b>More lands coming soon</b></div>
          <p>Beyond the Greenwood lie marshes, dunes, caverns, snowfields and fire.</p></div>`;
      return;
    }
    info.innerHTML = this.regionInfo(this.region, f, ex);
    paintMonsterPortraits();
  }

  private cooldown(z: number): number {
    const s = this.sim.save;
    if (z >= s.zoneBosses) return 0;
    return Math.max(0, ((s.bossReady[z] ?? 0) - this.sim.clock()) / 1000);
  }

  private regionInfo(b: number, f: ForestInfo, ex: Explored | null): string {
    const s = this.sim.save;
    const bm = f.biomes[b], z = bm.zone;
    const seen = (x: number, y: number) => !ex || ex.seen(x, y);
    const open = this.sim.zoneUnlocked(z);
    const here = b === this.sim.biome;
    const beaten = z < s.zoneBosses;
    // The tier's boss: its lair is in one of the tier's regions.
    const lair = f.lairs.find((l) => l.zone === z);
    const lairKnown = !!lair && seen(lair.x, lair.y);
    const lairHere = lair?.biome === b;
    const where = !lair ? '' : lairHere ? (lairKnown ? `at the ${lair.name}` : 'somewhere in this region') : `in ${f.biomes[lair.biome].name}`;
    const cool = this.cooldown(z);
    const bossState = !beaten ? `waits ${where}` : cool > 0 ? `defeated ✓ · back in ${clock(cool)}` : `defeated ✓ · rematch ${where}`;
    // Monsters of this region: shown once one of their haunts here has been found.
    const haunts = f.territories.filter((t) => t.biome === b);
    const kinds = [...new Map(haunts.map((t) => [t.area * 4 + t.monster, t])).values()];
    const mons = kinds.map((k) => {
      const found = haunts.some((t) => t.area === k.area && t.monster === k.monster && seen(t.x, t.y));
      return monsterSlot(k.area, k.monster, this.codexIcon(k.area, k.monster), 'map-mon', !found);
    }).join('');
    const found = haunts.filter((t) => seen(t.x, t.y)).length;
    const hordes = haunts.filter((t) => t.horde).length;
    const action = here
      ? '<span class="zone-tag here">You are here</span>'
      : open
        ? `<button type="button" class="btn green" data-act="travel:${b}">Travel here</button>`
        : `<button type="button" class="zone-lock" data-act="locked:${z}">${gi('padlock', 'grey')} ${this.lockText(z)}</button>`;
    return `
      <div class="wm-region-info">
        <div class="wm-ri-head"><b>${bm.name}</b><span>Zone ${z + 1} · Lv ${zoneLevel(z)}+ · XP <b>${fmt(xpForKill(zoneStage(z), false))}</b>/kill</span></div>
        <div class="wm-ri-row">${gi('skull-crossed-bones', 'white')} <b>${zoneBossName(z)}</b> <span>${bossState}</span></div>
        <div class="wm-ri-row"><span class="map-mons">${mons}</span><span>Haunts found: <b>${found}/${haunts.length}</b>${hordes ? ` · <b class="wm-horde">${hordes} overrun</b>` : ''}</span></div>
        <div class="wm-ri-act">${action}</div>
      </div>`;
  }
}

/** A desaturated, hazy copy of the picture: how unexplored land looks. */
function greyed(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    d[i] = l * 0.45 + HAZE[0] * 0.55;
    d[i + 1] = l * 0.45 + HAZE[1] * 0.55;
    d[i + 2] = l * 0.45 + HAZE[2] * 0.55;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Opaque where unexplored, clear (soft-edged) where explored: FOG_RES px per cell. */
function fogMask(ex: Explored): HTMLCanvasElement {
  const R = FOG_RES;
  const c = document.createElement('canvas');
  c.width = ex.cols * R; c.height = ex.rows * R;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
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
  return c;
}

/** 125 → "2:05". */
function clock(sec: number): string {
  const t = Math.ceil(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
