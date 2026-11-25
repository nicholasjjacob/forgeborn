import { autoFit } from './pager';
import { Minimap } from './minimap';
import { gi } from './icons';
import { HeroesUI } from './heroes';
import { fmt } from '../core/format';
import { WorldMapUI } from './worldMap';
import { zoneBossName, zoneLevel, zoneName, zoneTerrain } from '../sim/zones';
import { BOSS_TIME, UPGRADES, UPGRADE_IDS, type UpgradeId } from '../sim/balance';
import type { BuyMode, Sim } from '../sim/sim';
import { ForgePanel } from './forge';
import { sfx } from '../audio/sfx';
import { QuestPanel } from './quests';
import { ReforgePanel } from './reforge';
import { MissionsUI } from './missions';
import { LevelRoad } from './levelRoad';
import { BagUI } from './bag';
import { MAX_LEVEL, levelTier } from '../sim/level';

type Tab = 'upgrades' | 'forge' | 'quests' | 'reforge';
const PAGE_TITLE: Record<Tab, string> = { upgrades: 'Upgrades', forge: 'Forge', quests: 'Quests', reforge: 'Reforge' };
/** Stand-in icons for the bottom bar until the 3D ones are rendered (see render/currencyIcons.ts). */
const DOCK_ICONS: [string, string, 'white' | 'gold' | 'grey' | 'green'][] = [['up', 'sprint', 'green'], ['anvil', 'anvil-impact', 'grey'], ['scroll', 'checklist', 'gold']];

const ICONS: Record<UpgradeId, string> = {
  atk: gi('crossed-swords'), hp: gi('hearts'), aspd: gi('sprint'), crit: gi('bullseye'), gold: gi('two-coins'),
};
/** Side column and top bar icons (the HTML ships emoji placeholders; these replace them). */
const SIDE_ICONS: [string, string, Parameters<typeof gi>[1]][] = [
  ['#side-map', 'treasure-map', 'gold'], ['#side-missions', 'checklist', 'white'], ['#side-journey', 'present', 'pink'],
  ['#side-codex', 'spell-book', 'purple'], ['#side-bag', 'knapsack', 'orange'], ['#side-heroes', 'visored-helm', 'cyan'],
];

interface Row {
  id: UpgradeId;
  level: HTMLElement;
  value: HTMLElement;
  btn: HTMLButtonElement;
  count: HTMLElement;
  cost: HTMLElement;
}

/**
 * DOM HUD. Text only changes when its value changes (cached strings), and the HUD refreshes
 * at ~10 Hz rather than every frame, so it costs almost nothing while the battle renders.
 */
export class Hud {
  private readonly rows: Row[] = [];
  private readonly cache = new Map<HTMLElement, string>();
  private readonly el: Record<string, HTMLElement>;
  private toastTimer = 0;
  /** The menu page open over the battlefield, if any. */
  private tab: Tab | null = null;
  private readonly forge: ForgePanel;
  private readonly quests: QuestPanel;
  private readonly reforge: ReforgePanel;
  private readonly badges: Record<Exclude<Tab, 'upgrades'>, HTMLElement>;
  private toastUntil = 0;
  readonly missions: MissionsUI;
  readonly levelRoad: LevelRoad;
  readonly bag: BagUI;
  readonly worldMap: WorldMapUI;
  private readonly mapDot: HTMLElement;
  private readonly lv: { chip: HTMLElement; num: HTMLElement; fill: HTMLElement; dot: HTMLElement };

