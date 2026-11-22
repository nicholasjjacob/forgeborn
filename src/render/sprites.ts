import { CanvasSource, ImageSource, Rectangle, Texture } from 'pixi.js';
import { Rng } from '../core/rng';
import { areaFor, type AreaDef, type MonsterPalette, type MonsterShape, type PropKind } from '../sim/areas';

/**
 * Placeholder art in a soft, shaded cartoon style, drawn in code at startup: ball-shaded
 * bodies, glossy highlights, tinted outlines. Everything is drawn at RES× detail into atlas
 * canvases and uploaded as high-resolution textures, so it stays crisp on phone screens while
 * game coordinates are unchanged. When real pre-rendered art arrives, it replaces these
 * builders; game code only uses the `Art` / `AreaArt` keys.
 */

const RES = 4;              // texture pixels per world unit
const OUTLINE = 'rgba(30,18,40,0.85)';

type Ctx = CanvasRenderingContext2D;

// --- Colour + shape helpers ----------------------------------------------------

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/** Radial "ball" gradient lit from the top-left. */
function ballGrad(c: Ctx, cx: number, cy: number, rx: number, ry: number, base: string, hi = 0.45, lo = -0.42): CanvasGradient {
  const g = c.createRadialGradient(cx - rx * 0.35, cy - ry * 0.45, Math.min(rx, ry) * 0.1, cx, cy, Math.max(rx, ry) * 1.15);
  g.addColorStop(0, shade(base, hi));
  g.addColorStop(0.5, base);
  g.addColorStop(1, shade(base, lo));
  return g;
}

