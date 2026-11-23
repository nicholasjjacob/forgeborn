import { BitmapText, Container, Graphics, Sprite, TilingSprite, type Application } from 'pixi.js';
import { levelTier } from '../sim/level';
import { areaFor } from '../sim/areas';
import { Ev } from '../sim/events';
import { MAP_H, MAP_W, type GameMap } from '../sim/map';
import { ELITE, MAX_ENEMIES, MAX_SHOTS, SLAM_RADIUS, SLAM_WIND, STYLE_DASHER, type Enemy, type Sim } from '../sim/sim';
import { MAX_PICKUPS } from '../sim/gather';
import { FONT, FONT_PX, Fx } from './fx';
import { areaArt, artVersion, ensureAreaSprites, heroAnim, spriteAnchor, type AnimSet, type Art } from './sprites';
import { haptic, sfx } from '../audio/sfx';

const SWING_TIME = 0.22;
const VIEW_W = 135;   // aim for about this many world units across the screen…
const VIEW_H = 110;   // …while always showing at least this many vertically
const CULL_PAD = 24;

interface EnemyView {
  root: Container;
  shadow: Sprite;
  aura: Sprite;      // golden glow under elites
  body: Sprite;
  crown: Sprite;
  warn: BitmapText;  // "!" over a monster winding up a skill
  barBg: Sprite;
  barTrail: Sprite;  // pale chunk that drains after the real bar: shows the last hit
  barFg: Sprite;
  trail: number;     // trailing health fraction
}

const DASH_LANE = 56; // world units a dash covers (for the warning lane)

interface PropView { sprite: Sprite; x: number; y: number; halfW: number; h: number }

export interface SceneHooks {
  onStageClear?(): void;
  onBossFail?(): void;
  onBossSpawn?(): void;
  onAreaEnter?(zone: number): void;
  onZoneClear?(zone: number): void;
  onLevelUp?(level: number): void;
  onPickup?(kind: 'wood' | 'stone'): void;
}

/**
 * Top-down ¾ view. Everything that stands on the ground (hero, monsters, trees, rocks) lives in
 * one depth-sorted layer keyed by its foot position, so the hero can walk behind a tree.
 * Off-screen props are hidden each frame (cheap culling). Owns no game rules.
 */
export class Scene {
  private readonly world = new Container();
  private readonly groundLayer = new Container();
  private readonly decalLayer = new Container();
  private readonly entities = new Container();
  private props: PropView[] = [];
  private map: GameMap | null = null;
  private artVer = -1;

  private readonly hero = new Container();
  private readonly heroBody: Sprite;
  private readonly swordArm = new Container();
  /** "Lv 12" over the hero's head, tinted by level tier. */
  private readonly levelText = new BitmapText({ text: 'Lv 1', style: { fontFamily: FONT, fontSize: FONT_PX } });
  private shownLevel = 0;
  /** Wood/stone pieces on the ground (pooled, one per sim pickup slot). */
  private readonly pickupViews: { root: Container; body: Sprite }[] = [];
  private readonly woodTex: Sprite['texture'];
  private readonly stoneTex: Sprite['texture'];
  /** Props currently shaking from a chop: prop index → seconds left. */
  private readonly shaking = new Map<number, number>();
  private levelPop = 0;
  private readonly sword: Sprite;
  private weaponId = -1;
  private readonly slash: Sprite;
  private readonly heroBarBg: Sprite;
  private readonly heroBarFg: Sprite;
  private readonly enemyViews: EnemyView[] = [];
  private readonly shotViews: Sprite[] = [];
  /** Danger zones (boss slam circles, dash lanes) drawn on the ground under everything. */
  private readonly warnLayer = new Graphics();
  /** Black overlay that fades out when the stage's map changes. */
  private readonly fade: Sprite;
  private fadeT = 0;
  private readonly fx: Fx;

  private t = 0;
  private frameDt = 1 / 60;
  private shake = 0;
  private scale = 2;
  private screenW = 0;
  private screenH = 0;
  private camX = MAP_W / 2;
  private camY = MAP_H / 2;
  /** Low quality: fewer particles, no screen shake. */
  low = false;

