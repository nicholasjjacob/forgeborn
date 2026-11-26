import { BIOMES } from './sim/forest';
import { Application, TextureStyle } from 'pixi.js';
import '@fontsource/lilita-one/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import { loadSave, wipeSave, writeSave } from './core/save';
import { installFonts } from './render/fx';
import { Scene } from './render/scene';
import { areaArt, buildArt, ensureAreaSprites, loadRenderedArt } from './render/sprites';
import { TICK } from './sim/balance';
import { Sim } from './sim/sim';
import { installCurrencyIcons } from './render/currencyIcons';
import { Hud } from './ui/hud';
import { Input } from './ui/input';
import { zoneArea, zoneName } from './sim/zones';
import { areaMonsterModels, preloadArea } from './render/world3d';
import { warmHeroStage } from './ui/heroes';
import { loadingDone, loadingFailed, loadingPaint, loadingStep } from './ui/loading';
import { chooseStarter } from './ui/starter';
import { installCursors } from './ui/cursor';
import { STARTERS } from './sim/skins';
import { loadModel } from './render/models';
import { heroAnimFiles } from './render/heroRig';
import { OFFLINE_CAP_HOURS, applyOfflineReward, hasReward, offlineReward } from './sim/offline';
import { showWelcome } from './ui/welcome';
import { openSettings } from './ui/settings';
import { sfx } from './audio/sfx';
import { registerPwa } from './pwa';

/** A hero's model and animations (for the first-launch hero choice). */
const preloadHero = (id: string) => Promise.all([`hero_${id}`, ...heroAnimFiles(id)].map((n) => loadModel(n).catch(() => null)));

const MAX_STEPS_PER_FRAME = 8;   // avoid a "spiral of death" on slow frames
const HUD_INTERVAL = 0.1;        // seconds
const AUTOSAVE_INTERVAL = 10;    // seconds
const CATCHUP_LIMIT = 60;        // seconds simulated live after a tab switch; longer absences pay offline rewards