function ellipsePath(c: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

/** Shaded ball with a tinted outline. */
function ball(c: Ctx, cx: number, cy: number, rx: number, ry: number, base: string, outline = true): void {
  ellipsePath(c, cx, cy, rx, ry);
  c.fillStyle = ballGrad(c, cx, cy, rx, ry, base);
  c.fill();
  if (outline) { c.lineWidth = 0.6; c.strokeStyle = shade(base, -0.65); c.stroke(); }
}

function gloss(c: Ctx, cx: number, cy: number, rx: number, ry: number, a = 0.55): void {
  ellipsePath(c, cx, cy, rx, ry);
  c.fillStyle = `rgba(255,255,255,${a})`;
  c.fill();
}

function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function shadedRect(c: Ctx, x: number, y: number, w: number, h: number, r: number, base: string): void {
  rrect(c, x, y, w, h, r);
  const g = c.createLinearGradient(x, y, x + w * 0.6, y + h);
  g.addColorStop(0, shade(base, 0.35));
  g.addColorStop(0.55, base);
  g.addColorStop(1, shade(base, -0.4));
  c.fillStyle = g;
  c.fill();
  c.lineWidth = 0.6;
  c.strokeStyle = shade(base, -0.65);
  c.stroke();
}

/** Big cartoon eye: white, pupil looking toward +x, highlight. */
function eye(c: Ctx, cx: number, cy: number, r: number, iris = '#1b1626'): void {
  ellipsePath(c, cx, cy, r, r * 1.1);
  c.fillStyle = '#ffffff';
  c.fill();
  c.lineWidth = 0.35;
  c.strokeStyle = OUTLINE;
  c.stroke();
  ellipsePath(c, cx + r * 0.25, cy + r * 0.1, r * 0.58, r * 0.66);
  c.fillStyle = iris;
  c.fill();
  gloss(c, cx + r * 0.05, cy - r * 0.3, r * 0.22, r * 0.22, 0.95);
}

/** Glowing eye (for skeletons, golems, imps). */
function glowEye(c: Ctx, cx: number, cy: number, r: number, color: string): void {
  c.save();
  c.shadowColor = color;
  c.shadowBlur = r * 3 * RES;
  ellipsePath(c, cx, cy, r, r);
  c.fillStyle = color;
  c.fill();
  c.restore();
  gloss(c, cx - r * 0.2, cy - r * 0.25, r * 0.35, r * 0.35, 0.9);
}

function limb(c: Ctx, x1: number, y1: number, x2: number, y2: number, w: number, color: string): void {
  c.lineCap = 'round';
  c.lineWidth = w + 0.7;
  c.strokeStyle = shade(color, -0.65);
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.lineWidth = w;
  c.strokeStyle = color;
  c.stroke();
}

// --- Atlas ----------------------------------------------------------------------

interface Region { x: number; y: number; w: number; h: number }

/** Shelf packer in world units; draws at RES× into one canvas. */
class Atlas {
  readonly canvas = document.createElement('canvas');
  readonly ctx: Ctx;
  private cx = 1;
  private cy = 1;
  private rowH = 0;

  constructor(readonly size: number) {
    this.canvas.width = this.canvas.height = size * RES;
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(w: number, h: number, fn: (c: Ctx) => void): Region {
    if (this.cx + w + 1 > this.size) { this.cx = 1; this.cy += this.rowH + 2; this.rowH = 0; }
    const r = { x: this.cx, y: this.cy, w, h };
    if (this.cy + h > this.size) throw new Error('atlas overflow');
    this.cx += w + 2;
    this.rowH = Math.max(this.rowH, h);
    const c = this.ctx;
    c.save();
    c.setTransform(RES, 0, 0, RES, r.x * RES, r.y * RES);
    c.beginPath(); c.rect(0, 0, w, h); c.clip();
    fn(c);
    c.restore();
    return r;
  }

  textures(): (r: Region) => Texture {
    const source = new CanvasSource({ resource: this.canvas, resolution: RES, scaleMode: 'linear' });
    return (r) => new Texture({ source, frame: new Rectangle(r.x, r.y, r.w, r.h) });
  }

  /** PNG data URL of a region (for DOM icons). */
  icon(r: Region): string {
    const c = document.createElement('canvas');
    c.width = r.w * RES; c.height = r.h * RES;
    c.getContext('2d')!.drawImage(this.canvas, r.x * RES, r.y * RES, r.w * RES, r.h * RES, 0, 0, c.width, c.height);
    return c.toDataURL();
  }
}

// --- Hero, weapons, shared bits ---------------------------------------------------

function drawHero(c: Ctx): void {
  // 16×20, facing right, feet at the bottom.
  limb(c, 6, 15.5, 5.8, 18.6, 2.2, '#3a3f5c');
  limb(c, 9.5, 15.5, 9.8, 18.6, 2.2, '#3a3f5c');
  ball(c, 5.8, 19, 1.6, 0.9, '#5a4030');
  ball(c, 10, 19, 1.6, 0.9, '#5a4030');
  // Cape (behind the body).
  c.beginPath();
  c.moveTo(5.5, 10); c.quadraticCurveTo(1.8, 14, 2.6, 17.6); c.lineTo(7.5, 16.8); c.closePath();
  const cg = c.createLinearGradient(2, 10, 7, 18); cg.addColorStop(0, '#e2454f'); cg.addColorStop(1, '#8a1f2a');
  c.fillStyle = cg; c.fill(); c.lineWidth = 0.6; c.strokeStyle = '#4a0f16'; c.stroke();
  // Body + belt.
  ball(c, 8, 13.6, 4.1, 3.6, '#3d6fd0');
  c.fillStyle = '#e8b33c'; rrect(c, 4.4, 13.8, 7.2, 1.1, 0.5); c.fill();
  ball(c, 8.8, 14.35, 0.8, 0.7, '#ffd86a', false);
  // Helmet head.
  ball(c, 8, 7, 5.9, 5.6, '#b8c2d6');
  gloss(c, 5.6, 4.4, 2, 1.3, 0.6);
  // Visor slit (offset toward the facing side) with glowing eyes.
  c.fillStyle = '#1b1626'; rrect(c, 6.6, 6.2, 7, 2.5, 1.2); c.fill();
  glowEye(c, 9.6, 7.45, 0.75, '#6ff6ff');
  glowEye(c, 12.2, 7.45, 0.75, '#6ff6ff');
  // Plume.
  c.beginPath(); c.moveTo(6.5, 1.8); c.quadraticCurveTo(3, 0.6, 2.4, 4.2); c.quadraticCurveTo(4.8, 2.6, 7.5, 2.6); c.closePath();
  c.fillStyle = '#e2454f'; c.fill(); c.lineWidth = 0.5; c.strokeStyle = '#4a0f16'; c.stroke();
  // Hand (gauntlet) where the weapon sits.
  ball(c, 11.6, 13.2, 1.3, 1.2, '#9aa4b8');
}

const WEAPON_PALS = [
  { m: '#c4cede', l: '#ffffff', d: '#6d7a8c', a: '#9a7448', glow: '' },
  { m: '#5aa8ff', l: '#dff0ff', d: '#2156a8', a: '#e8b33c', glow: '' },
  { m: '#b07cff', l: '#f2e2ff', d: '#5a2aa8', a: '#ff6ad0', glow: 'rgba(190,120,255,0.9)' },
  { m: '#ffc94a', l: '#fff8d8', d: '#c0780a', a: '#ff5a3a', glow: 'rgba(255,200,80,0.95)' },
];
const WOOD = '#7a4a28';

/** 9×16, grip centred at x=4.5, y≈13 (anchor 0.5, 0.82). */
function drawWeapon(c: Ctx, form: number, p: (typeof WEAPON_PALS)[number]): void {
  if (p.glow) { c.shadowColor = p.glow; c.shadowBlur = 2.5 * RES; }
  const metal = (x0: number, x1: number) => {
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, p.l); g.addColorStop(0.45, p.m); g.addColorStop(1, p.d);
    return g;
  };
  const grip = (top: number) => {
    limb(c, 4.5, top, 4.5, 14.6, 1.3, WOOD);
    ball(c, 4.5, 15.2, 0.9, 0.8, p.a);
  };
  c.lineWidth = 0.5;
  c.strokeStyle = shade(p.d, -0.5);
  if (form === 0) { // sword
    c.beginPath(); c.moveTo(4.5, 0.3); c.lineTo(6, 2); c.lineTo(6, 10.6); c.lineTo(3, 10.6); c.lineTo(3, 2); c.closePath();
    c.fillStyle = metal(3, 6); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(3.8, 2, 0.5, 8);
    shadedRect(c, 1, 10.5, 7, 1.4, 0.7, p.a);
    grip(12);
  } else if (form === 1) { // axe
    grip(2.5);
    c.beginPath(); c.moveTo(5, 1.6); c.quadraticCurveTo(9.4, 1.4, 8.6, 6); c.quadraticCurveTo(9.2, 9.6, 5, 8.6); c.closePath();
    c.fillStyle = metal(5, 9); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(4, 3); c.lineTo(1.4, 4.4); c.lineTo(4, 5.8); c.closePath();
    c.fillStyle = p.d; c.fill(); c.stroke();
    ball(c, 4.5, 1.6, 0.9, 0.9, p.a);
  } else if (form === 2) { // spear
    limb(c, 4.5, 5.5, 4.5, 15, 1.1, WOOD);
    c.beginPath(); c.moveTo(4.5, 0.2); c.quadraticCurveTo(6.6, 3, 4.5, 5.6); c.quadraticCurveTo(2.4, 3, 4.5, 0.2);
    c.fillStyle = metal(3, 6.4); c.fill(); c.stroke();
    ball(c, 4.5, 6, 1.1, 0.7, p.a);
    c.fillStyle = p.a; c.beginPath(); c.moveTo(4, 6.4); c.lineTo(3, 9); c.lineTo(5, 6.4); c.fill();
  } else { // hammer
    grip(5);
    shadedRect(c, 0.6, 0.6, 7.8, 4.8, 1.3, p.m);
    c.fillStyle = 'rgba(255,255,255,0.45)'; rrect(c, 1.4, 1.2, 6.2, 1, 0.5); c.fill();
    ball(c, 4.5, 3, 0.9, 0.9, p.a);
  }
  c.shadowBlur = 0;
}

const MONSTER_BOX: Record<MonsterShape, [number, number]> = {
  blob: [14, 12], bat: [16, 12], husk: [14, 18], beetle: [16, 12], golem: [18, 20], imp: [14, 16], spider: [18, 12],
};

function drawMonster(c: Ctx, shape: MonsterShape, p: MonsterPalette): void {
  const e = p.e ?? '#ffffff';
  switch (shape) {
    case 'blob': {
      ball(c, 7, 7.4, 6.5, 4.9, p.m);
      gloss(c, 4.6, 4.6, 1.8, 1.1, 0.7);
      eye(c, 5.4, 6.8, 1.55);
      eye(c, 9.3, 6.8, 1.55);
      c.beginPath(); c.arc(7.5, 9.2, 1.1, 0.15 * Math.PI, 0.85 * Math.PI);
      c.lineWidth = 0.5; c.strokeStyle = shade(p.d, -0.5); c.stroke();
      break;
    }
    case 'bat': {
      for (const s of [-1, 1]) {
        c.beginPath();
        c.moveTo(8 + s * 2, 5);
        c.quadraticCurveTo(8 + s * 7.6, 0.6, 8 + s * 7.8, 6.4);
        c.quadraticCurveTo(8 + s * 6, 5.6, 8 + s * 5.2, 8);
        c.quadraticCurveTo(8 + s * 4, 6.6, 8 + s * 2, 8);
        c.closePath();
        const g = c.createLinearGradient(8, 2, 8 + s * 8, 8); g.addColorStop(0, p.m); g.addColorStop(1, p.d);
        c.fillStyle = g; c.fill(); c.lineWidth = 0.5; c.strokeStyle = shade(p.d, -0.6); c.stroke();
      }
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(8 + s * 1.2, 3.2); c.lineTo(8 + s * 2.8, 0.6); c.lineTo(8 + s * 3, 3.8); c.fillStyle = p.d; c.fill(); }
      ball(c, 8, 6, 3.7, 3.5, p.m);
      gloss(c, 6.8, 4.2, 1.1, 0.7, 0.6);
      eye(c, 6.8, 5.6, 1.15, '#2a0a2a');
      eye(c, 9.4, 5.6, 1.15, '#2a0a2a');
      c.fillStyle = '#ffffff';
      c.beginPath(); c.moveTo(7.4, 7.6); c.lineTo(7.8, 8.8); c.lineTo(8.2, 7.6); c.fill();
      c.beginPath(); c.moveTo(8.6, 7.6); c.lineTo(9, 8.8); c.lineTo(9.4, 7.6); c.fill();
      break;
    }
    case 'husk': {
      limb(c, 5.5, 13, 5, 17.4, 1.3, p.l);
      limb(c, 8.5, 13, 9, 17.4, 1.3, p.l);
      limb(c, 3.5, 9.5, 1.6, 13.5, 1.1, p.l);
      limb(c, 10.5, 9.5, 12.6, 13.5, 1.1, p.l);
      shadedRect(c, 3.6, 8.6, 6.8, 5.4, 1.8, p.d);
      c.strokeStyle = p.l; c.lineWidth = 0.6;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(4.4, 9.8 + i * 1.3); c.lineTo(9.6, 9.8 + i * 1.3); c.stroke(); }
      ball(c, 7, 5, 4.6, 4.3, p.l);
      ellipsePath(c, 5.4, 5.2, 1.3, 1.5); c.fillStyle = '#1b1626'; c.fill();
      ellipsePath(c, 8.8, 5.2, 1.3, 1.5); c.fill();
      glowEye(c, 5.6, 5.3, 0.55, e);
      glowEye(c, 9, 5.3, 0.55, e);
      c.fillStyle = '#1b1626'; rrect(c, 5.2, 7.6, 3.6, 0.8, 0.3); c.fill();
      break;
    }
    case 'beetle': {
      c.strokeStyle = shade(p.d, -0.5); c.lineWidth = 0.8; c.lineCap = 'round';
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
        c.beginPath(); c.moveTo(8 + s * 4, 5.5 + i * 2); c.lineTo(8 + s * 7.2, 4.5 + i * 2.8); c.stroke();
      }
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(8 + s * 1, 9); c.quadraticCurveTo(8 + s * 3, 11.5, 8 + s * 4.5, 11); c.stroke(); }
      ball(c, 8, 10, 2.6, 1.8, p.d);
      ball(c, 8, 6, 6.2, 4.6, p.m);
      c.strokeStyle = shade(p.m, -0.6); c.lineWidth = 0.5;
      c.beginPath(); c.moveTo(8, 1.6); c.lineTo(8, 10.4); c.stroke();
      gloss(c, 5.2, 3.8, 1.6, 1.0, 0.65);
      gloss(c, 10.6, 3.8, 1.0, 0.6, 0.45);
      eye(c, 6.8, 10.1, 0.75);
      eye(c, 9.2, 10.1, 0.75);
      break;
    }
    case 'golem': {
      shadedRect(c, 4.2, 15, 3.6, 4.6, 1, p.d);
      shadedRect(c, 10.2, 15, 3.6, 4.6, 1, p.d);
      shadedRect(c, 0.6, 7.5, 4, 8, 1.8, p.m);
      shadedRect(c, 13.4, 7.5, 4, 8, 1.8, p.m);
      shadedRect(c, 3.6, 6.4, 10.8, 10, 2.4, p.m);
      shadedRect(c, 5.4, 1, 7.2, 6.2, 2, p.m);
      c.strokeStyle = shade(p.m, -0.55); c.lineWidth = 0.4;
      c.beginPath(); c.moveTo(6, 9); c.lineTo(8, 11); c.lineTo(7.2, 13.4); c.stroke();
      c.beginPath(); c.moveTo(12.4, 10); c.lineTo(10.8, 12.4); c.stroke();
      ellipsePath(c, 6.4, 8.6, 1.2, 0.6); c.fillStyle = p.l; c.fill();
      glowEye(c, 7.4, 3.9, 0.75, e);
      glowEye(c, 10.6, 3.9, 0.75, e);
      break;
    }
    case 'imp': {
      c.strokeStyle = p.d; c.lineWidth = 0.9; c.lineCap = 'round';
      c.beginPath(); c.moveTo(4, 12); c.quadraticCurveTo(0.6, 12, 1.4, 8.4); c.stroke();
      c.fillStyle = p.d; c.beginPath(); c.moveTo(0.6, 8.4); c.lineTo(1.4, 6.8); c.lineTo(2.2, 8.6); c.fill();
      limb(c, 5.6, 13, 5.2, 15.5, 1.2, p.d);
      limb(c, 8.4, 13, 8.8, 15.5, 1.2, p.d);
      ball(c, 7, 11.4, 3, 2.6, p.m);
      for (const s of [-1, 1]) {
        c.beginPath(); c.moveTo(7 + s * 2.4, 3.4); c.quadraticCurveTo(7 + s * 5.4, 2.4, 7 + s * 4.8, -0.2); c.quadraticCurveTo(7 + s * 3.6, 2, 7 + s * 1.2, 2.6); c.closePath();
        c.fillStyle = shade(p.d, -0.1); c.fill(); c.lineWidth = 0.4; c.strokeStyle = shade(p.d, -0.6); c.stroke();
      }
      ball(c, 7, 6.2, 4.6, 4.1, p.m);
      gloss(c, 5, 4, 1.3, 0.8, 0.6);
      glowEye(c, 5.4, 6.2, 0.95, e);
      glowEye(c, 8.8, 6.2, 0.95, e);
      c.beginPath(); c.arc(7.2, 8.2, 1.2, 0.1 * Math.PI, 0.9 * Math.PI); c.lineWidth = 0.5; c.strokeStyle = '#1b1626'; c.stroke();
      break;
    }
    case 'spider': {
      c.strokeStyle = shade(p.d, -0.3); c.lineWidth = 0.9; c.lineCap = 'round';
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
        const y = 5 + i * 1.6;
        c.beginPath(); c.moveTo(9 + s * 3, y); c.quadraticCurveTo(9 + s * 7, y - 3.4 + i * 0.6, 9 + s * 8.4, y + 2.6); c.stroke();
      }
      ball(c, 9, 5.2, 5, 3.9, p.m);
      c.fillStyle = shade(p.l, 0); ellipsePath(c, 9, 4, 1.4, 1.8); c.fill();
      gloss(c, 7, 3, 1.4, 0.8, 0.55);
      ball(c, 9, 8.6, 2.8, 2.3, p.d);
      for (const [x, y, r] of [[8, 8.2, 0.55], [10, 8.2, 0.55], [7.3, 9.3, 0.35], [10.7, 9.3, 0.35]]) glowEye(c, x, y, r, e);
      break;
    }
  }
}

