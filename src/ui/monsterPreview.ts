import * as THREE from 'three';
import { cloneActor, findClip, measure, model } from '../render/models';
import { areaFor, monsterModel } from '../sim/areas';
import { buildKitWeapon } from '../render/weapons3d';

/**
 * Live 3D portraits: any `<canvas class="mon3d" data-model="m0_1">` on the page shows that
 * monster's model playing its idle animation. One small shared WebGL renderer draws each portrait
 * in turn and copies it into its canvas, so a whole grid costs a single GL context. The loop runs
 * only while such canvases exist (it stops by itself when the sheet closes), at ~30 fps.
 *
 * The canvas sits over a fallback sprite; its portrait gets `has3d` once the model has drawn.
 */

interface Portrait { obj: THREE.Group; mixer: THREE.AnimationMixer; phase: number }

const FRAME_MS = 1000 / 30;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
const portraits = new Map<string, Portrait | null>();
let raf = 0;
let last = 0;
let drawnAt = 0;

function setup(): boolean {
  if (renderer) return true;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return false; // no WebGL to spare: the sprites stay
  }
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe4ecff, 0x3a4a7a, 2.3));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
  sun.position.set(-3, 6, 5);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  return true;
}

/** A normalised copy of a monster (fits a 1×1 box, feet at y = 0), idling. */
function build(key: string, fly: boolean): Portrait | null | undefined {
  if (portraits.has(key)) return portraits.get(key);
  const g = model(key);
  if (!g) return undefined; // still loading
  const inner = cloneActor(g);
  const dims = measure(inner);
  const k = 1 / Math.max(0.001, dims.h, dims.w * 0.85);
  inner.scale.setScalar(k);
  inner.position.set(-dims.cx * k, -dims.minY * k, -dims.cz * k);
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    // Same lift as on the battlefield: the packs' palettes are dark.
    if (m.isMesh && key.startsWith('m')) for (const x of Array.isArray(m.material) ? m.material : [m.material]) (x as THREE.MeshLambertMaterial).color?.multiplyScalar(1.35);
  });
  const obj = new THREE.Group();
  obj.add(inner);
  const mixer = new THREE.AnimationMixer(inner);
  const idle = findClip(g, fly ? ['Flying_Idle', 'Idle'] : ['Idle', 'Flying_Idle']);
  if (idle) mixer.clipAction(idle).play();
  const phase = Math.random() * 10;
  mixer.setTime(phase);
  const p = { obj, mixer, phase };
  portraits.set(key, p);
  return p;
}

// --- Weapons (forge inventory and weapon card) ---------------------------------------------

interface WeaponPortrait { obj: THREE.Group; phase: number }
const weapons = new Map<string, WeaponPortrait>();
let wcam: THREE.OrthographicCamera | null = null;

/** A weapon model, laid along the icon's diagonal and centred in a 2×2 box. Null while loading. */
function buildWeapon(form: number, rarity: number): WeaponPortrait | null {
  const key = `${form}|${rarity}`;
  const have = weapons.get(key);
  if (have) return have;
  const kit = buildKitWeapon(form, rarity);
  if (!kit) return null;
  const pose = new THREE.Group();
  pose.add(kit.group);
  const s0 = new THREE.Box3().setFromObject(kit.group).getSize(new THREE.Vector3());
  if (s0.z > s0.y && s0.z > s0.x) kit.group.rotation.x = -Math.PI / 2; // bows and crossbows point along z
  else if (s0.x > s0.y) kit.group.rotation.z = Math.PI / 2;
  if (kit.off) { kit.off.position.set(-0.3, -0.25, -0.2); pose.add(kit.off); }
  pose.rotation.z = -0.72;
  const outer = new THREE.Group();
  outer.add(pose);
  const box = new THREE.Box3().setFromObject(outer);
  const c = box.getCenter(new THREE.Vector3());
  const half = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2;
  pose.position.sub(c);
  outer.scale.setScalar(0.92 / Math.max(0.001, half));
  const w = { obj: new THREE.Group().add(outer) as THREE.Group, phase: Math.random() * 6 };
  weapons.set(key, w);
  return w;
}

/** Portraits smaller than this (CSS px; list icons) are redrawn every few frames, not every frame. */
const SMALL = 64;
/** Frames between redraws of a small portrait (staggered, so each frame draws a few). */
const SMALL_EVERY = 4;
let frameNo = 0;

/**
 * Size the shared renderer's drawing buffer to hold the biggest portrait (it only grows), so it
 * isn't reallocated for every canvas of a different size. Each portrait is drawn into the
 * bottom-left w×h corner (WebGL's origin) and copied from there.
 */
function fitBuffer(w: number, h: number): void {
  const r = renderer!;
  const size = r.getSize(new THREE.Vector2());
  if (size.x < w || size.y < h) r.setSize(Math.max(size.x, w), Math.max(size.y, h), false);
}

/** Render into the w×h corner and copy it onto canvas `c`. */
function blit(c: HTMLCanvasElement, w: number, h: number, draw: () => void): void {
  const r = renderer!;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  fitBuffer(w, h);
  const H = r.domElement.height;
  r.setViewport(0, 0, w, h);
  r.setScissor(0, 0, w, h);
  r.setScissorTest(true);
  draw();
  r.setScissorTest(false);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(r.domElement, 0, H - h, w, h, 0, 0, w, h);
  c.parentElement?.classList.add('has3d');
}

