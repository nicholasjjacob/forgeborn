import { monsterSlot, paintMonsterPortraits } from './monsterPreview';
import { gi, terrainIcon } from './icons';
import { zoneName } from '../sim/zones';
import { haptic, sfx } from '../audio/sfx';
import { rewardSpill, starBurst } from './rewardFx';
import { actionElement, bindSheetTaps } from './tap';
import { fmt } from '../core/format';
import { areaFor, areaName } from '../sim/areas';
import {
  DAILY_TASKS, JOURNEY_DAYS, JOURNEY_TASKS, SHOP, codexReward, codexTiers, describeReward, formatCountdown, msUntilNextDay,
  msUntilNextWeek, type Reward, type TaskDef,
} from '../sim/missions';
import type { BoardKind } from '../sim/missionSystem';
import type { Sim } from '../sim/sim';

export type MissionTab = 'login' | 'daily' | 'weekly' | 'journey' | 'codex' | 'shop';
const TAB_LABEL: Record<MissionTab, string> = { login: 'Login', daily: 'Daily', weekly: 'Weekly', journey: '7-Day', codex: 'Codex', shop: 'Shop' };
const TAB_TITLE: Record<MissionTab, string> = { login: 'Daily Login', daily: 'Daily Missions', weekly: 'Weekly Missions', journey: '7-Day Journey', codex: 'Monster Codex', shop: 'Gem Shop' };

/** Small inline reward chips (icons are CSS shapes, text is the amount). */
/** Large centred reward icons with amounts underneath (login calendar). */
function bigRewards(r: Reward): string {
  const it = (cls: string, n: number) => `<span class="ditem"><i class="${cls}"></i><b>${fmt(n)}</b></span>`;
  return [r.gold ? it('coin', r.gold) : '', r.shards ? it('gem', r.shards) : '', r.gems ? it('jewel', r.gems) : '', r.embers ? it('ember', r.embers) : ''].join('');
}

export function chips(r: Reward): string {
  const c: string[] = [];
  if (r.gold) c.push(`<span class="rchip"><i class="coin"></i>${fmt(r.gold)}</span>`);
  if (r.shards) c.push(`<span class="rchip"><i class="gem"></i>${fmt(r.shards)}</span>`);
  if (r.gems) c.push(`<span class="rchip"><i class="jewel"></i>${fmt(r.gems)}</span>`);
  if (r.embers) c.push(`<span class="rchip"><i class="ember"></i>${fmt(r.embers)}</span>`);
  if (r.xp) c.push(`<span class="rchip"><i class="xp-ico">XP</i>${fmt(r.xp)}</span>`);
  if (r.wood) c.push(`<span class="rchip"><i class="log"></i>${fmt(r.wood)}</span>`);
  if (r.stone) c.push(`<span class="rchip"><i class="rock"></i>${fmt(r.stone)}</span>`);
  return c.join('');
}

/** Whole numbers with separators below 100K ("3,000"), compact above ("1.2M"). */
function count(n: number): string {
  return n < 1e5 ? Math.floor(n).toLocaleString('en-US') : fmt(n);
}

/**
 * The Missions sheet (a full-height panel over the game) plus the main-screen pieces:
 * the left icon column and the right-side quest tracker. Rendering is string templates;
 * a section only re-renders when its state signature changes, so an open sheet costs little.
 */
export class MissionsUI {
  private wrap: HTMLElement | null = null;
  private tab: MissionTab = 'daily';
  private journeyDaySel = -1;
  private sig = '';
  private readonly cache = new Map<HTMLElement, string>();