  constructor(app: Application, private readonly sim: Sim, private readonly art: Art, private readonly hooks: SceneHooks = {}) {
    const bar = (w: number, h: number, color: number) => {
      const s = new Sprite(art.pixel);
      s.width = w; s.height = h; s.tint = color;
      return s;
    };
    const shadow = (w: number) => {
      const s = new Sprite(art.shadow);
      s.anchor.set(0.5);
      s.width = w; s.height = w * 0.42;
      return s;
    };

    this.entities.sortableChildren = true;
    this.world.addChild(this.groundLayer, this.decalLayer, this.warnLayer, this.entities);

    // Enemies: fixed slots mirror the sim's fixed enemy array (no lookups or allocation).
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const root = new Container();
      const sh = shadow(12);
      const body = new Sprite();
      body.anchor.set(0.5, 1);
      const crown = new Sprite(art.crown);
      crown.anchor.set(0.5, 1);
      const aura = new Sprite(art.ring);
      aura.anchor.set(0.5);
      aura.tint = 0xffc83a;
      aura.visible = false;
      const warn = new BitmapText({ text: '!', style: { fontFamily: FONT, fontSize: FONT_PX } });
      warn.anchor.set(0.5, 1);
      warn.scale.set(7 / FONT_PX);
      warn.tint = 0xff4a3a;
      warn.visible = false;
      const barBg = bar(14, 4, 0x1b1626);
      const barTrail = bar(12, 2, 0xfff0d0);
      const barFg = bar(12, 2, 0xe4572e);
      root.addChild(aura, sh, body, crown, warn, barBg, barTrail, barFg);
      root.visible = false;
      this.entities.addChild(root);
      this.enemyViews.push({ root, shadow: sh, aura, body, crown, warn, barBg, barTrail, barFg, trail: 1 });
    }

    // Monster projectiles: a glowing ball (pooled to match the sim's shot slots).
    for (let i = 0; i < MAX_SHOTS; i++) {
      const s = new Sprite(art.dot);
      s.anchor.set(0.5);
      s.scale.set(1.5);
      s.visible = false;
      this.entities.addChild(s);
      this.shotViews.push(s);
    }

    // Hero
    this.heroBody = new Sprite(art.hero);
    this.heroBody.anchor.set(0.5, 1);
    this.sword = new Sprite(art.sword);
    this.sword.anchor.set(0.5, 0.82); // pivot on the grip
    this.swordArm.addChild(this.sword);
    this.slash = new Sprite(art.slash);
    this.slash.anchor.set(7 / 30, 0.5);
    this.slash.visible = false;
    this.heroBarBg = bar(16, 2, 0x1b1626);
    this.heroBarFg = bar(16, 2, 0x5cc04f);
    this.heroBarBg.position.set(-8, -23);
    this.heroBarFg.position.set(-8, -23);
    this.levelText.anchor.set(0.5, 1);
    this.levelText.scale.set(LEVEL_TEXT_H / FONT_PX);
    this.levelText.position.set(0, -24.5);
    this.hero.addChild(shadow(12), this.heroBody, this.swordArm, this.slash, this.heroBarBg, this.heroBarFg, this.levelText);
    this.entities.addChild(this.hero);

    this.woodTex = art.wood;
    this.stoneTex = art.stone;
    for (let i = 0; i < MAX_PICKUPS; i++) {
      const root = new Container();
      const sh = shadow(7);
      const body = new Sprite(art.wood);
      body.anchor.set(0.5, 1);
      root.addChild(sh, body);
      root.visible = false;
      this.entities.addChild(root);
      this.pickupViews.push({ root, body });
    }

