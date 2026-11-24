import { BitmapFont, BitmapText, Container, Sprite, type Texture } from 'pixi.js';
import { fmt } from '../core/format';

/**
 * Pooled visual effects. Every object is created once up front and recycled through a
 * free-list, so a busy fight allocates nothing per frame.
 */

export const FONT = 'fb-dmg';
export const FONT_PX = 32;

export function installFonts(): void {
  BitmapFont.install({
    name: FONT,
    style: {
      fontFamily: '"Lilita One", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontSize: FONT_PX,
      fontWeight: '400',
      fill: '#ffffff',
      stroke: { color: '#0a1035', width: 7, join: 'round' },
    },
    chars: [['0', '9'], ['a', 'z'], '.KMBT!+- LVEUP'],
    resolution: 2,
  });
}

interface Item<T> { obj: T; t: number; life: number; x: number; y: number; vx: number; vy: number; a: number; b: number }

class Pool<T extends Container> {
  readonly items: Item<T>[] = [];
  private readonly free: number[] = [];
  private readonly live: number[] = [];

  constructor(size: number, make: () => T, parent: Container) {
    for (let i = 0; i < size; i++) {
      const obj = make();
      obj.visible = false;
      parent.addChild(obj);
      this.items.push({ obj, t: 0, life: 1, x: 0, y: 0, vx: 0, vy: 0, a: 0, b: 0 });
      this.free.push(i);
    }
  }

  /** Returns a recycled item, or null when the pool is exhausted (the effect is just skipped). */
  spawn(life: number): Item<T> | null {
    const i = this.free.pop();
    if (i === undefined) return null;
    const it = this.items[i];
    it.t = 0;
    it.life = life;
    it.obj.visible = true;
    this.live.push(i);
    return it;
  }

  /** Steps every live item; `step` returns false to recycle it. */
  update(dt: number, step: (it: Item<T>, p: number) => boolean): void {
    for (let k = this.live.length - 1; k >= 0; k--) {
      const i = this.live[k];
      const it = this.items[i];
      it.t += dt;
      const p = it.t / it.life;
      if (p >= 1 || !step(it, p)) {
        it.obj.visible = false;
        this.live[k] = this.live[this.live.length - 1];
        this.live.pop();
        this.free.push(i);
      }
    }
  }
}

/** Maps a game-space point (x, y on the ground, plus a height) to screen pixels. */
export type Projector = (x: number, height: number, y: number, out: { x: number; y: number }) => void;

/** Effects live in game coordinates and are projected onto the screen every frame. */
const FX_H = 7; // most effects float around a monster's middle

export class Fx {
  /** Screen-space layer for particles, coins and rings. */
  readonly world = new Container();
  /** Screen-space layer for crisp text. */
  readonly screen = new Container();
  private readonly pt = { x: 0, y: 0 };
  proj: Projector = (x, _h, y, out) => { out.x = x; out.y = y; };

  private readonly texts: Pool<BitmapText>;
  private readonly coins: Pool<Sprite>;
  private readonly gems: Pool<Sprite>;
  private readonly rings: Pool<Sprite>;
  /** Low quality: fewer particles. */
  low = false;
  private readonly parts: Pool<Sprite>;

  /** Screen pixels per world unit (set by Scene.layout). */
  scale = 1;
  /** Screen positions the coins / gems fly to. */
  coinTargetX = 6;
  coinTargetY = 4;
  gemTargetX = 6;
  gemTargetY = 12;

  constructor(coinTex: Texture, pixelTex: Texture, gemTex: Texture, ringTex: Texture) {
    this.texts = new Pool(48, () => {
      const t = new BitmapText({ text: '', style: { fontFamily: FONT, fontSize: FONT_PX } });
      t.anchor.set(0.5);
      return t;
    }, this.screen);
    this.coins = new Pool(40, () => {
      const s = new Sprite(coinTex);
      s.anchor.set(0.5);
      return s;
    }, this.world);
    this.gems = new Pool(24, () => {
      const s = new Sprite(gemTex);
      s.anchor.set(0.5);
      return s;
    }, this.world);
    this.rings = new Pool(6, () => {
      const s = new Sprite(ringTex);
      s.anchor.set(0.5);
      return s;
    }, this.world);
    this.parts = new Pool(128, () => {
      const s = new Sprite(pixelTex);
      s.anchor.set(0.5);
      return s;
    }, this.world);
  }

  text(wx: number, wy: number, value: number, color: number, big = false, prefix = ''): void {
    const it = this.texts.spawn(big ? 0.9 : 0.65);
    if (!it) return;
    it.obj.text = prefix + fmt(value) + (big ? '!' : '');
    it.obj.tint = color;
    it.x = wx + (Math.random() - 0.5) * 6;
    it.y = wy;
    it.a = big ? 1.5 : 1; // size multiplier
  }

  /** Expanding ring (stage clear, area enter). */
  ring(wx: number, wy: number, color: number, size = 3): void {
    const it = this.rings.spawn(0.55);
    if (!it) return;
    it.x = wx; it.y = wy; it.a = size;
    it.obj.tint = color;
  }