// --- Shared art -----------------------------------------------------------------------

export interface Art {
  hero: Texture;
  sword: Texture;
  /** weapons[form][rarity] */
  weapons: Texture[][];
  /** Data URLs for the same sprites, for DOM icons in the forge UI. */
  weaponIcons: string[][];
  crown: Texture;
  coin: Texture;
  gem: Texture;
  /** Building-material pickups lying on the ground. */
  wood: Texture;
  stone: Texture;
  pixel: Texture;
  dot: Texture;
  shadow: Texture;
  slash: Texture;
  ring: Texture;
}

export function buildArt(): Art {
  const a = new Atlas(160);
  const weaponRegions = [0, 1, 2, 3].map((form) => WEAPON_PALS.map((pal) => a.draw(9, 16, (c) => drawWeapon(c, form, pal))));
  const r = {
    hero: a.draw(16, 20, drawHero),
    crown: a.draw(12, 7, (c) => {
      c.beginPath();
      c.moveTo(1, 6.4); c.lineTo(0.6, 1.6); c.lineTo(3.4, 3.8); c.lineTo(6, 0.4); c.lineTo(8.6, 3.8); c.lineTo(11.4, 1.6); c.lineTo(11, 6.4); c.closePath();
      const g = c.createLinearGradient(0, 0, 0, 7); g.addColorStop(0, '#fff2a0'); g.addColorStop(0.5, '#ffc93c'); g.addColorStop(1, '#c0780a');
      c.fillStyle = g; c.fill(); c.lineWidth = 0.5; c.strokeStyle = '#6a3a00'; c.stroke();
      ball(c, 6, 4.6, 1, 1, '#e4572e'); ball(c, 3.2, 5, 0.7, 0.7, '#4fc3f7'); ball(c, 8.8, 5, 0.7, 0.7, '#4fc3f7');
    }),
    coin: a.draw(6, 6, (c) => {
      ball(c, 3, 3, 2.6, 2.6, '#ffc93c');
      ellipsePath(c, 3, 3, 1.6, 1.6); c.lineWidth = 0.4; c.strokeStyle = '#c0780a'; c.stroke();
      gloss(c, 2.2, 2, 0.7, 0.5, 0.85);
    }),
    gem: a.draw(6, 7, (c) => {
      c.beginPath(); c.moveTo(3, 0.3); c.lineTo(5.6, 2.6); c.lineTo(3, 6.7); c.lineTo(0.4, 2.6); c.closePath();
      const g = c.createLinearGradient(0, 0, 6, 7); g.addColorStop(0, '#f6e6ff'); g.addColorStop(0.5, '#b06cff'); g.addColorStop(1, '#4a1a8a');
      c.fillStyle = g; c.fill(); c.lineWidth = 0.4; c.strokeStyle = '#2a0a5a'; c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.moveTo(3, 0.8); c.lineTo(1.4, 2.6); c.lineTo(3, 2.6); c.fill();
    }),
    // A short log lying on its side: bark body, pale cut end with rings.
    wood: a.draw(10, 6, (c) => {
      c.beginPath(); c.moveTo(1.6, 1); c.lineTo(7.6, 1); c.lineTo(7.6, 5); c.lineTo(1.6, 5);
      c.ellipse(1.6, 3, 1.1, 2, 0, Math.PI / 2, -Math.PI / 2); c.closePath();
      const g = c.createLinearGradient(0, 1, 0, 5); g.addColorStop(0, '#b0743c'); g.addColorStop(0.5, '#8a5428'); g.addColorStop(1, '#5e3416');
      c.fillStyle = g; c.fill(); c.lineWidth = 0.45; c.strokeStyle = '#3a1e0a'; c.stroke();
      c.lineWidth = 0.3; c.strokeStyle = 'rgba(58,30,10,0.55)';
      for (const [x0, x1, y] of [[2.4, 5.2, 2.2], [3.4, 6.8, 3.4], [2.2, 4.6, 4.3]] as const) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); }
      ellipsePath(c, 7.6, 3, 1.2, 2); c.fillStyle = '#f0cf98'; c.fill(); c.lineWidth = 0.45; c.strokeStyle = '#3a1e0a'; c.stroke();
      ellipsePath(c, 7.6, 3, 0.6, 1.1); c.lineWidth = 0.3; c.strokeStyle = '#b8864a'; c.stroke();
      gloss(c, 4, 1.7, 2, 0.35, 0.35);
    }),
    // A chunky grey stone.
    stone: a.draw(8, 7, (c) => {
      c.beginPath(); c.moveTo(1, 5.6); c.lineTo(0.6, 3.2); c.lineTo(2.2, 1.2); c.lineTo(5, 0.7); c.lineTo(7.2, 2.4); c.lineTo(7.4, 5); c.lineTo(5.6, 6.3); c.lineTo(2.4, 6.4); c.closePath();
      const g = c.createLinearGradient(0, 0, 4, 7); g.addColorStop(0, '#d8dee6'); g.addColorStop(0.55, '#9aa4b0'); g.addColorStop(1, '#5e6672');
      c.fillStyle = g; c.fill(); c.lineWidth = 0.45; c.strokeStyle = '#2a2e36'; c.stroke();
      c.lineWidth = 0.3; c.strokeStyle = 'rgba(42,46,54,0.5)';
      c.beginPath(); c.moveTo(2.2, 1.2); c.lineTo(3.4, 3.4); c.lineTo(7.2, 2.4); c.moveTo(3.4, 3.4); c.lineTo(3, 6.3); c.stroke();
      gloss(c, 3.6, 1.8, 1.4, 0.5, 0.6);
    }),
    pixel: a.draw(2, 2, (c) => { c.fillStyle = '#fff'; c.fillRect(0, 0, 2, 2); }),
    dot: a.draw(4, 4, (c) => {
      const g = c.createRadialGradient(2, 2, 0, 2, 2, 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, 4, 4);
    }),
    shadow: a.draw(14, 6, (c) => {
      const g = c.createRadialGradient(7, 3, 0, 7, 3, 7);
      g.addColorStop(0, 'rgba(0,0,0,0.38)'); g.addColorStop(0.7, 'rgba(0,0,0,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.save(); c.scale(1, 3 / 7); c.fillStyle = g; c.fillRect(0, 0, 14, 14); c.restore();
    }),
    slash: a.draw(30, 30, (c) => {
      c.save();
      c.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        c.beginPath();
        c.arc(7, 15, 17.5 - i * 0.6, -1.2 + i * 0.05, 1.2 - i * 0.05);
        c.lineWidth = 3.4 - i * 0.5;
        c.strokeStyle = `rgba(255,255,255,${0.12 + i * 0.12})`;
        c.stroke();
      }
      c.restore();
    }),
    ring: a.draw(32, 32, (c) => {
      ellipsePath(c, 16, 16, 14.5, 14.5);
      c.lineWidth = 1.6; c.strokeStyle = 'rgba(255,255,255,0.95)'; c.stroke();
      ellipsePath(c, 16, 16, 12.8, 12.8);
      c.lineWidth = 0.8; c.strokeStyle = 'rgba(255,255,255,0.4)'; c.stroke();
    }),
  };
  const tex = a.textures();
  return {
    weapons: weaponRegions.map((row) => row.map(tex)),
    weaponIcons: weaponRegions.map((row) => row.map((reg) => a.icon(reg))),
    hero: tex(r.hero),
    sword: tex(weaponRegions[0][0]),
    crown: tex(r.crown), coin: tex(r.coin), gem: tex(r.gem), wood: tex(r.wood), stone: tex(r.stone), pixel: tex(r.pixel), dot: tex(r.dot),
    shadow: tex(r.shadow), slash: tex(r.slash), ring: tex(r.ring),
  };
}