async function boot() {
  // Smooth, shaded art (drawn at high resolution): linear filtering, sub-pixel motion.
  TextureStyle.defaultOptions.scaleMode = 'linear';
  installCursors(); // the RPG arrow cursor on PC
  loadingStep(0.05, 'Starting up…');
  const savePromise = loadSave(); // read storage while the renderer starts up

  const host = document.getElementById('canvas-host')!;
  const app = new Application();
  await app.init({
    resizeTo: host,
    backgroundAlpha: 0, // transparent: the 3D world (Three.js) renders underneath
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
  loadingStep(0.1);

  // Damage numbers use the display font: wait briefly for it so the bitmap font is built from it.
  await Promise.race([document.fonts.load('32px "Lilita One"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  installFonts();
  const art = buildArt();
  // Rendered 3D sprites (hero + scenery now, each area's monsters on demand). If they're slow
  // or missing, the code-drawn art is used and swapped out as soon as the sheets arrive.
  loadingStep(0.14, 'Painting the heroes…');
  await Promise.race([loadRenderedArt(), new Promise((r) => setTimeout(r, 2500))]);
  const loaded = await savePromise;
  // Every 3D model the forest needs (a few MB the first time, cached after), with the bar
  // following along. A very slow connection carries on after a while: the rest pops in later.
  loadingStep(0.2, 'Loading the forest…');
  const area = zoneArea(loaded.zone ?? 0);
  // First launch: the hero choice shows all three starters, so fetch the other two as well.
  const firstRun = !loaded.starterChosen;
  const starters = firstRun ? STARTERS.filter((id) => id !== loaded.skin).map((id) => preloadHero(id)) : [];
  await Promise.race([
    Promise.all([preloadArea(area, loaded.skin, (f) => loadingStep(0.2 + 0.5 * f, `Loading the forest… ${Math.round(f * 100)}%`)), ...starters]),
    new Promise((r) => setTimeout(r, 20000)),
  ]);
  // Offline earnings since the last save (rewards are granted immediately, then shown).
  const bootReward = offlineReward(loaded, (Date.now() - loaded.savedAt) / 1000, OFFLINE_CAP_HOURS + loaded.perks.offline);
  if (hasReward(bootReward)) applyOfflineReward(loaded, bootReward);
  const sim = new Sim(loaded);
  if (import.meta.env.DEV) (window as unknown as { __sim: Sim }).__sim = sim; // dev-only handle for testing
  let saving = true;
  const save = () => { if (saving) writeSave(sim.save); };

  let hud: Hud | null = null;
  const scene = new Scene(app, sim, art, {
    onBossSpawn: () => hud?.toast('BOSS!', 'boss'),
    onBossFail: () => hud?.toast('Boss escaped… farm and try again', 'bad'),
    onAreaEnter: (zone) => hud?.toast(sim.map.forest && sim.biome >= 0 ? BIOMES[sim.biome].name : zoneName(zone), 'boss'),
    onRegionEnter: (biome) => hud?.toast(BIOMES[biome]?.name ?? '', 'boss'),
    onZoneClear: () => hud?.toast('Zone boss defeated! +10 gems', 'boss'),
    onGateOpen: (zone) => hud?.toast(`The way to ${zoneName(zone)} is open!`, 'boss'),
    onLevelUp: (level) => hud?.toast(`Level ${level}!`, 'boss'),
  });
  if (import.meta.env.DEV) (window as unknown as { __scene: Scene }).__scene = scene; // dev-only handle for testing
  new Input(document.getElementById('battle')!, sim, scene);

  // First-run hint: fades on the first touch/click or after a few seconds.
  const hint = document.getElementById('hint')!;
  if (document.documentElement.classList.contains('pc')) hint.textContent = 'Click or hold to move · WASD / arrow keys · Auto lets the hero hunt on their own';
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
  registerPwa(); // service worker (offline play) and automatic updates

  sim.missions.update(new Date());
  hud = new Hud(document.getElementById('app')!, sim, art.weaponIcons, (area, slot) => { ensureAreaSprites(area); return areaArt(area).monsterIcons[slot]; }, () => openSettings(sim, {
    applySound: () => { applySound(); save(); },
    applyQuality: () => { applyQuality(); save(); },
    applyFps: () => { applyFps(); save(); },
    reset: () => {
      saving = false; // stop pagehide/autosave from restoring the old save during reload
      wipeSave().finally(() => location.reload());
    },
    openReforge: () => hud?.openPage('reforge'),
    reforgeBadge: () => hud?.reforgeBadge() ?? '',
  }));
  hud.worldMap.overview = (w, r) => scene.world3d.renderOverview(w, r);
  installCurrencyIcons(); // 3D coin / shard / gem / ember icons for the whole UI
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

  // Behind the loading screen: build the forest, compile every shader with one of each monster
  // in view, draw the first frames and the World Map, so play starts without hitches.
  loadingStep(0.74, 'Growing the trees…');
  await loadingPaint();
  for (let i = 0; i < 100 && !scene.world3d.mapReady; i++) {
    scene.world3d.syncMap(sim.map);
    if (!scene.world3d.mapReady) await new Promise((r) => setTimeout(r, 100));
  }
  loadingStep(0.84, 'Waking the monsters…');
  await loadingPaint();
  await scene.world3d.warmUp(areaMonsterModels(area));
  scene.update(1, 0);
  app.render();
  loadingStep(0.93, 'Drawing the map…');
  await loadingPaint();
  hud.worldMap.warm();
  await Promise.race([warmHeroStage(sim).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]); // the Heroes screen's 3D stage
  if (sim.save.sound) sfx.prepare(); // audio set up now; the first tap only switches it on
  // The battlefield also changes size without a window resize (hiding/showing the menu).
  // Redraw at once: a resized canvas is blank until its next frame, which would flicker
  // while the menu slides.
  new ResizeObserver(() => { app.resize(); scene.world3d.render(); app.render(); }).observe(host);

  // Fixed-timestep simulation with render interpolation.
  let acc = 0;
  // First launch: the game waits (no ticks) while the player picks their hero.
  let choosing = firstRun;
  let hudT = 0;
  let saveT = 0;
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.25);
    acc = choosing ? 0 : acc + dt;
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
    hud!.frame(acc / TICK);
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
  // The hero choice sits under the loading screen, which fades away to reveal it.
  if (firstRun) void chooseStarter(sim).then(() => { choosing = false; save(); void warmHeroStage(sim).catch(() => {}); });
  loadingDone();

  if (import.meta.env.DEV) {
    // Dev-only debug handle (stripped from production builds).
    (window as unknown as Record<string, unknown>).__fb = { sim, app, sfx, scene, hud, stopSaving: () => { saving = false; } };
  }
}

boot().catch((err) => {
  console.error(err);
  loadingFailed(String(err?.message ?? err));
});
