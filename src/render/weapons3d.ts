import * as THREE from 'three';
import { cloneActor, loadModel, model } from './models';

/**
 * Hand-built low-poly weapons (one per form: Sword, Axe, Greataxe, Greatsword, Dagger, Crossbow,
 * Bow, Longbow, Staff, Wand), in world units with the grip at the origin and
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
    // Greataxe: long banded haft, two broad crescent blades and a top spike.
    add(new THREE.CylinderGeometry(0.42, 0.52, 16, 7), wood, 0, 5.5, 0);
    const h = new THREE.Shape();
    h.moveTo(0, 1.2); h.quadraticCurveTo(2.2, 1.8, 3.5, 3.9); h.quadraticCurveTo(4.8, 0.1, 3.6, -3.6);
    h.quadraticCurveTo(2, -1.4, 0, -1.2); h.lineTo(0, 1.2);
    add(extrude(h, 0.4, 0.2), metal, 0.4, 11.6, 0);
    const m = add(extrude(h, 0.4, 0.2), metal, -0.4, 11.6, 0);
    m.rotation.y = Math.PI;
    add(new THREE.CylinderGeometry(0.75, 0.75, 2.8, 8), dark, 0, 11.6, 0);
    add(new THREE.ConeGeometry(0.5, 1.8, 6), metal, 0, 14, 0);
    add(new THREE.OctahedronGeometry(0.5, 0), gem, 0, 11.6, 0.75);
    for (const y of [-1.2, 0.2, 1.6]) add(new THREE.CylinderGeometry(0.56, 0.56, 0.35, 8), y < 0 ? leather : dark, 0, y, 0);
    base.position.set(2, 10, 0); tip.position.set(4.6, 13.6, 0);
  } else if (form === 3) {
    // Greatsword: long two-handed blade with a fuller, winged golden crossguard, long grip, gem pommel.
    const s = new THREE.Shape();
    s.moveTo(-0.95, 0); s.lineTo(-0.9, 10.6); s.lineTo(-0.45, 12.2); s.lineTo(0, 13.4);
    s.lineTo(0.45, 12.2); s.lineTo(0.9, 10.6); s.lineTo(0.95, 0); s.lineTo(-0.95, 0);
    add(extrude(s, 0.14, 0.18), metal, 0, 3.2, 0);
    add(new THREE.BoxGeometry(0.26, 9.4, 0.56), dark, 0, 8.2, 0);           // fuller
    const guard = new THREE.Shape();
    guard.moveTo(-3.4, 1.3); guard.quadraticCurveTo(-2.2, -0.2, 0, 0); guard.quadraticCurveTo(2.2, -0.2, 3.4, 1.3);
    guard.lineTo(3, 1.5); guard.quadraticCurveTo(1.8, 0.7, 0, 0.9); guard.quadraticCurveTo(-1.8, 0.7, -3, 1.5); guard.lineTo(-3.4, 1.3);
    add(extrude(guard, 0.7, 0.14), trim, 0, 2.3, 0);
    add(new THREE.OctahedronGeometry(0.55, 0), gem, 0, 2.9, 0.48);
    add(new THREE.CylinderGeometry(0.44, 0.44, 4, 8), leather, 0, 0.3, 0);
    for (const y of [-1, 0.3, 1.6]) add(new THREE.TorusGeometry(0.46, 0.08, 4, 10).rotateX(Math.PI / 2), dark, 0, y, 0);
    add(new THREE.IcosahedronGeometry(0.7, 0), trim, 0, -2.1, 0);
    base.position.set(0, 5, 0); tip.position.set(0, 16.4, 0);
  } else if (form === 4) {
    // Dagger: short leaf blade, swept guard, wrapped grip.
    const s = new THREE.Shape();
    s.moveTo(-0.6, 0); s.quadraticCurveTo(-0.9, 2.4, -0.45, 4); s.lineTo(0, 5.4); s.lineTo(0.45, 4);
    s.quadraticCurveTo(0.9, 2.4, 0.6, 0); s.lineTo(-0.6, 0);
    add(extrude(s, 0.1, 0.14), metal, 0, 1.6, 0);
    add(new THREE.BoxGeometry(3.2, 0.45, 0.6), trim, 0, 1.4, 0);
    add(new THREE.OctahedronGeometry(0.35, 0), gem, 0, 1.4, 0.4);
    grip(2, leather);
    add(new THREE.IcosahedronGeometry(0.5, 0), trim, 0, -1.3, 0);
    base.position.set(0, 2.2, 0); tip.position.set(0, 7, 0);
  } else if (form === 5) {
    // Crossbow: wooden stock pointing forward, metal limbs across the front, a loaded bolt.
    add(new THREE.BoxGeometry(0.9, 9, 0.9), wood, 0, 3.6, 0);
    add(new THREE.BoxGeometry(1.1, 2.4, 1.3), dark, 0, 0.2, 0);
    const limb = (side: number) => {
      const l = add(new THREE.BoxGeometry(4.2, 0.45, 0.55), metal, side * 2.1, 7.6, 0);
      l.rotation.z = side * 0.28;
    };
    limb(1); limb(-1);
    add(new THREE.CylinderGeometry(0.06, 0.06, 7.6, 4).rotateZ(Math.PI / 2), dark, 0, 6.6, 0);
    add(new THREE.CylinderGeometry(0.12, 0.12, 6, 5), wood, 0, 6, 0.55);
    add(new THREE.ConeGeometry(0.3, 0.9, 5), metal, 0, 9.2, 0.55);
    add(new THREE.OctahedronGeometry(0.4, 0), gem, 0, 7.6, 0.6);
    base.position.set(0, 6, 0); tip.position.set(0, 9.5, 0);
  } else if (form === 6 || form === 7) {
    // Bow / Longbow: a curved stave held at the grip, with a string.
    const r = form === 7 ? 9 : 6.5, arc = form === 7 ? 1.5 : 1.7;
    const stave = new THREE.TorusGeometry(r, form === 7 ? 0.36 : 0.32, 5, 16, arc);
    stave.rotateZ(-arc / 2);
    stave.translate(-r, 0, 0);
    add(stave, wood);
    const ex = r * Math.cos(arc / 2) - r, ey = r * Math.sin(arc / 2);
    add(new THREE.CylinderGeometry(0.06, 0.06, ey * 2, 4), new THREE.MeshBasicMaterial({ color: 0xf0ead8 }), ex, 0, 0);
    for (const sy of [1, -1]) add(new THREE.ConeGeometry(0.32, 1.2, 5).rotateZ(sy > 0 ? 0 : Math.PI), metal, ex + 0.1, sy * (ey - 0.3), 0);
    add(new THREE.CylinderGeometry(0.5, 0.5, 2.2, 7), leather, 0, 0, 0);
    add(new THREE.OctahedronGeometry(0.42, 0), gem, 0.45, 0, 0);
    base.position.set(0, -ey * 0.6, 0); tip.position.set(0, ey * 0.6, 0);
  } else if (form === 8) {
    // Staff: tall gnarled shaft with a cradle of prongs holding a glowing orb.
    add(new THREE.CylinderGeometry(0.34, 0.44, 17, 6), wood, 0, 5.5, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const pr = add(new THREE.ConeGeometry(0.28, 3, 4), trim, Math.cos(a) * 0.8, 14.6, Math.sin(a) * 0.8);
      pr.rotation.z = -Math.cos(a) * 0.35; pr.rotation.x = Math.sin(a) * 0.35;
    }
    const orb = add(new THREE.IcosahedronGeometry(1.25, 1), gem, 0, 15.4, 0);
    orb.scale.setScalar(1);
    add(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 7), trim, 0, 13.4, 0);
    for (const y of [-0.6, 0.6]) add(new THREE.CylinderGeometry(0.48, 0.48, 0.3, 7), leather, 0, y, 0);
    base.position.set(0, 13, 0); tip.position.set(0, 16.6, 0);
  } else if (form === 9) {
    // Wand: short tapered rod with a trim collar and a sparkling gem tip.
    add(new THREE.CylinderGeometry(0.2, 0.36, 7, 6), wood, 0, 2.6, 0);
    add(new THREE.CylinderGeometry(0.42, 0.42, 0.45, 7), trim, 0, 5.8, 0);
    add(new THREE.OctahedronGeometry(0.75, 0), gem, 0, 6.8, 0);
    add(new THREE.CylinderGeometry(0.42, 0.42, 1.6, 7), leather, 0, -0.2, 0);
    base.position.set(0, 5, 0); tip.position.set(0, 7.6, 0);
  }
  return { group: g, tip, base, glow };
}

// --- KayKit weapon models -----------------------------------------------------------------

/**
 * Which pack model each weapon type uses, by rarity tier: Common/Uncommon, Rare/Epic,
 * Legendary/Mythic, Divine (the best-looking model of its family). Files from
 * scripts/build-weapons.mjs: w_* from KayKit Adventurers, fw_* from KayKit Fantasy Weapons Bits.
 * `pair`: worn on both hands (claws); `scale`: size in hand.
 */