// --- Per-area art ------------------------------------------------------------------------

export interface AreaArt {
  ground: Texture;
  decals: Texture[];
  props: Record<PropKind, Texture[]>;
  monsters: Texture[];      // [roster 0, 1, 2, boss] (code-drawn fallback)
  monsterIcons: string[];   // same, as data URLs for the codex
  /** Rendered 3D animation sets for [roster 0, 1, 2, boss], once their sheet has loaded. */
  anims?: (AnimSet | null)[];
}

const cache = new Map<number, AreaArt>();
const merged = new Map<number, { version: number; art: AreaArt }>();

export function areaArt(area: number): AreaArt {
  const key = area % 6;
  let base = cache.get(key);
  if (!base) { base = buildAreaArt(areaFor(area).def, key); cache.set(key, base); }
  if (!meta) return base;
  const hit = merged.get(key);
  if (hit && hit.version === version) return hit.art;
  // Overlay whatever rendered art is loaded: props/decals from the shared sheet, monsters
  // from this area's sheet. Anything missing keeps its code-drawn version.
  const prop = (name: string) => renderedTexture(name);
  const pair = (a: string, b: string, fallback: Texture[]) => {
    const ta = prop(a), tb = prop(b);
    return ta && tb ? [ta, tb] : fallback;
  };
  const sets = ['m0', 'm1', 'm2', 'b'].map((s) => anim(`a${key}${s}`));
  const art: AreaArt = {
    ...base,
    props: {
      ...base.props,
      tree: pair('tree0', 'tree1', base.props.tree),
      pine: pair('pine0', 'pine1', base.props.pine),
      deadtree: pair('deadtree0', 'deadtree1', base.props.deadtree),
      rock: pair('rock0', 'rock1', base.props.rock),
      bush: pair('bush0', 'bush1', base.props.bush),
      shroom: pair('shroom0', 'shroom1', base.props.shroom),
    },
    decals: ['decal0', 'decal1', 'decal2'].map((d, i) => prop(d) ?? base.decals[i]),
    anims: sets.some(Boolean) ? sets : undefined,
    monsterIcons: sets.map((a, i) => a?.icon ?? base.monsterIcons[i]),
  };
  merged.set(key, { version, art });
  return art;
}

