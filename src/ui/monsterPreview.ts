import * as THREE from 'three';
import { cloneActor, findClip, measure, model } from '../render/models';
import { areaFor } from '../sim/areas';

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
    if (m.isMesh) for (const x of Array.isArray(m.material) ? m.material : [m.material]) (x as THREE.MeshLambertMaterial).color?.multiplyScalar(1.35);
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

/** Draw every live portrait now (call right after the cards are re-rendered so they never blink). */
export function paintMonsterPortraits(): void {
  const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas.mon3d');
  if (!canvases.length) { cancelAnimationFrame(raf); raf = 0; return; }
  if (!setup()) return;
  const now = performance.now();
  const dt = Math.min(0.1, (now - (drawnAt || now)) / 1000);
  drawnAt = now;
  const ticked = new Set<string>();
  const r = renderer!, sc = scene!, cam = camera!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const c of canvases) {
    const key = c.dataset.model!;
    const p = build(key, c.dataset.fly === '1');
    if (!p) continue;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) continue;
    // Scrolled out of view (long lists): leave it until it comes back.
    const rect = c.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) continue;
    if (!ticked.has(key)) { ticked.add(key); p.mixer.update(dt); }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) r.setSize(w, h, false);
    cam.aspect = w / h;
    // Frame the 1-unit model with a little headroom, seen slightly from above.
    cam.position.set(0, 1.0, 2.9);
    cam.lookAt(0, 0.5, 0);
    cam.updateProjectionMatrix();
    p.obj.rotation.y = 0.45 + Math.sin(now / 1000 * 0.6 + p.phase) * 0.35;
    sc.add(p.obj);
    r.render(sc, cam);
    sc.remove(p.obj);
    const ctx = c.getContext('2d');
    if (!ctx) continue;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(r.domElement, 0, 0);
    c.parentElement?.classList.add('has3d');
  }
  if (!raf) { last = now; raf = requestAnimationFrame(loop); }
}

function loop(now: number): void {
  raf = requestAnimationFrame(loop);
  if (now - last < FRAME_MS - 2) return;
  last = now;
  paintMonsterPortraits();
}

/**
 * Markup for a monster portrait: the sprite with the live 3D model drawn over it. `cls` sizes the
 * slot; `unseen` shows it as a dark silhouette.
 */
export function monsterSlot(area: number, slot: number, sprite: string, cls: string, unseen = false): string {
  const fly = slot < 3 && areaFor(area).def.monsters[slot]?.shape === 'bat';
  const u = unseen ? ' unseen' : '';
  return `<span class="mon-slot ${cls}"><img alt="" src="${sprite}" class="${u}" /><canvas class="mon3d${u}" data-model="m${area % 6}_${slot}" data-fly="${fly ? 1 : 0}"></canvas></span>`;
}
