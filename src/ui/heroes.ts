import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { cloneActor, loadModel, measure } from '../render/models';
import { SKINS, heroModelFile, lookOf, skinDef } from '../sim/skins';
import { applyLook, applyPalette, paletteReady } from '../render/heroLook';
import { heroClip, heroScale, heroWeaponScale, holdsPose, loadHeroAnims, showcaseIdle, showcaseUpright } from '../render/heroRig';
import { buildKitWeapon, heldLeft, holdWeapon, idleTilt, kitModels } from '../render/weapons3d';
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
/** Stage camera: framed so a regular hero (1.5 units) and the 1.4× Warlord both fit. */
const STAGE_CAM: [number, number, number] = [0, 1.3, 5.0];
const STAGE_LOOK: [number, number, number] = [0, 1.0, 0];
/**
 * How far a hero reaches out from their spin axis, weapon included (a katana held out to the side
 * reaches much further than the hero's own body), so the stage can step back to keep it in view.
 */
function reachOf(obj: THREE.Object3D): number {
  const was = obj.rotation.y;
  obj.rotation.y = 0;
  obj.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let r = 0;
  obj.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      r = Math.max(r, Math.hypot(v.x, v.z));
    }
  });
  obj.rotation.y = was;
  obj.updateMatrixWorld(true);
  return r;
}

const AUTO_SPIN = 0.7;     // rad/s when left alone
const DRAG_TURN = 0.012;   // radians per pixel dragged
const MAX_FLING = 12;      // rad/s

/** Wait for the next frame (or a moment, where frames are paused in a hidden tab). */
function nextFrame(): Promise<void> {
  return new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 50); });
}

/**
 * The Heroes screen's 3D stage: one WebGL context for the whole session (made during the loading
 * screen), so opening the screen never waits for a new context, shader compiles or texture uploads.
 */
interface HeroStage { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; bound: boolean }
let stage: HeroStage | null = null;
function heroStage(): HeroStage {
  if (stage) return stage;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a4a7a, 2.2));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
  sun.position.set(-3, 6, 5);
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0x0a1035, transparent: true, opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.scale.setScalar(0.62);
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(...STAGE_CAM);
  camera.lookAt(...STAGE_LOOK);
  stage = { renderer: r, scene, camera, bound: false };
  return stage;
}

/**
 * Stage heroes ready to show, by what they were built as (hero, style, colours, weapon): made
 * behind the loading screen and kept between opens, so picking a hero shows them at once.
 */
const ready = new Map<string, { obj: THREE.Object3D; mixer: THREE.AnimationMixer }>();
function modelKey(sim: Sim, id: string): string {
  const s = sim.save;
  const w = id === s.skin ? s.equipped : s.runs[id]?.equipped ?? null;
  return [heroModelFile(id, s.bones), lookOf(id, s.looks), s.palettes[id] ?? 0, w?.form ?? -1, w?.rarity ?? 0].join('|');
}

/**
 * Draw `obj` alone into a size×size image from a given camera, off-screen (a render target), on
 * the stage's renderer (so the live stage never resizes or flickers). `hide` is kept out of it.
 */
