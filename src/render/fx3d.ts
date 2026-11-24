import * as THREE from 'three';

/**
 * 3D combat effects living in the world: glowing sparks (additive), solid puffs of smoke, dust
 * and monster colour (normal blending), expanding shockwave rings on the ground, a rising light
 * pillar for level-ups, and the weapon swing trail. Everything is pooled and preallocated;
 * nothing is created per hit.
 */

const MAX_GLOW = 320;
const MAX_PUFFS = 160;
const MAX_RINGS = 10;
const TRAIL_N = 14;

function radialTexture(stops: [number, string][], cx = 32, cy = 32): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(cx, cy, 1, 32, 32, 32);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const glowTexture = () => radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.85)'], [0.6, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]);
/** Soft round puff, lit from the top-left, for smoke and dust. */
const puffTexture = () => radialTexture([[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(232,232,232,0.92)'], [0.85, 'rgba(190,190,190,0.5)'], [1, 'rgba(190,190,190,0)']], 25, 25);

/**
 * Camera-facing particles in one instanced mesh. Glow pools blend additively and fade by
 * darkening; solid pools blend normally and fade by swelling then shrinking away.
 */
class Pool {
  readonly mesh: THREE.InstancedMesh;
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  private readonly vx: Float32Array; private readonly vy: Float32Array; private readonly vz: Float32Array;
  private readonly age: Float32Array; private readonly life: Float32Array; private readonly size: Float32Array;
  private readonly grav: Float32Array; private readonly drag: Float32Array;
  private readonly col: THREE.Color[] = [];
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(scene: THREE.Scene, private readonly n: number, tex: THREE.Texture, private readonly additive: boolean) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: additive ? 1 : 0.9,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 6 : 5;
    const f = () => new Float32Array(n);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.size = f(); this.grav = f(); this.drag = f();
    for (let i = 0; i < n; i++) {
      this.col.push(new THREE.Color());
      this.mesh.setColorAt(i, this.c.setRGB(0, 0, 0));
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    scene.add(this.mesh);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, grav: number, drag: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size;
    this.grav[i] = grav; this.drag[i] = drag;
    this.col[i].setHex(color);
  }

  update(dt: number, q: THREE.Quaternion): void {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) continue;
      any = true;
      this.age[i] += dt;
      const k = Math.max(0, 1 - this.age[i] / this.life[i]);
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d; this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d - this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.3) { this.py[i] = 0.3; this.vy[i] *= -0.3; }
      const sz = this.additive
        ? this.size[i] * (0.4 + 0.6 * k)
        : this.size[i] * Math.min(1, (1 - k) * 6) * (0.3 + 0.9 * k);
      if (k <= 0) this.m.makeScale(0, 0, 0);
      else this.m.compose(this.p.set(this.px[i], this.py[i], this.pz[i]), q, this.s.set(sz, sz, sz));
      this.mesh.setMatrixAt(i, this.m);
      // Additive black is invisible, so glow fades by darkening.
      this.mesh.setColorAt(i, this.additive ? this.c.copy(this.col[i]).multiplyScalar(k * k) : this.c.copy(this.col[i]));
    }
    if (!any) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

interface Ring { mesh: THREE.Mesh; t: number; life: number; size: number }

export class Fx3D {
  private readonly glow: Pool;
  private readonly smoke: Pool;
  private readonly rings: Ring[] = [];
  private readonly pillar: THREE.Mesh;
  private pillarT = 0;
  // Swing trail
  private readonly trail: THREE.Mesh;
  private readonly trailPos: Float32Array;
  private readonly trailCol: Float32Array;
  private readonly tips: THREE.Vector3[] = [];
  private readonly bases: THREE.Vector3[] = [];
  private readonly trailAge = new Float32Array(TRAIL_N);
  private trailHead = 0;
  private trailOn = false;
  private readonly trailColor = new THREE.Color();
  /** Low quality: half the particles. */
  low = false;
  private readonly q = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    const tex = glowTexture();
    this.glow = new Pool(scene, MAX_GLOW, tex, true);
    this.smoke = new Pool(scene, MAX_PUFFS, puffTexture(), false);

    const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RINGS; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.rings.push({ mesh, t: 0, life: 1, size: 1 });
    }

    const pg = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
    pg.translate(0, 0.5, 0);
    this.pillar = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: tex, color: 0xffd23f, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    this.pillar.visible = false;
    scene.add(this.pillar);

    // Trail: a strip between the blade's base and tip over the last few frames.
    const geo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL_N * 2 * 3);
    this.trailCol = new Float32Array(TRAIL_N * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    this.trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 7;
    this.trail.visible = false;
    scene.add(this.trail);
    for (let i = 0; i < TRAIL_N; i++) { this.tips.push(new THREE.Vector3()); this.bases.push(new THREE.Vector3()); this.trailAge[i] = 99; }
  }

  /** Glowing particle. Velocities in units/s; gravity pulls down. */
  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, grav = 60, drag = 2): void {
    this.glow.emit(x, y, z, vx, vy, vz, life, size, color, grav, drag);
  }

  /** Solid puff (smoke, dust, monster colour). Slight negative gravity: it drifts up. */
  private puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, grav = -8, drag = 3): void {
    this.smoke.emit(x, y, z, vx, vy, vz, life, size, color, grav, drag);
  }

  private n(count: number): number { return this.low ? Math.ceil(count / 2) : count; }

  /** Sparks flying off a struck monster (game x, y; h = height of the hit). */
  hit(x: number, y: number, h: number, crit: boolean, color = 0xfff4d0): void {
    const n = this.n(crit ? 16 : 8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (crit ? 70 : 45) * (0.5 + Math.random());
      this.spark(x, h, y, Math.cos(a) * sp, 20 + Math.random() * 40, Math.sin(a) * sp, 0.25 + Math.random() * 0.2, crit ? 3.6 : 2.6, color, 140, 3);
    }
    this.spark(x, h, y, 0, 0, 0, 0.14, crit ? 18 : 12, crit ? 0xffd23f : 0xffffff, 0, 0); // flash
    if (crit) this.ring(x, y, 0xffd23f, 14, 0.3);
  }

  /** A monster falls: puffs of its colour, white sparks, and a ground shockwave. */
  kill(x: number, y: number, boss: boolean, color: number): void {
    const n = this.n(boss ? 30 : 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (boss ? 55 : 30) * (0.3 + Math.random());
      this.puff(x, 3 + Math.random() * 6, y, Math.cos(a) * sp, 8 + Math.random() * (boss ? 40 : 20), Math.sin(a) * sp, 0.5 + Math.random() * 0.3, (boss ? 9 : 5) + Math.random() * 3, color);
      this.spark(x, 6, y, Math.cos(a) * sp * 1.6, 30 + Math.random() * 40, Math.sin(a) * sp * 1.6, 0.4 + Math.random() * 0.3, 2.4, 0xffffff, 90, 2);
    }
    this.ring(x, y, boss ? 0xffd23f : 0xffffff, boss ? 60 : 18, boss ? 0.7 : 0.4);
  }

  /** Dust thrown up around an impact on the ground (boss slams). */
  dust(x: number, y: number, radius: number): void {
    const n = this.n(28);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const r = radius * (0.3 + Math.random() * 0.7);
      this.puff(x + Math.cos(a) * r, 1, y + Math.sin(a) * r, Math.cos(a) * 30, 12 + Math.random() * 20, Math.sin(a) * 30, 0.7 + Math.random() * 0.3, 7 + Math.random() * 4, 0xb8a080, 10, 2.5);
    }
    this.ring(x, y, 0xff8a4a, radius * 1.1, 0.45);
  }

  /** Lightning spark chain between two points (chain shock). */
  zap(x1: number, y1: number, x2: number, y2: number): void {
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, j = i === 0 || i === steps ? 0 : (Math.random() - 0.5) * 5;
      this.spark(x1 + (x2 - x1) * t + j, 6 + Math.random() * 3, y1 + (y2 - y1) * t + j, 0, 8, 0, 0.2 + Math.random() * 0.1, 3.6, i % 2 ? 0x9fe8ff : 0xffffff, 0, 0);
    }
  }

  /** Red sparks when the hero takes a hit. */
  hurt(x: number, y: number): void {
    const n = this.n(8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 25;
      this.spark(x, 9, y, Math.cos(a) * sp, 20 + Math.random() * 30, Math.sin(a) * sp, 0.3, 2.8, 0xff5a4a, 120, 3);
    }
  }

  /** Golden light pillar and rising motes (level up, zone clear). */
  levelUp(x: number, y: number): void {
    this.pillar.position.set(x, 0, y);
    this.pillarT = 1.1;
    const n = this.n(30);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 8;
      this.spark(x + Math.cos(a) * r, Math.random() * 6, y + Math.sin(a) * r, 0, 25 + Math.random() * 35, 0, 0.9 + Math.random() * 0.5, 2.6 + Math.random() * 1.5, i % 2 ? 0xffd23f : 0xffffff, -15, 0.5);
    }
    this.ring(x, y, 0xffd23f, 30, 0.6);
  }

  /** Spawn shimmer. */
  spawn(x: number, y: number, big: boolean): void {
    const n = this.n(big ? 24 : 8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * (big ? 14 : 6);
      this.spark(x + Math.cos(a) * r, Math.random() * 3, y + Math.sin(a) * r, 0, 18 + Math.random() * 25, 0, 0.5 + Math.random() * 0.3, 3 + Math.random() * 2, 0xc8b8ff, -10, 1);
    }
  }

  ring(x: number, y: number, color: number, size: number, life: number): void {
    let best = this.rings[0];
    for (const r of this.rings) if (!r.mesh.visible) { best = r; break; }
    best.mesh.visible = true;
    best.mesh.position.set(x, 0.4, y);
    (best.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    best.t = 0; best.life = life; best.size = size;
  }

  /**
   * Feed the blade's world-space base and tip every frame. `active` is true while swinging;
   * the trail keeps fading for a moment after.
   */
  trailSample(active: boolean, base: THREE.Vector3, tip: THREE.Vector3, color: number): void {
    if (active && !this.trailOn) {
      // New swing: collapse old samples onto the blade so no streak joins it to the last swing.
      for (let i = 0; i < TRAIL_N; i++) { this.tips[i].copy(tip); this.bases[i].copy(base); this.trailAge[i] = 99; }
    }
    this.trailOn = active;
    if (active) {
      this.trailHead = (this.trailHead + 1) % TRAIL_N;
      this.tips[this.trailHead].copy(tip);
      this.bases[this.trailHead].copy(base);
      this.trailAge[this.trailHead] = 0;
      this.trailColor.setHex(color);
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    this.q.copy(camera.quaternion);
    this.glow.update(dt, this.q);
    this.smoke.update(dt, this.q);

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const p = r.t / r.life;
      if (p >= 1) { r.mesh.visible = false; continue; }
      const e = 1 - (1 - p) * (1 - p);
      r.mesh.scale.setScalar(r.size * (0.2 + 0.8 * e));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p;
    }

    if (this.pillarT > 0) {
      this.pillarT -= dt;
      const p = 1 - this.pillarT / 1.1;
      this.pillar.visible = this.pillarT > 0;
      this.pillar.scale.set(7 * (1 - p * 0.6), 70 * Math.min(1, p * 4), 7 * (1 - p * 0.6));
      (this.pillar.material as THREE.MeshBasicMaterial).opacity = Math.min(1, (1 - p) * 1.5) * 0.7;
    }

    // Trail: newest sample bright, older ones fading; hidden once all have faded.
    let any = false;
    for (let k = 0; k < TRAIL_N; k++) {
      const i = (this.trailHead - k + TRAIL_N) % TRAIL_N;
      this.trailAge[i] += dt;
      const a = Math.max(0, 1 - this.trailAge[i] / 0.16) * (1 - k / TRAIL_N);
      if (a > 0) any = true;
      const t = this.tips[i], b = this.bases[i];
      this.trailPos.set([b.x, b.y, b.z, t.x, t.y, t.z], k * 6);
      const c = this.trailColor;
      this.trailCol.set([c.r * a * 0.15, c.g * a * 0.15, c.b * a * 0.15, c.r * a, c.g * a, c.b * a], k * 6);
    }
    this.trail.visible = any;
    if (any) {
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.geometry.attributes.color.needsUpdate = true;
    }
  }
}
