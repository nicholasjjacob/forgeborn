import { monsterSlot, paintMonsterPortraits } from './monsterPreview';
import { gi } from './icons';
import { sfx } from '../audio/sfx';
import { fmt } from '../core/format';
import { xpForKill } from '../sim/level';
import { EXPLORE_CELL, type Explored } from '../sim/explore';
import { forestRegion, type ForestInfo } from '../sim/forest';
import type { Sim } from '../sim/sim';
import { overviewGroundY, overviewPoint, type Overview } from '../render/world3d';
import { zoneBossName, zoneLevel, zoneName, zoneStage } from '../sim/zones';
import { bindSheetTaps } from './tap';

/**
 * The World Map: the whole Greenwood Forest as one big 3D picture (the real scenery, drawn from
 * high above), greyed out wherever the hero hasn't been yet. Tap a region to fly in for a closer
 * look (drag to pan): what's been found there (monster haunts, the boss lair, landmarks), its boss
 * and fast travel. Locked regions show what they need.
 */

/** The colour unexplored land fades towards. */
const HAZE: [number, number, number] = [118, 124, 138];
const FOG_RES = 6;           // fog mask pixels per explore cell
const ZOOM_MS = 320;

interface View { u: number; v: number; s: number } // image point at the canvas centre, canvas px per image px

export class WorldMapUI {
  private wrap: HTMLElement | null = null;
  private sig = '';
  /** Which region is zoomed into (-1 = the whole map). */
  private region = -1;
  private ov: Overview | null = null;
  private ovKey = '';
  /** The overview with unexplored parts greyed out (rebuilt when more is explored). */
  private fogged: HTMLCanvasElement | null = null;
  private grey: HTMLCanvasElement | null = null;
  private foggedFor = -1;
  private view: View = { u: 0, v: 0, s: 1 };
  private anim: { from: View; to: View; t0: number } | null = null;
  private raf = 0;
  private drawnAt = 0;
  private heading = -Math.PI / 2;
  private readonly icons = new Map<number, HTMLImageElement>();
  /** Draws the scenery from above (set by main: the 3D world renderer). */
  overview: ((widthPx: number) => Overview | null) | null = null;

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
    this.refresh();
    // Draw the 3D map once the sheet is on screen (it takes a moment).
    requestAnimationFrame(() => requestAnimationFrame(() => this.prepare()));
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
      const z = Number(arg);
      if (this.sim.bossActive) { this.toast('Finish the boss fight first'); return; }
      if (this.sim.travel(z)) { sfx.play('area'); this.close(); }
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

  // --- The 3D picture ---------------------------------------------------------------------------

  /** Draw (or reuse) the scenery picture, then the greyed version. */
  private prepare(): void {
    if (!this.wrap) return;
    const map = this.sim.map;
    const key = `${map.w}x${map.h}|${[...map.openGates].sort().join(',')}`;
    if (!this.ov || this.ovKey !== key) {
      const pc = document.documentElement.classList.contains('pc');
      const ov = this.overview?.(pc ? 2400 : 1500) ?? null;
      if (!ov) { setTimeout(() => this.prepare(), 400); return; } // scenery still loading
      this.ov = ov;
      this.ovKey = key;
      this.grey = greyed(ov.canvas);
      this.foggedFor = -1;
    }
    this.wrap.querySelector<HTMLElement>('.wm-wait')!.hidden = true;
    const view = this.wrap.querySelector<HTMLElement>('.wm-view')!;
    view.style.setProperty('--ar', String(this.ov.canvas.width / this.ov.canvas.height));
    this.view = this.viewFor(this.region);
    this.draw(true);
  }