  constructor(root: HTMLElement, private readonly sim: Sim, weaponIcons: string[][], codexIcon: (area: number, slot: number) => string, onSettings: () => void) {
    const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    this.el = {
      stage: $('#stage-label'),
      area: $('#area-label'),
      progress: $('#progress'),
      progressFill: $('#progress-fill'),
      progressText: $('#progress-text'),
      auto: $('#auto-btn'),
      gold: $('#gold-label'),
      shards: $('#shard-label'),
      ember: $('#ember-label'),
      emberPill: $('.embers'),
      buyModes: $('.buy-modes'),
      challenge: $('#challenge-btn'),
      toast: $('#toast'),
      settings: $('#settings-btn'),
      vignette: $('#vignette'),
      list: $('#upgrade-list'),
    };

    this.el.challenge.addEventListener('click', () => {
      if (sim.challengeBoss()) return;
      const left = sim.bossCooldownLeft();
      if (left > 0) { sfx.play('tick'); this.toast(`${zoneBossName(sim.save.zone)} is recovering: rematch in ${clock(left)}`); }
    });
    this.el.settings.addEventListener('click', () => onSettings());
    // UI click sound for every panel button.
    $('#panel').addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button:not(:disabled)')) sfx.play('tick'); });
    this.el.auto.addEventListener('click', () => { sim.setAuto(!sim.save.auto); this.refresh(); });

    for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-buy-mode]')) {
      btn.addEventListener('click', () => {
        const m = btn.dataset.buyMode!;
        sim.setBuyMode((m === 'max' ? 'max' : Number(m)) as BuyMode);
        this.refresh();
      });
    }

    for (const id of UPGRADE_IDS) this.rows.push(this.buildRow(id));
    this.forge = new ForgePanel($('#forge-root'), sim, weaponIcons, (m) => this.toast(m));
    this.quests = new QuestPanel($('#quests-root'), sim);
    this.reforge = new ReforgePanel($('#reforge-root'), sim, (m) => this.toast(m, 'boss'));
    this.missions = new MissionsUI(sim, (m) => this.toast(m), codexIcon);
    this.levelRoad = new LevelRoad(sim, (m, k) => this.toast(m, k));
    this.bag = new BagUI(sim, () => this.openPage('forge'));
    $('#side-bag').addEventListener('click', () => { sfx.play('tick'); this.bag.open(); });
    this.worldMap = new WorldMapUI(sim, (m) => this.toast(m), codexIcon);
    this.minimap = new Minimap(sim, () => { sfx.play('tick'); this.worldMap.open(); });
    $('#battle').appendChild(this.minimap.el);
    $('#side-map').addEventListener('click', () => { sfx.play('tick'); this.worldMap.open(); });
    this.mapDot = $('#side-map .dot');
    this.lv = { chip: $('#level-chip'), num: $('#level-num'), fill: $('#xp-fill'), dot: $('#level-dot') };
    this.lv.chip.addEventListener('click', () => { sfx.play('tick'); this.levelRoad.open(); });
    this.badges = { forge: $('#forge-badge'), quests: $('#quests-badge'), reforge: $('#reforge-badge') };
    for (const [sel, name, color] of SIDE_ICONS) $(`${sel} .side-ico`).innerHTML = gi(name, color);
    $('#settings-btn .cog').innerHTML = gi('cog');
    for (const [ico, name, color] of DOCK_ICONS) $(`.dock-ico[data-ico="${ico}"]`).innerHTML = gi(name, color);
    const heroes = new HeroesUI(sim, (m) => this.toast(m));
    $('#side-heroes').addEventListener('click', () => { sfx.play('tick'); heroes.open(); });

    // Bottom bar: each icon opens its page over the battlefield; tapping it again closes it.
    for (const t of root.querySelectorAll<HTMLButtonElement>('#dock [data-tab]')) {
      t.addEventListener('click', () => {
        sfx.play('tick');
        const tab = t.dataset.tab as Tab;
        if (tab === this.tab) this.closePage(); else this.openPage(tab);
      });
    }
    $('#page-close').addEventListener('click', () => { sfx.play('tick'); this.closePage(); });
    window.addEventListener('resize', () => this.fitPagers());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.tab && !document.querySelector('.modal')) this.closePage(); });
    // The open menu page never scrolls: on a very short screen its content shrinks to fit.
    this.fitAll = autoFit(document.getElementById('panel')!, () => false);
    this.refresh();
  }

  private buildRow(id: UpgradeId): Row {
    const def = UPGRADES[id];
    const li = document.createElement('li');
    li.className = 'upgrade';
    li.innerHTML = `
      <span class="icon" style="--c:#${def.color.toString(16).padStart(6, '0')}">${ICONS[id]}</span>
      <span class="info">
        <span class="name">${def.name} <span class="lvl"></span></span>
        <span class="value"></span>
      </span>
      <button class="buy" type="button"><span class="count"></span><span class="cost"></span></button>`;
    this.el.list.appendChild(li);
    const btn = li.querySelector<HTMLButtonElement>('.buy')!;
    this.bindHoldToRepeat(btn, () => {
      if (this.sim.buy(id)) this.refresh();
    });
    return {
      id,
      level: li.querySelector('.lvl')!,
      value: li.querySelector('.value')!,
      btn,
      count: li.querySelector('.count')!,
      cost: li.querySelector('.cost')!,
    };
  }

  /** Tap to buy once; hold to keep buying (accelerating). Pointer events work for touch and mouse. */
  private bindHoldToRepeat(btn: HTMLButtonElement, action: () => void): void {
    let timer = 0;
    let delay = 0;
    const stop = () => { clearTimeout(timer); timer = 0; };
    const loop = () => {
      action();
      delay = Math.max(50, delay * 0.8);
      timer = window.setTimeout(loop, delay);
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      try { btn.setPointerCapture(e.pointerId); } catch { /* unsupported: hold-repeat just ends on pointerup */ }
      action();
      delay = 220;
      timer = window.setTimeout(loop, 380);
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('lostpointercapture', stop);
    // Keyboard access: Enter/Space trigger click without pointer events.
    btn.addEventListener('click', (e) => { if (e.detail === 0) action(); });
  }

  private fitAll: () => void = () => {};
  private readonly minimap: Minimap;

  /** Open a menu page (Upgrades, Forge, Quests; Reforge from Settings) over the battlefield. */
  openPage(tab: Tab): void {
    this.tab = tab;
    const panel = document.getElementById('panel')!;
    panel.hidden = false;
    for (const t of document.querySelectorAll<HTMLElement>('#dock [data-tab]')) t.setAttribute('aria-pressed', String(t.dataset.tab === tab));
    for (const p of document.querySelectorAll<HTMLElement>('[data-page]')) p.hidden = p.dataset.page !== tab;
    document.getElementById('page-title')!.textContent = PAGE_TITLE[tab];
    this.refresh();
    this.fitPagers();
    this.fitAll();
  }

  /** Paged lists show as many rows as the (now taller) page fits. */
  private fitPagers(): void {
    if (this.tab === 'forge') this.forge.fitPager();
    if (this.tab === 'reforge') this.reforge.fitPager();
  }

  /** The Reforge badge (shown on the Settings button, where Reforge now lives). */
  reforgeBadge(): string { return this.reforge.badge(); }

  closePage(): void {
    this.tab = null;
    document.getElementById('panel')!.hidden = true;
    for (const t of document.querySelectorAll<HTMLElement>('#dock [data-tab]')) t.setAttribute('aria-pressed', 'false');
  }

  private setBadge(tab: Exclude<Tab, 'upgrades'>, text: string): void {
    const el = this.badges[tab];
    this.set(el, text);
    this.toggle(el, 'show', text !== '');
  }

  private challengeHtml = '';
  private bossAnnounced = -1;

  private set(el: HTMLElement, text: string): void {
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text);
    el.textContent = text;
  }

  private toggle(el: HTMLElement, cls: string, on: boolean): void {
    if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  }

  /** Pop the Bag icon when a wood/stone piece is collected. */
  bumpMaterial(_kind: 'wood' | 'stone'): void {
    const el = document.getElementById('side-bag');
    if (!el) return;
    el.classList.remove('fx-bump');
    void el.offsetWidth;
    el.classList.add('fx-bump');
  }

  toast(msg: string, kind: 'good' | 'bad' | 'boss' = 'good'): void {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.toggle('long', msg.length > 22);
    t.dataset.kind = kind;
    t.classList.remove('show');
    void t.offsetWidth; // restart the CSS animation
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 1800);
    this.toastUntil = performance.now() + 1900;
  }

  /** Called ~10× per second. */
  refresh(): void {
    const sim = this.sim;
    const s = sim.save;
    this.set(this.el.stage, zoneName(s.zone));
    this.set(this.el.area, `${zoneTerrain(s.zone)} · Zone ${s.zone + 1}`);
    const boss = sim.isBossStage;
    const max = sim.maxZone;
    this.toggle(this.el.progress, 'boss', boss);
    this.toggle(this.el.progress, 'ready', !boss && !sim.zoneBossBeaten);
    let frac: number, label: string;
    if (boss) { frac = sim.bossT / BOSS_TIME; label = `BOSS ${Math.ceil(sim.bossT)}s`; }
    else if (!sim.zoneBossBeaten) { frac = 1; label = `☠ ${zoneBossName(s.zone)}`; }
    else if (max > s.zone) { frac = 1; label = '🗺 New zone open!'; }
    else {
      // Boss beaten; only the hero level stands between here and the next zone.
      const need = zoneLevel(s.zone + 1);
      frac = s.level / need; label = `Next zone at Lv ${need}`;
    }
    this.mapDot.hidden = !(max > s.zone);
    this.set(this.el.progressText, label);
    const scale = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`;
    if (this.cache.get(this.el.progressFill) !== scale) {
      this.cache.set(this.el.progressFill, scale);
      this.el.progressFill.style.transform = scale;
    }
    this.toggle(this.el.auto, 'on', s.auto);
    this.set(this.el.gold, fmt(s.gold));
    this.set(this.el.shards, fmt(s.shards));
    this.set(this.el.ember, fmt(s.embers));
    this.toggle(this.el.emberPill, 'show', s.embersEarned > 0 || sim.reforgeGain > 0);
    this.bag.refresh();
    this.setBadge('forge', this.forge.badge());
    this.setBadge('quests', this.quests.badge());
    this.setBadge('reforge', this.reforge.badge());
    // Hero level chip: level, XP bar, red dot when a Level Road reward is waiting.
    this.set(this.lv.num, `Lv ${s.level}`);
    const xpScale = `scaleX(${s.level >= MAX_LEVEL ? 1 : Math.min(1, s.xp / sim.xpNeeded).toFixed(3)})`;
    if (this.cache.get(this.lv.fill) !== xpScale) { this.cache.set(this.lv.fill, xpScale); this.lv.fill.style.transform = xpScale; }
    const tierCss = levelTier(s.level).css;
    if (this.cache.get(this.lv.chip) !== tierCss) { this.cache.set(this.lv.chip, tierCss); this.lv.chip.style.setProperty('--tier', tierCss); }
    const ready = sim.levelRewardsReady();
    this.lv.dot.hidden = ready === 0;
    this.set(this.lv.dot, String(ready));
    this.levelRoad.refresh();

    // Sim notices (achievements, finished quests) become toasts, one at a time.
    if (sim.notices.length && performance.now() > this.toastUntil) {
      this.toast(sim.notices.shift()!);
      sfx.play('achieve');
    }
    this.toggle(this.el.vignette, 'boss', sim.isBossStage && sim.phase === 'playing');
    const now = new Date();
    this.missions.refreshMain(now);
    this.missions.refresh();

    // Boss button: a plain "Rematch" once beaten; while the zone's boss is still standing it's a
    // big glowing, bouncing call to action with the boss's name, announced once per zone.
    const fresh = !sim.zoneBossBeaten;
    this.toggle(this.el.challenge, 'show', !sim.isBossStage && sim.phase === 'playing');
    this.toggle(this.el.challenge, 'ready', fresh);
    const cool = fresh ? 0 : sim.bossCooldownLeft();
    this.toggle(this.el.challenge, 'cooling', cool > 0);
    const cbHtml = fresh
      ? `<span class="cb-main">${gi('skull-crossed-bones', 'white')} Fight Boss!</span><span class="cb-sub">${zoneBossName(s.zone)}</span>`
      : cool > 0 ? `<span class="cb-main">Rematch</span><span class="cb-sub">in ${clock(cool)}</span>` : 'Rematch Boss';
    if (cbHtml !== this.challengeHtml) { this.challengeHtml = cbHtml; this.el.challenge.innerHTML = cbHtml; }
    if (fresh && !sim.isBossStage && this.bossAnnounced !== s.zone && performance.now() > this.toastUntil) {
      this.bossAnnounced = s.zone;
      this.toast(`${zoneBossName(s.zone)} awaits! Tap Fight Boss`, 'boss');
    }
    this.worldMap.refresh();
    this.minimap.update();

    for (const b of document.querySelectorAll<HTMLElement>('[data-buy-mode]')) {
      this.toggle(b, 'active', b.dataset.buyMode === String(s.buyMode));
    }

    if (this.tab === 'forge') { this.forge.refresh(); return; }
    if (this.tab === 'quests') { this.quests.refresh(); return; }
    if (this.tab === 'reforge') { this.reforge.refresh(); return; }
    if (this.tab !== 'upgrades') return;
    for (const r of this.rows) {
      const def = UPGRADES[r.id];
      const lvl = s.upgrades[r.id];
      const maxed = lvl >= def.maxLevel;
      const q = sim.quote(r.id);
      this.set(r.level, `Lv ${lvl}`);
      const now = def.show(def.value(lvl));
      this.set(r.value, maxed ? `${now} (max)` : `${now} → ${def.show(def.value(lvl + Math.max(1, q.count)))}`);
      this.set(r.count, maxed ? 'MAX' : `+${q.count}`);
      this.set(r.cost, maxed ? '' : fmt(q.cost));
      const can = !maxed && q.cost <= s.gold;
      if (r.btn.disabled === can) r.btn.disabled = !can;
    }
  }
}

/** 125 → "2:05", 3725 → "1:02:05". */
function clock(sec: number): string {
  const t = Math.ceil(sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