// --- Rendered 3D sprites (tools/blender/render_sprites.py → public/sprites) ---------------

export interface AnimSet { idle: Texture[]; walk: Texture[]; attack: Texture[]; top: number; fly: boolean; icon: string }

interface SpriteMeta { sheet: string; anchor: [number, number]; top: number; width: number; fly: boolean; frames: Record<string, number[][]> }
interface SpriteIndex { res: number; sheets: Record<string, { file: string }>; sprites: Record<string, SpriteMeta> }

let meta: SpriteIndex | null = null;
let version = 0;
const sheets = new Map<string, { source: ImageSource; img: HTMLImageElement }>();
const pending = new Map<string, Promise<void>>();
const anims = new Map<string, AnimSet | null>();
const singles = new Map<string, Texture | null>();
const anchors = new WeakMap<Texture, [number, number]>();
const SPRITE_DIR = './sprites/';

/** Bumped whenever newly loaded sheets change what `areaArt`/`heroAnim` return. */
export const artVersion = () => version;

/** Feet anchor for a texture: rendered sprites carry their own; code-drawn art uses the fallback. */
export function spriteAnchor(tex: Texture, fx: number, fy: number): [number, number] {
  return anchors.get(tex) ?? [fx, fy];
}

/** Load the sprite index plus the hero and scenery sheets. Resolves false if unavailable. */
export async function loadRenderedArt(): Promise<boolean> {
  try {
    const r = await fetch(SPRITE_DIR + 'sprites.json');
    if (!r.ok) return false;
    meta = (await r.json()) as SpriteIndex;
    await Promise.all([loadSheet('hero'), loadSheet('props')]);
    version++;
    return true;
  } catch {
    meta = null;
    return false;
  }
}

