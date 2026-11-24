import type { Sim } from '../sim/sim';
import { confirmDialog } from './dialog';

export interface SettingsActions {
  applySound(on: boolean): void;
  applyQuality(q: 'high' | 'low'): void;
  applyFps(fps: 30 | 60): void;
  reset(): void;
  /** Present the browser's install prompt if one is available; returns false if not. */
  install(): Promise<boolean>;
  canInstall(): boolean;
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Settings sheet: sound, graphics quality, frame rate, install, reset. Changes apply instantly. */
export function openSettings(sim: Sim, act: SettingsActions): void {
  const s = sim.save;
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'Settings');
  wrap.innerHTML = `
    <div class="modal-card settings">
      <h2>Settings</h2>
      <div class="set-row"><span>Sound</span><div class="seg" data-key="sound"><button data-v="on">On</button><button data-v="off">Off</button></div></div>
      <div class="set-row"><span>Graphics<small>Low: sharper on weak phones, fewer particles, no shake</small></span><div class="seg" data-key="quality"><button data-v="high">High</button><button data-v="low">Low</button></div></div>
      <div class="set-row"><span>Frame rate<small>30 saves battery</small></span><div class="seg" data-key="fps"><button data-v="60">60</button><button data-v="30">30</button></div></div>
      <div class="set-row install-row" hidden><span>Install<small class="install-note"></small></span><button type="button" class="btn small primary" id="install-btn">Install</button></div>
      <div class="set-actions">
        <button type="button" class="btn ghost" id="reset-progress">Reset progress</button>
        <button type="button" class="btn primary" id="close-settings">Done</button>
      </div>
      <p class="build-stamp">Version ${__BUILD__}<br>Icons: game-icons.net (CC BY 3.0) · 3D models: Quaternius (CC0)</p>
    </div>`;

  const sync = () => {
    const val: Record<string, string> = { sound: s.sound ? 'on' : 'off', quality: s.quality, fps: String(s.fps) };
    for (const seg of wrap.querySelectorAll<HTMLElement>('.seg')) {
      for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) {
        const on = b.dataset.v === val[seg.dataset.key!];
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      }
    }
  };

  wrap.querySelectorAll<HTMLElement>('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    const v = b.dataset.v!;
    switch (seg.dataset.key) {
      case 'sound': s.sound = v === 'on'; act.applySound(s.sound); break;
      case 'quality': s.quality = v as 'high' | 'low'; act.applyQuality(s.quality); break;
      case 'fps': s.fps = Number(v) as 30 | 60; act.applyFps(s.fps); break;
    }
    sync();
  }));

  // Install: native prompt on Chrome/Android/desktop; instructions on iOS Safari.
  const row = wrap.querySelector<HTMLElement>('.install-row')!;
  const note = wrap.querySelector<HTMLElement>('.install-note')!;
  const ib = wrap.querySelector<HTMLButtonElement>('#install-btn')!;
  if (!isStandalone()) {
    if (act.canInstall()) {
      row.hidden = false;
      note.textContent = 'Play full-screen and offline';
      ib.addEventListener('click', async () => { if (await act.install()) row.hidden = true; });
    } else if (isIos()) {
      row.hidden = false;
      note.textContent = 'In Safari: tap Share, then "Add to Home Screen"';
      ib.hidden = true;
    }
  }

  const close = () => { document.removeEventListener('keydown', onKey); wrap.remove(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('#close-settings')!.addEventListener('click', close);
  wrap.querySelector('#reset-progress')!.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reset all progress?',
      body: '<p>This erases your zones, levels, weapons, embers, perks and achievements. It cannot be undone.</p>',
      confirm: 'Erase everything',
      danger: true,
    });
    if (ok) { close(); act.reset(); }
  });

  sync();
  document.body.appendChild(wrap);
  wrap.querySelector<HTMLButtonElement>('#close-settings')!.focus();
}