/** Draw every live portrait now (call right after the cards are re-rendered so they never blink). */
export function paintMonsterPortraits(force = true): void {
  const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas.mon3d, canvas.wpn3d');
  if (!canvases.length) { cancelAnimationFrame(raf); raf = 0; return; }
  if (!setup()) return;
  const now = performance.now();
  const dt = Math.min(0.1, (now - (drawnAt || now)) / 1000);
  drawnAt = now;
  frameNo++;
  const ticked = new Set<string>();
  const sc = scene!, cam = camera!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Read every canvas's size and place first (layout reads), then draw (no reads in between).
  const jobs: { c: HTMLCanvasElement; w: number; h: number; small: boolean; i: number }[] = [];
  canvases.forEach((c, i) => {
    const rect = c.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) return; // hidden or scrolled away
    jobs.push({ c, w: Math.round(rect.width * dpr), h: Math.round(rect.height * dpr), small: rect.width < SMALL, i });
  });
  for (const { c, w, h, small, i } of jobs) {
    // Small icons take turns; a fresh canvas (never drawn) is drawn straight away.
    if (!force && small && c.width && (frameNo + i) % SMALL_EVERY !== 0) continue;
    if (c.classList.contains('wpn3d')) { paintWeapon(c, w, h, now); continue; }
    const key = c.dataset.model!;
    const p = build(key, c.dataset.fly === '1');
    if (!p) continue;
    if (!ticked.has(key)) { ticked.add(key); p.mixer.update(dt); }
    blit(c, w, h, () => {
      cam.aspect = w / h;
      // Frame the 1-unit model with a little headroom, seen slightly from above.
      cam.position.set(0, 1.0, 2.9);
      cam.lookAt(0, 0.5, 0);
      cam.updateProjectionMatrix();
      p.obj.rotation.y = 0.45 + Math.sin(now / 1000 * 0.6 + p.phase) * 0.35;
      sc.add(p.obj);
      renderer!.render(sc, cam);
      sc.remove(p.obj);
    });
  }
  if (!raf) { last = now; raf = requestAnimationFrame(loop); }
}

function paintWeapon(c: HTMLCanvasElement, w: number, h: number, now: number): void {
  const form = Number(c.dataset.form), rarity = Number(c.dataset.rarity);
  const p = Number.isFinite(form) && Number.isFinite(rarity) ? buildWeapon(form, rarity) : null;
  if (!p) {
    // Not ready (or the slot emptied): show the drawn stand-in underneath.
    c.parentElement?.classList.remove('has3d');
    const ctx = c.getContext('2d');
    if (ctx && c.width) ctx.clearRect(0, 0, c.width, c.height);
    return;
  }
  const sc = scene!;
  if (!wcam) { wcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50); wcam.position.set(0, 0, 10); }
  blit(c, w, h, () => {
    const a = w / h;
    wcam!.left = -a; wcam!.right = a; wcam!.top = 1; wcam!.bottom = -1;
    wcam!.updateProjectionMatrix();
    // A slow sway so the model reads as 3D without going edge-on.
    p.obj.rotation.y = Math.sin(now / 1000 * 0.9 + p.phase) * 0.55;
    sc.add(p.obj);
    renderer!.render(sc, wcam!);
    sc.remove(p.obj);
  });
}

/**
 * A still portrait of a monster's 3D model (`m<area>_<slot>`), size×size pixels, drawn once and
 * cached: for places that paint onto their own canvas (the World Map's haunt markers). Null until
 * the model has loaded (callers just try again on their next draw).
 */
const snapshots = new Map<string, HTMLCanvasElement>();
export function monsterSnapshot(area: number, slot: number, size = 96): HTMLCanvasElement | null {
  const key = monsterModel(area, slot);
  const have = snapshots.get(`${key}|${size}`);
  if (have) return have;
  if (!setup()) return null;
  const fly = slot < 3 && areaFor(area).def.monsters[slot]?.shape === 'bat';
  const p = build(key, fly);
  if (!p) return null;
  const sc = scene!, cam = camera!;
  const rot = p.obj.rotation.y;
  p.obj.rotation.y = 0.5;
  // Frame the monster as it actually stands in its idle pose (flyers hover well above the ground).
  p.obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(p.obj, true);
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const span = Math.max(sz.x, sz.y, sz.z * 0.8, 0.3);
  const dist = (span * 0.62) / Math.tan((cam.fov * Math.PI) / 360);
  const out = document.createElement('canvas');
  blit(out, size, size, () => {
    cam.aspect = 1;
    cam.position.set(c.x, c.y + dist * 0.28, c.z + dist);
    cam.lookAt(c.x, c.y, c.z);
    cam.updateProjectionMatrix();
    sc.add(p.obj);
    renderer!.render(sc, cam);
    sc.remove(p.obj);
  });
  p.obj.rotation.y = rot;
  snapshots.set(`${key}|${size}`, out);
  return out;
}

function loop(now: number): void {
  raf = requestAnimationFrame(loop);
  if (now - last < FRAME_MS - 2) return;
  last = now;
  paintMonsterPortraits(false);
}

/**
 * Markup for a monster portrait: the sprite with the live 3D model drawn over it. `cls` sizes the
 * slot; `unseen` shows it as a dark silhouette.
 */
export function monsterSlot(area: number, slot: number, sprite: string, cls: string, unseen = false): string {
  const fly = slot < 3 && areaFor(area).def.monsters[slot]?.shape === 'bat';
  const u = unseen ? ' unseen' : '';
  return `<span class="mon-slot ${cls}"><img alt="" src="${sprite}" class="${u}" /><canvas class="mon3d${u}" data-model="${monsterModel(area, slot)}" data-fly="${fly ? 1 : 0}"></canvas></span>`;
}