/** Start loading an area's monster sheet in the background (no-op once loaded). */
export function ensureAreaSprites(area: number): void {
  const name = `area${area % 6}`;
  if (!meta || sheets.has(name) || pending.has(name)) return;
  loadSheet(name).then(() => { anims.clear(); version++; }).catch(() => { /* keep code-drawn monsters */ });
}

function loadSheet(name: string): Promise<void> {
  const info = meta?.sheets[name];
  if (!info) return Promise.resolve();
  const existing = pending.get(name);
  if (existing) return existing;
  const p = new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      sheets.set(name, { img, source: new ImageSource({ resource: img, resolution: meta!.res, scaleMode: 'linear' }) });
      resolve();
    };
    img.onerror = () => reject(new Error('sprite sheet failed: ' + name));
    img.src = SPRITE_DIR + info.file;
  });
  pending.set(name, p);
  return p;
}

function frameTexture(m: SpriteMeta, rect: number[]): Texture | null {
  const sheet = sheets.get(m.sheet);
  if (!sheet) return null;
  const [x, y, w, h] = rect;
  const t = new Texture({ source: sheet.source, frame: new Rectangle(x, y, w, h) });
  anchors.set(t, m.anchor);
  return t;
}

function renderedTexture(name: string): Texture | null {
  if (singles.has(name)) return singles.get(name)!;
  const m = meta?.sprites[name];
  const t = m?.frames.idle?.[0] ? frameTexture(m, m.frames.idle[0]) : null;
  if (t || (m && sheets.has(m.sheet))) singles.set(name, t);
  return t;
}

function anim(key: string): AnimSet | null {
  if (anims.has(key)) return anims.get(key)!;
  const m = meta?.sprites[key];
  if (!m || !sheets.has(m.sheet)) return null;
  const make = (rects?: number[][]) => (rects ?? []).map((r) => frameTexture(m, r)!).filter(Boolean);
  const idle = make(m.frames.idle);
  const set: AnimSet = {
    idle,
    walk: m.frames.walk ? make(m.frames.walk) : idle,
    attack: m.frames.attack ? make(m.frames.attack) : idle,
    top: m.top,
    fly: m.fly,
    icon: iconOf(m),
  };
  anims.set(key, set);
  return set;
}

/** First idle frame as a data URL (codex portraits). */
function iconOf(m: SpriteMeta): string {
  const sheet = sheets.get(m.sheet)!;
  const res = meta!.res;
  const [x, y, w, h] = m.frames.idle[0];
  const c = document.createElement('canvas');
  c.width = w * res; c.height = h * res;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(sheet.img, x * res, y * res, w * res, h * res, 0, 0, c.width, c.height);
  // Trim transparent margins (render cells are roomy) so portraits fill their frame.
  try {
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let yy = 0; yy < c.height; yy++) {
      for (let xx = 0; xx < c.width; xx++) {
        if (px[(yy * c.width + xx) * 4 + 3] > 16) {
          if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
        }
      }
    }
    if (x1 >= x0 && y1 >= y0) {
      const pad = 2, cw = x1 - x0 + 1 + pad * 2, ch = y1 - y0 + 1 + pad * 2;
      const out = document.createElement('canvas');
      out.width = cw; out.height = ch;
      out.getContext('2d')!.drawImage(c, x0 - pad, y0 - pad, cw, ch, 0, 0, cw, ch);
      return out.toDataURL();
    }
  } catch { /* fall back to the untrimmed frame */ }
  return c.toDataURL();
}

/** The hero's rendered animations, if loaded. */
export function heroAnim(): AnimSet | null {
  return anim('hero');
}

