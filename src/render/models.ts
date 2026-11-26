import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Loads and caches the 3D models in public/models/ (built by scripts/build-models.py from CC0
 * Quaternius packs). Materials are swapped for cheap Lambert ones: the stylized art doesn't need
 * PBR, and phones render Lambert far faster.
 */

const loader = new GLTFLoader();

/**
 * The address of a file in public/models, with its content fingerprint (so an updated model is
 * never served stale from a cache).
 */
export function modelUrl(file: string): string {
  const v = typeof __ASSET_HASHES__ === 'undefined' ? undefined : __ASSET_HASHES__[file];
  return v ? `models/${file}?v=${v}` : `models/${file}`;
}
const cache = new Map<string, Promise<GLTF>>();
const ready = new Map<string, GLTF>();

export function loadModel(name: string): Promise<GLTF> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(modelUrl(`${name}.glb`)).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = Array.isArray(m.material) ? m.material.map(toLambert) : toLambert(m.material);
        // Characters use palette atlases (flat colour cells): mipmaps would blend neighbouring
        // cells into mud at a distance, so sample them without mipmaps.
        if (/^(m\d|hero|w_)/.test(name)) {
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
            const map = (mat as THREE.MeshLambertMaterial).map;
            if (map) { map.generateMipmaps = false; map.minFilter = THREE.LinearFilter; map.needsUpdate = true; }
          }
        }
        m.castShadow = true;
        m.receiveShadow = false;
      });
      if (name.startsWith('nf_')) {
        // Forest pack models ship without their texture: each colourway shares tex/forest_<N>.png.
        const tex = forestTexture(Number(/_Color(\d)/.exec(name)?.[1] ?? 1));
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) { (mat as THREE.MeshLambertMaterial).map = tex; mat.needsUpdate = true; }
        });
      }
      ready.set(name, g);
      return g;
    });
    p.catch((err) => { console.warn('model failed', name, err); cache.delete(name); });
    cache.set(name, p);
  }
  return p;
}

const forestTex = new Map<number, THREE.Texture>();
function forestTexture(colour: number): THREE.Texture {
  let t = forestTex.get(colour);
  if (!t) {
    t = new THREE.TextureLoader().load(modelUrl(`tex/forest_${colour}.png`));
    t.flipY = false; // glTF UV convention
    t.colorSpace = THREE.SRGBColorSpace;
    // A palette atlas: sample cells without mipmap blending.
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    forestTex.set(colour, t);
  }
  return t;
}

/** The model if it has finished loading (starts the load otherwise). */
export function model(name: string): GLTF | null {
  const g = ready.get(name);
  if (!g) void loadModel(name).catch(() => {});
  return g ?? null;
}

function toLambert(src: THREE.Material): THREE.Material {
  const s = src as THREE.MeshStandardMaterial;
  const m = new THREE.MeshLambertMaterial({
    name: s.name,
    color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
    map: s.map ?? null,
    transparent: s.transparent,
    alphaTest: s.alphaTest,
    side: s.side,
    // Vertex colours in these packs hold wind/shading data for their own shaders, not colour.
    vertexColors: false,
  });
  if (s.emissive && s.emissiveIntensity > 0 && (s.emissive.r + s.emissive.g + s.emissive.b) > 0) {
    m.emissive.copy(s.emissive);
    m.emissiveMap = s.emissiveMap ?? null;
  }
  src.dispose();
  return m;
}

/** A skinned, independently animatable copy with its own materials (for hit flashes). */
export function cloneActor(g: GLTF): THREE.Object3D {
  const o = cloneSkinned(g.scene);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    m.frustumCulled = false; // skinned bounds don't follow the animation; actors are culled by hand
  });
  return o;
}

export function findClip(g: GLTF, names: readonly string[]): THREE.AnimationClip | null {
  for (const n of names) {
    const c = g.animations.find((a) => a.name === n || a.name.endsWith('|' + n));
    if (c) return c;
  }
  for (const n of names) {
    const c = g.animations.find((a) => a.name.toLowerCase().includes(n.toLowerCase()));
    if (c) return c;
  }
  return null;
}

/** Height and footprint of a model in its own units, from its bind pose. */
export function measure(obj: THREE.Object3D): { h: number; w: number; minY: number; cx: number; cz: number } {
  obj.updateMatrixWorld(true);
  // Skinned vertices are measured through the skeleton's bone matrices, which normally only
  // refresh when the model is drawn: bring them up to date with the current pose first (a fresh
  // clone otherwise carries stale ones and can measure ten times too small or far off-centre).
  obj.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.update(); });
  const box = new THREE.Box3().setFromObject(obj, true);
  const size = box.getSize(new THREE.Vector3());
  return { h: size.y, w: Math.max(size.x, size.z), minY: box.min.y, cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2 };
}
