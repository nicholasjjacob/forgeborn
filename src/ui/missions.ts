import { haptic, sfx } from '../audio/sfx';
import { fmt } from '../core/format';
import { areaFor, areaName } from '../sim/areas';
import {
  DAILY_TASKS, JOURNEY_DAYS, JOURNEY_TASKS, SHOP, codexTiers, describeReward, formatCountdown, msUntilNextDay,
  msUntilNextWeek, type Reward, type TaskDef,
} from '../sim/missions';
import type { BoardKind } from '../sim/missionSystem';
import type { Sim } from '../sim/sim';

export type MissionTab = 'login' | 'daily' | 'weekly' | 'journey' | 'codex' | 'shop';
const TAB_LABEL: Record<MissionTab, string> = { login: 'Login', daily: 'Daily', weekly: 'Weekly', journey: '7-Day', codex: 'Codex', shop: 'Shop' };
const TAB_TITLE: Record<MissionTab, string> = { login: 'Daily Login', daily: 'Daily Missions', weekly: 'Weekly Missions', journey: '7-Day Journey', codex: 'Monster Codex', shop: 'Gem Shop' };

/** Small inline reward chips (icons are CSS shapes, text is the amount). */
function chips(r: Reward): string {
  const c: string[] = [];
  if (r.gold) c.push(`<span class="rchip"><i class="coin"></i>${fmt(r.gold)}</span>`);
  if (r.shards) c.push(`<span class="rchip"><i class="gem"></i>${fmt(r.shards)}</span>`);
  if (r.gems) c.push(`<span class="rchip"><i class="jewel"></i>${fmt(r.gems)}</span>`);
  if (r.embers) c.push(`<span class="rchip"><i class="ember"></i>${fmt(r.embers)}</span>`);
  return c.join('');
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
    document.getElementById('tracker')!.addEventListener('click', () => this.open('daily'));
  }

  get isOpen(): boolean { return this.wrap !== null; }

  /** The section with something to claim, preferring login → daily → weekly. */
  private bestTab(): MissionTab {
    const b = this.sim.missions.badges(new Date());
    return b.login ? 'login' : b.daily ? 'daily' : b.weekly ? 'weekly' : 'daily';
  }

  open(tab: MissionTab = 'daily'): void {
    this.tab = tab;
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
      wrap.addEventListener('click', (e) => this.onClick(e));
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

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t === this.wrap || t.closest('.sheet-x')) { this.close(); return; }
    const el = t.closest<HTMLElement>('[data-act]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const m = this.sim.missions, now = new Date();
    const [act, a, b] = el.dataset.act!.split(':');
    let reward: Reward | null = null;
    switch (act) {
      case 'tab': this.tab = a as MissionTab; sfx.play('tick'); break;
      case 'jday': this.journeyDaySel = Number(a); sfx.play('tick'); break;
      case 'task':
        if (m.claimTask(a as BoardKind, b, now)) { sfx.play('coin'); this.toast('Mission complete!'); }
        break;
      case 'chest': reward = m.claimChest(a as BoardKind, Number(b)); break;
      case 'login': reward = m.claimAttendance(now); break;
      case 'codex': reward = m.claimCodex(Number(a), Number(b)); break;
      case 'buy': reward = m.buy(a); if (!reward) this.toast('Not enough gems'); break;
    }
    if (reward) {
      sfx.play('achieve');
      haptic(25);
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
    const sig = JSON.stringify([this.tab, this.journeyDaySel, s.missions, s.kills, s.stats, s.bestEver, Math.floor(now.getTime() / 30000)]);
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
    const scroll = body.scrollTop;
    body.innerHTML =
      this.tab === 'login' ? this.renderLogin(now)
      : this.tab === 'daily' ? this.renderBoard('daily', now)
      : this.tab === 'weekly' ? this.renderBoard('weekly', now)
      : this.tab === 'journey' ? this.renderJourney(now)
      : this.tab === 'codex' ? this.renderCodex()
      : this.renderShop();
    body.scrollTop = scroll;
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
      return `<div class="day-cell ${d === 6 ? 'grand' : ''} ${claimed ? 'claimed' : ''} ${today ? 'today' : ''}">
        <div class="day-label">Day ${d + 1}</div>
        <div class="day-reward">${chips(m.attendanceReward(d))}</div>
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
    return `
      <div class="ptrack">
        <div class="ptrack-pts"><i class="star">★</i>${b.points}</div>
        <div class="ptrack-bar"><div class="ptrack-fill" style="transform:scaleX(${Math.min(1, b.points / max)})"></div>
          ${ms.map((p, i) => {
            const open = b.chests.includes(i), ready = m.canClaimChest(kind, i);
            return `<button type="button" class="chest ${open ? 'open' : ''} ${ready ? 'ready' : ''}" style="left:${(p / max) * 100}%"
              data-act="chest:${kind}:${i}" ${ready ? '' : 'disabled'} title="${describeReward(m.chestReward(kind, i))}">
              <span class="chest-ico">${open ? '✔' : '🎁'}</span><span class="chest-pts">${p}</span></button>`;
          }).join('')}
        </div>
      </div>`;
  }

  private taskRow(kind: BoardKind, t: TaskDef, now: Date): string {
    const m = this.sim.missions, b = m.board(kind);
    const p = Math.min(t.target, m.progress(kind, t));
    const claimed = b.claimed.includes(t.id), ready = m.canClaimTask(kind, t, now);
    const locked = !m.taskUnlocked(kind, t, now);
    const show = (v: number) => (t.stat === 'play' ? `${Math.floor(v / 60)}m` : fmt(v));
    return `
      <div class="task ${claimed ? 'claimed' : ''} ${ready ? 'ready' : ''}">
        <div class="task-pts"><i class="star">★</i><span>${t.points}</span></div>
        <div class="task-main">
          <div class="task-text">${t.text}</div>
          <div class="bar"><div class="bar-fill" style="transform:scaleX(${p / t.target})"></div><span class="bar-text">${show(p)} / ${show(t.target)}</span></div>
        </div>
        ${claimed ? '<div class="task-done">✔</div>'
          : `<button type="button" class="btn small ${ready ? 'green' : 'grey'}" data-act="task:${kind}:${t.id}" ${ready ? '' : 'disabled'}>${locked ? '🔒' : 'Claim'}</button>`}
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
    if (this.journeyDaySel < 0 || this.journeyDaySel > today) this.journeyDaySel = today;
    const dayTabs = Array.from({ length: JOURNEY_DAYS }, (_, d) => {
      const locked = d > today;
      const ready = JOURNEY_TASKS[d].some((t) => m.canClaimTask('journey', t, now));
      return `<button type="button" class="jday ${d === this.journeyDaySel ? 'sel' : ''}" data-act="jday:${d}" ${locked ? 'disabled' : ''}>
        ${locked ? '🔒' : `Day ${d + 1}`}${ready ? '<b class="dot">!</b>' : ''}</button>`;
    }).join('');
    const left = Math.max(0, 14 - m.journeyDay(now));
    return `
      <div class="timer">⏱ Event ends in ${left} day${left === 1 ? '' : 's'}</div>
      ${this.track('journey')}
      <div class="journey">
        <div class="jdays">${dayTabs}</div>
        <div class="task-list">${JOURNEY_TASKS[this.journeyDaySel].map((t) => this.taskRow('journey', t, now)).join('')}</div>
      </div>`;
  }

  private renderCodex(): string {
    const m = this.sim.missions;
    return `<p class="sheet-note">Defeat monsters to fill the codex. Every milestone pays gems.</p>` +
      m.codexAreas().reverse().map((area) => {
        const { def } = areaFor(area);
        const mons = [...def.monsters, def.boss];
        return `<h3 class="codex-area">${areaName(area)}</h3><div class="codex-grid">${mons.map((mon, slot) => {
          const kills = m.codexKills(area, slot), tier = m.codexClaimed(area, slot), tiers = codexTiers(slot);
          const maxed = tier >= tiers.length, goal = maxed ? tiers[tiers.length - 1] : tiers[tier];
          const ready = m.canClaimCodex(area, slot), seen = kills > 0;
          return `<div class="codex-card ${slot === 3 ? 'boss' : ''} ${ready ? 'ready' : ''}">
            ${slot === 3 ? '<span class="boss-tag">BOSS</span>' : ''}
            <img alt="" src="${this.codexIcon(area, slot)}" class="${seen ? '' : 'unseen'}" />
            <div class="codex-name">${seen ? mon.name : '???'}</div>
            <div class="stars">${tiers.map((_, i) => `<i class="${i < tier ? 'on' : ''}">★</i>`).join('')}</div>
            <div class="bar thin"><div class="bar-fill" style="transform:scaleX(${Math.min(1, kills / goal)})"></div></div>
            <div class="codex-count">${fmt(Math.min(kills, goal))}/${fmt(goal)}</div>
            ${ready ? `<button type="button" class="btn tiny green" data-act="codex:${area}:${slot}">Claim</button>` : ''}
          </div>`;
        }).join('')}</div>`;
      }).join('');
  }

  private renderShop(): string {
    const g = this.sim.save.missions.gems;
    return `
      <div class="gem-balance"><i class="jewel"></i>${fmt(g)} <span>gems</span></div>
      <p class="sheet-note">Earn gems from logins, mission chests and the codex.</p>
      <div class="shop">${SHOP.map((o) => `
        <div class="offer">
          <div class="offer-ico">${o.id === 'shards' ? '<i class="gem big"></i>' : o.id === 'gold' ? '<i class="coin big"></i>' : '⏳'}</div>
          <div class="offer-main"><div class="offer-name">${o.name}</div><div class="offer-desc">${o.desc}</div>
            <div class="offer-gets">${chips(this.sim.missions.offerReward(o.id))}</div></div>
          <button type="button" class="btn small blue" data-act="buy:${o.id}" ${g >= o.cost ? '' : 'disabled'}><i class="jewel"></i>${o.cost}</button>
        </div>`).join('')}
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
      <div class="track-card ${p >= 1 ? 'ready' : ''}">
        <div class="track-text">${p >= 1 ? '✔ ' : ''}${t.text}</div>
        <div class="bar thin"><div class="bar-fill" style="transform:scaleX(${p.toFixed(2)})"></div></div>
      </div>`).join(''));
  }
}