function drawProp(c: Ctx, kind: PropKind, v: number, P: AreaDef['propPal'], rng: Rng): void {
  switch (kind) {
    case 'tree': {
      shadedRect(c, 9.4, 15, 3.2, 12.4, 1.4, P.trunk);
      const canopy: [number, number, number][] = [[6.2, 13.2, 5.4], [15.8, 13.2, 5.4], [11, 11, 7.6 - v * 0.6], [11, 6.2 - v, 5.6]];
      for (const [x, y, r] of canopy) {
        ellipsePath(c, x, y, r, r * 0.92);
        c.fillStyle = ballGrad(c, x, y, r, r, P.a, 0.5, -0.45); c.fill();
        c.lineWidth = 0.6; c.strokeStyle = shade(P.a, -0.6); c.stroke();
      }
      gloss(c, 8.2, 5.4 - v, 2.4, 1.4, 0.35);
      for (let i = 0; i < 5; i++) gloss(c, 6 + rng.next() * 10, 8 + rng.next() * 6, 0.9, 0.6, 0.25);
      break;
    }
    case 'pine': {
      shadedRect(c, 7, 23, 2, 6.6, 0.8, P.trunk);
      for (let t = 0; t < 3; t++) {
        const top = 1 + t * 7 - v, w = 6.6 - t * 0.6 + v * 0.4, h = 11;
        c.beginPath();
        c.moveTo(8, top);
        c.quadraticCurveTo(8 + w * 0.5, top + h * 0.6, 8 + w, top + h);
        c.quadraticCurveTo(8, top + h + 1.6, 8 - w, top + h);
        c.quadraticCurveTo(8 - w * 0.5, top + h * 0.6, 8, top);
        const g = c.createLinearGradient(8 - w, top, 8 + w, top + h);
        g.addColorStop(0, shade(P.a, 0.35)); g.addColorStop(0.6, P.a); g.addColorStop(1, shade(P.a, -0.45));
        c.fillStyle = g; c.fill(); c.lineWidth = 0.6; c.strokeStyle = shade(P.a, -0.6); c.stroke();
        // Highlight/snow along the upper left edge.
        c.beginPath(); c.moveTo(8, top + 0.6); c.quadraticCurveTo(8 - w * 0.45, top + h * 0.55, 8 - w * 0.75, top + h * 0.85);
        c.lineWidth = 0.9; c.strokeStyle = P.b; c.globalAlpha = 0.7; c.stroke(); c.globalAlpha = 1;
      }
      break;
    }
    case 'rock': {
      c.beginPath();
      c.moveTo(1.4, 8.6);
      c.quadraticCurveTo(0.6, 3.6, 4.6, 2.2 + v * 0.5);
      c.quadraticCurveTo(8.6, 0.8, 11.6, 3.4);
      c.quadraticCurveTo(13.6, 6, 12.4, 8.6);
      c.closePath();
      c.fillStyle = ballGrad(c, 7, 5, 6.5, 4.5, P.c, 0.45, -0.5); c.fill();
      c.lineWidth = 0.6; c.strokeStyle = shade(P.c, -0.6); c.stroke();
      gloss(c, 5, 3.6, 2, 0.9, 0.35);
      c.beginPath(); c.moveTo(8, 4); c.lineTo(9.4, 6.4); c.strokeStyle = shade(P.c, -0.45); c.lineWidth = 0.4; c.stroke();
      break;
    }
    case 'cactus': {
      const arm = (x: number, y: number, dir: number) => {
        c.beginPath(); c.moveTo(6, y + 2); c.lineTo(x, y + 2); c.lineTo(x, y - 2.6);
        c.lineWidth = 2.6; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = shade(P.a, -0.55); c.stroke();
        c.lineWidth = 1.9; c.strokeStyle = dir > 0 ? shade(P.a, -0.1) : P.a; c.stroke();
      };
      arm(2, 8 + v, -1);
      arm(10, 10 - v, 1);
      shadedRect(c, 3.8, 2.4, 4.4, 15, 2.2, P.a);
      c.strokeStyle = shade(P.a, -0.35); c.lineWidth = 0.35;
      c.beginPath(); c.moveTo(6, 3.4); c.lineTo(6, 16.6); c.stroke();
      ball(c, 6, 2.6, 1.1, 0.8, '#ff8ab0');
      break;
    }
    case 'crystal': {
      const shard = (cx: number, top: number, h: number, w: number) => {
        c.beginPath(); c.moveTo(cx, top); c.lineTo(cx + w, top + h * 0.3); c.lineTo(cx + w * 0.8, top + h); c.lineTo(cx - w * 0.8, top + h); c.lineTo(cx - w, top + h * 0.3); c.closePath();
        const g = c.createLinearGradient(cx - w, top, cx + w, top + h);
        g.addColorStop(0, shade(P.b, 0.2)); g.addColorStop(0.5, P.a); g.addColorStop(1, shade(P.a, -0.5));
        c.fillStyle = g; c.fill(); c.lineWidth = 0.5; c.strokeStyle = shade(P.a, -0.65); c.stroke();
        c.beginPath(); c.moveTo(cx, top + 0.6); c.lineTo(cx - w * 0.5, top + h * 0.35); c.lineTo(cx - w * 0.3, top + h * 0.9);
        c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 0.5; c.stroke();
      };
      c.save(); c.shadowColor = P.a; c.shadowBlur = 3 * RES;
      shard(3.4, 7 + v, 8.4 - v, 2);
      shard(8.8, 5, 10.4, 2.2);
      shard(6, 0.6 - v * 0.4, 14.8 + v * 0.4, 2.6);
      c.restore();
      break;
    }
    case 'shroom': {
      shadedRect(c, 3.8, 4.6, 2.4, 5, 1, '#f3ead8');
      c.beginPath(); c.ellipse(5, 4.8, 4.4 + v * 0.4, 3.4, 0, Math.PI, 0); c.closePath();
      c.fillStyle = ballGrad(c, 5, 3, 4.4, 3.4, P.c, 0.45, -0.4); c.fill();
      c.lineWidth = 0.5; c.strokeStyle = shade(P.c, -0.6); c.stroke();
      for (const [x, y, r] of [[3.4, 3, 0.7], [6.4, 2.4, 0.6], [5.2, 4, 0.45]]) gloss(c, x, y, r, r * 0.8, 0.9);
      break;
    }
    case 'deadtree': {
      c.lineCap = 'round';
      const branch = (x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, w: number) => {
        c.beginPath(); c.moveTo(x1, y1); c.quadraticCurveTo(cx, cy, x2, y2);
        c.lineWidth = w + 0.7; c.strokeStyle = shade(P.trunk, -0.6); c.stroke();
        c.lineWidth = w; c.strokeStyle = P.trunk; c.stroke();
      };
      branch(8, 21.5, 7.4, 14, 8, 6, 2.4);
      branch(7.8, 12, 4, 10, 2.4 + v, 5, 1.2);
      branch(8.1, 9.5, 11, 7, 13.4, 2.6, 1.1);
      branch(8, 7, 8.6, 4, 7.4, 1.2, 0.8);
      break;
    }
    case 'bush': {
      for (const [x, y, r] of [[4.6, 6.4, 3.6], [9.6, 5.8 - v * 0.5, 4.2], [7, 4.4, 3.4]]) {
        ellipsePath(c, x, y, r, r * 0.88);
        c.fillStyle = ballGrad(c, x, y, r, r, P.a, 0.5, -0.45); c.fill();
        c.lineWidth = 0.55; c.strokeStyle = shade(P.a, -0.6); c.stroke();
      }
      gloss(c, 6, 3.4, 1.6, 0.8, 0.35);
      if (v === 1) { ball(c, 4.4, 5.4, 0.8, 0.8, '#ffd23f'); ball(c, 10.6, 6.6, 0.8, 0.8, '#ff8ab0'); ball(c, 8, 3.6, 0.7, 0.7, '#ffffff'); }
      break;
    }
  }
}