  /** The overview with everything unexplored swapped for its grey, hazy version. */
  private foggedImage(): HTMLCanvasElement | null {
    const ov = this.ov, ex = this.sim.explored;
    if (!ov || !this.grey) return null;
    const ver = ex ? ex.version : 0;
    if (this.fogged && this.foggedFor === ver) return this.fogged;
    this.foggedFor = ver;
    const c = this.fogged ?? document.createElement('canvas');
    c.width = ov.canvas.width; c.height = ov.canvas.height;
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(ov.canvas, 0, 0);
    if (ex) {
      // Grey copy, cut down to the unexplored parts by a soft mask, laid over the picture.
      // The mask, laid over the ground rectangle (its rows are linear in y on this tilted view).
      // The strip above the north edge (the tops of the border trees) follows the first row.
      const top = overviewPoint(ov, 0, 0).v, bottom = overviewPoint(ov, 0, ov.mapH).v;
      const mask = fogMask(ex);
      const mw = ex.cols * EXPLORE_CELL * ov.k, mh = ((ex.rows * EXPLORE_CELL) / ov.mapH) * (bottom - top);
      const full = document.createElement('canvas');
      full.width = c.width; full.height = c.height;
      const fg = full.getContext('2d')!;
      fg.imageSmoothingEnabled = true;
      fg.drawImage(mask, 0, top, mw, mh);
      if (top > 0) fg.drawImage(mask, 0, 0, mask.width, 1, 0, 0, mw, top + 1);
      // Grey copy, cut down to the unexplored parts (one composite: it clears outside the source).
      const tmp = document.createElement('canvas');
      tmp.width = c.width; tmp.height = c.height;
      const tg = tmp.getContext('2d')!;
      tg.drawImage(this.grey, 0, 0);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(full, 0, 0);
      g.drawImage(tmp, 0, 0);
    }
    this.fogged = c;
    return c;
  }

  /** Whole map, or one region filling the height (the rest is reached by dragging). */
  private viewFor(region: number): View {
    const ov = this.ov!, cv = this.canvas();
    const iw = ov.canvas.width, ih = ov.canvas.height;
    const cw = cv.width || 1, ch = cv.height || 1;
    const f = this.forest;
    if (region < 0 || !f) return { u: iw / 2, v: ih / 2, s: Math.min(cw / iw, ch / ih) };
    const [y0, y1] = bandOf(f, region, ov.mapH);
    const top = overviewPoint(ov, 0, y0, 40).v, bottom = overviewPoint(ov, 0, y1).v;
    const s = ch / ((bottom - top) * 1.06);
    // Centre on the hero if they're here, else on the region's boss lair.
    const h = this.sim.hero;
    const lair = f.lairs.find((l) => l.zone === region);
    const at = forestRegion(h.y) === region ? h.x : lair?.x ?? ov.mapW / 2;
    return this.clamp({ u: at * ov.k, v: (top + bottom) / 2, s });
  }

  /** Keep the view over the picture. */
  private clamp(v: View): View {
    const ov = this.ov!, cv = this.canvas();
    const iw = ov.canvas.width, ih = ov.canvas.height;
    const hw = cv.width / v.s / 2, hh = cv.height / v.s / 2;
    const u = hw * 2 >= iw ? iw / 2 : Math.min(iw - hw, Math.max(hw, v.u));
    const vv = hh * 2 >= ih ? ih / 2 : Math.min(ih - hh, Math.max(hh, v.v));
    return { u, v: vv, s: v.s };
  }

  private zoomTo(region: number): void {
    if (!this.ov) { this.region = region; this.sig = ''; this.refresh(); return; }
    this.region = region;
    this.anim = { from: { ...this.view }, to: this.viewFor(region), t0: performance.now() };
    this.sig = '';
    this.refresh();
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
      this.view = { u: from.u + (to.u - from.u) * e, v: from.v + (to.v - from.v) * e, s };
      this.draw(true);
      if (t < 1) this.raf = requestAnimationFrame(step);
      else this.anim = null;
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
      if (!this.anim) this.view = this.region >= 0 ? this.clamp({ ...this.viewFor(this.region), u: this.view.u }) : this.viewFor(-1);
    }
    const img = this.foggedImage();
    if (!img) return;
    const ov = this.ov, v = this.view, f = this.forest;
    const g = cv.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1b2a1c';
    g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    // image px → canvas px
    const tx = (u: number) => (u - v.u) * v.s + W / 2;
    const ty = (vv: number) => (vv - v.v) * v.s + H / 2;
    g.drawImage(img, tx(0), ty(0), img.width * v.s, img.height * v.s);
    if (!f) return;

    const ex = this.sim.explored;
    const seen = (x: number, y: number) => !ex || ex.seen(x, y);
    const at = (x: number, y: number, h = 0) => { const p = overviewPoint(ov, x, y, h); return { x: tx(p.u), y: ty(p.v) }; };
    const zoomed = this.region >= 0;
    const scale = Math.max(1, dpr) * (zoomed ? 1.25 : 1);