interface KitDef { tiers: readonly [string, string, string, string]; pair?: boolean; scale?: number }
const KIT: Record<number, KitDef> = {
  0: { tiers: ['fw_sword_A', 'fw_sword_B', 'w_sword_1handed', 'fw_sword_F'] },               // Sword → flame sword
  1: { tiers: ['fw_axe_A', 'w_axe_1handed', 'fw_axe_C', 'fw_axe_D'] },                         // Axe → crescent axe
  2: { tiers: ['w_axe_2handed', 'fw_axe_B', 'w_axe_2handed_Large', 'fw_axe_D'], scale: 1.15 }, // Greataxe
  3: { tiers: ['w_sword_2handed', 'fw_sword_E', 'w_sword_2handed_color', 'fw_sword_G'] },     // Greatsword → ice blade
  4: { tiers: ['w_dagger', 'fw_dagger_A', 'fw_dagger_B', 'fw_dagger_C'] },                     // Dagger → poison blade
  5: { tiers: ['w_crossbow_1handed', 'w_crossbow_1handed', 'w_crossbow_2handed', 'w_crossbow_2handed'] },
  6: { tiers: ['fw_bow_A_withString', 'w_bow_withString', 'fw_bow_B_withString', 'fw_bow_C_withString'] }, // → bone bow
  7: { tiers: ['w_bow_withString', 'fw_bow_B_withString', 'fw_bow_C_withString', 'fw_bow_C_withString'], scale: 1.15 },
  8: { tiers: ['fw_staff_A', 'w_staff', 'fw_staff_B', 'fw_staff_D'] },                         // Staff → sun staff
  9: { tiers: ['w_wand', 'fw_wand_A', 'fw_wand_A', 'fw_wand_B'] },                             // Wand → void orb
  10: { tiers: ['fw_sword_C', 'fw_sword_C', 'fw_sword_D', 'fw_scythe'] },                      // Katana → reaper's scythe
  11: { tiers: ['fw_fistweapon_A', 'fw_fistweapon_B', 'fw_fistweapon_B', 'fw_fistweapon_C_right'], pair: true }, // Claws
  12: { tiers: ['fw_staff_A', 'w_druid_staff', 'w_druid_staff', 'fw_staff_C'] },               // Nature staff → living staff
  13: { tiers: ['w_shotgun', 'w_shotgun', 'w_shotgun', 'w_shotgun'] },
  14: { tiers: ['w_engineer_Wrench', 'w_engineer_Wrench', 'fw_hammer_D', 'fw_hammer_A'] },      // Wrench → warhammer
  15: { tiers: ['fw_hammer_C', 'fw_hammer_D', 'fw_hammer_A', 'fw_hammer_B'] },                 // Warhammer → morningstar
  16: { tiers: ['fw_spear_A', 'fw_spear_A', 'fw_halberd', 'fw_spear_B'] },                     // Polearm → golden trident
};
/** Left-hand models for weapons worn as a pair (the right-hand model mirrored if not listed). */
const LEFT: Record<string, string> = { fw_fistweapon_C_right: 'fw_fistweapon_C_left' };
/** Per-model fixes so everything is held like the Adventurers' weapons (blade up the hand slot's y). */
const ROT: Record<string, [number, number, number]> = {
  fw_bow_A_withString: [0, -Math.PI / 2, 0], fw_bow_B_withString: [0, -Math.PI / 2, 0], fw_bow_C_withString: [0, -Math.PI / 2, 0],
};