function snapshotOn(obj: THREE.Object3D, pos: [number, number, number], look: [number, number, number], size: number, hide: THREE.Object3D | null = null): string {
  const { renderer: r, scene, camera: cam } = heroStage();
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  if (hide) hide.visible = false;
  scene.add(obj);
  const shot = new THREE.PerspectiveCamera(cam.fov, 1, 0.1, 50);
  shot.position.set(...pos);
  shot.lookAt(...look);
  r.setRenderTarget(rt);
  r.setClearColor(0x000000, 0);
  r.clear();
  r.render(scene, shot);
  const px = new Uint8Array(size * size * 4);
  r.readRenderTargetPixels(rt, 0, 0, size, size, px);
  r.setRenderTarget(null);
  scene.remove(obj);
  if (hide) hide.visible = true;
  rt.dispose();
  // Pixels come bottom row first: flip them into a canvas.
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

const PORTRAIT_CAM: [number, number, number] = [0, 1.05, 3.1];
const PORTRAIT_LOOK: [number, number, number] = [0, 0.8, 0];

/**
 * Behind the loading screen: make the Heroes screen's stage and get every hero onto the GPU
 * (built, shaders compiled, textures uploaded) along with their card portraits, the current
 * hero first. Opening the screen and picking any hero then shows them at once.
 */
export async function warmHeroStage(sim: Sim, onStep?: (f: number) => void): Promise<void> {
  const st = heroStage();
  st.renderer.setSize(200, 200, false);
  st.camera.aspect = 1;
  st.camera.updateProjectionMatrix();
  const ids = [sim.save.skin, ...SKINS.map((k) => k.id).filter((id) => id !== sim.save.skin)];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i], key = modelKey(sim, id);
    if (!ready.has(key)) {
      const built = await buildHeroModel(sim, id);
      if (built) {
        st.scene.add(built.obj);
        st.renderer.compile(st.scene, st.camera);
        st.renderer.render(st.scene, st.camera); // uploads its textures
        st.scene.remove(built.obj);
        ready.set(key, built);
      }
    }
    if (!portraits.has(id)) {
      const flat = await buildHeroModel(sim, id, false);
      if (flat) portraits.set(id, snapshotOn(flat.obj, PORTRAIT_CAM, PORTRAIT_LOOK, 160));
    }
    // The current hero last on the stage canvas: the first open shows them even before a frame.
    if (i === ids.length - 1) {
      const cur = ready.get(modelKey(sim, sim.save.skin));
      if (cur) { st.scene.add(cur.obj); st.renderer.render(st.scene, st.camera); st.scene.remove(cur.obj); }
    }
    onStep?.((i + 1) / ids.length);
    await nextFrame(); // let the loading screen paint
  }
}

/** A paintbrush, for the Edit (customize) button. */
const EDIT_ICON = '<svg class="gi" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 3.3a1.6 1.6 0 0 0-2.3 0L9.6 12.1l2.3 2.3 8.8-8.8a1.6 1.6 0 0 0 0-2.3z" fill="#ffd84a" stroke="#0a1035" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.4 13.4c-2.2 0-3.6 1.5-3.8 3.6-.1 1.2-.7 2.2-1.9 2.7 3.6 1.2 7.4.3 8.1-3.3z" fill="#ff7ab0" stroke="#0a1035" stroke-width="1.6" stroke-linejoin="round"/></svg>';

/** Each mastery goal's icon. */
const GOAL_ICON: Record<string, string> = { bosses: 'skull-crossed-bones', explore: 'compass', level: 'sprint', forge: 'anvil-impact', weapon: 'broadsword' };

export class HeroesUI {
  private wrap: HTMLElement | null = null;
  private pick = '';
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private model: THREE.Object3D | null = null;
  /** The shown hero's reach (see reachOf); the stage camera stands back far enough for it. */
  private reach = 0;
  /** How far the stage camera stands back (eases towards what the shown hero needs). */
  private camDist = 0;
  private mixer: THREE.AnimationMixer | null = null;
  private shown = '';
  /** The hero now on the stage (shelved in `ready` when replaced). */
  /** What the stage hero was built as (its shelf key): kept, since the save may change under it. */
  private modelKeyOn = '';
  private raf = 0;
  private last = 0;
  /** Turntable: spin speed (rad/s), the direction it settles back to, and an active drag. */
  private spin = AUTO_SPIN;
  private masteryOpen = false;
  private editing = false;
  private spinDir = 1;
  private drag: { id: number; x: number; t: number } | null = null;

  constructor(private readonly sim: Sim, private readonly toast: (m: string) => void) {}