  burst(wx: number, wy: number, color: number, n: number, speed = 40): void {
    if (this.low) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const it = this.parts.spawn(0.35 + Math.random() * 0.25);
      if (!it) return;
      const ang = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      it.x = wx; it.y = wy;
      it.vx = Math.cos(ang) * sp;
      it.vy = Math.sin(ang) * sp - speed * 0.5;
      it.obj.tint = color;
      it.a = 1 + Math.random();
    }
  }

  coin(wx: number, wy: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const it = this.coins.spawn(0.55 + Math.random() * 0.25);
      if (!it) return;
      it.x = wx + (Math.random() - 0.5) * 10;
      it.y = wy - 4 - Math.random() * 6;
      it.vx = (Math.random() - 0.3) * 30; // initial pop for the arc
      it.vy = -30 - Math.random() * 20;
    }
  }

  private dt = 0;

  gem(wx: number, wy: number, n: number): void {
    for (let i = 0; i < Math.min(n, 6); i++) {
      const it = this.gems.spawn(0.7 + Math.random() * 0.25);
      if (!it) return;
      it.x = wx + (Math.random() - 0.5) * 8;
      it.y = wy - 6;
      it.vx = (Math.random() - 0.5) * 40;
      it.vy = -40 - Math.random() * 20;
    }
  }

  /** Jagged lightning between two world points, made of short-lived particles. */
  zap(x1: number, y1: number, x2: number, y2: number): void {
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      const it = this.parts.spawn(0.18 + Math.random() * 0.08);
      if (!it) return;
      const t = i / steps;
      const jitter = i === 0 || i === steps ? 0 : (Math.random() - 0.5) * 6;
      it.x = x1 + (x2 - x1) * t + jitter;
      it.y = y1 + (y2 - y1) * t + jitter;
      it.vx = 0; it.vy = -20;
      it.obj.tint = Math.random() < 0.5 ? 0x9fe8ff : 0xffffff;
      it.a = 1.2;
    }
  }

  update(dt: number): void {
    this.dt = dt;
    this.texts.update(dt, this.stepText);
    this.parts.update(dt, this.stepPart);
    this.coins.update(dt, this.stepCoin);
    this.gems.update(dt, this.stepGem);
    this.rings.update(dt, this.stepRing);
  }

  private readonly stepRing = (it: Item<Sprite>, p: number): boolean => {
    const e = 1 - (1 - p) * (1 - p);
    this.proj(it.x, 0, it.y, this.pt);
    it.obj.position.set(this.pt.x, this.pt.y);
    const k = (0.2 + e * it.a) * this.scale;
    it.obj.scale.set(k, k * 0.62); // flattened: lies on the ground
    it.obj.alpha = 1 - p;
    return true;
  };

  private readonly stepGem = (it: Item<Sprite>, p: number): boolean => {
    const dt = this.dt;
    const k = p * p * p;
    it.vy += 120 * dt;
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    this.proj(it.x, FX_H, it.y, this.pt);
    it.obj.position.set(this.pt.x + (this.gemTargetX - this.pt.x) * k, this.pt.y + (this.gemTargetY - this.pt.y) * k);
    it.obj.scale.set(this.scale);
    it.obj.rotation = p * 6;
    return true;
  };

  // Step callbacks are created once (not per frame) to keep the render loop allocation-free.
  private readonly stepText = (it: Item<BitmapText>, p: number): boolean => {
    const o = it.obj;
    const s = this.scale;
    const rise = 1 - (1 - p) * (1 - p);
    this.proj(it.x, 12, it.y, this.pt);
    o.x = this.pt.x;
    o.y = this.pt.y - rise * 14 * s;
    const pop = p < 0.15 ? 0.6 + (p / 0.15) * 0.6 : 1.2 - Math.min(0.2, (p - 0.15) * 0.5);
    o.scale.set((s * 5.5 * it.a * pop) / FONT_PX);
    o.alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    return true;
  };

  private readonly stepPart = (it: Item<Sprite>, p: number): boolean => {
    const dt = this.dt;
    it.vy += 140 * dt;
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    this.proj(it.x, FX_H, it.y, this.pt);
    it.obj.position.set(this.pt.x, this.pt.y);
    it.obj.scale.set(it.a * (1 - p * 0.6) * this.scale);
    it.obj.alpha = 1 - p * p;
    return true;
  };

  private readonly stepCoin = (it: Item<Sprite>, p: number): boolean => {
    // Pop outward, then home in on the gold counter.
    const dt = this.dt;
    const k = p * p * p;
    it.vy += 120 * dt;
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    this.proj(it.x, FX_H, it.y, this.pt);
    it.obj.position.set(this.pt.x + (this.coinTargetX - this.pt.x) * k, this.pt.y + (this.coinTargetY - this.pt.y) * k);
    it.obj.scale.set((1 - k * 0.4) * this.scale);
    return true;
  };
}
