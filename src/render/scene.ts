import { BitmapText, Container, Sprite, type Application } from 'pixi.js';
import { levelTier } from '../sim/level';
import { Ev } from '../sim/events';
import { MAP_H, MAP_W } from '../sim/map';
import { MAX_ENEMIES, type Enemy, type Sim } from '../sim/sim';
import { FONT, FONT_PX, Fx } from './fx';
import { type Art } from './sprites';
import { World3D } from './world3d';
import { haptic, sfx } from '../audio/sfx';

/**
 * The battlefield: a 3D world (Three.js, see world3d.ts) with a 2D overlay on top (PixiJS)
 * for health bars, level text, damage numbers and particles. Overlay items are positioned by
 * projecting their 3D anchor points every frame. Owns no game rules.
 */

interface EnemyView {
  root: Container;   // overlay: bars and markers above one monster
  crown: Sprite;
  warn: BitmapText;  // "!" over a monster winding up a skill
  barBg: Sprite;
  barTrail: Sprite;  // pale chunk that drains after the real bar: shows the last hit
  barFg: Sprite;
  trail: number;     // trailing health fraction
}

export interface SceneHooks {
  onStageClear?(): void;
  onBossFail?(): void;
  onBossSpawn?(): void;
  onAreaEnter?(zone: number): void;
  onZoneClear?(zone: number): void;
  onLevelUp?(level: number): void;
  onPickup?(kind: 'wood' | 'stone'): void;
}

export class Scene {
  readonly world3d: World3D;
  /** Overlay container in "world units": scaled by pixels-per-unit, positioned by projection. */
  private readonly overlay = new Container();
  private readonly hero = new Container();
  private readonly levelText = new BitmapText({ text: 'Lv 1', style: { fontFamily: FONT, fontSize: FONT_PX } });
  private shownLevel = 0;
  private levelPop = 0;
  private readonly heroBarBg: Sprite;
  private readonly heroBarFg: Sprite;
  private readonly enemyViews: EnemyView[] = [];
  /** Black overlay that fades out when the zone's map changes. */
  private readonly fade: Sprite;
  private fadeT = 0;
  private readonly fx: Fx;
  private readonly pt = { x: 0, y: 0 };

  private t = 0;
  private frameDt = 1 / 60;
  private shake = 0;
  private screenW = 0;
  private screenH = 0;
  private camX = MAP_W / 2;
  private camY = MAP_H / 2;
  private hadMap = false;
  private lowQ = false;

  /** Low quality: no shadows, 1× resolution, fewer particles, no screen shake. */
  get low(): boolean { return this.lowQ; }
  set low(v: boolean) { this.lowQ = v; this.world3d.setLow(v); }

  constructor(app: Application, private readonly sim: Sim, art: Art, private readonly hooks: SceneHooks = {}) {
    this.world3d = new World3D(app.canvas.parentElement ?? document.body);
    const bar = (w: number, h: number, color: number) => {
      const s = new Sprite(art.pixel);
      s.width = w; s.height = h; s.tint = color;
      return s;
    };

    for (let i = 0; i < MAX_ENEMIES; i++) {
      const root = new Container();
      const crown = new Sprite(art.crown);
      crown.anchor.set(0.5, 1);
      const warn = new BitmapText({ text: '!', style: { fontFamily: FONT, fontSize: FONT_PX } });
      warn.anchor.set(0.5, 1);
      warn.scale.set(7 / FONT_PX);
      warn.tint = 0xff4a3a;
      warn.visible = false;
      const barBg = bar(14, 4, 0x1b1626);
      const barTrail = bar(12, 2, 0xfff0d0);
      const barFg = bar(12, 2, 0xe4572e);
      root.addChild(crown, warn, barBg, barTrail, barFg);
      root.visible = false;
      this.overlay.addChild(root);
      this.enemyViews.push({ root, crown, warn, barBg, barTrail, barFg, trail: 1 });
    }

    this.heroBarBg = bar(16, 2, 0x1b1626);
    this.heroBarFg = bar(16, 2, 0x5cc04f);
    this.heroBarBg.position.set(-8, -2);
    this.heroBarFg.position.set(-8, -2);
    this.levelText.anchor.set(0.5, 1);
    this.levelText.scale.set(LEVEL_TEXT_H / FONT_PX);
    this.levelText.position.set(0, -2.5);
    this.hero.addChild(this.heroBarBg, this.heroBarFg, this.levelText);
    this.overlay.addChild(this.hero);

    this.fx = new Fx(art.coin, art.dot, art.gem, art.ring);
    this.fx.proj = (x, hgt, y, out) => this.world3d.project(x, hgt, y, out);
    this.fade = new Sprite(art.pixel);
    this.fade.tint = 0x000000;
    this.fade.alpha = 0;
    app.stage.addChild(this.fx.world, this.overlay, this.fade, this.fx.screen);
  }

