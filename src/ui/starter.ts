import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { STARTERS, skinDef } from '../sim/skins';
import { FORMS } from '../sim/weapons';
import type { Sim } from '../sim/sim';
import { buildHeroModel } from './heroes';

/**
 * First launch: choose your hero. The three starters stand on a stage: the chosen one in front,
 * lit, the other two behind and greyed out. Tap one to bring it forward and read how it fights;
 * "Play as …" starts the game with it (the other two wait in the Heroes screen with the rest).
 * Resolves once a hero is chosen.
 */

/** How each starter fights, in a line or two, and how forgiving it is to learn. */
const STYLE: Record<string, { style: string; level: string }> = {
  knight: { style: 'Up close: sweeping sword strikes that hit everything in front. Built to soak up hits.', level: 'Easy' },
  ranger: { style: 'From afar: quick arrows at long range, and the longbow shoots through a line of monsters. Fast on their feet.', level: 'Medium' },
  mage: { style: 'From afar: orbs that burst on impact, or rapid wand sparks. Shocks leap from monster to monster.', level: 'Medium' },
};

interface Stand { id: string; el: HTMLCanvasElement; renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; mixer: THREE.AnimationMixer | null; model: THREE.Object3D | null }

export function chooseStarter(sim: Sim): Promise<string> {
  return new Promise((resolve) => {
    let pick = STARTERS[0];
    const root = document.createElement('div');
    root.className = 'starter';
    root.innerHTML = `
      <div class="st-head">
        <h1>Choose your hero</h1>
        <p>You can unlock the others later in Heroes.</p>
      </div>
      <div class="st-stage"></div>
      <div class="st-card">
        <div class="st-title"><b class="st-name"></b><span class="st-role"></span><span class="st-level"></span></div>
        <p class="st-style"></p>
        <div class="st-weapons"></div>
        <p class="st-perk"></p>
      </div>
      <button type="button" class="btn green st-go"></button>`;
    document.body.appendChild(root);
    const stage = root.querySelector<HTMLElement>('.st-stage')!;

    // One small 3D stage per hero (each its own canvas, so the slots can glide and grey out in CSS).
    const stands: Stand[] = STARTERS.map((id) => {
      const el = document.createElement('canvas');
      el.className = 'st-hero';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', skinDef(id).name);
      stage.appendChild(el);
      const renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a4a7a, 2.2));
      const sun = new THREE.DirectionalLight(0xfff2dc, 2.5);
      sun.position.set(-3, 6, 5);
      scene.add(sun);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(0.55, 40), new THREE.MeshBasicMaterial({ color: 0x050920, transparent: true, opacity: 0.45 }));
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);
      const camera = new THREE.PerspectiveCamera(30, 0.75, 0.1, 50);
      camera.position.set(0, 1.25, 4.6);
      camera.lookAt(0, 0.85, 0);
      const st: Stand = { id, el, renderer, scene, camera, mixer: null, model: null };
      el.addEventListener('click', () => { if (pick !== id) { pick = id; sfx.play('tick'); show(); } });
      void buildHeroModel(sim, id, false, 0).then((b) => {
        if (!b) return;
        b.obj.rotation.y = 0.35;
        scene.add(b.obj);
        st.model = b.obj;
        st.mixer = b.mixer;
      });
      return st;
    });

    const name = root.querySelector<HTMLElement>('.st-name')!, role = root.querySelector<HTMLElement>('.st-role')!;
    const level = root.querySelector<HTMLElement>('.st-level')!, style = root.querySelector<HTMLElement>('.st-style')!;
    const weapons = root.querySelector<HTMLElement>('.st-weapons')!, perk = root.querySelector<HTMLElement>('.st-perk')!;
    const go = root.querySelector<HTMLButtonElement>('.st-go')!;

    /** Lay the stage out around the pick (front and centre; the others behind, either side). */
    function show(): void {
      const others = STARTERS.filter((id) => id !== pick);
      for (const s of stands) {
        s.el.classList.toggle('front', s.id === pick);
        s.el.classList.toggle('left', s.id === others[0]);
        s.el.classList.toggle('right', s.id === others[1]);
      }
      const def = skinDef(pick), info = STYLE[pick];
      name.textContent = def.name;
      role.textContent = def.role;
      level.textContent = info.level;
      level.dataset.level = info.level.toLowerCase();
      style.textContent = info.style;
      weapons.innerHTML = def.forms.map((f) => `<span class="st-wpn"><b>${FORMS[f].name}</b><small>${FORMS[f].blurb}</small></span>`).join('');
      perk.textContent = `Class perk: ${def.perk}`;
      go.textContent = `Play as ${def.name}`;
    }
    show();

    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const s of stands) {
        s.mixer?.update(dt);
        const w = s.el.clientWidth, h = s.el.clientHeight;
        if (!w || !h) continue;
        const pr = s.renderer.getPixelRatio();
        if (s.el.width !== Math.floor(w * pr) || s.el.height !== Math.floor(h * pr)) {
          s.renderer.setSize(w, h, false);
          s.camera.aspect = w / h;
          s.camera.updateProjectionMatrix();
        }
        s.renderer.render(s.scene, s.camera);
      }
    };
    raf = requestAnimationFrame(loop);

    go.addEventListener('click', () => {
      if (!sim.chooseStarter(pick)) return;
      sfx.play('area');
      cancelAnimationFrame(raf);
      root.classList.add('gone');
      setTimeout(() => {
        for (const s of stands) s.renderer.dispose();
        root.remove();
      }, 450);
      resolve(pick);
    });
  });
}
