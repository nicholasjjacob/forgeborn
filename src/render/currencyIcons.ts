import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * 3D currency icons: a gold coin, a purple shard crystal, a cut blue gem and a glowing ember,
 * modelled here and rendered once at startup (with studio reflections) into small PNGs. They
 * replace the flat CSS icons everywhere (.coin, .gem, .jewel, .ember) through CSS variables
 * --ico-coin / --ico-gem / --ico-jewel / --ico-ember and the html.icons3d class. If WebGL isn't
 * available the CSS icons simply stay.
 */

type Kind = 'coin' | 'gem' | 'jewel' | 'ember';

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

const BUILD: Record<Kind, () => THREE.Object3D> = { coin, gem: shard, jewel, ember };

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