  /** Fit the camera to the canvas. */
  layout(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    this.world3d.resize(w, h);
    const s = this.world3d.pxPerUnit;
    this.overlay.scale.set(s);
    this.fx.scale = s;
    // Coins/gems fly to their counters (top-left of the screen).
    this.fx.coinTargetX = 24; this.fx.coinTargetY = 22;
    this.fx.gemTargetX = 24; this.fx.gemTargetY = 52;
  }

  /** Screen (canvas CSS pixels) → world coordinates on the ground, for tap-to-move. */
  screenToWorld(sx: number, sy: number, out: { x: number; y: number }): void {
    this.world3d.screenToGround(sx, sy, out);
  }

  /** Overlay item at a 3D point: position in overlay units. */
  private place(c: Container, x: number, height: number, y: number): void {
    this.world3d.project(x, height, y, this.pt);
    const s = this.world3d.pxPerUnit;
    c.position.set(this.pt.x / s, this.pt.y / s);
  }

  /** Render one frame. `alpha` is the interpolation factor between the last two sim ticks. */
  update(alpha: number, dt: number): void {
    this.t += dt;
    this.frameDt = dt;
    const sim = this.sim;
    const w3 = this.world3d;
    if (w3.syncMap(sim.map)) {
      if (this.hadMap) this.fadeT = 0.45;
      this.hadMap = true;
    }
    this.drainEvents();

    const h = sim.hero;
    const hx = h.prevX + (h.x - h.prevX) * alpha;
    const hy = h.prevY + (h.y - h.prevY) * alpha;

    // Camera follows the hero smoothly, clamped so we don't show much beyond the map edge.
    const k = 1 - Math.exp(-dt * 8);
    this.camX += (hx - this.camX) * k;
    this.camY += (hy - this.camY) * k;
    const cx = clamp(this.camX, Math.min(w3.halfW - 30, MAP_W / 2), Math.max(MAP_W - w3.halfW + 30, MAP_W / 2));
    const cy = clamp(this.camY, Math.min(w3.halfD * 0.55, MAP_H / 2), Math.max(MAP_H - w3.halfD * 0.35, MAP_H / 2));
    this.fx.low = this.lowQ;
    if (this.lowQ) this.shake = 0;
    this.shake = Math.max(0, this.shake - dt * 3);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 3 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 3 : 0;
    w3.setCamera(cx + sx, cy + sy);
    w3.update(sim, alpha, dt, this.t);

    // Hero overlay: health bar and level over the head.
    const dead = sim.phase === 'dead';
    this.place(this.hero, hx, 21, hy);
    this.hero.alpha = dead ? 0.4 : 1;
    if (sim.save.level !== this.shownLevel) {
      this.shownLevel = sim.save.level;
      this.levelText.text = `Lv ${this.shownLevel}`;
      this.levelText.tint = levelTier(this.shownLevel).color;
    }
    if (this.levelPop > 0) {
      this.levelPop = Math.max(0, this.levelPop - dt);
      const lk = this.levelPop / 0.6;
      this.levelText.scale.set((LEVEL_TEXT_H / FONT_PX) * (1 + 0.6 * Math.sin(lk * Math.PI)));
    }
    const hpFrac = h.maxHp > 0 ? Math.max(0, h.hp / h.maxHp) : 0;
    this.heroBarFg.width = 16 * hpFrac;
    this.heroBarFg.tint = hpFrac > 0.5 ? 0x5cc04f : hpFrac > 0.25 ? 0xffca28 : 0xe4572e;

    // Enemy overlays
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = sim.enemies[i];
      const v = this.enemyViews[i];
      if (!e.alive) { v.root.visible = false; continue; }
      const x = e.prevX + (e.x - e.prevX) * alpha;
      const y = e.prevY + (e.y - e.prevY) * alpha;
      v.root.visible = w3.inView(x, y, 30);
      if (v.root.visible) this.drawEnemy(e, v, x, y, w3.enemyTop(i, e));
    }

