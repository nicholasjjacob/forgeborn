import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * 3D icons: a gold coin, a purple shard crystal, a cut blue gem and a glowing ember (currencies),
 * plus the bottom bar's arrow (Upgrades), anvil (Forge) and scroll (Quests),
 * modelled here and rendered once at startup (with studio reflections) into small PNGs. They
 * replace the flat CSS icons everywhere (.coin, .gem, .jewel, .ember) through CSS variables
 * --ico-coin / --ico-gem / --ico-jewel / --ico-ember and the html.icons3d class. If WebGL isn't
 * available the CSS icons simply stay.
 */

type Kind = 'coin' | 'gem' | 'jewel' | 'ember' | 'up' | 'anvil' | 'scroll' | 'chest' | 'chestOpen';

function coin(): THREE.Object3D {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd040, metalness: 0.7, roughness: 0.3, emissive: 0xb07800, emissiveIntensity: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0xf09a10, metalness: 0.7, roughness: 0.35, emissive: 0x8a4a00, emissiveIntensity: 0.45 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.26, 40), gold);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  // Raised rim on both faces.
  for (const z of [0.13, -0.13]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 8, 40), gold);
    rim.position.z = z;
    g.add(rim);
  }
  // Embossed star.
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.26 : 0.58, a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i) star.lineTo(Math.cos(a) * r, Math.sin(a) * r); else star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const sg = new THREE.ExtrudeGeometry(star, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  const s1 = new THREE.Mesh(sg, dark);
  s1.position.z = 0.12;
  g.add(s1);
  g.rotation.set(-0.35, 0.55, 0.1);
  return g;
}

function crystal(color: number, h: number, r: number): THREE.Mesh {
  // A six-sided prism with pointed ends.
  const pts = [new THREE.Vector2(0, -h * 0.5), new THREE.Vector2(r, -h * 0.28), new THREE.Vector2(r, h * 0.22), new THREE.Vector2(0, h * 0.5)];
  const geo = new THREE.LatheGeometry(pts, 6);
  const m = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.2, flatShading: true, emissive: color, emissiveIntensity: 0.3 });
  return new THREE.Mesh(geo, m);
}

function shard(): THREE.Object3D {
  // A cluster of violet crystals.
  const g = new THREE.Group();
  const main = crystal(0x9a3cff, 2, 0.42);
  main.rotation.z = -0.12;
  const left = crystal(0x7a22e0, 1.25, 0.3);
  left.position.set(-0.45, -0.32, 0.05); left.rotation.z = 0.55;
  const right = crystal(0xb060ff, 1.05, 0.26);
  right.position.set(0.42, -0.4, 0.1); right.rotation.z = -0.6;
  g.add(main, left, right);
  g.rotation.y = 0.4;
  return g;
}

function jewel(): THREE.Object3D {
  // A brilliant cut: flat table, sloped crown, pointed pavilion.
  const pts = [
    new THREE.Vector2(0, -0.95), new THREE.Vector2(1, 0), new THREE.Vector2(1, 0.12),
    new THREE.Vector2(0.62, 0.5), new THREE.Vector2(0, 0.5),
  ];
  const geo = new THREE.LatheGeometry(pts, 8);
  const m = new THREE.MeshStandardMaterial({ color: 0x18bfff, metalness: 0.25, roughness: 0.15, flatShading: true, emissive: 0x0a62d0, emissiveIntensity: 0.45 });
  const mesh = new THREE.Mesh(geo, m);
  const g = new THREE.Group();
  g.add(mesh);
  g.rotation.set(0.35, 0.35, 0);
  return g;
}

function ember(): THREE.Object3D {
  // A flame-shaped glowing crystal with a bright core.
  const outer = [
    new THREE.Vector2(0, -0.9), new THREE.Vector2(0.55, -0.6), new THREE.Vector2(0.7, -0.1),
    new THREE.Vector2(0.5, 0.45), new THREE.Vector2(0.18, 0.95), new THREE.Vector2(0, 1.25),
  ];
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.LatheGeometry(outer, 10), new THREE.MeshStandardMaterial({
    color: 0xff5a10, emissive: 0xff3a00, emissiveIntensity: 1, roughness: 0.4, flatShading: true,
  })));
  const core = new THREE.Mesh(new THREE.LatheGeometry(outer.map((p) => p.clone().multiplyScalar(0.55)), 10), new THREE.MeshBasicMaterial({ color: 0xffd040 }));
  core.position.set(0, -0.2, 0.32);
  g.add(core);
  g.rotation.set(0.15, 0.4, 0);
  return g;
}

function bevel(shape: THREE.Shape, depth: number, b: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return g;
}

function upArrow(): THREE.Object3D {
  // A chunky green arrow pointing up (Upgrades).
  const s = new THREE.Shape();
  s.moveTo(0, 1); s.lineTo(0.9, 0.05); s.lineTo(0.38, 0.05); s.lineTo(0.38, -0.95); s.lineTo(-0.38, -0.95);
  s.lineTo(-0.38, 0.05); s.lineTo(-0.9, 0.05); s.lineTo(0, 1);
  const m = new THREE.Mesh(bevel(s, 0.35, 0.09), new THREE.MeshStandardMaterial({ color: 0x46e04a, emissive: 0x157a18, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.1 }));
  const g = new THREE.Group();
  g.add(m);
  g.rotation.set(-0.2, 0.45, 0);
  return g;
}