const PROP_BOX: Record<PropKind, [number, number]> = {
  tree: [22, 28], pine: [16, 30], rock: [14, 10], cactus: [12, 18], crystal: [12, 16], shroom: [10, 10], deadtree: [16, 22], bush: [14, 10],
};

function buildAreaArt(def: AreaDef, seed: number): AreaArt {
  const a = new Atlas(200);
  const rng = new Rng(77 + seed);
  const P = def.propPal;
  const g = def.ground;

  const monsterRegions = [...def.monsters, def.boss].map((m) => {
    const [w, h] = MONSTER_BOX[m.shape];
    return a.draw(w, h, (c) => drawMonster(c, m.shape, m.pal));
  });

  const decals = [0, 1, 2].map((v) => a.draw(6, 5, (c) => {
    if (v === 0) { // grass tuft
      c.lineCap = 'round'; c.lineWidth = 0.6;
      for (const [x, lean, col] of [[2, -1, g.dark], [3, 0.2, g.speck], [4, 1, g.dark]] as const) {
        c.strokeStyle = col; c.beginPath(); c.moveTo(x, 5); c.quadraticCurveTo(x + lean * 0.4, 3, x + lean, 1.2); c.stroke();
      }
    } else if (v === 1) { // flower
      for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2; ball(c, 3 + Math.cos(t) * 1.1, 2.5 + Math.sin(t) * 1.1, 0.8, 0.8, i % 2 ? '#ffffff' : '#ffd6ec', false); }
      ball(c, 3, 2.5, 0.7, 0.7, '#ffd23f', false);
    } else { // pebbles
      ball(c, 2, 3.2, 1.3, 0.9, shade(g.dark, -0.1));
      ball(c, 4.4, 2.6, 0.9, 0.7, shade(g.dark, 0.1));
    }
  }));

  const props = Object.fromEntries((Object.keys(PROP_BOX) as PropKind[]).map((kind) => {
    const [w, h] = PROP_BOX[kind];
    return [kind, [0, 1].map((v) => a.draw(w, h, (c) => drawProp(c, kind, v, P, rng)))];
  })) as Record<PropKind, Region[]>;

  // Ground: a seamless 128-unit tile at 2× with soft blotches and grass strokes.
  const T = 128, GR = 2;
  const gc = document.createElement('canvas');
  gc.width = gc.height = T * GR;
  const x = gc.getContext('2d')!;
  x.scale(GR, GR);
  x.fillStyle = g.base;
  x.fillRect(0, 0, T, T);
  const wrapped = (fn: (ox: number, oy: number) => void) => { for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) fn(ox, oy); };
  for (let i = 0; i < 26; i++) {
    const cx = rng.range(0, T), cy = rng.range(0, T), r = rng.range(6, 18), light = rng.chance(0.45);
    wrapped((ox, oy) => {
      const gr = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
      gr.addColorStop(0, light ? g.light : g.dark);
      gr.addColorStop(1, light ? g.light + '00' : g.dark + '00');
      x.globalAlpha = 0.45; x.fillStyle = gr; x.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2); x.globalAlpha = 1;
    });
  }
  x.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const px = rng.range(0, T), py = rng.range(0, T), len = rng.range(1, 2.4), lean = rng.range(-0.8, 0.8);
    x.strokeStyle = rng.chance(0.5) ? g.speck : g.dark;
    x.globalAlpha = 0.55;
    x.lineWidth = 0.45;
    wrapped((ox, oy) => { x.beginPath(); x.moveTo(px + ox, py + oy); x.lineTo(px + ox + lean, py + oy - len); x.stroke(); });
    x.globalAlpha = 1;
  }
  const ground = new Texture({ source: new CanvasSource({ resource: gc, resolution: GR, scaleMode: 'linear', addressMode: 'repeat' }) });

  const tex = a.textures();
  return {
    ground,
    decals: decals.map(tex),
    monsters: monsterRegions.map(tex),
    monsterIcons: monsterRegions.map((r) => a.icon(r)),
    props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.map(tex)])) as Record<PropKind, Texture[]>,
  };
}