/** Rarity tier (0-3) for the model ladder. */
export const kitTier = (rarity: number) => (rarity >= 6 ? 3 : rarity >= 4 ? 2 : rarity >= 2 ? 1 : 0);

/** The model files weapon type `form` at `rarity` needs. */
export function kitModels(form: number, rarity: number): string[] {
  const k = KIT[form];
  if (!k) return [];
  const main = k.tiers[kitTier(rarity)];
  return k.pair && LEFT[main] ? [main, LEFT[main]] : [main];
}

/** Ranger arrows by rarity tier (golden from Divine), crossbow bolts. */
export const arrowModel = (rarity: number) => (rarity >= 6 ? 'fw_arrow_C' : rarity >= 4 ? 'fw_arrow_B' : 'fw_arrow_A');
export const BOLT_MODEL = 'w_arrow_crossbow';

/** Rarity glow strength on the pack models (Common … Divine): rarity tints the whole weapon. */
const KIT_GLOW = [0, 0.1, 0.16, 0.26, 0.34, 0.4, 0.46];

export interface KitWeaponView extends WeaponView { off: THREE.Object3D | null }

function kitPiece(name: string, rarity: number, glow: THREE.MeshLambertMaterial[], mirror = false): THREE.Object3D | null {
  const g = model(name);
  if (!g) { void loadModel(name).catch(() => {}); return null; }
  const o = cloneActor(g);
  const r = ROT[name];
  if (r) o.rotation.set(r[0], r[1], r[2]);
  if (mirror) o.scale.x = -1;
  const c = new THREE.Color(weaponTrailColor(rarity));
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const l = mat as THREE.MeshLambertMaterial;
      if (!l.emissive) continue;
      // Models with their own glow (flame blade, sun staff, void orb) keep it; the rest take the rarity's.
      if (l.emissive.r + l.emissive.g + l.emissive.b > 0.01) { if (rarity >= 3) glow.push(l); continue; }
      l.emissive.copy(c).multiplyScalar(KIT_GLOW[rarity] ?? 0);
      if (rarity >= 3) glow.push(l);
    }
  });
  return o;
}

