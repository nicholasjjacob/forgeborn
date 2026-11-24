import * as THREE from 'three';
import { skinDef } from '../sim/skins';

/**
 * Hero styles (see SkinDef.looks / palette): pieces of the model hidden (a hat, a cape, a mask),
 * the Knight's visor closed, and alternate colour schemes (the pack's alt A/B/C palettes).
 *
 * The visor is a separate mesh skinned to the head, raised in the model. Closing it swings its
 * vertices about the helmet's hinge pins (measured from the model: both sides at y 1.745, z 0, in
 * the model's units) by 46°, which lands it over the helmet's face opening.
 */

const VISOR_PIVOT_Y = 1.745;
const VISOR_PIVOT_Z = 0;
const VISOR_CLOSE = (46 * Math.PI) / 180;

/** Closed-visor copies of visor geometries, by the open geometry's uuid, and the way back. */
const closed = new Map<string, THREE.BufferGeometry>();
const openOf = new Map<string, THREE.BufferGeometry>();

function closedVisor(open: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = closed.get(open.uuid);
  if (g) return g;
  g = open.clone();
  const m = new THREE.Matrix4()
    .makeTranslation(0, VISOR_PIVOT_Y, VISOR_PIVOT_Z)
    .multiply(new THREE.Matrix4().makeRotationX(VISOR_CLOSE))
    .multiply(new THREE.Matrix4().makeTranslation(0, -VISOR_PIVOT_Y, -VISOR_PIVOT_Z));
  g.applyMatrix4(m); // positions and normals; skin weights are untouched (all on the head bone)
  closed.set(open.uuid, g);
  openOf.set(g.uuid, open);
  return g;
}

/** Apply style `look` to a hero model of skin `skin` (any of its clones). Unknown looks mean the default. */
export function applyLook(root: THREE.Object3D, skin: string, look: string): void {
  const looks = skinDef(skin).looks;
  if (!looks) return;
  const def = looks.find((l) => l.id === look) ?? looks[0];
  const hidden = new Set<string>();
  for (const l of looks) for (const n of l.hide ?? []) hidden.add(n); // every piece any style can hide
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (hidden.has(m.name)) m.visible = !def.hide?.includes(m.name);
    if (m.name === 'Knight_HelmetVisor') {
      // (Not kept in userData: model clones deep-copy userData as JSON.)
      const open = openOf.get(m.geometry.uuid) ?? m.geometry;
      m.geometry = def.visor ? closedVisor(open) : open;
    }
  });
}

// --- Colour schemes -----------------------------------------------------------------------

const loader = new THREE.TextureLoader();
const altTex = new Map<string, THREE.Texture>();
/** Each hero's own palette texture, captured from its model the first time it is restyled. */
const ownTex = new Map<string, THREE.Texture>();

function alt(name: string, like: THREE.Texture): THREE.Texture {
  let t = altTex.get(name);
  if (!t) {
    t = loader.load(`models/tex/${name}.png`);
    // Match the model's own texture: glTF orientation, colour space, palette-cell sampling.
    t.flipY = like.flipY;
    t.colorSpace = like.colorSpace;
    t.generateMipmaps = like.generateMipmaps;
    t.minFilter = like.minFilter;
    t.magFilter = like.magFilter;
    altTex.set(name, t);
  }
  return t;
}

/** Colour scheme `n` (0 = the model's own, 1-3 = alternates A-C) on a hero model of skin `skin`. */
export function applyPalette(root: THREE.Object3D, skin: string, n: number): void {
  const pal = skinDef(skin).palette;
  if (!pal) return;
  root.traverse((o) => {
    // Only the hero's own (skinned) pieces: weapons in its hands keep their textures.
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const l = mat as THREE.MeshLambertMaterial;
      if (!l.map) continue;
      if (!ownTex.has(skin)) ownTex.set(skin, l.map);
      const own = ownTex.get(skin)!;
      const want = n >= 1 && n <= 3 ? alt(`${pal}_${'ABC'[n - 1]}`, own) : own;
      if (l.map !== want) { l.map = want; l.needsUpdate = true; }
    }
  });
}