    // Closed passes: a red bar (once found).
    for (const gate of f.gates) {
      if (this.sim.map.openGates.has(gate.zone) || !seen(gate.x, gate.y)) continue;
      const a = at(gate.x - 34, gate.y), b = at(gate.x + 34, gate.y);
      g.strokeStyle = '#ff3b3b'; g.lineWidth = 4 * scale; g.lineCap = 'round';
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }

    // Monster haunts (found ones): their codex portrait in a ring of the monster's colour.
    if (zoomed) {
      for (const t of f.territories) {
        if (!seen(t.x, t.y)) continue;
        const p = at(t.x, t.y);
        const r = 13 * scale;
        g.fillStyle = 'rgba(10,16,53,0.75)';
        g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
        const icon = this.icon(t.monster);
        if (icon?.complete && icon.naturalWidth) g.drawImage(icon, p.x - r * 0.85, p.y - r * 0.85, r * 1.7, r * 1.7);
        g.strokeStyle = '#fff'; g.lineWidth = 1.5 * scale;
        g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.stroke();
      }
    }

    // Landmark names (found ones), when zoomed in.
    if (zoomed) {
      g.font = `600 ${11 * scale}px Fredoka, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      for (const l of f.landmarks) {
        if (!seen(l.x, l.y) || f.lairs.some((q) => q.name === l.name)) continue;
        const p = at(l.x, l.y);
        g.lineWidth = 3 * scale; g.strokeStyle = 'rgba(10,16,53,0.85)'; g.fillStyle = '#fff';
        g.strokeText(l.name, p.x, p.y + 6 * scale);
        g.fillText(l.name, p.x, p.y + 6 * scale);
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
      if (zoomed) {
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

  /** Region name tags over the whole map (tap one to zoom in). */
  private placeLabels(at: (x: number, y: number) => { x: number; y: number }, W: number, H: number): void {
    const box = this.wrap!.querySelector<HTMLElement>('.wm-labels')!;
    const f = this.forest;
    if (this.region >= 0 || !f || !this.ov) { box.innerHTML = ''; return; }
    const s = this.sim.save;
    if (!box.childElementCount) {
      box.innerHTML = [0, 1, 2].map((z) => `<button type="button" class="wm-region" data-act="region:${z}"></button>`).join('');
    }
    box.querySelectorAll<HTMLButtonElement>('.wm-region').forEach((b) => {
      const z = Number(b.dataset.act!.split(':')[1]);
      const [y0, y1] = bandOf(f, z, this.ov!.mapH);
      const p = at(this.ov!.mapW / 2, (y0 + y1) / 2);
      const open = this.sim.zoneUnlocked(z);
      const here = z === s.zone;
      const html = `${here ? gi('position-marker', 'red') : open ? '' : gi('padlock', 'grey')}<b>${zoneName(z)}</b><small>${open ? `Lv ${zoneLevel(z)}+` : `Locked · Lv ${zoneLevel(z)}`}</small>`;
      if (b.innerHTML !== html) b.innerHTML = html;
      b.classList.toggle('locked', !open);
      b.classList.toggle('here', here);
      b.style.left = `${(p.x / W) * 100}%`;
      b.style.top = `${(p.y / H) * 100}%`;
    });
  }

  private icon(slot: number): HTMLImageElement | null {
    let im = this.icons.get(slot);
    if (!im) {
      const src = this.codexIcon(0, slot);
      if (!src) return null;
      im = new Image();
      im.src = src;
      this.icons.set(slot, im);
    }
    return im;
  }

  /** Drag to pan (zoomed in); a tap on the whole map zooms into the region under it. */
  private bindCanvas(cv: HTMLCanvasElement): void {
    let drag: { id: number; x: number; y: number; u: number; v: number; moved: boolean } | null = null;
    cv.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, u: this.view.u, v: this.view.v, moved: false };
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id || !this.ov) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      if (!drag.moved || this.region < 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.anim = null;
      this.view = this.clamp({ u: drag.u - (dx * dpr) / this.view.s, v: drag.v - (dy * dpr) / this.view.s, s: this.view.s });
      this.draw(true);
    });
    const up = (e: PointerEvent) => {
      const d = drag;
      drag = null;
      if (!d || e.pointerId !== d.id || d.moved || !this.ov || this.region >= 0) return;
      // Tap on the whole map: which region is under it?
      const r = cv.getBoundingClientRect();
      const dpr = cv.width / r.width;
      const v = (e.clientY - r.top) * dpr;
      const iv = (v - cv.height / 2) / this.view.s + this.view.v;
      const y = overviewGroundY(this.ov, iv);
      if (y < 0 || y > this.ov.mapH) return;
      sfx.play('tick');
      this.zoomTo(forestRegion(y));
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { drag = null; });
  }

  // --- Text: where you are, and the region details ------------------------------------------

  /** Re-render when progress changes (and redraw the hero marker). Called by the HUD ~10×/s. */
  refresh(): void {
    if (!this.wrap) return;
    if (this.ov && !this.anim) this.draw();
    const sim = this.sim, s = sim.save;
    const f = this.forest;
    const ex = sim.explored;
    const cool = this.region >= 0 ? Math.ceil(this.cooldown(this.region)) : 0;
    const sig = `${s.zone}|${s.zoneBosses}|${s.level}|${sim.maxZone}|${sim.bossActive}|${this.region}|${ex?.version ?? 0}|${cool}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.wrap.querySelector('.map-you')!.innerHTML = `📍 <b>${zoneName(s.zone)}</b> · Hero Lv ${s.level}`;
    this.wrap.querySelector<HTMLElement>('.wm-back')!.hidden = this.region < 0;
    const info = this.wrap.querySelector<HTMLElement>('.wm-info')!;
    if (this.region < 0 || !f) {
      info.innerHTML = `
        <p class="sheet-note">Tap a region to look closer. Grey parts are still unexplored: walk there to uncover them.</p>
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

  private regionInfo(z: number, f: ForestInfo, ex: Explored | null): string {
    const s = this.sim.save;
    const seen = (x: number, y: number) => !ex || ex.seen(x, y);
    const open = this.sim.zoneUnlocked(z);
    const here = z === s.zone;
    const beaten = z < s.zoneBosses;
    const lair = f.lairs.find((l) => l.zone === z);
    const lairKnown = !!lair && seen(lair.x, lair.y);
    const cool = this.cooldown(z);
    const bossState = !beaten
      ? lairKnown ? `waits at the ${lair!.name}` : 'lair not found yet'
      : cool > 0 ? `defeated ✓ · back in ${clock(cool)}` : `defeated ✓ · ready for a rematch${lairKnown ? ` at the ${lair!.name}` : ''}`;
    // Monsters of this region: shown once one of their haunts here has been found.
    const slots = [...new Set(f.territories.filter((t) => t.zone === z).map((t) => t.monster))];
    const mons = slots.map((m) => {
      const found = f.territories.some((t) => t.zone === z && t.monster === m && seen(t.x, t.y));
      return monsterSlot(0, m, this.codexIcon(0, m), 'map-mon', !found);
    }).join('');
    const action = here
      ? '<span class="zone-tag here">You are here</span>'
      : open
        ? `<button type="button" class="btn green" data-act="travel:${z}">Travel here</button>`
        : `<button type="button" class="zone-lock" data-act="locked:${z}">${gi('padlock', 'grey')} ${this.lockText(z)}</button>`;
    const total = f.territories.filter((t) => t.zone === z).length;
    const found = f.territories.filter((t) => t.zone === z && seen(t.x, t.y)).length;
    return `
      <div class="wm-region-info">
        <div class="wm-ri-head"><b>${zoneName(z)}</b><span>Lv ${zoneLevel(z)}+ · XP <b>${fmt(xpForKill(zoneStage(z), false))}</b>/kill</span></div>
        <div class="wm-ri-row">${gi('skull-crossed-bones', 'white')} <b>${zoneBossName(z)}</b> <span>${bossState}</span></div>
        <div class="wm-ri-row"><span class="map-mons">${mons}</span><span>Haunts found: <b>${found}/${total}</b></span></div>
        <div class="wm-ri-act">${action}</div>
      </div>`;
  }
}

/** A region's north and south edges (y). */
function bandOf(f: ForestInfo, z: number, mapH: number): [number, number] {
  const edges = [0, ...f.walls, mapH]; // north → south: Old Mill (2), Bloomwood (1), Meadow (0)
  const i = 2 - Math.min(2, Math.max(0, z));
  return [edges[i], edges[i + 1]];
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