    this.fx = new Fx(art.coin, art.dot, art.gem, art.ring);
    this.world.addChild(this.fx.world);
    this.fade = new Sprite(art.pixel);
    this.fade.tint = 0x000000;
    this.fade.alpha = 0;
    app.stage.addChild(this.world, this.fade, this.fx.screen);
  }

  /** Rebuild the static map layers (ground, decals, props) for a new area. */
  private buildMap(map: GameMap): void {
    // A new stage's ground: fade in from black (not on the very first build).
    if (this.map && this.map !== map) this.fadeT = 0.45;
    this.map = map;
    const art = areaArt(map.area);
    this.groundLayer.removeChildren().forEach((c) => c.destroy());
    this.decalLayer.removeChildren().forEach((c) => c.destroy());
    for (const p of this.props) p.sprite.destroy();
    this.props = [];

    const { def } = areaFor(map.area);
    // Ground extends past the map edge (tinted darker outside) so the camera never shows a hard void.
    const edge = new TilingSprite({ texture: art.ground, width: MAP_W + 400, height: MAP_H + 400 });
    edge.position.set(-200, -200);
    edge.tint = parseInt(def.void.slice(1), 16);
    const ground = new TilingSprite({ texture: art.ground, width: MAP_W, height: MAP_H });
    ground.tint = map.tint; // daylight → dusk through the area; red glow in the boss arena
    this.groundLayer.addChild(edge, ground);

    for (const d of map.decals) {
      const s = new Sprite(art.decals[d.variant]);
      const [ax, ay] = spriteAnchor(art.decals[d.variant], 0.5, 0.5);
      s.anchor.set(ax, ay);
      s.position.set(Math.round(d.x), Math.round(d.y));
      this.decalLayer.addChild(s);
    }

    for (const p of map.props) {
      const tex = art.props[p.kind][p.variant % 2];
      const s = new Sprite(tex);
      const [ax, ay] = spriteAnchor(tex, 0.5, 1);
      s.anchor.set(ax, ay);
      s.position.set(Math.round(p.x), Math.round(p.y + 2));
      s.zIndex = p.y;
      if (p.variant >= 2) s.scale.x = -1; // mirrored variants for more variety
      this.entities.addChild(s);
      this.props.push({ sprite: s, x: p.x, y: p.y, halfW: tex.width / 2, h: tex.height });
    }
  }

  /** Fit the camera to the canvas (smooth art scales cleanly at any zoom). */
  layout(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    this.scale = Math.max(1, Math.min(w / VIEW_W, h / VIEW_H));
    this.world.scale.set(this.scale);
    this.fx.scale = this.scale;
  }

  /** Screen (canvas CSS pixels) → world coordinates, for click-to-move. */
  screenToWorld(sx: number, sy: number, out: { x: number; y: number }): void {
    out.x = (sx - this.world.x) / this.scale;
    out.y = (sy - this.world.y) / this.scale;
  }

  /** Render one frame. `alpha` is the interpolation factor between the last two sim ticks. */
  update(alpha: number, dt: number): void {
    this.t += dt;
    this.frameDt = dt;
    const sim = this.sim;
    ensureAreaSprites(sim.area);
    if (sim.map !== this.map || artVersion() !== this.artVer) { this.artVer = artVersion(); this.buildMap(sim.map); }
    this.drainEvents();
    const art = areaArt(sim.area);

    // Hero (interpolated)
    const h = sim.hero;
    const hx = h.prevX + (h.x - h.prevX) * alpha;
    const hy = h.prevY + (h.y - h.prevY) * alpha;

    // Camera follows the hero smoothly, clamped so we don't show much beyond the map edge.
    const k = 1 - Math.exp(-dt * 10);
    this.camX += (hx - this.camX) * k;
    this.camY += (hy - 6 - this.camY) * k;
    const halfW = this.screenW / this.scale / 2, halfH = this.screenH / this.scale / 2;
    const cx = clamp(this.camX, Math.min(halfW - 20, MAP_W / 2), Math.max(MAP_W - halfW + 20, MAP_W / 2));
    const cy = clamp(this.camY, Math.min(halfH - 20, MAP_H / 2), Math.max(MAP_H - halfH + 20, MAP_H / 2));
    this.fx.low = this.low;
    if (this.low) this.shake = 0;
    this.shake = Math.max(0, this.shake - dt * 3);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 3 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 3 : 0;
    this.world.position.set(
      Math.round(this.screenW / 2 - (cx + sx) * this.scale),
      Math.round(this.screenH / 2 - (cy + sy) * this.scale),
    );
    this.fx.ox = this.world.x;
    this.fx.oy = this.world.y;
    // Coins/gems fly to their counters (top-left of the screen), expressed in world coords.
    this.fx.coinTargetX = (24 - this.world.x) / this.scale;
    this.fx.coinTargetY = (22 - this.world.y) / this.scale;
    this.fx.gemTargetX = (24 - this.world.x) / this.scale;
    this.fx.gemTargetY = (52 - this.world.y) / this.scale;

    // Show the equipped weapon in the hero's hand.
    const eq = sim.save.equipped;
    if ((eq?.id ?? 0) !== this.weaponId) {
      this.weaponId = eq?.id ?? 0;
      this.sword.texture = eq ? this.art.weapons[eq.form][eq.rarity] : this.art.sword;
    }

    // Cull props outside the view.
    const vx0 = cx - halfW - CULL_PAD, vx1 = cx + halfW + CULL_PAD;
    const vy0 = cy - halfH - CULL_PAD, vy1 = cy + halfH + CULL_PAD + 30;
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      p.sprite.visible = p.x + p.halfW > vx0 && p.x - p.halfW < vx1 && p.y > vy0 && p.y - p.h < vy1;
    }

    const dead = sim.phase === 'dead';
    const moving = h.moving && !dead;
    const ha = heroAnim();
    // Rendered hero animates itself; the code-drawn fallback bobs instead.
    const bob = ha ? 0 : moving ? -Math.abs(Math.sin(this.t * 14)) * 1.5 : Math.sin(this.t * 3) * 0.4;
    this.hero.position.set(Math.round(hx), Math.round(hy));
    this.hero.zIndex = hy;
    if (ha) {
      const frames = moving ? ha.walk : ha.idle;
      const tex = frames[Math.floor(this.t * (moving ? 12 : 5)) % frames.length];
      if (this.heroBody.texture !== tex) {
        this.heroBody.texture = tex;
        const [ax, ay] = spriteAnchor(tex, 0.5, 1);
        this.heroBody.anchor.set(ax, ay);
      }
    }
    this.heroBody.y = Math.round(bob);
    this.heroBody.scale.x = h.faceX;
    this.heroBody.rotation = dead ? -1.4 * h.faceX : 0;
    this.hero.alpha = dead ? 0.5 : 1;
    this.heroBody.tint = h.hitT > 0 ? 0xff7070 : 0xffffff;

    // Mirror the weapon with the hero. Rotations below are already mirrored (× faceX), and
    // mirror·rotate(r) = rotate(−r)·mirror, so with this flip the whole pose is a true mirror
    // image: an axe head or hammer face points the right way when running left.
    this.swordArm.scale.x = h.faceX;
    if (h.swingT > 0) {
      // Sweep the blade across the swing direction; the slash arc fades out over the swing.
      const p = 1 - h.swingT / SWING_TIME;
      const e = 1 - (1 - p) * (1 - p);
      const sweep = h.swingAngle + (e * 2.4 - 1.2) * h.faceX;
      this.swordArm.position.set(0, -7);
      this.swordArm.rotation = sweep + Math.PI / 2;
      this.slash.visible = true;
      this.slash.position.set(0, -6);
      this.slash.rotation = h.swingAngle;
      this.slash.alpha = Math.max(0, 1 - p * 1.2);
      this.slash.scale.set(0.9 + e * 0.25);
    } else {
      this.swordArm.position.set((ha ? 5 : 4) * h.faceX, (ha ? -7 : -6) + Math.round(bob));
      this.swordArm.rotation = (moving ? 0.9 : 0.35 + Math.sin(this.t * 3) * 0.05) * h.faceX;
      this.slash.visible = false;
    }
    if (sim.save.level !== this.shownLevel) {
      this.shownLevel = sim.save.level;
      this.levelText.text = `Lv ${this.shownLevel}`;
      this.levelText.tint = levelTier(this.shownLevel).color;
    }
    if (this.levelPop > 0) {
      this.levelPop = Math.max(0, this.levelPop - dt);
      const k = this.levelPop / 0.6;
      this.levelText.scale.set((LEVEL_TEXT_H / FONT_PX) * (1 + 0.6 * Math.sin(k * Math.PI)));
    }
    const hpFrac = h.maxHp > 0 ? Math.max(0, h.hp / h.maxHp) : 0;
    this.heroBarFg.width = 16 * hpFrac;
    this.heroBarFg.tint = hpFrac > 0.5 ? 0x5cc04f : hpFrac > 0.25 ? 0xffca28 : 0xe4572e;

    // Wood / stone pieces: bob gently; newly dropped ones pop in.
    const pk = sim.gather.pickups;
    for (let i = 0; i < MAX_PICKUPS; i++) {
      const p = pk[i], v = this.pickupViews[i];
      if (!p.alive) { v.root.visible = false; continue; }
      const px = p.prevX + (p.x - p.prevX) * alpha, py = p.prevY + (p.y - p.prevY) * alpha;
      v.root.visible = true;
      v.root.position.set(Math.round(px), Math.round(py));
      v.root.zIndex = py;
      const tex = p.kind === 'wood' ? this.woodTex : this.stoneTex;
      if (v.body.texture !== tex) v.body.texture = tex;
      const pop = Math.min(1, p.age / 0.25);
      v.body.scale.set(1.25 * (0.6 + 0.4 * pop));
      v.body.y = Math.round(-1 - Math.abs(Math.sin(this.t * 3 + i)) * 1.2);
      v.root.alpha = p.age > 110 ? Math.max(0, (120 - p.age) / 10) : 1;
    }

    // Chopped trees/rocks shake briefly.
    for (const [idx, left] of this.shaking) {
      const view = this.props[idx];
      const nl = left - dt;
      if (!view) { this.shaking.delete(idx); continue; }
      if (nl <= 0) { view.sprite.rotation = 0; this.shaking.delete(idx); continue; }
      view.sprite.rotation = Math.sin(nl * 60) * 0.06 * (nl / 0.3);
      this.shaking.set(idx, nl);
    }

    // Danger zones under the monsters: boss slam circles and dash lanes.
    const g = this.warnLayer;
    g.clear();
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = sim.enemies[i];
      if (!e.alive || e.windT <= 0) continue;
      if (e.boss) {
        const p = 1 - e.windT / SLAM_WIND;
        g.circle(e.x, e.y, SLAM_RADIUS).fill({ color: 0xff3a2a, alpha: 0.14 + 0.12 * p })
          .stroke({ color: 0xff5a3a, width: 1, alpha: 0.8 });
        g.circle(e.x, e.y, SLAM_RADIUS * p).fill({ color: 0xff3a2a, alpha: 0.22 });
      } else if (e.style === STYLE_DASHER) {
        const w = e.radius * 1.6, len = DASH_LANE;
        const nx = -e.dirY * w, ny = e.dirX * w;
        const ex = e.x + e.dirX * len, ey = e.y + e.dirY * len;
        g.poly([e.x + nx, e.y + ny, ex + nx, ey + ny, ex - nx, ey - ny, e.x - nx, e.y - ny])
          .fill({ color: 0xff3a2a, alpha: 0.12 + 0.2 * (1 - e.windT / 0.45) });
      }
    }

    // Monster projectiles
    for (let i = 0; i < MAX_SHOTS; i++) {
      const s = sim.shots[i], v = this.shotViews[i];
      if (!s.alive) { v.visible = false; continue; }
      v.visible = true;
      const x = s.prevX + (s.x - s.prevX) * alpha, y = s.prevY + (s.y - s.prevY) * alpha;
      v.position.set(x, y);
      v.zIndex = y + 4;
      v.tint = SHOT_COLORS[s.monster % SHOT_COLORS.length];
      v.scale.set(1.5 + Math.sin(this.t * 30 + i) * 0.25);
    }

    // Enemies
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = sim.enemies[i];
      const v = this.enemyViews[i];
      if (!e.alive) { v.root.visible = false; continue; }
      const x = e.prevX + (e.x - e.prevX) * alpha;
      const y = e.prevY + (e.y - e.prevY) * alpha;
      v.root.visible = x > vx0 && x < vx1 && y > vy0 && y < vy1;
      if (!v.root.visible) continue;
      this.drawEnemy(e, v, x, y, hx, hy, art.monsters[e.monster], art.anims?.[e.monster] ?? null);
    }

    if (this.fadeT > 0) {
      this.fadeT = Math.max(0, this.fadeT - dt);
      this.fade.width = this.screenW;
      this.fade.height = this.screenH;
    }
    this.fade.alpha = this.fadeT / 0.45;
    this.fade.visible = this.fadeT > 0;

    this.fx.update(dt);
  }

  private drawEnemy(e: Enemy, v: EnemyView, x: number, y: number, hx: number, hy: number, tex: Sprite['texture'], an: AnimSet | null): void {
    // Lunge toward the hero when attacking.
    let lx = 0, ly = 0;
    if (e.lungeT > 0) {
      const d = Math.hypot(hx - x, hy - y) || 1;
      const amt = Math.sin((e.lungeT / 0.18) * Math.PI) * 4;
      lx = ((hx - x) / d) * amt; ly = ((hy - y) / d) * amt;
    }
    // Winding up a skill: tremble in place.
    const shakeX = e.windT > 0 ? Math.round(Math.sin(this.t * 70 + e.seed)) : 0;
    v.root.position.set(Math.round(x + lx) + shakeX, Math.round(y + ly));
    v.root.zIndex = y;
    // Size: elites are a bit bigger; champion bosses (a regular monster as a zone boss) much bigger.
    const sizeK = (e.elite ? ELITE.scale : 1) * (e.boss && e.monster !== 3 ? 2 : 1);
    const spawnK = (e.spawnT > 0 ? 1 - e.spawnT / 0.35 : 1) * sizeK;
    let top: number;
    if (an) {
      // Rendered 3D sprite: attack while lunging, walk while moving, otherwise idle.
      const moving = Math.abs(e.x - e.prevX) + Math.abs(e.y - e.prevY) > 0.05;
      let frame: Sprite['texture'];
      if (e.lungeT > 0) frame = an.attack[Math.min(an.attack.length - 1, Math.floor((1 - e.lungeT / 0.18) * an.attack.length))];
      else {
        const set = moving ? an.walk : an.idle;
        frame = set[Math.floor(this.t * (moving ? 10 : 6) + e.seed * 3) % set.length];
      }
      if (v.body.texture !== frame) {
        v.body.texture = frame;
        const [ax, ay] = spriteAnchor(frame, 0.5, 1);
        v.body.anchor.set(ax, ay);
      }
      // Renders face right; flip toward the hero. Bosses are pre-rendered at full size.
      v.body.scale.set(spawnK * (hx >= x ? 1 : -1), spawnK);
      v.body.y = an.fly ? Math.round(-3 + Math.sin(this.t * 4 + e.seed) * 1.5) : 0;
      top = v.body.y - an.top * sizeK;
    } else {
      v.body.texture = tex;
      v.body.anchor.set(0.5, 1);
      const sc = e.boss ? 2.4 : 1;
      const flying = this.sim.monsterDef(e).shape === 'bat';
      const wobble = flying ? 0 : Math.sin(this.t * 8 + e.seed) * 0.07;
      v.body.scale.set(sc * (1 - wobble) * spawnK * (hx < x ? 1 : -1), sc * (1 + wobble) * spawnK);
      v.body.y = flying ? Math.round(-6 + Math.sin(this.t * 6 + e.seed) * 2) : 0;
      top = v.body.y - v.body.height;
    }
    v.body.alpha = Math.min(1, spawnK);
    const flash = e.windT > 0 && Math.sin(this.t * 40) > 0;
    v.body.tint = e.hitT > 0 ? 0xff8080 : flash ? 0xff6050 : e.dashT > 0 ? 0xffc0b0 : 0xffffff;
    v.aura.visible = e.elite;
    if (e.elite) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 4 + e.seed);
      v.aura.width = e.radius * 2.8;
      v.aura.height = e.radius * 1.2;
      v.aura.alpha = 0.45 + 0.35 * pulse;
    }
    v.warn.visible = e.windT > 0 && !e.boss;
    if (v.warn.visible) v.warn.position.set(0, Math.round(top - 3));
    v.shadow.width = e.radius * 2.4;
    v.shadow.height = e.radius;
    v.crown.visible = e.boss;
    if (e.boss) v.crown.position.set(0, Math.round(top + 3));
    // Health bar: appears once a monster has been hit (elites always show theirs), with a pale
    // trailing chunk that drains a moment later so each hit's size is easy to read.
    const frac = Math.max(0, e.hp / e.maxHp);
    if (e.spawnT > 0 || frac >= 1) v.trail = 1;
    v.trail = Math.max(frac, v.trail - (v.trail > frac ? 0.9 * this.frameDt : 0));
    const showBar = frac < 1 || e.elite;
    v.barBg.visible = v.barFg.visible = v.barTrail.visible = showBar;
    if (showBar) {
      const w = e.boss ? 30 : e.elite ? 18 : 14;
      const barY = Math.round(top - (e.boss ? 10 : 5) - (v.warn.visible ? 7 : 0));
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
          fx.burst(x, y + 6, 0xffffff, f ? 4 : 2, 30);
          if (f) this.shake = Math.max(this.shake, 0.35);
          break;
        case Ev.Kill: {
          const boss = f === 1;
          fx.burst(x, y - 5, boss ? 0xffd23f : 0xe8e0ff, boss ? 34 : 9, boss ? 80 : 45);
          fx.coin(x, y - 6, boss ? 14 : 1 + ((Math.random() * 2) | 0));
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
          fx.burst(x, y - 8, 0xb8343e, 18, 50);
          this.shake = 0.8;
          sfx.play('die');
          haptic(120);
          break;
        case Ev.Spawn:
          fx.burst(x, y - 4, 0xd8c8ff, v ? 20 : 5, v ? 60 : 25);
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
          fx.burst(x, y - 10, 0xffd23f, 26, 70);
          this.levelPop = 0.6;
          haptic(40);
          this.hooks.onLevelUp?.(v);
          break;
        case Ev.Chop:
          this.shaking.set(v, 0.3);
          fx.burst(x, y - 6, 0xd8c8a0, 4, 30);
          break;
        case Ev.Drop:
          fx.burst(x, y - 2, v ? 0xc8d0dc : 0xd8a868, 5, 25);
          break;
        case Ev.Pickup:
          sfx.play('shard', 0.6);
          fx.burst(x, y - 3, v ? 0xe8eef6 : 0xf0c890, 6, 35);
          fx.text(x, y - 8, 1, v ? 0xd8e0ea : 0xf0b070, false, '+');
          this.hooks.onPickup?.(v ? 'stone' : 'wood');
          break;
        case Ev.Telegraph:
          if (f === 1) sfx.play('boss', 0.5);
          break;
        case Ev.Slam:
          this.shake = Math.max(this.shake, 0.8);
          fx.ring(x, y, 0xff6a3a, (v / 16) * 1.0);
          fx.burst(x, y - 2, 0xd8b890, 22, 70);
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
          fx.burst(x, y - 10, 0xffd23f, 40, 90);
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
/** Projectile tint by the shooter's roster slot. */
const SHOT_COLORS = [0x9cff5a, 0xffb03a, 0xff6ad5, 0x7ad6ff];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
