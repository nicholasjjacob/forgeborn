import { Application, TextureStyle } from 'pixi.js';
import { loadSave, wipeSave, writeSave } from './core/save';
import { installFonts } from './render/fx';
import { Scene } from './render/scene';
import { areaArt, buildArt, ensureAreaSprites, loadRenderedArt } from './render/sprites';
import { TICK } from './sim/balance';
import { Sim } from './sim/sim';
import { Hud } from './ui/hud';
import { Input } from './ui/input';
import { areaName } from './sim/areas';
import { OFFLINE_CAP_HOURS, applyOfflineReward, hasReward, offlineReward } from './sim/offline';
import { showWelcome } from './ui/welcome';
import { openSettings } from './ui/settings';
import { sfx } from './audio/sfx';
import { registerPwa } from './pwa';

const MAX_STEPS_PER_FRAME = 8;   // avoid a "spiral of death" on slow frames
const HUD_INTERVAL = 0.1;        // seconds
const AUTOSAVE_INTERVAL = 10;    // seconds
const CATCHUP_LIMIT = 60;        // seconds simulated live after a tab switch; longer absences pay offline rewards

async function boot() {
  // Smooth, shaded art (drawn at high resolution): linear filtering, sub-pixel motion.
  TextureStyle.defaultOptions.scaleMode = 'linear';
  const savePromise = loadSave(); // read storage while the renderer starts up

  const host = document.getElementById('canvas-host')!;
  const app = new Application();
  await app.init({
    resizeTo: host,
    background: '#1d2b53',
    antialias: false,
    // Cap at 2x: 3x phone screens cost ~2.25x the fill-rate for no visible gain on pixel art.
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    roundPixels: false,
    powerPreference: 'high-performance',
    preference: 'webgl',
    // Skip Pixi's pointer-events + accessibility layers: input is handled by the DOM (ui/input.ts).
    skipExtensionImports: true,
  });
  host.appendChild(app.canvas);

  installFonts();
  const art = buildArt();
  // Rendered 3D sprites (hero + scenery now, each area's monsters on demand). If they're slow
  // or missing, the code-drawn art is used and swapped out as soon as the sheets arrive.
  await Promise.race([loadRenderedArt(), new Promise((r) => setTimeout(r, 2500))]);
  const loaded = await savePromise;
  // Offline earnings since the last save (rewards are granted immediately, then shown).
  const bootReward = offlineReward(loaded, (Date.now() - loaded.savedAt) / 1000, OFFLINE_CAP_HOURS + loaded.perks.offline);
  if (hasReward(bootReward)) applyOfflineReward(loaded, bootReward);
  const sim = new Sim(loaded);
  let saving = true;
  const save = () => { if (saving) writeSave(sim.save); };

  let hud: Hud | null = null;
  const scene = new Scene(app, sim, art, {
    onStageClear: () => hud?.toast(`Stage ${sim.stage}`),
    onBossSpawn: () => hud?.toast('BOSS!', 'boss'),
    onBossFail: () => hud?.toast('Boss escaped… farm and try again', 'bad'),
    onAreaEnter: (area) => hud?.toast(areaName(area), 'boss'),
    onLevelUp: (level) => hud?.toast(`Level ${level}!`, 'boss'),
    onPickup: (kind) => hud?.bumpMaterial(kind),
  });
  new Input(document.getElementById('battle')!, sim, scene);

  // First-run hint: fades on the first touch/click or after a few seconds.
  const hint = document.getElementById('hint')!;
  const hideHint = () => hint.classList.add('hide');
  if (sim.save.kills > 50) hideHint();
  document.getElementById('battle')!.addEventListener('pointerdown', hideHint, { once: true });
  setTimeout(hideHint, 7000);

  const applyFps = () => { app.ticker.maxFPS = sim.save.fps; };
  const applyQuality = () => {
    const low = sim.save.quality === 'low';
    scene.low = low;
    // Low quality renders at 1× device pixels: ~4× fewer pixels on high-DPI phones.
    app.renderer.resolution = low ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    app.resize();
  };
  const applySound = () => { sfx.enabled = sim.save.sound; if (sim.save.sound) sfx.unlock(); };
  const pwa = registerPwa();

  sim.missions.update(new Date());
  hud = new Hud(document.getElementById('app')!, sim, art.weaponIcons, (area, slot) => { ensureAreaSprites(area); return areaArt(area).monsterIcons[slot]; }, () => openSettings(sim, {
    applySound: () => { applySound(); save(); },
    applyQuality: () => { applyQuality(); save(); },
    applyFps: () => { applyFps(); save(); },
    reset: () => {
      saving = false; // stop pagehide/autosave from restoring the old save during reload
      wipeSave().finally(() => location.reload());
    },
    install: () => pwa.install(),
    canInstall: () => pwa.canInstall(),
  }));
  applyFps();
  applyQuality();
  sfx.enabled = sim.save.sound;
  // Browsers only allow audio after a user gesture, and iOS only counts some gesture types
  // (a finished tap, not the initial touch-down). So try on every kind of gesture until audio
  // is actually running. The listeners stay: iOS can also suspend audio after a phone call or
  // backgrounding, and the next tap brings it back. Once running, each call is a cheap check.
  const unlockAudio = () => { if (sim.save.sound && !sfx.running) sfx.unlock(); };
  for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {
    document.addEventListener(type, unlockAudio, { capture: true, passive: true });
  }
  if (hasReward(bootReward)) showWelcome(bootReward, sim.offlineCapHours);
  // Daily login: open the calendar shortly after start if today's reward is waiting
  // (after the welcome-back dialog, if that's showing).
  const offerLogin = () => {
    if (!sim.missions.canClaimAttendance(new Date())) return;
    if (!document.getElementById('modal')!.hidden || document.querySelector('.modal:not(#modal)')) { setTimeout(offerLogin, 1500); return; }
    hud!.missions.open('login');
  };
  setTimeout(offerLogin, 1200);
  save();

  const relayout = () => scene.layout(app.screen.width, app.screen.height);
  app.renderer.on('resize', relayout);
  relayout();

  // Fixed-timestep simulation with render interpolation.
  let acc = 0;
  let hudT = 0;
  let saveT = 0;
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.25);
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < MAX_STEPS_PER_FRAME) {
      sim.tick();
      acc -= TICK;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;
    scene.update(acc / TICK, dt);

    hudT += dt;
    if (hudT >= HUD_INTERVAL) { hudT = 0; hud!.refresh(); }
    saveT += dt;
    if (saveT >= AUTOSAVE_INTERVAL) { saveT = 0; save(); sim.missions.update(new Date()); }
  });

  // Pause rendering entirely when hidden; catch up briefly on return.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = performance.now();
      save();
      app.ticker.stop();
      sfx.suspend();
    } else {
      // Simulate the first minute live; pay anything longer as offline earnings.
      const away = (performance.now() - hiddenAt) / 1000;
      const live = Math.min(away, CATCHUP_LIMIT);
      sim.advance(live);
      sim.events.clear(); // don't replay a minute of effects at once
      const reward = offlineReward(sim.save, away - live, sim.offlineCapHours);
      if (hasReward(reward)) {
        applyOfflineReward(sim.save, reward);
        showWelcome({ ...reward, away, capped: away > CATCHUP_LIMIT + reward.seconds }, sim.offlineCapHours);
        save();
      }
      acc = 0;
      sim.missions.update(new Date()); // the day may have changed while away
      app.ticker.start();
      sfx.resume();
    }
  });
  window.addEventListener('pagehide', save);

  if (import.meta.env.DEV) {
    // Dev-only debug handle (stripped from production builds).
    (window as unknown as Record<string, unknown>).__fb = { sim, app, sfx, stopSaving: () => { saving = false; } };
  }
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="padding:20px;color:#fff">Couldn't start the game: ${String(err?.message ?? err)}</p>`;
});
