import { haptic, sfx } from '../audio/sfx';
import { fmt } from '../core/format';
import { MAX_LEVEL, MILESTONES, levelBonus, levelTier, type MilestoneReward } from '../sim/level';
import { describeReward } from '../sim/missions';
import type { Sim } from '../sim/sim';
import { RARITY_COLORS, RARITY_NAMES } from '../sim/weapons';
import { chips } from './missions';
import { rewardSpill } from './rewardFx';
import { actionElement, bindSheetTaps } from './tap';

/**
 * Hero level panel + Level Road: the current level, XP, permanent bonuses, and a reward
 * every 5 levels. Rewards are sized to the furthest zone reached when claimed.
 */
export class LevelRoad {
  private wrap: HTMLElement | null = null;
  private sig = '';

  constructor(private readonly sim: Sim, private readonly toast: (m: string, kind?: 'good' | 'bad' | 'boss') => void) {}

  get isOpen(): boolean { return this.wrap !== null; }

  open(): void {
    if (this.wrap && !this.wrap.isConnected) this.close();
    if (this.wrap) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal sheet-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <div class="sheet level-sheet">
        <div class="ribbon"><span class="ribbon-text">Hero Level</span></div>
        <button type="button" class="sheet-x" aria-label="Close">✕</button>
        <div class="lv-head"></div>
        <div class="sheet-body lv-road"></div>
      </div>`;
    bindSheetTaps(wrap, (act) => this.run(act));
    document.addEventListener('keydown', this.onKey);
    document.body.appendChild(wrap);
    this.wrap = wrap;
    this.sig = '';
    this.refresh();
    // Start at the first milestone that still needs attention.
    const s = this.sim.save;
    const next = MILESTONES.find((m) => !s.levelClaimed.includes(m)) ?? MAX_LEVEL;
    wrap.querySelector(`[data-lv="${next}"]`)?.scrollIntoView({ block: 'center' });
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
    const [act, a] = action.split(':');
    if (act !== 'lvclaim') return;
    const r = this.sim.claimLevelReward(Number(a));
    if (r === 'full') { sfx.play('tick'); this.toast('Inventory full: free a slot in the Forge', 'bad'); return; }
    if (!r) return;
    sfx.play('achieve');
    haptic(25);
    rewardSpill(r, el);
    const parts = [describeReward(r)];
    if (r.weapon) parts.push(`${RARITY_NAMES[r.weapon.rarity]} weapon`);
    this.toast(`+ ${parts.filter(Boolean).join(' · ')}`);
    this.sig = '';
    this.refresh();
  }

  /** Re-render if anything shown changed. Called by the HUD ~10×/s. */
  refresh(): void {
    if (!this.wrap) return;
    const s = this.sim.save;
    const sig = JSON.stringify([s.level, Math.floor(s.xp), s.levelClaimed.length, s.bestEver, s.weapons.indexOf(null) < 0]);
    if (sig === this.sig) return;
    this.sig = sig;

    const tier = levelTier(s.level);
    const need = this.sim.xpNeeded;
    const max = s.level >= MAX_LEVEL;
    const b = levelBonus(s.level);
    const pctOf = (m: number) => Math.round((m - 1) * 100);
    this.wrap.querySelector('.lv-head')!.innerHTML = `
      <div class="lv-badge" style="--tier:${tier.css}"><small>Lv</small>${s.level}</div>
      <div class="lv-info">
        <div class="lv-tier" style="color:${tier.css}">${tier.name} Hero</div>
        <div class="bar lv-xp"><div class="bar-fill" style="transform:scaleX(${max ? 1 : Math.min(1, s.xp / need)})"></div>
          <span>${max ? 'MAX LEVEL' : `${fmt(s.xp)} / ${fmt(need)} XP`}</span></div>
        <div class="lv-bonus">+${pctOf(b.atk)}% damage &amp; HP · +${pctOf(b.gold)}% gold</div>
      </div>`;

    const full = s.weapons.indexOf(null) < 0;
    this.wrap.querySelector('.lv-road')!.innerHTML = `
      <p class="sheet-note">Kill monsters to earn XP. Every 5 levels unlocks a reward, and new levels open new zones on the 🗺 Map. Rewards grow as you explore.</p>
      ${MILESTONES.map((m) => this.row(m, this.sim.levelReward(m), full)).join('')}`;
  }

  private row(m: number, r: MilestoneReward, invFull: boolean): string {
    const s = this.sim.save;
    const claimed = s.levelClaimed.includes(m), reached = s.level >= m;
    const weapon = r.weapon
      ? `<span class="rchip wchip" style="--rc:${RARITY_COLORS[r.weapon.rarity]}"><i>⚔</i>${RARITY_NAMES[r.weapon.rarity]} weapon</span>` : '';
    const big = m % 25 === 0;
    const btn = claimed ? '<div class="task-done">✔</div>'
      : reached ? `<button type="button" class="btn small green" data-act="lvclaim:${m}" ${r.weapon && invFull ? 'title="Inventory full"' : ''}>Claim</button>`
      : `<div class="lv-lock">🔒</div>`;
    return `
      <div class="lv-row ${claimed ? 'claimed' : ''} ${reached && !claimed ? 'ready' : ''} ${big ? 'big' : ''}" data-lv="${m}">
        <div class="lv-medal" style="--tier:${levelTier(m).css}">${m}</div>
        <div class="lv-rewards">${chips(r)}${weapon}</div>
        ${btn}
      </div>`;
  }
}