  open(): void {
    if (this.wrap) return;
    this.pick = this.sim.save.skin;
    this.masteryOpen = false;
    this.editing = false;
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
          <div class="hero-stage"><div class="hero-gems"><i class="jewel"></i><b></b></div>
            <button type="button" class="hero-edit-btn" data-act="edit:open" aria-label="Customize hero">${EDIT_ICON}<span>Edit</span></button></div>
          <div class="hero-info"><b class="hero-name"></b><span class="hero-sub"><span class="hero-role"></span><button type="button" class="hero-mastery" data-act="mastery:open" aria-label="Hero mastery"></button></span><span class="hero-perk"></span><span class="hero-weapons"></span></div>
          <div class="hero-edit">
            <b class="he-title">Style</b>
            <div class="hero-looks" role="radiogroup" aria-label="Style"></div>
            <b class="he-title">Colours</b>
            <div class="hero-palettes" role="radiogroup" aria-label="Colours"></div>
            <b class="he-title">Mastery skin</b>
            <div class="hero-looks hero-forms" role="radiogroup" aria-label="Mastery skin"></div>
            <button type="button" class="btn big green he-done" data-act="edit:done">Done</button>
          </div>
          <div class="hero-action"></div>
          <div class="hero-grid"></div>
        </div>
        <div class="hero-mastery-panel" role="dialog" aria-label="Hero mastery" hidden></div>
      </div>`;
    bindSheetTaps(wrap, (act) => this.run(act));
    document.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
    document.body.appendChild(wrap);
    this.wrap = wrap;
    this.setupStage(wrap.querySelector<HTMLElement>('.hero-stage')!);
    this.render();
    void this.makePortraits();
  }

  close(): void {
    if (!this.wrap) return;
    cancelAnimationFrame(this.raf);
    // The stage (its WebGL context, compiled shaders and textures) is kept for next time, along
    // with the hero on it, so the next open shows them at once.
    if (this.model && this.mixer && this.scene) {
      this.scene.remove(this.model);
      ready.set(this.modelKeyOn, { obj: this.model, mixer: this.mixer });
    }
    this.renderer = null; this.scene = null; this.camera = null; this.model = null; this.mixer = null; this.shown = '';
    this.wrap.remove();
    this.wrap = null;
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
  }

  private readonly onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); };

  private run(action: string): void {
    if (action === 'close') { this.close(); return; }
    const [act, id] = action.split(':');
    const sim = this.sim;
    if (act === 'pick') {
      sfx.play('tick');
      this.pick = id;
      this.editing = false;
    } else if (act === 'equip') {
      if (sim.selectSkin(id)) { sfx.play('stage'); this.toast(`${skinDef(id).name} picks up their journey at Lv ${sim.save.level}`); }
    } else if (act === 'look' || act === 'pal') {
      if (act === 'look' ? sim.setLook(this.pick, id) : sim.setPalette(this.pick, Number(id))) {
        sfx.play('tick');
        void this.restyle(this.pick);
        portraits.delete(this.pick);
        void this.makePortraits();
        if (act === 'look') void this.makeThumbs(this.pick); // the colour thumbnails show the new style
      }
    } else if (act === 'form') {
      const d = skinDef(this.pick);
      if (sim.setSkeleton(this.pick, id === 'skel')) {
        sfx.play(id === 'skel' ? 'achieve' : 'tick');
        this.shown = ''; // a different model: rebuild the stage hero
        void this.showModel(this.pick);
        portraits.delete(this.pick);
        void this.makePortraits();
      } else { sfx.play('tick'); this.toast(`Master ${d.name} (100%) to unlock ${d.skeleton.name}`); }
    } else if (act === 'edit') {
      // Customizing: the style and colour pickers take the place of the button and hero list.
      if (id === 'open' && !sim.ownsSkin(this.pick)) return;
      sfx.play('tick');
      this.editing = id === 'open';
    } else if (act === 'mastery') {
      sfx.play('tick');
      this.masteryOpen = id === 'open';
    } else if (act === 'buy') {
      const d = skinDef(id);
      if (sim.buySkin(id)) { sfx.play('achieve'); this.toast(`New hero: ${d.name}! A fresh journey begins`); }
      else { sfx.play('tick'); this.toast(sim.bestLevel < (d.minLevel ?? 0) ? `Reach hero level ${d.minLevel} first` : 'Not enough gems yet'); }
    }
    this.render();
  }

  /** The mastery bar under the hero's name, and its goal list (when open). */
  private renderMastery(): void {
    const def = skinDef(this.pick);
    const m = this.sim.mastery(def.id);
    const owned = this.sim.ownsSkin(def.id);
    const bar = this.wrap!.querySelector<HTMLElement>('.hero-mastery')!;
    bar.classList.toggle('complete', m.complete);
    bar.classList.toggle('locked', !owned);
    bar.innerHTML = `${gi('crown', m.complete ? 'gold' : owned ? 'orange' : 'grey')}<i class="hm-bar"><i style="width:${m.pct}%"></i></i><span>${m.pct}%</span>`;
    const panel = this.wrap!.querySelector<HTMLElement>('.hero-mastery-panel')!;
    panel.hidden = !this.masteryOpen;
    if (!this.masteryOpen) return;
    panel.innerHTML = `<div class="hm-card">
      <div class="hm-head">${gi('crown', m.complete ? 'gold' : 'orange')}<b>${def.name} Mastery</b><span>${m.pct}%</span>
        <button type="button" class="hm-x" data-act="mastery:close" aria-label="Back">✕</button></div>
      <p class="hm-note">${owned ? `Complete every goal on ${def.name}'s own journey.` : `Unlock ${def.name} to start their journey.`}</p>
      <ul class="hm-goals">${m.goals.map((g) => `<li class="${g.done ? 'done' : ''}">
        ${gi(GOAL_ICON[g.goal.id] ?? 'bullseye', g.done ? 'gold' : 'grey')}
        <div><b>${g.goal.name}</b><small>${g.goal.desc}</small><i class="hm-bar"><i style="width:${Math.round(g.frac * 100)}%"></i></i></div>
        <span>${g.done ? gi('check-mark', 'green') : g.goal.show(g.value)}</span></li>`).join('')}</ul>
      <div class="hm-reward ${m.complete ? 'ready' : ''}">${gi('present', m.complete ? 'gold' : 'grey')}
        <div><b>Reward: ${def.skeleton.name}</b><small>${m.complete ? 'Unlocked! Wear it from Edit.' : `${def.name}'s skeleton form, to wear any time`}</small></div></div>
    </div>`;
  }

  private readonly onResize = () => { if (this.wrap) this.wrap.style.removeProperty('--hp'); this.fit(); };

  /**
   * The screen never scrolls: if its content is taller than the sheet (a short or zoomed
   * window), shrink the hero portraits a step at a time until everything fits.
   */
  private fit(): void {
    const body = this.wrap?.querySelector<HTMLElement>('.sheet-body');
    const card = this.wrap?.querySelector<HTMLElement>('.hero-portrait');
    if (!this.wrap || !body || !card) return;
    let size = card.getBoundingClientRect().width;
    for (let i = 0; i < 20 && body.scrollHeight > body.clientHeight + 1 && size > 40; i++) {
      size -= 6;
      this.wrap.style.setProperty('--hp', `${Math.round(size)}px`);
    }
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
      ? `<button type="button" class="btn big grey" disabled>${gi('check-mark', 'green')} Playing</button>`
      : owned
        ? `<button type="button" class="btn big green" data-act="equip:${def.id}">Play · Lv ${s.runs[def.id]?.level ?? 1}</button>`
        : this.sim.bestLevel < (def.minLevel ?? 0)
          ? `<button type="button" class="btn big grey" disabled>${gi('padlock', 'grey')} Reach Lv ${def.minLevel} · <i class="jewel"></i>${def.cost}</button>`
          : `<button type="button" class="btn big blue" data-act="buy:${def.id}" ${gems >= def.cost ? '' : 'disabled'}>Unlock <i class="jewel"></i>${def.cost}</button>`;
    this.wrap.querySelector('.heroes-sheet')!.classList.toggle('editing', this.editing && owned);
    const edit = this.wrap.querySelector<HTMLButtonElement>('.hero-edit-btn')!;
    edit.disabled = !owned;
    edit.classList.toggle('on', this.editing);
    edit.hidden = this.editing;
    // Styles (e.g. the Knight's visor): shown for owned heroes that have any.
    const looksEl = this.wrap.querySelector<HTMLElement>('.hero-looks')!;
    const cur = lookOf(def.id, s.looks);
    // Shown for every hero (locked ones greyed out), so the screen keeps the same size whichever
    // hero is picked.
    // (The skeleton form has no styles or colours of its own: those wait greyed out while it's worn.)
    const bones = !!s.bones[def.id];
    const lock = owned && !bones ? '' : ' disabled';
    looksEl.hidden = !def.looks;
    looksEl.classList.toggle('locked', !owned || bones);
    looksEl.innerHTML = def.looks
      ? def.looks.map((l) => `<button type="button" role="radio" aria-checked="${l.id === cur}" class="${l.id === cur ? 'on' : ''}" data-act="look:${l.id}"${lock}>${l.name}</button>`).join('')
      : '';
    // Colour schemes: the hero's own palette and the pack's three alternates, as 3D thumbnails.
    const palEl = this.wrap.querySelector<HTMLElement>('.hero-palettes')!;
    const pal = s.palettes[def.id] ?? 0;
    palEl.hidden = !def.palette;
    palEl.classList.toggle('locked', !owned || bones);
    palEl.innerHTML = def.palette
      ? [0, 1, 2, 3].map((n) => {
        const img = thumbs.get(thumbKey(def.id, lookOf(def.id, s.looks), n));
        return `<button type="button" role="radio" aria-label="Colours ${n + 1}" aria-checked="${n === pal}" class="${n === pal ? 'on' : ''}" data-act="pal:${n}"${lock}>${img ? `<img alt="" src="${img}" />` : ''}</button>`;
      }).join('')
      : '';
    if (def.palette) void this.makeThumbs(def.id);
    // The mastery reward: the hero's skeleton form, worn once they're 100% complete.
    const earned = this.sim.mastery(def.id).complete;
    this.wrap.querySelector('.hero-forms')!.innerHTML = [
      `<button type="button" role="radio" aria-checked="${!bones}" class="${bones ? '' : 'on'}" data-act="form:hero"${owned ? '' : ' disabled'}>${def.name}</button>`,
      `<button type="button" role="radio" aria-checked="${bones}" class="${bones ? 'on' : ''} ${earned ? '' : 'he-locked'}" data-act="form:skel"${owned ? '' : ' disabled'}>${gi(earned ? 'crown' : 'padlock', earned ? 'gold' : 'grey')}${def.skeleton.name}</button>`,
    ].join('');
    this.renderMastery();
    this.wrap.querySelector('.hero-grid')!.innerHTML = this.order().map((k) => {
      const have = this.sim.ownsSkin(k.id);
      const tag = s.skin === k.id ? `${gi('check-mark', 'green')} Lv ${s.level}` : have ? `Owned · Lv ${s.runs[k.id]?.level ?? 1}`
        : this.sim.bestLevel < (k.minLevel ?? 0) ? `Lv ${k.minLevel}` : `<i class="jewel"></i>${k.cost}`;
      const img = portraits.get(k.id);
      return `<button type="button" class="hero-card ${k.id === this.pick ? 'sel' : ''} ${have ? 'owned' : 'locked'}" data-act="pick:${k.id}">
        <span class="hero-portrait">${img ? `<img alt="" src="${img}" />` : ''}${have ? this.cardMastery(k.id) : `<i class="hero-lock">${gi('padlock', 'grey')}</i>`}</span>
        <span class="hero-card-name">${k.name}</span><span class="hero-card-role">${k.role}</span><span class="hero-tag">${tag}</span></button>`;
    }).join('');
    this.fit();
    void this.showModel(this.pick);
  }

  /** An owned hero's mastery on their card: a thin bar, or a crown once complete. */
  private cardMastery(id: string): string {
    const m = this.sim.mastery(id);
    return m.complete ? `<i class="hero-crown">${gi('crown', 'gold')}</i>` : `<i class="hero-mbar"><i style="width:${m.pct}%"></i></i>`;
  }

  /**
   * Heroes in the grid: the ones owned first, in the order they were got (the first-launch pick
   * leads), then the locked ones in their usual order.
   */
  private order(): typeof SKINS[number][] {
    const owned = this.sim.save.skins;
    const rank = (id: string) => { const i = owned.indexOf(id); return i >= 0 ? i : owned.length + SKINS.findIndex((k) => k.id === id); };
    return [...SKINS].sort((a, b) => rank(a.id) - rank(b.id));
  }

  // --- 3D preview ------------------------------------------------------------------------

  private setupStage(host: HTMLElement): void {
    const st = heroStage();
    const canvas = st.renderer.domElement;
    host.prepend(canvas);
    this.renderer = st.renderer;
    this.scene = st.scene;
    this.camera = st.camera;
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
    if (st.bound) return; // the canvas keeps its listeners between opens
    st.bound = true;

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
    // The stage is a square box around the hero: as wide as it is tall (it gets its height from
    // the room left on the screen), never wider than the sheet.
    const stage = c.parentElement;
    if (stage) {
      const side = `${stage.clientHeight}px`;
      if (stage.clientHeight && stage.style.width !== side) stage.style.width = side;
    }
    const w = c.clientWidth, h = c.clientHeight;
    if (w && h && (c.width !== Math.floor(w * r.getPixelRatio()) || c.height !== Math.floor(h * r.getPixelRatio()))) {
      r.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    // Step back far enough that the hero's furthest point (a long blade held out) stays inside the
    // frame at every turn of the spin; most heroes fit at the usual distance. A point on a circle
    // of radius R, seen from distance d, is at most R / sqrt(d² − R²) off centre.
    const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect * 0.96;
    const need = Math.max(STAGE_CAM[2], this.reach * Math.sqrt(1 + 1 / (t * t)));
    this.camDist = this.camDist ? this.camDist + (need - this.camDist) * 0.15 : need;
    const k = this.camDist / STAGE_CAM[2];
    cam.position.set(0, STAGE_LOOK[1] + (STAGE_CAM[1] - STAGE_LOOK[1]) * k, this.camDist);
    cam.lookAt(...STAGE_LOOK);
    r.render(scene, cam);
  }

  private build(id: string, sized = true, palette?: number): Promise<{ obj: THREE.Object3D; mixer: THREE.AnimationMixer } | null> {
    return buildHeroModel(this.sim, id, sized, palette);
  }

  /** Settles once the stage's first hero has been shown (or failed to load). */
  private modelReady: Promise<void> = Promise.resolve();

  private showModel(id: string): Promise<void> {
    if (this.shown === id || !this.scene) return this.modelReady;
    const p = this.loadModelOnStage(id);
    if (!this.model) this.modelReady = p.then(() => nextFrame()); // let the stage draw it first
    return p;
  }

  private async loadModelOnStage(id: string): Promise<void> {
    this.shown = id;
    const key = modelKey(this.sim, id);
    const kept = ready.get(key);
    if (kept) ready.delete(key);
    const built = kept ?? await this.build(id);
    if (!built || !this.scene || this.shown !== id) { if (built) ready.set(key, built); return; }
    if (this.model && this.mixer) {
      // Put the last hero back on the shelf, as they are now (style and colours may have changed).
      this.scene.remove(this.model);
      ready.set(this.modelKeyOn, { obj: this.model, mixer: this.mixer });
    }
    built.obj.rotation.y = 0.5;
    this.scene.add(built.obj);
    this.model = built.obj;
    this.mixer = built.mixer;
    this.modelKeyOn = key;
    this.reach = reachOf(built.obj);
  }

  /** Restyle the hero on the stage in place: its spin and animation carry on. */
  private async restyle(id: string): Promise<void> {
    const pal = this.sim.save.palettes[id] ?? 0;
    await paletteReady(id, pal); // (applying a scheme before its texture loads draws the hero black)
    if (!this.model || this.shown !== id) return;
    if (this.modelKeyOn.startsWith('skel_')) return; // the skeleton form keeps its own look
    applyLook(this.model, id, lookOf(id, this.sim.save.looks));
    applyPalette(this.model, id, pal);
    this.modelKeyOn = modelKey(this.sim, id);
  }

  private snapshot(obj: THREE.Object3D, pos: [number, number, number], look: [number, number, number], size: number): string | null {
    return this.renderer ? snapshotOn(obj, pos, look, size, this.model) : null;
  }

  /**
   * Render each skin once, facing the camera, into a portrait image for its card. Runs after the
   * stage's hero is up, one portrait per frame, so the first open shows the hero straight away.
   */
  private async makePortraits(): Promise<void> {
    await this.modelReady;
    for (const k of SKINS) {
      if (portraits.has(k.id)) continue;
      await nextFrame();
      if (!this.renderer) return;
      const built = await this.build(k.id, false);
      if (!built || !this.renderer) return;
      const img = this.snapshot(built.obj, PORTRAIT_CAM, PORTRAIT_LOOK, 160);
      if (img) portraits.set(k.id, img);
      this.render();
    }
  }

  /** Head-and-shoulders thumbnails of hero `id` in each colour scheme (for the colour picker). */
  private thumbing = '';
  private async makeThumbs(id: string): Promise<void> {
    const look = lookOf(id, this.sim.save.looks);
    const key = `${id}:${look}`;
    if (this.thumbing === key || [0, 1, 2, 3].every((n) => thumbs.has(thumbKey(id, look, n)))) return;
    this.thumbing = key;
    for (let n = 0; n <= 3; n++) {
      if (thumbs.has(thumbKey(id, look, n))) continue;
      const built = await this.build(id, false, n);
      if (!built || !this.renderer || this.thumbing !== key) break;
      built.obj.rotation.y = 0.35;
      const img = this.snapshot(built.obj, [0, 1.22, 1.75], [0, 1.0, 0], 112);
      if (img) thumbs.set(thumbKey(id, look, n), img);
    }
    if (this.thumbing === key) this.thumbing = '';
    if (this.pick === id) this.render();
  }
}

/** Colour-picker thumbnails, by hero, style and colour scheme. */
const thumbs = new Map<string, string>();
const thumbKey = (id: string, look: string, n: number) => `${id}:${look}:${n}`;

const _hip = new THREE.Vector3();
/**
 * A posed, normalised copy of a hero (1.5 units tall, feet on the ground) holding their weapon,
 * playing their showcase idle. Shared by the Heroes screen and the first-run hero choice.
 */
export async function buildHeroModel(sim: Sim, id: string, sized = true, palette?: number): Promise<{ obj: THREE.Object3D; mixer: THREE.AnimationMixer } | null> {
  // Its skeleton form when worn (colour thumbnails, which pass a palette, always show the hero).
  const file = palette === undefined ? heroModelFile(id, sim.save.bones) : `hero_${id}`;
  const skel = !file.startsWith('hero_');
  const [g, rig] = await Promise.all([loadModel(file), loadHeroAnims(id)]).catch(() => [null, null]);
  if (!g || !rig) return null;
  const anims = rig.anims;
  const inner = cloneActor(g);
  // The battlefield may be wearing this same model: undo its placement and its hero render layer.
  inner.position.set(0, 0, 0);
  inner.scale.setScalar(1);
  inner.rotation.set(0, 0, 0);
  inner.traverse((o) => {
    o.layers.set(0);
    // The battlefield hero flashes red when hit: a copy made mid-flash would keep the glow.
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) (mat as THREE.MeshLambertMaterial).emissive?.setHex(0);
  });
  for (const n of ['weapon-hand', 'weapon-kit-r', 'weapon-kit-l']) inner.getObjectByName(n)?.removeFromParent(); // the battlefield's weapon, if cloned along
  if (!skel) {
    applyLook(inner, id, lookOf(id, sim.save.looks));
    // Wait for the colour scheme's texture: drawn before it arrives, the hero (and its one-shot
    // portrait) would come out black.
    const pal = palette ?? sim.save.palettes[id] ?? 0;
    await paletteReady(id, pal);
    applyPalette(inner, id, pal);
  }
  // The clone copies whatever pose the battlefield hero was in (mid-run, mid-swing): measure it at rest.
  inner.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.pose(); });
  const dims = measure(inner);
  // On the stage heroes keep their relative size (the Warlord towers); portraits are all fitted.
  const k = (1.5 * (sized ? heroScale(id) : 1)) / dims.h;
  inner.scale.setScalar(k);
  inner.position.set(-dims.cx * k, -dims.minY * k, -dims.cz * k);
  // The hero holds their weapon: the equipped one, or what they would draw when picked.
  // (Added after measuring, so a tall staff does not shrink the hero.)
  const s = sim.save;
  const w = id === s.skin ? s.equipped : s.runs[id]?.equipped ?? null;
  await Promise.all(kitModels(w?.form ?? skinDef(id).forms[0], w?.rarity ?? 0).map((n) => loadModel(n).catch(() => null)));
  const kit = buildKitWeapon(w?.form ?? skinDef(id).forms[0], w?.rarity ?? 0);
  if (kit) {
    kit.group.scale.multiplyScalar(heroWeaponScale(id));
    const form = w?.form ?? skinDef(id).forms[0];
    // The stage shows the weapon's idle; one-handed weapons (unarmed idle) are held upright.
    holdWeapon(kit.group, form, showcaseUpright(id, form) ? idleTilt(form) : 0);
    kit.off?.scale.multiplyScalar(heroWeaponScale(id));
    inner.getObjectByName(heldLeft(form) ? 'handslotl' : 'handslotr')?.add(kit.group);
    if (kit.off) inner.getObjectByName('handslotl')?.add(kit.off);
  }
  const obj = new THREE.Group();
  obj.add(inner);
  const mixer = new THREE.AnimationMixer(inner);
  const idleName = showcaseIdle(id, w?.form ?? skinDef(id).forms[0]);
  const idle = heroClip(anims, idleName);
  if (idle) {
    const a = mixer.clipAction(idle);
    if (holdsPose(idleName)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    a.play();
  }
  mixer.update(0.4);
  centerOnHips(obj);
  return { obj, mixer };
}

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