function anvil(): THREE.Object3D {
  // A blacksmith's anvil with a horn, on a stout foot (Forge), and a glowing hot bar on top.
  const s = new THREE.Shape();
  s.moveTo(-1.25, 0.55); s.quadraticCurveTo(-0.95, 0.25, -0.55, 0.22); s.lineTo(-0.35, 0.2); s.lineTo(-0.3, -0.2);
  s.lineTo(-0.62, -0.55); s.lineTo(0.72, -0.55); s.lineTo(0.42, -0.2); s.lineTo(0.48, 0.2); s.lineTo(0.95, 0.24);
  s.lineTo(0.95, 0.55); s.lineTo(-1.25, 0.55);
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a94a8, metalness: 0.85, roughness: 0.32, emissive: 0x2a3040, emissiveIntensity: 0.4 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(bevel(s, 0.75, 0.06), metal));
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.14, 0.22), new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff5a10, emissiveIntensity: 1 }));
  bar.position.set(0.1, 0.62, 0.05); bar.rotation.y = 0.3;
  g.add(bar);
  g.rotation.set(0.35, -0.5, 0);
  return g;
}

function scroll(): THREE.Object3D {
  // A parchment scroll with wooden rollers and a red seal (Quests).
  const g = new THREE.Group();
  const paper = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.6, 0.06), new THREE.MeshStandardMaterial({ color: 0xf4e2b0, roughness: 0.8, emissive: 0x5a4a20, emissiveIntensity: 0.25 }));
  g.add(paper);
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a5a2a, roughness: 0.5, emissive: 0x3a1a08, emissiveIntensity: 0.3 });
  for (const y of [0.85, -0.85]) {
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.45, 14).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xead2a0, roughness: 0.8, emissive: 0x4a3a18, emissiveIntensity: 0.25 }));
    roll.position.y = y;
    g.add(roll);
    for (const x of [0.8, -0.8]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), wood);
      knob.position.set(x, y, 0);
      g.add(knob);
    }
  }
  const ink = new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.9 });
  for (const [y, w] of [[0.42, 0.9], [0.18, 0.75], [-0.06, 0.85]] as const) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, 0.02), ink);
    line.position.set(-0.05, y, 0.04);
    g.add(line);
  }
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe0302a, emissive: 0x7a0a08, emissiveIntensity: 0.5, roughness: 0.4 }));
  seal.position.set(0.25, -0.42, 0.06);
  g.add(seal);
  g.rotation.set(-0.15, 0.4, -0.12);
  return g;
}

function chest(open: boolean): THREE.Object3D {
  // A wooden treasure chest with gold bands and a lock; open, its lid swings back on a pile of gold.
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xa8622a, roughness: 0.6, emissive: 0x4a2008, emissiveIntensity: 0.35, flatShading: true });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 0.8, roughness: 0.3, emissive: 0x9a6a00, emissiveIntensity: 0.45 });
  const W = 1.8, D = 1.1, H = 0.95;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wood);
  body.position.y = H / 2;
  g.add(body);
  for (const x of [-0.62, 0.62]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.16, H + 0.04, D + 0.06), gold);
    band.position.set(x, H / 2, 0);
    g.add(band);
  }
  const rim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.1, D + 0.06), gold);
  rim.position.y = H;
  g.add(rim);
  // Lid: a half cylinder hinged along the back edge.
  const hinge = new THREE.Group();
  hinge.position.set(0, H, -D / 2);
  const lidGeo = new THREE.CylinderGeometry(D / 2, D / 2, W, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2);
  const lid = new THREE.Mesh(lidGeo, wood);
  lid.position.z = D / 2;
  hinge.add(lid);
  for (const x of [-0.62, 0.62]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 + 0.03, D / 2 + 0.03, 0.16, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2), gold);
    b.position.set(x, 0, D / 2);
    hinge.add(b);
  }
  if (!open) {
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.12), gold);
    lock.position.set(0, H - 0.05, D / 2 + 0.06);
    g.add(lock);
  } else {
    hinge.rotation.x = -1.9;
    const pile = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffd24a, metalness: 0.7, roughness: 0.25, emissive: 0xc88a00, emissiveIntensity: 0.7 }));
    pile.scale.set(1.05, 0.45, 0.6);
    pile.position.y = H - 0.02;
    g.add(pile);
  }
  g.add(hinge);
  g.rotation.set(0.42, -0.5, 0);
  return g;
}

const BUILD: Record<Kind, () => THREE.Object3D> = {
  coin, gem: shard, jewel, ember, up: upArrow, anvil, scroll, chest: () => chest(false), chestOpen: () => chest(true),
};

/** Render the icons and switch the UI over to them. Resolves true on success. */
export function installCurrencyIcons(size = 96): boolean {
  let r: THREE.WebGLRenderer;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return false;
  }
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  r.setClearColor(0x000000, 0);
  const pmrem = new THREE.PMREMGenerator(r);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.55; // reflections without washing the colours out
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-2, 3, 4);
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.5));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  cam.position.set(0, 0, 10);
  const root = document.documentElement;
  for (const kind of Object.keys(BUILD) as Kind[]) {
    const obj = BUILD[kind]();
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const half = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2 * 1.04;
    cam.left = c.x - half; cam.right = c.x + half; cam.top = c.y + half; cam.bottom = c.y - half;
    cam.updateProjectionMatrix();
    r.render(scene, cam);
    root.style.setProperty(`--ico-${kind}`, `url(${r.domElement.toDataURL('image/png')})`);
    scene.remove(obj);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
  }
  env.dispose();
  pmrem.dispose();
  r.dispose();
  r.forceContextLoss();
  root.classList.add('icons3d');
  return true;
}