  constructor(
    private readonly sim: Sim,
    private readonly toast: (m: string) => void,
    private readonly codexIcon: (area: number, slot: number) => string,
  ) {
    document.getElementById('side-missions')!.addEventListener('click', () => this.open(this.bestTab()));
    document.getElementById('side-journey')!.addEventListener('click', () => this.open('journey'));
    document.getElementById('side-codex')!.addEventListener('click', () => this.open('codex'));
    // Tracker cards are buttons (so a tap never starts the joystick). A finished mission is
    // claimed right there; any other card opens the daily board.
    document.getElementById('tracker')!.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.track-card');
      if (!card) return;
      const id = card.dataset.task;
      if (card.classList.contains('ready') && id && this.sim.missions.claimTask('daily', id, new Date())) {
        sfx.play('coin');
        starBurst(card);
        this.toast('Mission complete!');
        this.refreshMain(new Date());
        return;
      }
      this.open('daily');
    });
  }

  get isOpen(): boolean { return this.wrap !== null; }

  /** The section with something to claim, preferring login → daily → weekly. */
  private bestTab(): MissionTab {
    const b = this.sim.missions.badges(new Date());
    return b.login ? 'login' : b.daily ? 'daily' : b.weekly ? 'weekly' : 'daily';
  }

  open(tab: MissionTab = 'daily'): void {
    this.tab = tab;
    if (tab === 'codex') this.codexArea = null;
    if (this.wrap && !this.wrap.isConnected) this.close(); // removed from the page externally
    if (!this.wrap) {
      const wrap = document.createElement('div');
      wrap.className = 'modal sheet-wrap';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.innerHTML = `
        <div class="sheet">
          <div class="ribbon"><span class="ribbon-text"></span></div>
          <button type="button" class="sheet-x" aria-label="Close">✕</button>
          <div class="sheet-body"></div>
          <nav class="sheet-tabs" role="tablist"></nav>
        </div>`;
      bindSheetTaps(wrap, (act) => this.run(act));
      document.addEventListener('keydown', this.onKey);
      document.body.appendChild(wrap);
      this.wrap = wrap;
    }
    this.sig = '';
    this.refresh();
  }

  close(): void {
    if (!this.wrap) return;
    this.wrap.remove();
    this.wrap = null;
    document.removeEventListener('keydown', this.onKey);
  }

  private readonly onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); };

  private run(action: string): void {
    if (!this.wrap) return;
    if (action === 'close') { this.close(); return; }
    const el = actionElement(this.wrap, action);
    if (!el || (el as HTMLButtonElement).disabled) return;
    const m = this.sim.missions, now = new Date();
    const [act, a, b] = action.split(':');
    let reward: Reward | null = null;
    switch (act) {
      case 'tab': this.tab = a as MissionTab; sfx.play('tick'); break;
      case 'jday': this.journeyDaySel = Number(a); sfx.play('tick'); break;
      case 'task':
        if (m.claimTask(a as BoardKind, b, now)) { sfx.play('coin'); starBurst(el); this.toast('Mission complete!'); }
        break;
      case 'chest':
        if (m.canClaimChest(a as BoardKind, Number(b))) reward = m.claimChest(a as BoardKind, Number(b));
        else if (!m.board(a as BoardKind).chests.includes(Number(b))) {
          sfx.play('tick');
          this.toast(`🎁 at ${m.milestones(a as BoardKind)[Number(b)]} ★: ${describeReward(m.chestReward(a as BoardKind, Number(b)))}`);
        }
        break;
      case 'login': reward = m.claimAttendance(now); break;
      case 'codex': reward = m.claimCodex(Number(a), Number(b)); break;
      case 'carea': this.codexArea = a === 'back' ? null : Number(a); sfx.play('tick'); this.scrollTop = true; break;
      case 'buy': reward = m.buy(a); if (!reward) this.toast('Not enough gems'); break;
    }
    if (reward) {
      sfx.play('achieve');
      haptic(25);
      rewardSpill(reward, el);
      this.toast(`+ ${describeReward(reward)}`);
    }
    this.sig = '';
    this.refresh();
  }

  /** Re-render the open sheet if anything it shows changed. Called by the HUD ~10×/s. */
  refresh(): void {
    if (!this.wrap) return;
    const now = new Date();
    const m = this.sim.missions;
    const s = this.sim.save;
    const sig = JSON.stringify([this.tab, this.journeyDaySel, this.codexArea, s.missions, s.kills, s.stats, s.bestEver, Math.floor(now.getTime() / 30000)]);
    if (sig === this.sig) return;
    this.sig = sig;

    const badges = m.badges(now);
    const tabs: MissionTab[] = ['login', 'daily', 'weekly', ...(m.journeyActive(now) ? ['journey' as const] : []), 'codex', 'shop'];
    if (!tabs.includes(this.tab)) this.tab = 'daily';
    const badgeOf = (t: MissionTab) => (t === 'shop' ? 0 : badges[t as keyof typeof badges] ?? 0);
    this.wrap.querySelector('.ribbon-text')!.textContent = TAB_TITLE[this.tab];
    this.wrap.querySelector('.sheet-tabs')!.innerHTML = tabs.map((t) =>
      `<button type="button" role="tab" data-act="tab:${t}" aria-selected="${t === this.tab}">${TAB_LABEL[t]}${badgeOf(t) ? `<b class="dot">${badgeOf(t)}</b>` : ''}</button>`,
    ).join('');

    const body = this.wrap.querySelector<HTMLElement>('.sheet-body')!;
    // The login calendar stretches to fill the (fixed-height) sheet instead of leaving a gap.
    body.classList.toggle('fill', this.tab === 'login');
    const scroll = this.scrollTop ? 0 : body.scrollTop;
    this.scrollTop = false;
    body.innerHTML =
      this.tab === 'login' ? this.renderLogin(now)
      : this.tab === 'daily' ? this.renderBoard('daily', now)
      : this.tab === 'weekly' ? this.renderBoard('weekly', now)
      : this.tab === 'journey' ? this.renderJourney(now)
      : this.tab === 'codex' ? this.renderCodex()
      : this.renderShop();
    body.scrollTop = scroll;
    paintMonsterPortraits();
  }

  // --- Sections ---------------------------------------------------------------------

  private renderLogin(now: Date): string {
    const m = this.sim.missions, a = this.sim.save.missions.attendance;
    const canClaim = m.canClaimAttendance(now);
    // `a.day` is the next day to claim. Right after claiming Day 7 it wraps to 0 for tomorrow,
    // so for the rest of today the whole week shows as claimed.
    const cycleDone = !canClaim && a.day === 0 && a.last !== null;
    const cell = (d: number) => {
      const claimed = cycleDone || d < a.day;
      const today = canClaim && d === a.day;
      // --t keeps the "today" pulse smooth across the sheet's once-a-second re-render.
      return `<div class="day-cell ${d === 6 ? 'grand' : ''} ${claimed ? 'claimed' : ''} ${today ? 'today' : ''}" style="--t:-${Math.round(performance.now())}ms">
        <div class="day-label">Day ${d + 1}</div>
        <div class="day-items">${bigRewards(m.attendanceReward(d))}</div>
        ${claimed ? '<div class="check">✔</div>' : ''}
      </div>`;
    };
    return `
      <p class="sheet-note">Log in every day for rewards. Day 7 is the grand prize!</p>
      <div class="login-grid">${[0, 1, 2, 3, 4, 5, 6].map(cell).join('')}</div>
      <button type="button" class="btn big green" data-act="login" ${canClaim ? '' : 'disabled'}>
        ${canClaim ? `Claim Day ${a.day + 1}` : `Come back in ${formatCountdown(msUntilNextDay(now))}`}
      </button>`;
  }

  private track(kind: BoardKind): string {
    const m = this.sim.missions, b = m.board(kind), ms = m.milestones(kind);
    const max = ms[ms.length - 1];
    const next = ms.find((p) => p > b.points);
    return `
      <div class="ptrack">
        <div class="ptrack-pts"><i class="star">★</i><b>${b.points}</b></div>
        <div class="ptrack-col">
          <div class="ptrack-bar"><div class="ptrack-fill" style="transform:scaleX(${Math.min(1, b.points / max)})"></div>
            ${ms.map((p, i) => {
              const open = b.chests.includes(i), ready = m.canClaimChest(kind, i);
              // The sheet re-renders every second; a negative delay from a shared clock keeps the
              // chest animations running smoothly instead of restarting on every re-render.
              return `<button type="button" class="chest ${open ? 'open' : ''} ${ready ? 'ready' : ''}" style="left:${(p / max) * 100}%;--t:-${Math.round(performance.now())}ms"
                data-act="chest:${kind}:${i}" aria-label="Gift at ${p} points">
                <span class="chest-ico">${open ? gi('open-chest', 'gold') : gi('locked-chest', 'gold')}</span><span class="chest-pts">${p}</span></button>`;
            }).join('')}
          </div>
          <div class="ptrack-hint">${next ? `Next gift at <b>${next} ★</b> · tap a gift to see inside` : 'All gifts reached!'}</div>
        </div>
      </div>`;
  }

  private taskRow(kind: BoardKind, t: TaskDef, now: Date): string {
    const m = this.sim.missions, b = m.board(kind);
    const p = Math.min(t.target, m.progress(kind, t));
    const claimed = b.claimed.includes(t.id), ready = m.canClaimTask(kind, t, now);
    const locked = !m.taskUnlocked(kind, t, now);
    const show = (v: number) => (t.stat === 'play' ? `${Math.floor(v / 60)}m` : count(v));
    const pct = Math.floor((p / t.target) * 100);
    const right = claimed ? '<div class="task-end done">✔</div>'
      : ready ? `<button type="button" class="btn small green" data-act="task:${kind}:${t.id}">Claim</button>`
      : locked ? `<div class="task-end">${gi('padlock', 'grey')}</div>`
      : `<div class="task-end pct">${pct}%</div>`;
    return `
      <div class="task ${claimed ? 'claimed' : ''} ${ready ? 'ready' : ''} ${locked ? 'locked' : ''}">
        <div class="task-pts"><i class="star">★</i><b>${t.points}</b></div>
        <div class="task-main">
          <div class="task-text">${t.text}</div>
          <div class="bar"><div class="bar-fill" style="transform:scaleX(${p / t.target})"></div><span class="bar-text">${show(p)} / ${show(t.target)}</span></div>
        </div>
        ${right}
      </div>`;
  }

  private renderBoard(kind: 'daily' | 'weekly', now: Date): string {
    const ms = kind === 'daily' ? msUntilNextDay(now) : msUntilNextWeek(now);
    const tasks = this.sim.missions.tasks(kind);
    // Claimable first, then unfinished, then done.
    const order = (t: TaskDef) => (this.sim.missions.canClaimTask(kind, t, now) ? 0 : this.sim.missions.board(kind).claimed.includes(t.id) ? 2 : 1);
    return `
      <div class="timer">⏱ Resets in ${formatCountdown(ms)}</div>
      ${this.track(kind)}
      <div class="task-list">${[...tasks].sort((a, b) => order(a) - order(b)).map((t) => this.taskRow(kind, t, now)).join('')}</div>`;
  }

  private renderJourney(now: Date): string {
    const m = this.sim.missions;
    const today = Math.min(JOURNEY_DAYS - 1, m.journeyDay(now));
    if (this.journeyDaySel < 0 || this.journeyDaySel >= JOURNEY_DAYS) this.journeyDaySel = today;
    const sel = this.journeyDaySel;
    // A row of day buttons; locked days can be previewed (tasks shown with a lock).
    const dayTabs = Array.from({ length: JOURNEY_DAYS }, (_, d) => {
      const locked = d > today;
      const ready = !locked && JOURNEY_TASKS[d].some((t) => m.canClaimTask('journey', t, now));
      const done = !locked && JOURNEY_TASKS[d].every((t) => m.board('journey').claimed.includes(t.id));
      return `<button type="button" class="jday ${d === sel ? 'sel' : ''} ${locked ? 'locked' : ''} ${done ? 'done' : ''}" data-act="jday:${d}">
        <small>Day</small>${d + 1}${locked ? `<i class="jlock">${gi('padlock', 'grey')}</i>` : done ? `<i class="jlock">${gi('check-mark', 'green')}</i>` : ''}${ready ? '<b class="dot">!</b>' : ''}</button>`;
    }).join('');
    const left = Math.max(0, 14 - m.journeyDay(now));
    const unlockIn = sel > today ? msUntilNextDay(now) + (sel - today - 1) * 86400000 : 0;
    return `
      <div class="timer">⏱ Event ends in ${left} day${left === 1 ? '' : 's'}</div>
      ${this.track('journey')}
      <div class="jdays">${dayTabs}</div>
      ${sel > today ? `<p class="sheet-note jnote">${gi('padlock', 'grey')} Day ${sel + 1} unlocks in ${formatCountdown(unlockIn)}</p>` : ''}
      <div class="task-list">${JOURNEY_TASKS[sel].map((t) => this.taskRow('journey', t, now)).join('')}</div>`;
  }

  /** Codex: which terrain is open (null = the terrain list). */
  private codexArea: number | null = null;
  /** Jump to the top on the next render (after switching codex pages). */
  private scrollTop = false;

  /** Stars earned / available for one terrain's four monsters, and whether any can be claimed. */
  private codexProgress(area: number): { stars: number; total: number; ready: boolean } {
    const m = this.sim.missions;
    let stars = 0, total = 0, ready = false;
    for (let slot = 0; slot < 4; slot++) {
      stars += Math.min(m.codexClaimed(area, slot), codexTiers(slot).length);
      total += codexTiers(slot).length;
      if (m.canClaimCodex(area, slot)) ready = true;
    }
    return { stars, total, ready };
  }

  private renderCodex(): string {
    const areas = this.sim.missions.codexAreas();
    if (this.codexArea !== null && areas.includes(this.codexArea)) return this.renderCodexArea(this.codexArea);
    this.codexArea = null;
    // Terrain list: one big card per discovered terrain, painted in its ground colours.
    return `<p class="sheet-note">Pick a land to see its monsters. Every ★ milestone pays gems.</p>
      <div class="codex-lands">${areas.map((area) => {
        const { def } = areaFor(area);
        const g = def.ground;
        const p = this.codexProgress(area);
        return `<button type="button" class="codex-land ${p.ready ? 'ready' : ''}" data-act="carea:${area}" style="--g1:${g.light};--g2:${g.base};--g3:${g.dark}">
          <span class="cl-ico">${terrainIcon(area)}</span>
          <span class="cl-main"><b>${areaName(area)}</b>
            <span class="bar thin"><span class="bar-fill" style="transform:scaleX(${p.stars / p.total})"></span></span>
            <small>★ ${p.stars}/${p.total}</small></span>
          <span class="cl-mons">${[0, 1, 2, 3].map((slot) => monsterSlot(area, slot, this.codexIcon(area, slot), 'cl-mon', this.sim.missions.codexKills(area, slot) === 0)).join('')}</span>
          ${p.ready ? '<b class="dot">!</b>' : ''}
        </button>`;
      }).join('')}</div>
      <div class="codex-teaser">${gi('padlock', 'grey')} <b>Next land</b> · unlock ${zoneName(areas.length * 3)} on the Map to discover new monsters</div>`;
  }

  /** One terrain's monsters as big cards. */
  private renderCodexArea(area: number): string {
    const m = this.sim.missions;
    const { def } = areaFor(area);
    const mons = [...def.monsters, def.boss];
    const p = this.codexProgress(area);
    return `<div class="codex-top">
        <button type="button" class="btn small grey" data-act="carea:back">‹ Lands</button>
        <h3 class="codex-area">${terrainIcon(area)} ${areaName(area)}</h3><span class="codex-stars">★ ${p.stars}/${p.total}</span>
      </div>
      <div class="codex-grid big">${mons.map((mon, slot) => {
        const kills = m.codexKills(area, slot), tier = m.codexClaimed(area, slot), tiers = codexTiers(slot);
        const maxed = tier >= tiers.length, goal = maxed ? tiers[tiers.length - 1] : tiers[tier];
        const ready = m.canClaimCodex(area, slot), seen = kills > 0;
        const reward = maxed ? null : codexReward(slot, tier);
        return `<div class="codex-card ${slot === 3 ? 'boss' : ''} ${ready ? 'ready' : ''} ${maxed ? 'maxed' : ''}">
          ${slot === 3 ? '<span class="boss-tag">BOSS</span>' : ''}
          <div class="codex-portrait"><img alt="" src="${this.codexIcon(area, slot)}" class="${seen ? '' : 'unseen'}" /><canvas class="mon3d ${seen ? '' : 'unseen'}" data-model="m${area % 6}_${slot}" data-fly="${slot < 3 && mon.shape === 'bat' ? 1 : 0}"></canvas></div>
          <div class="codex-name">${seen ? mon.name : '???'}</div>
          <div class="stars">${tiers.map((_, i) => `<i class="${i < tier ? 'on' : ''}">★</i>`).join('')}</div>
          <div class="bar thin"><div class="bar-fill" style="transform:scaleX(${Math.min(1, kills / goal)})"></div></div>
          <div class="codex-count">${count(Math.min(kills, goal))}/${count(goal)} defeated</div>
          ${ready ? `<button type="button" class="btn small green" data-act="codex:${area}:${slot}">Claim</button>`
            : maxed ? '<div class="codex-next done">Complete!</div>'
            : `<div class="codex-next">Next ${chips(reward!)}</div>`}
        </div>`;
      }).join('')}</div>`;
  }

  private renderShop(): string {
    const g = this.sim.save.missions.gems;
    const icon: Record<string, string> = {
      gold: '<i class="coin big"></i>', shards: '<i class="gem big"></i>', warp: gi('hourglass', 'cyan'), xp: gi('book-cover', 'blue'), embers: '<i class="ember big"></i>',
      mats: '<span class="mats-ico"><i class="log"></i><i class="rock"></i></span>',
    };
    return `
      <div class="gem-balance"><i class="jewel"></i>${fmt(g)} <span>gems</span></div>
      <p class="sheet-note">Earn gems from logins, mission gifts and the codex.</p>
      <div class="shop">${SHOP.map((o) => {
        const can = g >= o.cost;
        return `
        <div class="offer ${can ? '' : 'cant'}">
          <div class="offer-ico">${icon[o.id] ?? gi('present', 'pink')}</div>
          <div class="offer-name">${o.name}</div>
          <div class="offer-desc">${o.desc}</div>
          <div class="offer-gets">${chips(this.sim.missions.offerReward(o.id))}</div>
          <button type="button" class="btn small blue offer-buy" data-act="buy:${o.id}" ${can ? '' : 'disabled'}><i class="jewel"></i>${o.cost}</button>
        </div>`;
      }).join('')}
      </div>`;
  }

  // --- Main-screen pieces --------------------------------------------------------------

  private set(el: HTMLElement, html: string): void {
    if (this.cache.get(el) === html) return;
    this.cache.set(el, html);
    el.innerHTML = html;
  }

  /** Side icon badges + the right-side tracker. Called by the HUD ~10×/s. */
  refreshMain(now: Date): void {
    const m = this.sim.missions;
    const b = m.badges(now);
    const badge = (id: string, n: number) => {
      const el = document.querySelector<HTMLElement>(`#${id} .dot`)!;
      const txt = n > 0 ? String(n) : '';
      if (el.textContent !== txt) el.textContent = txt;
      el.hidden = n === 0;
    };
    badge('side-missions', b.login + b.daily + b.weekly);
    badge('side-journey', b.journey);
    badge('side-codex', b.codex);
    const j = document.getElementById('side-journey')!;
    const active = m.journeyActive(now);
    if (j.hidden === active) j.hidden = !active;
    const gemEl = document.getElementById('gem-label')!;
    const gems = fmt(this.sim.save.missions.gems);
    if (gemEl.textContent !== gems) gemEl.textContent = gems;

    // Tracker: up to two daily missions, claimable first, then closest to done.
    const tasks = DAILY_TASKS.filter((t) => t.id !== 'd-login' && !m.board('daily').claimed.includes(t.id))
      .map((t) => ({ t, p: Math.min(1, m.progress('daily', t) / t.target) }))
      .sort((a, z) => (z.p >= 1 ? 1 : 0) - (a.p >= 1 ? 1 : 0) || z.p - a.p)
      .slice(0, 2);
    this.set(document.getElementById('tracker')!, tasks.map(({ t, p }) => `
      <button type="button" class="track-card ${p >= 1 ? 'ready' : ''}" data-task="${t.id}" aria-label="${t.text}${p >= 1 ? ': tap to claim' : ''}">
        <span class="track-text">${p >= 1 ? '✔ ' : ''}${t.text}</span>
        ${p >= 1 ? '<span class="track-claim">Tap to claim</span>' : `<span class="bar thin"><span class="bar-fill" style="transform:scaleX(${p.toFixed(2)})"></span></span>`}
      </button>`).join(''));
  }
}