    if (this.fadeT > 0) {
      this.fadeT = Math.max(0, this.fadeT - dt);
      this.fade.width = this.screenW;
      this.fade.height = this.screenH;
    }
    this.fade.alpha = this.fadeT / 0.45;
    this.fade.visible = this.fadeT > 0;

    this.fx.update(dt);
    w3.render();
  }

  private drawEnemy(e: Enemy, v: EnemyView, x: number, y: number, top: number): void {
    const spawnK = e.spawnT > 0 ? 1 - e.spawnT / 0.35 : 1;
    this.place(v.root, x, top * spawnK + 1, y);
    v.warn.visible = e.windT > 0 && !e.boss;
    if (v.warn.visible) v.warn.position.set(0, -1);
    v.crown.visible = e.boss;
    if (e.boss) v.crown.position.set(0, 0);
    // Health bar: appears once a monster has been hit (elites always show theirs), with a pale
    // trailing chunk that drains a moment later so each hit's size is easy to read.
    const frac = Math.max(0, e.hp / e.maxHp);
    if (e.spawnT > 0 || frac >= 1) v.trail = 1;
    v.trail = Math.max(frac, v.trail - (v.trail > frac ? 0.9 * this.frameDt : 0));
    const showBar = frac < 1 || e.elite;
    v.barBg.visible = v.barFg.visible = v.barTrail.visible = showBar;
    if (showBar) {
      const w = e.boss ? 30 : e.elite ? 18 : 14;
      const barY = (e.boss ? -9 : -2) - (v.warn.visible ? 7 : 0);
      v.barBg.width = w + 2; v.barBg.height = 4;
      v.barBg.position.set(-w / 2 - 1, barY - 1);
      v.barTrail.position.set(-w / 2, barY);
      v.barTrail.width = w * v.trail;
      v.barFg.position.set(-w / 2, barY);
      v.barFg.width = w * frac;
      v.barFg.tint = e.boss ? 0xc040ff : e.elite ? 0xffb52e : frac > 0.5 ? 0xe4572e : 0xff3030;
    }
  }

  private drainEvents(): void {
    const q = this.sim.events;
    const fx = this.fx;
    for (let i = 0; i < q.count; i++) {
      const x = q.x[i], y = q.y[i], v = q.value[i], f = q.flag[i];
      switch (q.type[i]) {
        case Ev.Swing:
          sfx.play('swing');
          break;
        case Ev.Hit:
          if (f !== 2) sfx.play(f === 1 ? 'crit' : 'hit');
          fx.text(x, y, v, f === 1 ? 0xffd23f : f === 2 ? 0x9fe8ff : 0xffffff, f === 1);
          fx.burst(x, y + 2, 0xffffff, f ? 4 : 2, 30);
          if (f) this.shake = Math.max(this.shake, 0.35);
          break;
        case Ev.Kill: {
          const boss = f === 1;
          fx.burst(x, y, boss ? 0xffd23f : 0xe8e0ff, boss ? 34 : 9, boss ? 80 : 45);
          fx.coin(x, y, boss ? 14 : 1 + ((Math.random() * 2) | 0));
          sfx.play(boss ? 'bossKill' : 'kill');
          sfx.play('coin');
          if (boss) { this.shake = 1; fx.ring(x, y, 0xffd23f, 4); haptic(60); }
          break;
        }
        case Ev.HeroHit:
          sfx.play('hurt');
          fx.text(x, y, v, 0xff6b6b, false, '-');
          break;
        case Ev.HeroDie:
          fx.burst(x, y, 0xb8343e, 18, 50);
          this.shake = 0.8;
          sfx.play('die');
          haptic(120);
          break;
        case Ev.Spawn:
          fx.burst(x, y, 0xd8c8ff, v ? 20 : 5, v ? 60 : 25);
          break;
        case Ev.StageClear:
          this.camX = this.sim.hero.x; this.camY = this.sim.hero.y;
          sfx.play('stage');
          fx.ring(this.sim.hero.x, this.sim.hero.y, 0x7de86f, 3);
          this.hooks.onStageClear?.();
          break;
        case Ev.BossFail:
          this.hooks.onBossFail?.();
          break;
        case Ev.BossSpawn:
          this.shake = 0.7;
          sfx.play('boss');
          haptic(40);
          this.hooks.onBossSpawn?.();
          break;
        case Ev.Shard:
          sfx.play('shard');
          fx.gem(x, y, v);
          break;
        case Ev.Shock:
          sfx.play('zap');
          fx.zap(q.x2[i], q.y2[i], x, y);
          break;
        case Ev.LevelUp:
          sfx.play('achieve');
          fx.ring(x, y, 0xffd23f, 4);
          fx.ring(x, y, 0xffffff, 2.5);
          fx.burst(x, y, 0xffd23f, 26, 70);
          this.levelPop = 0.6;
          haptic(40);
          this.hooks.onLevelUp?.(v);
          break;
        case Ev.Chop:
          this.world3d.chop(v);
          fx.burst(x, y, 0xd8c8a0, 4, 30);
          break;
        case Ev.Drop:
          fx.burst(x, y, v ? 0xc8d0dc : 0xd8a868, 5, 25);
          break;
        case Ev.Pickup:
          sfx.play('shard', 0.6);
          fx.burst(x, y, v ? 0xe8eef6 : 0xf0c890, 6, 35);
          fx.text(x, y - 4, 1, v ? 0xd8e0ea : 0xf0b070, false, '+');
          this.hooks.onPickup?.(v ? 'stone' : 'wood');
          break;
        case Ev.Telegraph:
          if (f === 1) sfx.play('boss', 0.5);
          break;
        case Ev.Slam:
          this.shake = Math.max(this.shake, 0.8);
          fx.ring(x, y, 0xff6a3a, (v / 16) * 1.0);
          fx.burst(x, y, 0xd8b890, 22, 70);
          sfx.play('crit');
          haptic(30);
          break;
        case Ev.Shoot:
          sfx.play('swing', 0.5);
          break;
        case Ev.ShotPop:
          fx.burst(x, y, 0xffffff, 4, 25);
          break;
        case Ev.ZoneClear:
          fx.ring(x, y, 0xffd23f, 5);
          fx.ring(x, y, 0xffffff, 3);
          fx.burst(x, y, 0xffd23f, 40, 90);
          sfx.play('achieve');
          this.hooks.onZoneClear?.(v);
          break;
        case Ev.ZoneUnlock:
          sfx.play('area');
          break;
        case Ev.AreaEnter:
          this.camX = MAP_W / 2; this.camY = MAP_H / 2;
          sfx.play('area');
          fx.ring(MAP_W / 2, MAP_H / 2, 0xffffff, 5);
          this.hooks.onAreaEnter?.(v);
          break;
      }
    }
    q.clear();
  }
}

const LEVEL_TEXT_H = 4.6; // world units

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