/**
 * The pack model for weapon type `form` at `rarity`, in the model's own units (it goes straight
 * into the character's hand slot bones). Null while a model is still loading (it starts loading).
 */
export function buildKitWeapon(form: number, rarity: number): KitWeaponView | null {
  const k = KIT[form];
  if (!k) return null;
  const glow: THREE.MeshLambertMaterial[] = [];
  const name = k.tiers[kitTier(rarity)];
  const main = kitPiece(name, rarity, glow);
  const off = k.pair ? kitPiece(LEFT[name] ?? name, rarity, glow, !LEFT[name]) : null;
  if (!main || (k.pair && !off)) return null;
  const group = new THREE.Group();
  group.add(main);
  if (k.scale) { group.scale.setScalar(k.scale); off?.scale.multiplyScalar(k.scale); }
  // Swing-trail markers: from a third of the way up the weapon to its far end.
  const box = new THREE.Box3().setFromObject(main);
  const tip = new THREE.Object3D(), base = new THREE.Object3D();
  base.position.set(0, box.min.y + (box.max.y - box.min.y) * 0.4, 0);
  tip.position.set(0, box.max.y, 0);
  group.add(tip, base);
  return { group, tip, base, glow: glow as unknown as THREE.MeshPhongMaterial[], off };
}
