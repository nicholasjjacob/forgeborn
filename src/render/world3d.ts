import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { areaFor, type PropKind } from '../sim/areas';
import { MAP_H, MAP_W, type GameMap } from '../sim/map';
import { ELITE, MAX_ENEMIES, MAX_SHOTS, SLAM_RADIUS, SLAM_WIND, STYLE_DASHER, type Enemy, type Sim } from '../sim/sim';
import { MAX_PICKUPS } from '../sim/gather';
import { FORMS } from '../sim/weapons';
import { cloneActor, findClip, loadModel, measure, model } from './models';

/**
 * The 3D battlefield (Three.js). Game coordinates map straight onto the ground plane:
 * game x → three x, game y → three z, height → three y, 1 game unit = 1 three unit
 * (the hero is ~17 units tall). The camera looks down from the south at a fixed angle, so
 * "up" on screen is still smaller y, as in the sim. Owns no game rules: it only mirrors the sim.
 */

const FOV = 30;
const PITCH = (47 * Math.PI) / 180;    // camera angle down from the horizon
const VIEW_W = 108;                    // keep about this many units across the screen…
const VIEW_H = 90;                     // …and at least this many vertically
const CHUNK = 160;                     // props are instanced per chunk so off-screen chunks are culled
const HERO_H = 17;
const SWING_TIME = 0.22;

/** Monster heights (world units) by body shape; bosses use their own big models. */
const SHAPE_H: Record<string, number> = { blob: 9, bat: 7, husk: 12, beetle: 10, golem: 14, imp: 13, spider: 9 };
const BOSS_H = 27;

interface PropSpec { models: string[]; size: number; by: 'h' | 'w'; shadow: boolean }
const PROP_SPECS: Record<PropKind, PropSpec> = {
  tree: { models: ['tree_0', 'tree_1', 'tree_2', 'tree_3'], size: 40, by: 'h', shadow: true },
  pine: { models: ['pine_0', 'pine_1', 'pine_2', 'pine_3'], size: 44, by: 'h', shadow: true },
  deadtree: { models: ['deadtree_0', 'deadtree_1', 'deadtree_2', 'deadtree_3'], size: 30, by: 'h', shadow: true },
  rock: { models: ['rock_0', 'rock_1', 'rock_2'], size: 15, by: 'w', shadow: true },
  bush: { models: ['bush_0', 'bush_1'], size: 15, by: 'w', shadow: true },
  shroom: { models: ['shroom_0', 'shroom_1'], size: 9, by: 'h', shadow: true },
  cactus: { models: ['@cactus'], size: 22, by: 'h', shadow: true },
  crystal: { models: ['@crystal'], size: 15, by: 'h', shadow: true },
};

/** Ground cover per terrain: [model, weight, size (height)]. */
const COVER: [string, number, number][][] = [
  [['grass_0', 5, 4], ['grass_1', 4, 5], ['flower_0', 2, 5], ['flower_1', 1, 5]],
  [['fern_0', 3, 7], ['grass_1', 4, 5], ['grass_2', 3, 6], ['shroom_0', 1, 3]],
  [['pebble_0', 3, 1.6], ['pebble_1', 3, 1.4], ['grass_1', 1, 4]],
  [['pebble_0', 3, 1.6], ['pebble_1', 3, 1.4], ['shroom_0', 1, 3]],
  [['pebble_0', 3, 1.6], ['pebble_1', 3, 1.4], ['grass_1', 1, 4]],
  [['pebble_0', 3, 1.6], ['pebble_1', 3, 1.4]],
];

/** Per-terrain tint for scenery and lighting. */
interface AreaLook { propTint: number; coverTint: number; sky: number; ground: number; sun: number; sunI: number; hemiI: number; crystal: number; rockTint: number }
const LOOKS: AreaLook[] = [
  { propTint: 0xffffff, coverTint: 0xffffff, sky: 0xd8ecff, ground: 0x6a8a4a, sun: 0xfff0d8, sunI: 2.4, hemiI: 1.5, crystal: 0x8ad8ff, rockTint: 0xffffff },
  { propTint: 0xa8c098, coverTint: 0x9ab88a, sky: 0xb8c8c0, ground: 0x34402c, sun: 0xe8f0d0, sunI: 1.9, hemiI: 1.4, crystal: 0x9cff5a, rockTint: 0x9aa890 },
  { propTint: 0xffe8c0, coverTint: 0xe8d8a0, sky: 0xfff0d8, ground: 0xa08050, sun: 0xffe6b8, sunI: 2.7, hemiI: 1.5, crystal: 0xffd06a, rockTint: 0xf0c890 },
  { propTint: 0xc8c0e8, coverTint: 0xb8b0d8, sky: 0x9890c0, ground: 0x302848, sun: 0xd8d0ff, sunI: 1.7, hemiI: 1.6, crystal: 0x7af0ff, rockTint: 0xa8a0c8 },
  { propTint: 0xe8f4ff, coverTint: 0xf0f8ff, sky: 0xe8f4ff, ground: 0x8aa0c0, sun: 0xf8fbff, sunI: 2.2, hemiI: 1.7, crystal: 0x9ad8ff, rockTint: 0xe0ecf8 },
  { propTint: 0x907070, coverTint: 0x806060, sky: 0xffb090, ground: 0x401818, sun: 0xffc090, sunI: 2.0, hemiI: 1.3, crystal: 0xff7a2a, rockTint: 0x6a5a58 },
];

