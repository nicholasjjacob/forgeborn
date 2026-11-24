import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { cloneActor, findClip, loadModel, measure } from '../render/models';
import { SKINS, lookOf, skinDef } from '../sim/skins';
import { applyLook } from '../render/heroLook';
import { buildKitWeapon, KIT_MODELS } from '../render/weapons3d';
import { FORMS } from '../sim/weapons';
import type { Sim } from '../sim/sim';
import { gi } from './icons';
import { bindSheetTaps } from './tap';

/**
 * Heroes screen: pick which hero (class) to play. A live 3D preview of the highlighted hero
 * turns on a little stage; below, every skin as a card with its portrait. Owned skins can be
 * worn; the rest are bought with gems. The preview has its own small WebGL canvas, created when
 * the screen opens and released when it closes.
 */

const portraits = new Map<string, string>();
const AUTO_SPIN = 0.7;     // rad/s when left alone
const DRAG_TURN = 0.012;   // radians per pixel dragged
const MAX_FLING = 12;      // rad/s

export class HeroesUI {
  private wrap: HTMLElement | null = null;
  private pick = '';
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private shown = '';
  private raf = 0;
  private last = 0;
  /** Turntable: spin speed (rad/s), the direction it settles back to, and an active drag. */
  private spin = AUTO_SPIN;
  private spinDir = 1;
  private drag: { id: number; x: number; t: number } | null = null;

  constructor(private readonly sim: Sim, private readonly toast: (m: string) => void) {}

