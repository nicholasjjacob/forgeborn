import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { STARTERS, skinDef } from '../sim/skins';
import { FORMS } from '../sim/weapons';
import type { Sim } from '../sim/sim';
import { buildHeroModel } from './heroes';

/**
 * First launch: choose your hero. The starters stand on a stage: the chosen one in front, lit,
 * the others behind it either side, smaller and greyed out. Tap one to bring it forward and read how it fights;
 * "Play as …" starts the game with it (the others wait in the Heroes screen with the rest).
 * Resolves once a hero is chosen.
 */

/** How each starter fights, in a line or two, and how forgiving it is to learn. */
const STYLE: Record<string, { style: string; level: string }> = {
  knight: { style: 'Up close: sweeping sword strikes that hit everything in front. Built to soak up hits.', level: 'Easy' },
  barbarian: { style: 'Up close: wide axe sweeps that hit harder the more hurt you are. Tough and reckless.', level: 'Easy' },
  rogue: { style: 'Fast dagger flurries up close, or heavy crossbow bolts from afar. Lots of critical hits.', level: 'Medium' },
  mage: { style: 'From afar: orbs that burst on impact, or rapid wand sparks. Shocks leap from monster to monster.', level: 'Medium' },
  rogue_hooded: { style: 'Up close: swift katana cuts and claw flurries. Strike unhurt monsters for a guaranteed critical hit.', level: 'Hard' },
};

interface Stand { id: string; el: HTMLCanvasElement; renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; mixer: THREE.AnimationMixer | null; model: THREE.Object3D | null; lit: number; target: number }

/** How lit each slot is (1 = full colour; lower is darker and greyer). */
const LIT: Record<string, number> = { front: 1, left: 0.42, right: 0.42, 'far-left': 0.3, 'far-right': 0.3 };

/**
 * The heroes behind are greyed and darkened inside the 3D render itself, as the last step of each
 * pixel (three.js's "custom tone mapping", fed the stand's exposure). A CSS filter on the canvas
 * did the same, but iPhones would sometimes leave the front hero stuck grey. Only these stands use
 * custom tone mapping, so nothing else in the game is affected.
 */
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  'vec3 CustomToneMapping( vec3 color ) { return color; }',
  `vec3 CustomToneMapping( vec3 color ) {
    float grey = clamp( ( 1.0 - toneMappingExposure ) * 3.0, 0.0, 1.0 );
    color = mix( color, vec3( dot( color, vec3( 0.2126, 0.7152, 0.0722 ) ) ), grey );
    return color * pow( toneMappingExposure, 2.2 );
  }`,
);

export function chooseStarter(sim: Sim): Promise<string> {
  return new Promise((resolve) => {
    let pick = STARTERS[0];
    const root = document.createElement('div');
    root.className = 'starter';
    root.innerHTML = `
      <div class="st-head">
        <h1>Choose your hero</h1>
        <p>Each hero has their own journey. Unlock more in Heroes.</p>
      </div>
      <div class="st-stage"></div>
      <div class="st-card">${STARTERS.map((id) => {
        const def = skinDef(id), info = STYLE[id];
        // All three heroes' details share one spot (only the pick's shows), so the card is always
        // the size of the longest and never jumps when you switch.
        return `<div class="st-info" data-id="${id}">
          <b class="st-name">${def.name}</b>
          <div class="st-tags"><span class="st-role">${def.role}</span><span class="st-level" data-level="${info.level.toLowerCase()}">${info.level} to learn</span></div>
          <p class="st-style">${info.style}</p>
          <div class="st-weapons">${def.forms.map((f) => `<span class="st-wpn"><b>${FORMS[f].name}</b><small>${FORMS[f].blurb}</small></span>`).join('')}</div>
          <p class="st-perk"><b>Class perk</b> ${def.perk}</p>
        </div>`;
      }).join('')}</div>
      <button type="button" class="btn green st-go"></button>`;
    document.body.appendChild(root);
    const stage = root.querySelector<HTMLElement>('.st-stage')!;
    // The golden glow behind the front hero (a plain gradient, not a filter on the 3D canvas).
    stage.insertAdjacentHTML('beforeend', '<div class="st-glow"></div>');

    // One small 3D stage per hero (each its own canvas, so the slots can glide and grey out in CSS).
    const stands: Stand[] = STARTERS.map((id) => {
      const el = document.createElement('canvas');
      el.className = 'st-hero';
      el.setAttribute('aria-label', skinDef(id).name);
      stage.appendChild(el);
      const renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.CustomToneMapping;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a4a7a, 2.2));
      const sun = new THREE.DirectionalLight(0xfff2dc, 2.5);
      sun.position.set(-3, 6, 5);
      scene.add(sun);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(0.55, 40), new THREE.MeshBasicMaterial({ color: 0x050920, transparent: true, opacity: 0.45 }));
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);
      const camera = new THREE.PerspectiveCamera(30, 0.75, 0.1, 50);
      // Close in: the hero fills most of their slot (feet near the bottom, a little room overhead).
      camera.position.set(0, 1.05, 3.7);
      camera.lookAt(0, 0.82, 0);
      const st: Stand = { id, el, renderer, scene, camera, mixer: null, model: null, lit: 1, target: 1 };
      void buildHeroModel(sim, id, false, 0).then((b) => {
        if (!b) return;
        b.obj.rotation.y = 0.35;
        scene.add(b.obj);
        st.model = b.obj;
        st.mixer = b.mixer;
      });
      return st;
    });

    // Taps go to the hero whose middle is nearest (the slots overlap, so the canvases themselves
    // don't take clicks).
    stage.addEventListener('click', (e) => {
      let best = stands[0], bestD = Infinity;
      for (const s of stands) {
        const r = s.el.getBoundingClientRect();
        const d = Math.abs(e.clientX - (r.left + r.width / 2));
        if (d < bestD) { bestD = d; best = s; }
      }
      if (best.id !== pick) { pick = best.id; sfx.play('tick'); show(); }
    });

    const infos = [...root.querySelectorAll<HTMLElement>('.st-info')];
    const go = root.querySelector<HTMLButtonElement>('.st-go')!;

    /** Lay the stage out around the pick (front and centre; the others behind, either side). */
    function show(): void {
      // Slots around the pick, in starter order wrapping round: -2, -1, 0 (front), +1, +2.
      const n = STARTERS.length, at = STARTERS.indexOf(pick);
      const slot = ['far-left', 'left', 'front', 'right', 'far-right'];
      for (const s of stands) {
        const off = ((STARTERS.indexOf(s.id) - at + n + Math.floor(n / 2)) % n) - Math.floor(n / 2);
        s.el.dataset.slot = slot[off + 2] ?? 'front';
        s.target = LIT[s.el.dataset.slot] ?? 1;
      }
      for (const el of infos) el.classList.toggle('on', el.dataset.id === pick);
      const def = skinDef(pick);
      go.textContent = `Play as ${def.name}`;
    }
    show();
    for (const s of stands) s.lit = s.target;

    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const s of stands) {
        s.mixer?.update(dt);
        // Fade towards the slot's light as the hero glides there.
        s.lit += (s.target - s.lit) * Math.min(1, dt * 9);
        if (Math.abs(s.target - s.lit) < 0.002) s.lit = s.target;
        s.renderer.toneMappingExposure = s.lit;
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
