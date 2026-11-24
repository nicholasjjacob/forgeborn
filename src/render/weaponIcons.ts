import * as THREE from 'three';
import { FORMS, MAX_RARITY } from '../sim/weapons';
import { loadModel } from './models';
import { KIT_MODELS, buildKitWeapon } from './weapons3d';

/**
 * Inventory icons from the pack's weapon models: each weapon type at each rarity (with its
 * rarity glow) rendered once into a small PNG, replacing the hand-drawn stand-ins in `icons`
 * (icons[form][rarity]) in place. Uses a throwaway WebGL renderer that is released afterwards.
 * Resolves true if the icons were replaced.
 */
export async function renderKitIcons(icons: string[][], size = 96): Promise<boolean> {
  const ok = await Promise.all(KIT_MODELS.map((n) => loadModel(n).then(() => true, () => false)));
  if (ok.includes(false)) return false;
  let r: THREE.WebGLRenderer;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return false;
  }
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6a9a, 3.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-2, 3, 5);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  cam.position.set(0, 0, 10);

  for (let form = 0; form < FORMS.length; form++) {
    for (let rarity = 0; rarity <= MAX_RARITY; rarity++) {
      const kit = buildKitWeapon(form, rarity);
      if (!kit) continue;
      const pose = new THREE.Group();
      pose.add(kit.group);
      // Lay the weapon along its longest side, then tilt it onto the icon's diagonal.
      const box0 = new THREE.Box3().setFromObject(kit.group);
      const s0 = box0.getSize(new THREE.Vector3());
      if (s0.z > s0.y && s0.z > s0.x) kit.group.rotation.x = -Math.PI / 2; // bows and crossbows point along z
      pose.rotation.z = -0.72;
      if (kit.off) {
        // An off-hand piece (e.g. a shield): behind, lower left.
        kit.off.position.set(-0.35, -0.35, -0.3);
        kit.off.rotation.z = 0.72;
        pose.add(kit.off);
      }
      scene.add(pose);
      const box = new THREE.Box3().setFromObject(pose);
      const c = box.getCenter(new THREE.Vector3());
      const half = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2 * 1.02;
      cam.left = c.x - half; cam.right = c.x + half; cam.top = c.y + half; cam.bottom = c.y - half;
      cam.updateProjectionMatrix();
      r.render(scene, cam);
      icons[form] ??= [];
      icons[form][rarity] = r.domElement.toDataURL('image/png');
      scene.remove(pose);
      pose.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) for (const x of Array.isArray(m.material) ? m.material : [m.material]) x.dispose();
      });
    }
  }
  r.dispose();
  r.forceContextLoss();
  return true;
}
