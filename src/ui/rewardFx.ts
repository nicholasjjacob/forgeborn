import { sfx } from '../audio/sfx';
import type { Reward } from '../sim/missions';

/**
 * Reward "spill": currency icons burst out of the element that was tapped, bounce once, then
 * fly into their counter in the top bar, which pops as they land. DOM + Web Animations only,
 * so it draws above the mission sheet and costs nothing when idle.
 */

type Kind = 'gold' | 'shards' | 'gems' | 'embers' | 'star';

const ICON: Record<Kind, string> = { gold: 'coin', shards: 'gem', gems: 'jewel', embers: 'ember', star: 'fx-star' };
// Where each currency flies to (the HUD counters). Embers have no counter, so they fade out.
const TARGET: Partial<Record<Kind, string>> = { gold: '[aria-label="Gold"]', shards: '[aria-label="Shards"]', gems: '[aria-label="Gems"]' };
const MAX_PER_KIND = 14;

let layer: HTMLDivElement | null = null;
let lastTick = 0;

function getLayer(): HTMLDivElement {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** More icons for bigger rewards, on a log scale (1 → 5 icons, 1M → 14). */
function countFor(amount: number): number {
  return Math.max(4, Math.min(MAX_PER_KIND, Math.round(4 + Math.log10(Math.max(1, amount)) * 1.7)));
}

function bump(el: Element | null): void {
  if (!el) return;
  el.classList.remove('fx-bump');
  void (el as HTMLElement).offsetWidth; // restart the animation
  el.classList.add('fx-bump');
}

function visibleTarget(sel: string | undefined): HTMLElement | null {
  if (!sel) return null;
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function spill(kind: Kind, amount: number, ox: number, oy: number, delay: number): void {
  const target = visibleTarget(TARGET[kind]);
  if (reducedMotion()) { bump(target); return; }
  const t = target?.querySelector(`.${ICON[kind]}`)?.getBoundingClientRect() ?? target?.getBoundingClientRect();
  const n = countFor(amount);
  const root = getLayer();
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = `fx-p ${ICON[kind]}`;
    if (kind === 'star') p.textContent = '★';
    p.style.left = `${ox}px`;
    p.style.top = `${oy}px`;
    root.appendChild(p);

    // Burst up and out, land a little below the start, then fly home.
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const pow = 50 + Math.random() * 70;
    const dx = Math.cos(ang) * pow, dy = Math.sin(ang) * pow;
    const landX = dx * 1.35, landY = 26 + Math.random() * 34;
    const spin = (Math.random() - 0.5) * 540;
    const frames: Keyframe[] = [
      { transform: 'translate(-50%,-50%) translate(0,0) scale(.3) rotate(0deg)', opacity: 0, offset: 0, easing: 'cubic-bezier(.2,.7,.4,1)' },
      { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(1.1) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.28, easing: 'cubic-bezier(.5,0,.9,.6)' },
      { transform: `translate(-50%,-50%) translate(${landX}px,${landY}px) scale(1) rotate(${spin}deg)`, opacity: 1, offset: 0.5, easing: 'ease-out' },
      { transform: `translate(-50%,-50%) translate(${landX}px,${landY - 8}px) scale(1) rotate(${spin}deg)`, opacity: 1, offset: 0.58, easing: 'cubic-bezier(.55,0,.8,.4)' },
      t
        ? { transform: `translate(-50%,-50%) translate(${t.left + t.width / 2 - ox}px,${t.top + t.height / 2 - oy}px) scale(.7) rotate(${spin}deg)`, opacity: 1, offset: 1 }
        : { transform: `translate(-50%,-50%) translate(${landX}px,${landY - 40}px) scale(.6) rotate(${spin}deg)`, opacity: 0, offset: 1 },
    ];
    const anim = p.animate(frames, { duration: 1000 + Math.random() * 250, delay: delay + i * 35, fill: 'both' });
    anim.onfinish = () => {
      p.remove();
      if (!target) return;
      bump(target);
      const now = performance.now();
      if (now - lastTick > 70) { lastTick = now; sfx.play('tick'); }
    };
  }
}

/** Spill every currency in `reward` from the centre of `from` (or the screen centre). */
export function rewardSpill(reward: Reward, from?: Element | null): void {
  const r = from?.getBoundingClientRect();
  const ox = r && r.width ? r.left + r.width / 2 : window.innerWidth / 2;
  const oy = r && r.height ? r.top + r.height / 2 : window.innerHeight / 2;
  let delay = 0;
  for (const kind of ['gold', 'gems', 'shards', 'embers'] as const) {
    const amt = reward[kind];
    if (amt) { spill(kind, amt, ox, oy, delay); delay += 120; }
  }
}

/** A small burst of stars (mission points). */
export function starBurst(from?: Element | null): void {
  const r = from?.getBoundingClientRect();
  if (!r) return;
  spill('star', 1, r.left + r.width / 2, r.top + r.height / 2, 0);
}