  open(): void {
    if (this.wrap) return;
    this.pick = this.sim.save.skin;
    const wrap = document.createElement('div');
    wrap.className = 'modal sheet-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Heroes');
    wrap.innerHTML = `
      <div class="sheet heroes-sheet">
        <div class="ribbon"><span class="ribbon-text">Heroes</span></div>
        <button type="button" class="sheet-x" aria-label="Close">✕</button>
        <div class="sheet-body">
          <div class="hero-stage"><canvas></canvas><div class="hero-gems"><i class="jewel"></i><b></b></div></div>
          <div class="hero-info"><b class="hero-name"></b><span class="hero-role"></span><span class="hero-perk"></span><span class="hero-weapons"></span></div>
          <div class="hero-looks" role="radiogroup" aria-label="Style"></div>
          <div class="hero-action"></div>
          <div class="hero-grid"></div>
        </div>
      </div>`;
    bindSheetTaps(wrap, (act) => this.run(act));
    document.addEventListener('keydown', this.onKey);
    document.body.appendChild(wrap);
    this.wrap = wrap;
    this.setupStage(wrap.querySelector('canvas')!);
    this.render();
    void this.makePortraits();
  }

  close(): void {
    if (!this.wrap) return;
    cancelAnimationFrame(this.raf);
    this.mixer?.stopAllAction();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null; this.scene = null; this.camera = null; this.model = null; this.mixer = null; this.shown = '';
    this.wrap.remove();
    this.wrap = null;
    document.removeEventListener('keydown', this.onKey);
  }

  private readonly onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); };

  private run(action: string): void {
    if (action === 'close') { this.close(); return; }
    const [act, id] = action.split(':');
    const sim = this.sim;
    if (act === 'pick') {
      sfx.play('tick');
      this.pick = id;
    } else if (act === 'equip') {
      if (sim.selectSkin(id)) { sfx.play('stage'); this.toast(`${skinDef(id).name} ready for battle!`); }
    } else if (act === 'look') {
      if (sim.setLook(this.pick, id)) {
        sfx.play('tick');
        this.shown = ''; // rebuild the preview in the new style
        portraits.delete(this.pick);
        void this.makePortraits();
      }
    } else if (act === 'buy') {
      if (sim.buySkin(id)) { sfx.play('achieve'); this.toast(`New hero: ${skinDef(id).name}!`); }
      else { sfx.play('tick'); this.toast('Not enough gems yet'); }
    }
    this.render();
  }

  /** Cards, the info line and the action button. */
  private render(): void {
    if (!this.wrap) return;
    const s = this.sim.save;
    const def = skinDef(this.pick);
    const owned = this.sim.ownsSkin(def.id);
    const worn = s.skin === def.id;
    const gems = s.missions.gems;
    this.wrap.querySelector('.hero-gems b')!.textContent = String(gems);
    this.wrap.querySelector('.hero-name')!.textContent = def.name;
    this.wrap.querySelector('.hero-role')!.textContent = def.role;
    this.wrap.querySelector('.hero-perk')!.textContent = def.perk;
    this.wrap.querySelector('.hero-weapons')!.textContent = `Weapons: ${def.forms.map((f) => FORMS[f].name).join(', ')}${def.forms.some((f) => FORMS[f].ranged) ? ' · ranged' : ''}`;
    this.wrap.querySelector('.hero-action')!.innerHTML = worn
      ? `<button type="button" class="btn big grey" disabled>${gi('check-mark', 'green')} Equipped</button>`
      : owned
        ? `<button type="button" class="btn big green" data-act="equip:${def.id}">Equip</button>`
        : `<button type="button" class="btn big blue" data-act="buy:${def.id}" ${gems >= def.cost ? '' : 'disabled'}>Unlock <i class="jewel"></i>${def.cost}</button>`;
    // Styles (e.g. the Knight's visor): shown for owned heroes that have any.
    const looksEl = this.wrap.querySelector<HTMLElement>('.hero-looks')!;
    const cur = lookOf(def.id, s.looks);
    looksEl.hidden = !owned || !def.looks;
    looksEl.innerHTML = owned && def.looks
      ? def.looks.map((l) => `<button type="button" role="radio" aria-checked="${l.id === cur}" class="${l.id === cur ? 'on' : ''}" data-act="look:${l.id}">${l.name}</button>`).join('')
      : '';
    this.wrap.querySelector('.hero-grid')!.innerHTML = SKINS.map((k) => {
      const have = this.sim.ownsSkin(k.id);
      const tag = s.skin === k.id ? `${gi('check-mark', 'green')} Equipped` : have ? 'Owned' : `<i class="jewel"></i>${k.cost}`;
      const img = portraits.get(k.id);
      return `<button type="button" class="hero-card ${k.id === this.pick ? 'sel' : ''} ${have ? 'owned' : 'locked'}" data-act="pick:${k.id}">
        <span class="hero-portrait">${img ? `<img alt="" src="${img}" />` : ''}${have ? '' : `<i class="hero-lock">${gi('padlock', 'grey')}</i>`}</span>
        <span class="hero-card-name">${k.name}</span><span class="hero-card-role">${k.role}</span><span class="hero-tag">${tag}</span></button>`;
    }).join('');
    void this.showModel(this.pick);
  }

  // --- 3D preview ------------------------------------------------------------------------

  private setupStage(canvas: HTMLCanvasElement): void {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a4a7a, 2.2));
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
    sun.position.set(-3, 6, 5);
    scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0x0a1035, transparent: true, opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.scale.setScalar(0.62);
    scene.add(floor);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 1.25, 4.2);
    this.camera.lookAt(0, 0.75, 0);
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.mixer?.update(dt);
      if (this.model) centerOnHips(this.model);
      // Not held: ease back to the slow auto-spin (keeping any fling's momentum for a moment).
      if (!this.drag) {
        this.spin += (AUTO_SPIN * this.spinDir - this.spin) * (1 - Math.exp(-dt * 1.8));
        if (this.model) this.model.rotation.y += this.spin * dt;
      }
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);

    // Drag left/right to turn the hero by hand; let go and it carries on spinning.
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { id: e.pointerId, x: e.clientX, t: performance.now() };
      this.spin = 0;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const now = performance.now();
      const turn = (e.clientX - d.x) * DRAG_TURN;
      if (this.model) this.model.rotation.y += turn;
      const dt = Math.max(0.008, (now - d.t) / 1000);
      this.spin = this.spin * 0.5 + (turn / dt) * 0.5; // smoothed fling speed
      d.x = e.clientX; d.t = now;
    });
    const release = (e: PointerEvent) => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      // A finger held still before lifting shouldn't fling.
      if (performance.now() - this.drag.t > 120) this.spin = 0;
      this.spin = Math.max(-MAX_FLING, Math.min(MAX_FLING, this.spin));
      if (Math.abs(this.spin) > 0.3) this.spinDir = Math.sign(this.spin);
      this.drag = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  private draw(): void {
    const r = this.renderer, cam = this.camera, scene = this.scene;
    if (!r || !cam || !scene) return;
    const c = r.domElement;
    const w = c.clientWidth, h = c.clientHeight;
    if (w && h && (c.width !== Math.floor(w * r.getPixelRatio()) || c.height !== Math.floor(h * r.getPixelRatio()))) {
      r.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    r.render(scene, cam);
  }

  /** A posed, normalised copy of a skin (1.5 units tall, feet on the ground). */
  private async build(id: string): Promise<{ obj: THREE.Object3D; mixer: THREE.AnimationMixer } | null> {
    const [g, anims] = await Promise.all([loadModel(`hero_${id}`), loadModel('hero_anims')]).catch(() => [null, null]);
    if (!g || !anims) return null;
    const inner = cloneActor(g);
    // The battlefield may be wearing this same model: undo its placement and its hero render layer.
    inner.position.set(0, 0, 0);
    inner.scale.setScalar(1);
    inner.rotation.set(0, 0, 0);
    inner.traverse((o) => o.layers.set(0));
    for (const n of ['weapon-hand', 'weapon-kit-r', 'weapon-kit-l']) inner.getObjectByName(n)?.removeFromParent(); // the battlefield's weapon, if cloned along
    applyLook(inner, id, lookOf(id, this.sim.save.looks));
    // The clone copies whatever pose the battlefield hero was in (mid-run, mid-swing): measure it at rest.
    inner.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.pose(); });
    const dims = measure(inner);
    const k = 1.5 / dims.h;
    inner.scale.setScalar(k);
    inner.position.set(-dims.cx * k, -dims.minY * k, -dims.cz * k);
    // The hero holds their weapon: the equipped one, or what they would draw when picked.
    // (Added after measuring, so a tall staff does not shrink the hero.)
    await Promise.all(KIT_MODELS.map((n) => loadModel(n).catch(() => null)));
    const s = this.sim.save;
    const w = id === s.skin ? s.equipped : s.gear[id] ?? null;
    const kit = buildKitWeapon(w?.form ?? skinDef(id).forms[0], w?.rarity ?? 0);
    if (kit) {
      inner.getObjectByName('handslotr')?.add(kit.group);
      if (kit.off) inner.getObjectByName('handslotl')?.add(kit.off);
    }
    const obj = new THREE.Group();
    obj.add(inner);
    const mixer = new THREE.AnimationMixer(inner);
    const idle = findClip(anims, ['Idle_A']);
    if (idle) mixer.clipAction(idle).play();
    mixer.update(0.4);
    centerOnHips(obj);
    return { obj, mixer };
  }

  private async showModel(id: string): Promise<void> {
    if (this.shown === id || !this.scene) return;
    this.shown = id;
    const built = await this.build(id);
    if (!built || !this.scene || this.shown !== id) return;
    if (this.model) this.scene.remove(this.model);
    this.mixer?.stopAllAction();
    built.obj.rotation.y = 0.5;
    this.scene.add(built.obj);
    this.model = built.obj;
    this.mixer = built.mixer;
  }

  /** Render each skin once, facing the camera, into a portrait image for its card. */
  private async makePortraits(): Promise<void> {
    for (const k of SKINS) {
      if (portraits.has(k.id)) continue;
      const built = await this.build(k.id);
      if (!built || !this.renderer || !this.scene || !this.camera) return;
      const r = this.renderer;
      const keep = this.model;
      if (keep) keep.visible = false;
      this.scene.add(built.obj);
      const size = new THREE.Vector2();
      r.getSize(size);
      const aspect = this.camera.aspect;
      r.setSize(160, 160, false);
      this.camera.aspect = 1;
      this.camera.position.set(0, 1.05, 3.1);
      this.camera.lookAt(0, 0.8, 0);
      this.camera.updateProjectionMatrix();
      r.render(this.scene, this.camera);
      portraits.set(k.id, r.domElement.toDataURL('image/png'));
      this.scene.remove(built.obj);
      if (keep) keep.visible = true;
      this.camera.position.set(0, 1.25, 4.2);
      this.camera.lookAt(0, 0.75, 0);
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
      r.setSize(size.x, size.y, false);
      this.render();
    }
  }
}

const _hip = new THREE.Vector3();
/**
 * Keep the hero standing on the turntable's axis: shift the model so its hips sit at the centre
 * (x/z only), whatever pose or animation it is in. Otherwise it can orbit off to one side as it spins.
 */
function centerOnHips(obj: THREE.Object3D): void {
  const inner = obj.children[0];
  const hips = inner?.getObjectByName('hips');
  if (!inner || !hips) return;
  obj.updateMatrixWorld(true);
  obj.worldToLocal(hips.getWorldPosition(_hip));
  inner.position.x -= _hip.x;
  inner.position.z -= _hip.z;
}
