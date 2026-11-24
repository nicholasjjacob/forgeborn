import * as THREE from 'three';

/**
 * Hand-built low-poly weapons (one per form), in world units with the grip at the origin and
 * the business end along +y. Bevelled extrusions give blades a proper edge; rarity changes the
 * metal (steel, blue, violet, gold), adds a glowing gem from Rare up and a glow from Epic up.
 * `tip` and `base` markers bound the striking part, for the swing trail.
 */

export interface WeaponView { group: THREE.Group; tip: THREE.Object3D; base: THREE.Object3D; glow: THREE.MeshPhongMaterial[] }

/** Per rarity: Common, Uncommon, Rare, Epic, Legendary, Mythic, Divine. */
const METAL = [0xc4cad6, 0x8ae06a, 0x7cc0ff, 0xc08cff, 0xffcf5a, 0xff6a80, 0x9af6ff];
const GEM = [0xffffff, 0x3ac83a, 0x3aa0ff, 0xb44cff, 0xff6a2a, 0xff2a4a, 0xffffff];

export function weaponTrailColor(rarity: number): number {
  return [0xffffff, 0x9cff7a, 0x8ad0ff, 0xd0a0ff, 0xffd870, 0xff8aa0, 0xb8faff][rarity] ?? 0xffffff;
}