/** Start loading everything a terrain needs (hero, its monsters, scenery); resolves when done. */
export function preloadArea(area: number): Promise<unknown> {
  const names = new Set<string>(['hero']);
  for (let i = 0; i < 4; i++) names.add(`m${area % 6}_${i}`);
  for (const p of areaFor(area).def.props) for (const n of PROP_SPECS[p.kind].models) if (!n.startsWith('@')) names.add(n);
  for (const [n] of COVER[area % COVER.length]) names.add(n);
  return Promise.all([...names].map((n) => loadModel(n).catch(() => null)));
}

const RARITY_METAL = [0xc8ccd8, 0x5aa8ff, 0xb87cff, 0xffc040];

interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; m: THREE.Matrix4 }

interface Actor {
  key: string;
  obj: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction | null;
  move: THREE.AnimationAction | null;
  attack: THREE.AnimationAction | null;
  death: THREE.AnimationAction | null;
  hit: THREE.AnimationAction | null;
  cur: THREE.AnimationAction | null;
  base: number;   // scale that makes the model its target height
  h: number;      // target height
  mats: THREE.MeshLambertMaterial[];
  flash: number;  // emissive currently applied (to skip redundant writes)
}

interface Slot {
  actor: Actor | null;
  alive: boolean;
  lunge: number;
  yaw: number;
  aura: THREE.Mesh;
  slam: THREE.Mesh; slamIn: THREE.Mesh; slamEdge: THREE.Mesh;
  lane: THREE.Mesh;
}

interface Corpse { actor: Actor; t: number; scale: number }

interface PropRef { meshes: THREE.InstancedMesh[]; index: number; parts: Part[]; x: number; y: number; rot: number; s: number }

