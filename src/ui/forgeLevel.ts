import { areaName } from '../sim/areas';
import { zoneName } from '../sim/zones';
import { haptic, sfx } from '../audio/sfx';
import { fmt } from '../core/format';
import type { Sim } from '../sim/sim';
import { FORGE_ATK_PER_LEVEL, MAX_FORGE_LEVEL, forgeCost, forgeLevelCap, forgeOdds, forgeTiers, forgeUpgradeCost } from '../sim/weapons';

/**
 * The forge's own window: what the forge does at this level, what the next level adds, and the
 * gold upgrade. Kept apart from the weapon card so "upgrade the forge" and "upgrade a weapon"
 * are never confused.
 */
export class ForgeLevelUI {
  private wrap: HTMLElement | null = null;
  private sig = '';

  constructor(private readonly sim: Sim, private readonly toast: (m: string) => void, private readonly onUpgrade: () => void) {}

  get isOpen(): boolean { return this.wrap !== null; }

  open(): void {
    if (this.wrap?.isConnected) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Forge level');
    wrap.innerHTML = `
      <div class="modal-card forge-level-card">
        <h2>🔨 Forge</h2>
        <div class="flc-body"></div>
        <div class="set-actions">
          <button type="button" class="btn ghost" data-close>Close</button>
          <button type="button" class="btn primary" id="flc-upgrade"></button>
        </div>
      </div>`;
    wrap.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === wrap || t.closest('[data-close]')) this.close();
      else if (t.closest('#flc-upgrade')) this.upgrade();
    });
    document.addEventListener('keydown', this.onKey);
    document.body.appendChild(wrap);
    this.wrap = wrap;
    this.sig = '';
    this.refresh();
  }

  close(): void {
    this.wrap?.remove();
    this.wrap = null;
    document.removeEventListener('keydown', this.onKey);
  }

  private readonly onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); };

  private upgrade(): void {
    if (!this.sim.upgradeForge()) return;
    const lv = this.sim.save.forgeLevel;
    sfx.play('forge');
    haptic(20);
    this.toast(`Forge level ${lv}!`);
    this.wrap?.querySelector('.forge-level-card')?.classList.remove('leveled');
    void (this.wrap?.querySelector('.forge-level-card') as HTMLElement | null)?.offsetWidth;
    this.wrap?.querySelector('.forge-level-card')?.classList.add('leveled');
    this.onUpgrade();
    this.sig = '';
    this.refresh();
  }

  /** Re-render when the level or affordability changes. Called by the HUD ~10×/s. */
  refresh(): void {
    if (!this.wrap) return;
    const s = this.sim.save;
    const lv = s.forgeLevel, maxed = lv >= MAX_FORGE_LEVEL;
    const locked = !maxed && lv >= forgeLevelCap(this.sim.maxZone);
    const cost = forgeUpgradeCost(lv);
    const sig = `${lv}|${locked}|${s.gold >= cost}|${maxed ? '' : fmt(Math.max(0, cost - s.gold))}`;
    if (sig === this.sig) return;
    this.sig = sig;

    const row = (label: string, now: string, next: string) =>
      `<div class="flc-row"><span>${label}</span><b>${now}</b>${maxed ? '' : `<i>→</i><b class="next">${next}</b>`}</div>`;
    const tiers = (l: number) => { const [lo, hi] = forgeTiers(l); return lo === hi ? `T${hi}` : `T${lo}–${hi}`; };
    const odds = (l: number, i: number) => pct(forgeOdds(l)[i]);
    const bonus = (l: number) => `+${Math.round(FORGE_ATK_PER_LEVEL * 100 * (l - 1))}%`;
    this.wrap.querySelector('.flc-body')!.innerHTML = `
      <div class="flc-level"><small>Level</small>${lv}<small>${maxed ? 'MAX' : `/ ${MAX_FORGE_LEVEL}`}</small></div>
      <p>Higher forge levels forge stronger weapons and make every weapon you wield hit harder.</p>
      <div class="flc-table">
        ${row('New weapons', tiers(lv), tiers(lv + 1))}
        ${row('Rare chance', odds(lv, 0), odds(lv + 1, 0))}
        ${row('Epic chance', odds(lv, 1), odds(lv + 1, 1))}
        ${row('Legendary chance', odds(lv, 2), odds(lv + 1, 2))}
        ${row('Weapon attack', bonus(lv), bonus(lv + 1))}
        ${row('Shards per forge', String(forgeCost(lv)), String(forgeCost(lv + 1)))}
      </div>`;
    const btn = this.wrap.querySelector<HTMLButtonElement>('#flc-upgrade')!;
    btn.disabled = maxed || locked || s.gold < cost;
    btn.innerHTML = maxed ? 'Max level' : locked ? `🔒 ${areaName(lv)}` : `Upgrade <span class="coin-dot"></span>${fmt(cost)}`;
    const p = this.wrap.querySelector<HTMLElement>('.flc-body p')!;
    if (locked) p.textContent = `The forge grows with your journey: unlock ${zoneName(lv * 3)} in ${areaName(lv)} this run to reach level ${lv + 1}.`;
    else if (!maxed && s.gold < cost) p.textContent = `Need ${fmt(cost - s.gold)} more gold to reach level ${lv + 1}.`;
  }
}

function pct(v: number): string {
  return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
}