export function buildWeapon(form: number, rarity: number): WeaponView {
  const g = new THREE.Group();
  const glow: THREE.MeshPhongMaterial[] = [];
  const metal = new THREE.MeshPhongMaterial({
    color: METAL[rarity], specular: 0xffffff, shininess: 90, flatShading: true,
    emissive: new THREE.Color(METAL[rarity]).multiplyScalar(rarity >= 3 ? 0.28 + 0.06 * (rarity - 3) : rarity ? 0.1 : 0),
  });
  if (rarity >= 3) glow.push(metal);
  const dark = new THREE.MeshPhongMaterial({ color: 0x4a4250, specular: 0x666666, shininess: 40, flatShading: true });
  const leather = new THREE.MeshLambertMaterial({ color: 0x5a3420, flatShading: true });
  const wood = new THREE.MeshLambertMaterial({ color: 0x7a4e2c, flatShading: true });
  const trim = new THREE.MeshPhongMaterial({ color: rarity >= 4 ? 0xfff0b0 : 0xd8a040, specular: 0xffffff, shininess: 80, flatShading: true });
  const gem = new THREE.MeshPhongMaterial({ color: GEM[rarity], emissive: new THREE.Color(GEM[rarity]).multiplyScalar(0.6), shininess: 100, flatShading: true });
  if (rarity >= 1) glow.push(gem);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const extrude = (shape: THREE.Shape, depth: number, bevel: number) => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
    geo.translate(0, 0, -depth / 2);
    return geo;
  };
  const grip = (len: number, mat: THREE.Material) => {
    add(new THREE.CylinderGeometry(0.42, 0.42, len, 8), mat, 0, 0, 0);
    for (let i = -1; i <= 1; i++) add(new THREE.TorusGeometry(0.44, 0.08, 4, 10).rotateX(Math.PI / 2), dark, 0, (i * len) / 3.2, 0);
  };
  const tip = new THREE.Object3D();
  const base = new THREE.Object3D();
  g.add(tip, base);

  if (form === 0) {
    // Sword: bevelled blade with a fuller, curled crossguard, gem pommel.
    const s = new THREE.Shape();
    s.moveTo(-0.75, 0); s.lineTo(-0.7, 7.4); s.lineTo(-0.35, 8.9); s.lineTo(0, 9.9);
    s.lineTo(0.35, 8.9); s.lineTo(0.7, 7.4); s.lineTo(0.75, 0); s.lineTo(-0.75, 0);
    add(extrude(s, 0.12, 0.16), metal, 0, 1.9, 0);
    add(new THREE.BoxGeometry(0.22, 6.4, 0.5), dark, 0, 5.4, 0);           // fuller
    const guard = new THREE.Shape();
    guard.moveTo(-2.4, 0.5); guard.quadraticCurveTo(-1.4, -0.1, 0, 0.1); guard.quadraticCurveTo(1.4, -0.1, 2.4, 0.5);
    guard.lineTo(2.2, 0.9); guard.quadraticCurveTo(1.2, 0.5, 0, 0.75); guard.quadraticCurveTo(-1.2, 0.5, -2.2, 0.9); guard.lineTo(-2.4, 0.5);
    add(extrude(guard, 0.6, 0.12), trim, 0, 1.15, 0);
    add(new THREE.OctahedronGeometry(0.45, 0), gem, 0, 1.6, 0.42);
    grip(2.2, leather);
    add(new THREE.IcosahedronGeometry(0.6, 0), trim, 0, -1.4, 0);
    base.position.set(0, 3, 0); tip.position.set(0, 11.6, 0);
  } else if (form === 1) {
    // Axe: tapered haft, crescent head with a back spike, metal bands.
    add(new THREE.CylinderGeometry(0.38, 0.48, 12, 7), wood, 0, 4, 0);
    const h = new THREE.Shape();
    h.moveTo(0, 0.9); h.quadraticCurveTo(1.6, 1.3, 2.6, 2.9); h.quadraticCurveTo(3.6, 0.1, 2.7, -2.7);
    h.quadraticCurveTo(1.5, -1, 0, -0.9); h.lineTo(0, 0.9);
    add(extrude(h, 0.35, 0.18), metal, 0.35, 8.4, 0);
    const spike = new THREE.Shape();
    spike.moveTo(0, 0.6); spike.lineTo(-2, 0.1); spike.lineTo(-2, -0.1); spike.lineTo(0, -0.6); spike.lineTo(0, 0.6);
    add(extrude(spike, 0.3, 0.12), metal, -0.3, 8.4, 0);
    add(new THREE.CylinderGeometry(0.62, 0.62, 2.2, 8), dark, 0, 8.4, 0);
    add(new THREE.OctahedronGeometry(0.42, 0), gem, 0, 8.4, 0.62);
    for (const y of [-0.8, 0.8, 2.4]) add(new THREE.CylinderGeometry(0.52, 0.52, 0.35, 8), y < 0 ? leather : dark, 0, y, 0);
    base.position.set(1.5, 7.2, 0); tip.position.set(3.4, 9.8, 0);
  } else if (form === 2) {
    // Spear: long haft, leaf-shaped head on a collar, red tassel.
    add(new THREE.CylinderGeometry(0.32, 0.38, 19, 7), wood, 0, 5.5, 0);
    const leaf = new THREE.Shape();
    leaf.moveTo(0, 0); leaf.quadraticCurveTo(1.25, 1.2, 0.9, 2.6); leaf.lineTo(0, 4.8); leaf.lineTo(-0.9, 2.6);
    leaf.quadraticCurveTo(-1.25, 1.2, 0, 0);
    add(extrude(leaf, 0.14, 0.18), metal, 0, 15.6, 0);
    add(new THREE.CylinderGeometry(0.3, 0.55, 1.4, 8), trim, 0, 15, 0);
    add(new THREE.OctahedronGeometry(0.35, 0), gem, 0, 15, 0.45);
    const tassel = new THREE.ConeGeometry(0.8, 2.2, 6);
    add(tassel, new THREE.MeshLambertMaterial({ color: 0xc83a2a, flatShading: true }), 0, 13.2, 0);
    for (const y of [-0.6, 0.6]) add(new THREE.CylinderGeometry(0.44, 0.44, 0.3, 8), leather, 0, y, 0);
    base.position.set(0, 14, 0); tip.position.set(0, 20.5, 0);
  } else {
    // Hammer: bevelled rounded head with banded faces and a top spike.
    add(new THREE.CylinderGeometry(0.42, 0.5, 11, 7), wood, 0, 3.5, 0);
    const r = new THREE.Shape();
    const w = 2.6, hh = 1.6, c = 0.5;
    r.moveTo(-w + c, -hh); r.lineTo(w - c, -hh); r.quadraticCurveTo(w, -hh, w, -hh + c); r.lineTo(w, hh - c);
    r.quadraticCurveTo(w, hh, w - c, hh); r.lineTo(-w + c, hh); r.quadraticCurveTo(-w, hh, -w, hh - c);
    r.lineTo(-w, -hh + c); r.quadraticCurveTo(-w, -hh, -w + c, -hh);
    add(extrude(r, 2.4, 0.3), metal, 0, 9, 0);
    for (const x of [-1.6, 1.6]) add(new THREE.BoxGeometry(0.35, 3.5, 3.3), dark, x, 9, 0);
    add(new THREE.ConeGeometry(0.55, 1.6, 6), metal, 0, 11.4, 0);
    add(new THREE.OctahedronGeometry(0.5, 0), gem, 0, 9, 1.55);
    grip(2.4, leather);
    base.position.set(0, 7.5, 0); tip.position.set(0, 11, 0);
  }
  return { group: g, tip, base, glow };
}