export class World3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 20, 2600);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1.5);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private readonly frustum = new THREE.Frustum();
  private readonly projM = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 20);
  private readonly ray = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private w = 1;
  private h = 1;
  private dist = 500;
  /** Screen pixels per world unit at the camera's focus point. */
  pxPerUnit = 2;
  /** Visible ground half-width/half-depth around the focus (for camera clamping). */
  halfW = 70;
  halfD = 140;

  private readonly groundGroup = new THREE.Group();
  private readonly propGroup = new THREE.Group();
  private builtMap: GameMap | null = null;
  private mapPending = false;
  private propRefs: (PropRef | null)[] = [];
  private readonly shaking = new Map<number, number>();
  private readonly partCache = new Map<string, Part[]>();
  private readonly tintCache = new Map<string, THREE.Material>();

  // Hero
  private readonly heroRoot = new THREE.Group();
  private heroMixer: THREE.AnimationMixer | null = null;
  private heroAct: Record<'idle' | 'run' | 'attack' | 'death' | 'walk', THREE.AnimationAction | null> = { idle: null, run: null, attack: null, death: null, walk: null };
  private heroCur: THREE.AnimationAction | null = null;
  private heroMats: THREE.MeshLambertMaterial[] = [];
  private heroYaw = 0;
  private heroSwing = 0;
  private heroDead = false;
  private readonly hand = new THREE.Group();  // weapon holder, in world units
  private weaponKey = '';
  private readonly slash: THREE.Mesh;

  // Monsters
  private readonly slots: Slot[] = [];
  private readonly pools = new Map<string, Actor[]>();
  private readonly corpses: Corpse[] = [];
  private readonly shotMeshes: THREE.Mesh[] = [];
  private readonly pickupMeshes: { wood: THREE.Mesh; stone: THREE.Mesh }[] = [];
  private area = -1;

  private low = false;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.canvas = this.renderer.domElement;
    host.prepend(this.canvas);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene.add(this.hemi, this.sun, this.sun.target, this.groundGroup, this.propGroup, this.heroRoot);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.sun.shadow.radius = 3;

    // Hero slash arc: a flat crescent on the ground that sweeps with the swing.
    const sg = new THREE.RingGeometry(7, 22, 20, 1, -1, 2);
    sg.rotateX(-Math.PI / 2);
    this.slash = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.slash.visible = false;
    this.slash.renderOrder = 2;
    this.scene.add(this.slash);

    void loadModel('hero').then((g) => this.setupHero(g)).catch(() => {});

    // Per-enemy ground markers: elite aura, slam circles, dash lane.
    const flat = (geo: THREE.BufferGeometry, color: number, opacity: number, add = false) => {
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false,
        blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      m.visible = false;
      m.renderOrder = 1;
      this.scene.add(m);
      return m;
    };
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const lane = new THREE.PlaneGeometry(1, 1);
      lane.translate(0.5, 0, 0); // starts at the monster, extends along +x
      this.slots.push({
        actor: null, alive: false, lunge: 0, yaw: 0,
        aura: flat(new THREE.RingGeometry(0.55, 1, 32), 0xffc83a, 0.6, true),
        slam: flat(new THREE.CircleGeometry(1, 40), 0xff3a2a, 0.2),
        slamIn: flat(new THREE.CircleGeometry(1, 40), 0xff3a2a, 0.25),
        slamEdge: flat(new THREE.RingGeometry(0.96, 1, 48), 0xff6a3a, 0.8),
        lane: flat(lane, 0xff3a2a, 0.25),
      });
    }

    const shotGeo = new THREE.SphereGeometry(1.7, 10, 8);
    for (let i = 0; i < MAX_SHOTS; i++) {
      const m = new THREE.Mesh(shotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.visible = false;
      this.scene.add(m);
      this.shotMeshes.push(m);
    }

    const logGeo = new THREE.CylinderGeometry(1, 1, 5.5, 7);
    logGeo.rotateZ(Math.PI / 2);
    const logMat = new THREE.MeshLambertMaterial({ color: 0xa06a3a });
    const stoneGeo = new THREE.DodecahedronGeometry(2, 0);
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xb0b8c4, flatShading: true });
    for (let i = 0; i < MAX_PICKUPS; i++) {
      const wood = new THREE.Mesh(logGeo, logMat);
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      wood.castShadow = stone.castShadow = true;
      wood.visible = stone.visible = false;
      this.scene.add(wood, stone);
      this.pickupMeshes.push({ wood, stone });
    }
  }

  setLow(low: boolean): void {
    this.low = low;
    this.sun.castShadow = !low;
    this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.w, this.h, false);
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    this.renderer.setSize(this.w, this.h, false);
    const aspect = this.w / this.h;
    this.camera.aspect = aspect;
    const tan = Math.tan((FOV * Math.PI) / 360);
    // Visible width at the focus point: as wide as the old 2D view, or more on wide screens.
    const viewW = Math.max(VIEW_W, VIEW_H * aspect);
    this.dist = viewW / (2 * tan * aspect);
    this.pxPerUnit = this.h / (2 * this.dist * tan);
    this.halfW = viewW / 2;
    this.halfD = (this.dist * tan) / Math.sin(PITCH);
    this.camera.near = this.dist * 0.3;
    this.camera.far = this.dist * 3;
    this.camera.updateProjectionMatrix();
    const s = this.sun.shadow.camera;
    const r = Math.max(this.halfW, this.halfD) * 1.25;
    s.left = -r; s.right = r; s.top = r; s.bottom = -r; s.near = 10; s.far = 900;
    s.updateProjectionMatrix();
  }

  /** Point the camera at a spot on the ground (plus shake). */
  setCamera(x: number, y: number): void {
    const c = this.camera;
    c.position.set(x, Math.sin(PITCH) * this.dist, y + Math.cos(PITCH) * this.dist);
    c.lookAt(x, 0, y);
    c.updateMatrixWorld();
    this.sun.position.set(x - 120, 260, y + 90);
    this.sun.target.position.set(x, 0, y);
    this.projM.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projM);
  }

  /** World point (game x, height, game y) → canvas CSS pixels. */
  project(x: number, height: number, y: number, out: { x: number; y: number }): void {
    this.v.set(x, height, y).project(this.camera);
    out.x = (this.v.x + 1) * 0.5 * this.w;
    out.y = (1 - this.v.y) * 0.5 * this.h;
  }

  /** Canvas CSS pixels → the game-space point on the ground under them. */
  screenToGround(sx: number, sy: number, out: { x: number; y: number }): void {
    this.ray.setFromCamera(new THREE.Vector2((sx / this.w) * 2 - 1, 1 - (sy / this.h) * 2), this.camera);
    const p = this.ray.ray.intersectPlane(this.groundPlane, this.v);
    if (p) { out.x = p.x; out.y = p.z; }
  }

  inView(x: number, y: number, r = 20): boolean {
    this.sphere.center.set(x, r * 0.5, y);
    this.sphere.radius = r;
    return this.frustum.intersectsSphere(this.sphere);
  }

  // --- Map ---------------------------------------------------------------------------------

  /** Rebuild ground, scenery and lighting when the sim's map changes (or its models arrive). */
  syncMap(map: GameMap): boolean {
    if (map === this.builtMap && !this.mapPending) return false;
    const changed = map !== this.builtMap;
    if (map.area !== this.area) this.setArea(map.area);
    // Wait (a frame at a time) for this terrain's scenery models; the ground shows meanwhile.
    const names = new Set<string>();
    for (const p of areaFor(map.area).def.props) for (const n of PROP_SPECS[p.kind].models) if (!n.startsWith('@')) names.add(n);
    for (const [n] of COVER[map.area % COVER.length]) names.add(n);
    let missing = false;
    for (const n of names) if (!model(n)) missing = true;
    if (changed) this.buildGround(map);
    this.builtMap = map;
    this.mapPending = missing;
    if (!missing) this.buildProps(map);
    return changed;
  }

  private setArea(area: number): void {
    this.area = area;
    // Drop the previous terrain's monsters; preload this one's.
    for (const s of this.slots) if (s.actor) { this.release(s.actor); s.actor = null; }
    for (const c of this.corpses) this.release(c.actor);
    this.corpses.length = 0;
    for (const [, list] of this.pools) for (const a of list) a.obj.removeFromParent();
    this.pools.clear();
    for (let i = 0; i < 4; i++) void loadModel(`m${area % 6}_${i}`).catch(() => {});
  }

  private buildGround(map: GameMap): void {
    for (const c of this.groundGroup.children) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      const mat = m.material as THREE.MeshLambertMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.groundGroup.clear();
    const { def } = areaFor(map.area);
    const look = LOOKS[map.area % LOOKS.length];
    const tex = groundTexture(def.ground);
    tex.repeat.set(MAP_W / 90, MAP_H / 90);
    const tint = new THREE.Color(map.tint);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), new THREE.MeshLambertMaterial({ map: tex, color: tint }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(MAP_W / 2, 0, MAP_H / 2);
    ground.receiveShadow = true;
    // Beyond the map edge: darker ground fading into fog, so there's never a hard void.
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W * 4, MAP_H * 4), new THREE.MeshLambertMaterial({ map: tex.clone(), color: new THREE.Color(def.void).lerp(tint, 0.25) }));
    (outer.material as THREE.MeshLambertMaterial).map!.repeat.set((MAP_W * 4) / 90, (MAP_H * 4) / 90);
    (outer.material as THREE.MeshLambertMaterial).map!.needsUpdate = true;
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(MAP_W / 2, -0.2, MAP_H / 2);
    outer.receiveShadow = true;
    this.groundGroup.add(ground, outer);

    // Light: terrain look × the zone's time of day.
    const sunCol = new THREE.Color(look.sun).multiply(tint);
    this.sun.color.copy(sunCol);
    this.sun.intensity = look.sunI;
    this.hemi.color.set(look.sky).multiply(tint);
    this.hemi.groundColor.set(look.ground);
    this.hemi.intensity = look.hemiI;
    const fogCol = new THREE.Color(def.void).lerp(new THREE.Color(look.sky), 0.15);
    this.scene.background = fogCol;
    this.scene.fog = new THREE.Fog(fogCol, this.dist * 1.05, this.dist * 1.9);
  }

  private buildProps(map: GameMap): void {
    for (const c of this.propGroup.children) (c as THREE.InstancedMesh).dispose();
    this.propGroup.clear();
    this.shaking.clear();
    const look = LOOKS[map.area % LOOKS.length];
    const groups = new Map<string, { parts: Part[]; shadow: boolean; items: { idx: number; m: THREE.Matrix4; x: number; y: number; rot: number; s: number }[] }>();
    const add = (name: string, parts: Part[], shadow: boolean, idx: number, x: number, y: number, rot: number, s: number) => {
      const key = `${name}|${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
      let g = groups.get(key);
      if (!g) { g = { parts, shadow, items: [] }; groups.set(key, g); }
      g.items.push({ idx, m: propMatrix(x, y, rot, s), x, y, rot, s });
    };

    map.props.forEach((p, i) => {
      const spec = PROP_SPECS[p.kind];
      const name = spec.models[(p.variant + Math.floor(p.x * 7 + p.y * 13)) % spec.models.length];
      const parts = this.parts(name, spec, p.kind === 'rock' ? look.rockTint : p.kind === 'crystal' ? look.crystal : look.propTint, map.area);
      if (!parts) return;
      const h = hash(p.x, p.y);
      add(name, parts, spec.shadow, i, p.x, p.y, h * Math.PI * 2, 0.85 + 0.3 * hash(p.y, p.x));
    });

    const cover = COVER[map.area % COVER.length];
    const total = cover.reduce((s, c) => s + c[1], 0);
    const n = this.low ? Math.floor(map.decals.length * 0.6) : map.decals.length;
    for (let i = 0; i < n; i++) {
      const d = map.decals[i];
      let r = hash(d.x, d.y) * total, pick = cover[0];
      for (const c of cover) { if ((r -= c[1]) < 0) { pick = c; break; } }
      const parts = this.parts(pick[0], { models: [], size: pick[2], by: 'h', shadow: false }, look.coverTint, map.area);
      if (!parts) continue;
      add(pick[0], parts, false, -1, d.x, d.y, hash(d.y, d.x) * 6.28, 0.8 + 0.4 * hash(d.x + 1, d.y));
    }

    this.propRefs = map.props.map(() => null);
    for (const g of groups.values()) {
      const meshes: THREE.InstancedMesh[] = [];
      for (const part of g.parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, g.items.length);
        const tmp = new THREE.Matrix4();
        g.items.forEach((it, k) => im.setMatrixAt(k, tmp.multiplyMatrices(it.m, part.m)));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = g.shadow && !this.low;
        im.receiveShadow = false;
        this.propGroup.add(im);
        meshes.push(im);
      }
      g.items.forEach((it, k) => {
        if (it.idx >= 0) this.propRefs[it.idx] = { meshes, index: k, parts: g.parts, x: it.x, y: it.y, rot: it.rot, s: it.s };
      });
    }
  }

  /** Mesh parts of a scenery model, normalised to its target size and tinted for the terrain. */
  private parts(name: string, spec: PropSpec, tint: number, area: number): Part[] | null {
    const key = `${name}|${spec.size}|${tint}|${area}`;
    const hit = this.partCache.get(key);
    if (hit) return hit;
    let src: THREE.Object3D;
    if (name === '@cactus') src = cactusModel();
    else if (name === '@crystal') src = crystalModel(tint);
    else {
      const g = model(name);
      if (!g) return null;
      src = g.scene;
    }
    const dims = measure(src);
    const k = spec.size / (spec.by === 'h' ? dims.h : dims.w);
    const norm = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-dims.cx, -dims.minY, -dims.cz));
    const out: Part[] = [];
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const mat = name.startsWith('@') ? mats[0] : this.tinted(mats[0], tint);
      out.push({ geo: m.geometry, mat, m: norm.clone().multiply(m.matrixWorld) });
    });
    this.partCache.set(key, out);
    return out;
  }

  private tinted(mat: THREE.Material, tint: number): THREE.Material {
    if (tint === 0xffffff) return mat;
    const key = mat.uuid + tint;
    let t = this.tintCache.get(key);
    if (!t) {
      t = mat.clone();
      (t as THREE.MeshLambertMaterial).color.multiply(new THREE.Color(tint));
      this.tintCache.set(key, t);
    }
    return t;
  }

  /** A tree or rock that was just chopped/mined shakes for a moment. */
  chop(propIndex: number): void {
    if (this.propRefs[propIndex]) this.shaking.set(propIndex, 0.3);
  }

  // --- Actors ------------------------------------------------------------------------------

  private setupHero(g: GLTF): void {
    const m = g.scene;
    const dims = measure(m);
    const k = HERO_H / dims.h;
    m.scale.setScalar(k);
    m.position.set(-dims.cx * k, -dims.minY * k, -dims.cz * k);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.heroMats.push(mat as THREE.MeshLambertMaterial);
    });
    this.heroRoot.add(m);
    const mixer = new THREE.AnimationMixer(m);
    this.heroMixer = mixer;
    const act = (names: string[]) => { const c = findClip(g, names); return c ? mixer.clipAction(c) : null; };
    this.heroAct = {
      idle: act(['Idle_swordRight', 'Idle']),
      run: act(['Run_swordRight', 'Run']),
      attack: act(['Run_swordAttack', 'swordAttack']),
      death: act(['Death']),
      walk: act(['Walking']),
    };
    if (this.heroAct.attack) { this.heroAct.attack.setLoop(THREE.LoopOnce, 1); this.heroAct.attack.clampWhenFinished = true; }
    if (this.heroAct.death) { this.heroAct.death.setLoop(THREE.LoopOnce, 1); this.heroAct.death.clampWhenFinished = true; }
    this.heroPlay(this.heroAct.idle, 0);
    // Weapon goes in the right hand. The holder cancels the bone's scale so weapons are built in world units.
    const bone = findBone(m, ['PalmR', 'Palm.R', 'Palm_R', 'MiddleHandR', 'LowerArmR']);
    if (bone) {
      bone.add(this.hand);
      m.updateMatrixWorld(true);
      const s = new THREE.Vector3();
      bone.getWorldScale(s);
      this.hand.scale.setScalar(0.75 / s.x);
      // Grip along the fist: the blade points up and a little forward in the idle pose.
      this.hand.rotation.set(0, 0, 1.0);
    }
    // A brighter, bluer steel than the source model's flat grey, so the hero reads at a glance.
    for (const m of this.heroMats) {
      if (m.name === 'Armor') m.color.setHex(0xa8b4d0);
      else if (m.name === 'Boots') m.color.setHex(0x6a4a34);
    }
  }

  private heroPlay(a: THREE.AnimationAction | null, fade = 0.15, restart = false): void {
    if (!a || (a === this.heroCur && !restart)) return;
    a.reset().setEffectiveWeight(1).play();
    if (this.heroCur && this.heroCur !== a) this.heroCur.crossFadeTo(a, fade, false);
    this.heroCur = a;
  }

  private setWeapon(form: number, rarity: number): void {
    const key = `${form}|${rarity}`;
    if (key === this.weaponKey) return;
    this.weaponKey = key;
    for (const c of this.hand.children) (c as THREE.Mesh).geometry?.dispose();
    this.hand.clear();
    this.hand.add(weaponModel(form, rarity));
  }

  private acquire(key: string, flying: boolean): Actor | null {
    const pool = this.pools.get(key);
    const a = pool?.pop();
    if (a) { a.obj.visible = true; return a; }
    const g = model(key);
    if (!g) return null;
    const obj = cloneActor(g);
    const dims = measure(obj);
    const inner = new THREE.Group();
    inner.add(obj);
    obj.position.set(-dims.cx, -dims.minY, -dims.cz);
    const mixer = new THREE.AnimationMixer(obj);
    const act = (names: string[], once = false) => {
      const c = findClip(g, names);
      if (!c) return null;
      const x = mixer.clipAction(c);
      if (once) { x.setLoop(THREE.LoopOnce, 1); x.clampWhenFinished = true; }
      return x;
    };
    const mats: THREE.MeshLambertMaterial[] = [];
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.push(x as THREE.MeshLambertMaterial);
    });
    const actor: Actor = {
      key, obj: inner, mixer, mats, flash: -1, cur: null,
      idle: act(flying ? ['Flying_Idle', 'Idle'] : ['Idle', 'Flying_Idle']),
      move: act(flying ? ['Fast_Flying', 'Flying_Idle', 'Walk'] : ['Walk', 'Run', 'Fast_Flying']),
      attack: act(['Bite_Front', 'Punch', 'Headbutt', 'Weapon'], true),
      death: act(['Death'], true),
      hit: act(['HitRecieve', 'HitReact'], true),
      base: 1 / Math.max(0.001, dims.h), h: 1,
    };
    this.scene.add(inner);
    return actor;
  }

  private release(a: Actor): void {
    a.obj.visible = false;
    a.mixer.stopAllAction();
    a.cur = null;
    let pool = this.pools.get(a.key);
    if (!pool) { pool = []; this.pools.set(a.key, pool); }
    pool.push(a);
  }

  private play(a: Actor, x: THREE.AnimationAction | null, fade = 0.15, restart = false): void {
    if (!x) return;
    if (x === a.cur && !restart) return;
    x.reset().setEffectiveWeight(1).play();
    if (a.cur && a.cur !== x) a.cur.crossFadeTo(x, fade, false);
    a.cur = x;
  }

  /** Height of an enemy's model top (world units), for bars and markers drawn over it. */
  enemyTop(i: number, e: Enemy): number {
    const s = this.slots[i];
    const sizeK = (e.elite ? ELITE.scale : 1) * (e.boss && e.monster !== 3 ? 2 : 1);
    return (s.actor ? s.actor.h : e.boss ? BOSS_H : 10) * sizeK + (this.flying(e) ? 6 : 0);
  }

  private flying(e: Enemy): boolean {
    return areaFor(this.area).def.monsters[e.monster]?.shape === 'bat' && !e.boss;
  }

  // --- Per frame -----------------------------------------------------------------------------

  update(sim: Sim, alpha: number, dt: number, t: number): void {
    const h = sim.hero;
    const hx = h.prevX + (h.x - h.prevX) * alpha;
    const hy = h.prevY + (h.y - h.prevY) * alpha;
    const dead = sim.phase === 'dead';

    // Shaking scenery
    for (const [idx, left] of this.shaking) {
      const ref = this.propRefs[idx];
      const nl = left - dt;
      const tilt = nl > 0 ? Math.sin(nl * 60) * 0.06 * (nl / 0.3) : 0;
      if (ref) {
        const m = propMatrix(ref.x, ref.y, ref.rot, ref.s, tilt);
        const tmp = new THREE.Matrix4();
        ref.meshes.forEach((im, k) => { im.setMatrixAt(ref.index, tmp.multiplyMatrices(m, ref.parts[k].m)); im.instanceMatrix.needsUpdate = true; });
      }
      if (nl <= 0) this.shaking.delete(idx); else this.shaking.set(idx, nl);
    }

    // Hero
    this.heroRoot.position.set(hx, 0, hy);
    const mvx = h.x - h.prevX, mvy = h.y - h.prevY;
    let want = this.heroYaw;
    if (h.swingT > 0) want = Math.atan2(Math.cos(h.swingAngle), Math.sin(h.swingAngle));
    else if (h.moving && Math.abs(mvx) + Math.abs(mvy) > 0.01) want = Math.atan2(mvx, mvy);
    this.heroYaw = turn(this.heroYaw, want, dt * (h.swingT > 0 ? 30 : 14));
    this.heroRoot.rotation.y = this.heroYaw;
    const eq = sim.save.equipped;
    this.setWeapon(eq?.form ?? 0, eq?.rarity ?? 0);
    if (this.heroMixer) {
      if (dead) {
        if (!this.heroDead) this.heroPlay(this.heroAct.death, 0.1, true);
      } else if (h.swingT > this.heroSwing + 0.01) {
        // A new swing started: play the slash, sped up to fit the swing.
        this.heroPlay(this.heroAct.attack, 0.05, true);
        if (this.heroAct.attack) this.heroAct.attack.timeScale = 2.6;
      } else if (this.heroCur === this.heroAct.attack && this.heroAct.attack && this.heroAct.attack.time < this.heroAct.attack.getClip().duration * 0.75) {
        // let the slash finish
      } else {
        this.heroPlay(h.moving ? this.heroAct.run : this.heroAct.idle, 0.18);
        if (this.heroAct.run) this.heroAct.run.timeScale = 1.25;
      }
      this.heroMixer.update(dt);
    }
    this.heroDead = dead;
    this.heroSwing = h.swingT;
    const heroFlash = h.hitT > 0 ? 0x902020 : 0;
    for (const m of this.heroMats) m.emissive.setHex(heroFlash);

    // Slash arc
    if (h.swingT > 0 && !dead) {
      const p = 1 - h.swingT / SWING_TIME;
      const form = FORMS[eq?.form ?? 0];
      this.slash.visible = true;
      this.slash.position.set(hx, 5, hy);
      this.slash.rotation.y = -h.swingAngle;
      const s = form.range / 22;
      this.slash.scale.set(s * (0.9 + p * 0.2), 1, s * (0.9 + p * 0.2) * (form.arc / 1.25));
      (this.slash.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - p);
      (this.slash.material as THREE.MeshBasicMaterial).color.setHex(RARITY_METAL[eq?.rarity ?? 0]);
    } else this.slash.visible = false;

    // Monsters
    const def = areaFor(this.area).def;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = sim.enemies[i], s = this.slots[i];
      if (!e.alive) {
        if (s.actor) {
          if (s.alive) this.corpses.push({ actor: s.actor, t: 0, scale: s.actor.obj.scale.x });
          else this.release(s.actor);
          s.actor = null;
        }
        s.alive = false;
        s.aura.visible = s.slam.visible = s.slamIn.visible = s.slamEdge.visible = s.lane.visible = false;
        continue;
      }
      const key = `m${this.area % 6}_${e.monster}`;
      const fly = def.monsters[e.monster]?.shape === 'bat' && !e.boss;
      if (s.actor && s.actor.key !== key) { this.release(s.actor); s.actor = null; }
      if (!s.actor) {
        s.actor = this.acquire(key, fly);
        if (s.actor) {
          const target = e.monster === 3 ? BOSS_H : SHAPE_H[def.monsters[e.monster]?.shape ?? 'blob'] ?? 10;
          s.actor.h = target;
          this.play(s.actor, s.actor.idle, 0);
          s.actor.mixer.setTime(e.seed * 3);
        }
      }
      s.alive = true;
      const x = e.prevX + (e.x - e.prevX) * alpha;
      const y = e.prevY + (e.y - e.prevY) * alpha;
      const vis = this.inView(x, y, 30);
      const a = s.actor;
      if (a) a.obj.visible = vis;
      this.markers(e, s, x, y, t);
      if (!a || !vis) { s.lunge = e.lungeT; continue; }

      // Lunge toward the hero when attacking; tremble while winding up a skill.
      let lx = 0, ly = 0;
      const tx = hx - x, ty = hy - y, td = Math.hypot(tx, ty) || 1;
      if (e.lungeT > 0) {
        const amt = Math.sin((e.lungeT / 0.18) * Math.PI) * 4;
        lx = (tx / td) * amt; ly = (ty / td) * amt;
      }
      const shake = e.windT > 0 ? Math.sin(t * 70 + e.seed) * 0.6 : 0;
      const hover = fly ? 5 + Math.sin(t * 4 + e.seed) * 1.2 : 0;
      a.obj.position.set(x + lx + shake, hover, y + ly);
      const sizeK = (e.elite ? ELITE.scale : 1) * (e.boss && e.monster !== 3 ? 2 : 1);
      const spawnK = e.spawnT > 0 ? 1 - e.spawnT / 0.35 : 1;
      a.obj.scale.setScalar(a.base * a.h * sizeK * Math.max(0.05, spawnK));
      // Face the hero when close or attacking; otherwise face where it's going.
      const mx = e.x - e.prevX, my = e.y - e.prevY;
      const moving = Math.abs(mx) + Math.abs(my) > 0.05;
      const yawWant = !moving || td < 40 || e.lungeT > 0 || e.windT > 0
        ? Math.atan2(tx, ty) : Math.atan2(mx, my);
      s.yaw = turn(s.yaw, e.dashT > 0 ? Math.atan2(e.dirX, e.dirY) : yawWant, dt * 10);
      a.obj.rotation.y = s.yaw;
      // Animation
      if (e.lungeT > s.lunge + 0.01 || (e.windT > 0 && a.cur !== a.attack)) {
        this.play(a, a.attack, 0.05, true);
        if (a.attack) a.attack.timeScale = e.windT > 0 ? 0.6 : 1.8;
      } else if (a.cur === a.attack && a.attack && a.attack.time < a.attack.getClip().duration * 0.8 && e.windT <= 0) {
        // finish the bite
      } else if (e.dashT > 0) {
        this.play(a, a.move ?? a.idle, 0.1);
        if (a.move) a.move.timeScale = 2.2;
      } else {
        this.play(a, moving ? (a.move ?? a.idle) : a.idle, 0.2);
        if (a.move) a.move.timeScale = 1.3;
      }
      s.lunge = e.lungeT;
      a.mixer.update(dt);
      // Flash red when hit, orange while winding up a skill.
      const flash = e.hitT > 0 ? 0x902020 : e.windT > 0 && Math.sin(t * 40) > 0 ? 0x803010 : e.elite ? 0x2a1a00 : 0;
      if (flash !== a.flash) { a.flash = flash; for (const m of a.mats) m.emissive.setHex(flash); }
    }

    // Dying monsters: play the death animation, then sink away.
    for (let k = this.corpses.length - 1; k >= 0; k--) {
      const c = this.corpses[k];
      if (c.t === 0) { this.play(c.actor, c.actor.death, 0.05, true); for (const m of c.actor.mats) m.emissive.setHex(0); c.actor.flash = 0; }
      c.t += dt;
      c.actor.mixer.update(dt);
      if (c.t > 0.8) {
        const p = (c.t - 0.8) / 0.4;
        c.actor.obj.position.y = -p * 6;
        c.actor.obj.scale.setScalar(c.scale * (1 - p * 0.5));
      }
      if (c.t > 1.2) { this.release(c.actor); this.corpses.splice(k, 1); }
    }

    // Monster projectiles
    const SHOT_COLORS = [0x9cff5a, 0xffb03a, 0xff6ad5, 0x7ad6ff];
    for (let i = 0; i < MAX_SHOTS; i++) {
      const s = sim.shots[i], m = this.shotMeshes[i];
      if (!s.alive) { m.visible = false; continue; }
      m.visible = true;
      m.position.set(s.prevX + (s.x - s.prevX) * alpha, 6, s.prevY + (s.y - s.prevY) * alpha);
      m.scale.setScalar(1 + Math.sin(t * 30 + i) * 0.15);
      (m.material as THREE.MeshBasicMaterial).color.setHex(SHOT_COLORS[s.monster % SHOT_COLORS.length]);
    }

    // Wood / stone pickups
    const pk = sim.gather.pickups;
    for (let i = 0; i < MAX_PICKUPS; i++) {
      const p = pk[i], v = this.pickupMeshes[i];
      if (!p.alive) { v.wood.visible = v.stone.visible = false; continue; }
      const m = p.kind === 'wood' ? v.wood : v.stone;
      (p.kind === 'wood' ? v.stone : v.wood).visible = false;
      m.visible = true;
      const pop = Math.min(1, p.age / 0.25);
      m.position.set(p.prevX + (p.x - p.prevX) * alpha, 1.5 + Math.abs(Math.sin(t * 3 + i)) * 1.2, p.prevY + (p.y - p.prevY) * alpha);
      m.rotation.y = t * 1.5 + i;
      m.scale.setScalar(1.2 * (0.6 + 0.4 * pop) * (p.age > 110 ? Math.max(0, (120 - p.age) / 10) : 1));
    }
  }

  /** Ground markers under one monster: elite aura, boss slam circle, dash lane. */
  private markers(e: Enemy, s: Slot, x: number, y: number, t: number): void {
    s.aura.visible = e.elite;
    if (e.elite) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4 + e.seed);
      s.aura.position.set(x, 0.3, y);
      s.aura.scale.setScalar(e.radius * 1.6);
      (s.aura.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.35 * pulse;
    }
    const slam = e.windT > 0 && e.boss;
    s.slam.visible = s.slamIn.visible = s.slamEdge.visible = slam;
    if (slam) {
      const p = 1 - e.windT / SLAM_WIND;
      for (const m of [s.slam, s.slamIn, s.slamEdge]) m.position.set(e.x, 0.25, e.y);
      s.slam.scale.setScalar(SLAM_RADIUS);
      s.slamEdge.scale.setScalar(SLAM_RADIUS);
      s.slamIn.scale.setScalar(Math.max(0.01, SLAM_RADIUS * p));
      (s.slam.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.12 * p;
    }
    const lane = e.windT > 0 && !e.boss && e.style === STYLE_DASHER;
    s.lane.visible = lane;
    if (lane) {
      s.lane.position.set(e.x, 0.25, e.y);
      s.lane.rotation.y = -Math.atan2(e.dirY, e.dirX);
      s.lane.scale.set(56, 1, e.radius * 3.2);
      (s.lane.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.2 * (1 - e.windT / 0.45);
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

// --- helpers ---------------------------------------------------------------------------------

function hash(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function turn(from: number, to: number, k: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * Math.min(1, k);
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function propMatrix(x: number, y: number, rot: number, s: number, tilt = 0): THREE.Matrix4 {
  _e.set(tilt, rot, tilt * 0.5);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, 0, y), _q, _s.set(s, s, s));
}

function findBone(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  for (const n of names) {
    const o = root.getObjectByName(n);
    if (o) return o;
  }
  return null;
}

/** Soft, painterly ground: base colour with light/dark patches and specks (tileable). */
function groundTexture(g: { base: string; dark: string; light: string; speck: string }): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.fillStyle = g.base;
  x.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blob = (cx: number, cy: number, r: number, col: string, a: number) => {
    for (let ox = -S; ox <= S; ox += S) for (let oy = -S; oy <= S; oy += S) {
      const gr = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
      gr.addColorStop(0, col);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.globalAlpha = a;
      x.fillStyle = gr;
      x.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
    }
  };
  for (let i = 0; i < 14; i++) blob(rnd() * S, rnd() * S, 30 + rnd() * 50, g.dark, 0.5);
  for (let i = 0; i < 12; i++) blob(rnd() * S, rnd() * S, 25 + rnd() * 45, g.light, 0.45);
  x.globalAlpha = 0.5;
  x.fillStyle = g.speck;
  for (let i = 0; i < 260; i++) x.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function cactusModel(): THREE.Object3D {
  const mat = new THREE.MeshLambertMaterial({ color: 0x4f9a3a, flatShading: true });
  const parts: THREE.BufferGeometry[] = [];
  const cap = (r: number, len: number, x: number, y: number, z: number, rz = 0) => {
    const g = new THREE.CapsuleGeometry(r, len, 3, 8);
    g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push(g);
  };
  cap(3, 15, 0, 10.5, 0);
  cap(1.8, 4, 5, 11, 0);            // right arm (up)
  cap(1.6, 3.5, 2.8, 8.5, 0, Math.PI / 2);
  cap(1.6, 3, -4.6, 8, 0);          // left arm (up)
  cap(1.4, 2.5, -2.6, 6, 0, Math.PI / 2);
  const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
  const flower = new THREE.Mesh(new THREE.SphereGeometry(1.4, 6, 4), new THREE.MeshLambertMaterial({ color: 0xff6a9a }));
  flower.position.set(0, 19.5, 0);
  const g = new THREE.Group();
  g.add(mesh, flower);
  return g;
}

function crystalModel(color: number): THREE.Object3D {
  const mat = new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.45), flatShading: true });
  const parts: THREE.BufferGeometry[] = [];
  const shard = (h: number, r: number, x: number, z: number, tx: number, tz: number) => {
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(r, h, r);
    g.rotateZ(tx);
    g.rotateX(tz);
    g.translate(x, h * 0.75, z);
    parts.push(g);
  };
  shard(9, 2.6, 0, 0, 0, 0);
  shard(6, 2, 3, 1.5, -0.35, 0.2);
  shard(5, 1.8, -2.8, -1, 0.4, -0.2);
  shard(4, 1.5, 0.5, -3, 0.1, -0.45);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeometries(parts), mat));
  return g;
}

/** Low-poly weapon in world units, grip at the origin, pointing along +y. Metal colour shows rarity. */
function weaponModel(form: number, rarity: number): THREE.Object3D {
  const metal = new THREE.MeshLambertMaterial({ color: RARITY_METAL[rarity], emissive: new THREE.Color(RARITY_METAL[rarity]).multiplyScalar(rarity ? 0.35 : 0.05), flatShading: true });
  const wood = new THREE.MeshLambertMaterial({ color: 0x6a4024, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3040, flatShading: true });
  const g = new THREE.Group();
  g.rotation.y = Math.PI / 2; // flat of the blade toward the camera
  const box = (w: number, h: number, d: number, y: number, mat: THREE.Material, x = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, 0);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  if (form === 0) {         // sword
    box(0.7, 3, 0.7, 0, dark);
    box(3.6, 0.6, 1, 1.7, metal);
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.25, 10, 4), metal);
    blade.scale.set(1, 1, 0.3);
    blade.rotation.y = Math.PI / 4;
    blade.position.y = 7;
    blade.castShadow = true;
    g.add(blade);
  } else if (form === 1) {  // axe
    box(0.6, 11, 0.6, 3.5, wood);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.6, 8, 1, false, 0, Math.PI), metal);
    head.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    head.position.set(0.3, 7.5, 0);
    head.castShadow = true;
    g.add(head);
  } else if (form === 2) {  // spear
    box(0.5, 17, 0.5, 5.5, wood);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1, 3.6, 4), metal);
    tip.position.y = 15.8;
    tip.castShadow = true;
    g.add(tip);
    box(1.6, 0.5, 0.6, 13.8, metal);
  } else {                  // hammer
    box(0.7, 10, 0.7, 3, wood);
    box(5, 3, 3, 8.5, metal);
    box(5.4, 0.6, 3.4, 8.5, dark);
  }
  return g;
}

export { MAP_W, MAP_H };
