import * as THREE from 'three';
import { skeletonLookOf, skinDef, type LookDef } from '../sim/skins';

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
  applyLookList(root, skinDef(skin).looks, look);
}

/** The skeleton form's styles and outfit (the Skeleton Knight's helmet and armour), from the saved choices. */
export function applyBonesLooks(root: THREE.Object3D, skin: string, looks: Record<string, string>): void {
  const sk = skinDef(skin).skeleton;
  applyLookList(root, sk.looks, skeletonLookOf(skin, looks));
  applyLookList(root, sk.outfits, skeletonLookOf(skin, looks, 'outfits'));
}

/** Show the pieces style `look` keeps (of every piece any style in `looks` can hide), and set the visor. */
function applyLookList(root: THREE.Object3D, looks: readonly LookDef[] | undefined, look: string): void {
  if (!looks) return;
  const def = looks.find((l) => l.id === look) ?? looks[0];
  const hidden = new Set<string>();
  for (const l of looks) for (const n of l.hide ?? []) hidden.add(n); // every piece any style can hide
  const visorStyle = looks.some((l) => l.visor);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (hidden.has(m.name)) m.visible = !def.hide?.includes(m.name);
    if (visorStyle && m.name === 'Knight_HelmetVisor') {
      // (Not kept in userData: model clones deep-copy userData as JSON.)
      const open = openOf.get(m.geometry.uuid) ?? m.geometry;
      m.geometry = def.visor ? closedVisor(open) : open;
    }
  });
}

// --- Colour schemes -----------------------------------------------------------------------

const loader = new THREE.TextureLoader();
/** Alternate palettes: the texture once its image has arrived, or the pending load. */
const altTex = new Map<string, THREE.Texture>();
const altLoading = new Map<string, Promise<THREE.Texture | null>>();
/** The Skeletons pack's own materials (never recoloured). */
const SKELETON_MATS = new Set(['skeleton', 'Glow']);
/** Each hero's own palette texture, captured from its model the first time it is restyled. */
const ownTex = new Map<string, THREE.Texture>();

function loadAlt(name: string): Promise<THREE.Texture | null> {
  let p = altLoading.get(name);
  if (!p) {
    p = loader.loadAsync(`models/tex/${name}.png`).then((t) => { altTex.set(name, t); return t; }, () => null);
    altLoading.set(name, p);
  }
  return p;
}

/** Make the texture sample like the model's own: glTF orientation, colour space, palette cells. */
function matchTexture(t: THREE.Texture, like: THREE.Texture): void {
  if (t.userData.matched) return;
  t.flipY = like.flipY;
  t.colorSpace = like.colorSpace;
  t.generateMipmaps = like.generateMipmaps;
  t.minFilter = like.minFilter;
  t.magFilter = like.magFilter;
  t.needsUpdate = true;
  t.userData.matched = true;
}

/** Name of colour scheme `n` for hero `skin`, or '' for its own. */
function altName(skin: string, n: number): string {
  const pal = skinDef(skin).palette;
  return pal && n >= 1 && n <= 3 ? `${pal}_${'ABC'[n - 1]}` : '';
}

/** Resolves once colour scheme `n` of hero `skin` can be shown (its texture has loaded). */
export async function paletteReady(skin: string, n: number): Promise<void> {
  const name = altName(skin, n);
  if (name) await loadAlt(name);
}

/**
 * Colour scheme `n` (0 = the model's own, 1-3 = alternates A-C) on a hero model of skin `skin`.
 * Returns false (changing nothing) while that scheme's texture is still loading: applying it
 * early would draw the hero black. The load is started; call again later.
 */
export function applyPalette(root: THREE.Object3D, skin: string, n: number): boolean {
  if (!skinDef(skin).palette) return true;
  const name = altName(skin, n);
  const tex = name ? altTex.get(name) : undefined;
  if (name && !tex) { void loadAlt(name); return false; }
  root.traverse((o) => {
    // Only the hero's own (skinned) pieces: weapons in its hands keep their textures.
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const l = mat as THREE.MeshLambertMaterial;
      // (On a skeleton form, only its borrowed hero pieces: its bones keep their own colours.)
      if (!l.map || SKELETON_MATS.has(l.name)) continue;
      if (!ownTex.has(skin)) ownTex.set(skin, l.map);
      const own = ownTex.get(skin)!;
      if (tex) matchTexture(tex, own);
      const want = tex ?? own;
      if (l.map !== want) { l.map = want; l.needsUpdate = true; }
    }
  });
  return true;
}
