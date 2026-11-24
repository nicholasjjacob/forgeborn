import * as THREE from 'three';

/**
 * Hero styles (see SkinDef.looks): small changes to a hero model's pieces. The Knight can wear
 * the visor up (as modelled), down, or go without the helmet.
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

/** Apply `look` to a hero model of skin `skin` (any of its clones). Unknown looks mean the default. */
export function applyLook(root: THREE.Object3D, skin: string, look: string): void {
  if (skin !== 'knight') return;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.name === 'Knight_Helmet') m.visible = look !== 'bare';
    else if (m.name === 'Knight_HelmetVisor') {
      m.visible = look !== 'bare';
      // (Not kept in userData: model clones deep-copy userData as JSON.)
      const open = openOf.get(m.geometry.uuid) ?? m.geometry;
      m.geometry = look === 'visor' ? closedVisor(open) : open;
    }
  });
}
