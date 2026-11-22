import { haptic, sfx } from '../audio/sfx';
import { fmt } from '../core/format';
import type { Sim } from '../sim/sim';
import { INVENTORY_STEP, MAX_INVENTORY, inventoryExpandCost } from '../sim/weapons';

/** The inventory's own window: slots used, and buying another row of slots with gold. */
export class InventoryUI {
  private wrap: HTMLElement | null = null;
  private sig = '';

  constructor(private readonly sim: Sim, private readonly toast: (m: string) => void, private readonly onExpand: () => void) {}

  open(): void {
    if (this.wrap?.isConnected) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Weapon slots');
    wrap.innerHTML = `
      <div class="modal-card forge-level-card inv-card">
        <h2>⚔ Weapon Slots</h2>
        <div class="flc-body"></div>
        <div class="set-actions">
          <button type="button" class="btn ghost" data-close>Close</button>
          <button type="button" class="btn primary" id="inv-expand"></button>
        </div>
      </div>`;
    wrap.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === wrap || t.closest('[data-close]')) this.close();
      else if (t.closest('#inv-expand')) this.expand();
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

  private expand(): void {
    if (!this.sim.expandInventory()) return;
    sfx.play('forge');
    haptic(20);
    this.toast(`Weapon slots: ${this.sim.save.weapons.length}`);
    const card = this.wrap?.querySelector<HTMLElement>('.inv-card');
    if (card) { card.classList.remove('leveled'); void card.offsetWidth; card.classList.add('leveled'); }
    this.onExpand();
    this.sig = '';
    this.refresh();
  }

  /** Re-render when size, usage or affordability changes. Called by the forge panel ~10×/s. */
  refresh(): void {
    if (!this.wrap) return;
    const s = this.sim.save;
    const size = s.weapons.length, used = s.weapons.filter(Boolean).length;
    const maxed = size >= MAX_INVENTORY;
    const cost = inventoryExpandCost(size);
    const sig = `${size}|${used}|${s.gold >= cost}|${maxed ? '' : fmt(Math.max(0, cost - s.gold))}`;
    if (sig === this.sig) return;
    this.sig = sig;

    const next = Math.min(MAX_INVENTORY, size + INVENTORY_STEP);
    const note = maxed ? 'Your inventory is as big as it gets.'
      : s.gold < cost ? `Need ${fmt(cost - s.gold)} more gold for the next row.`
      : `Add a row of ${next - size} slots. Extra slots are permanent and kept when you Reforge.`;
    this.wrap.querySelector('.flc-body')!.innerHTML = `
      <div class="flc-level">${used}<small>/ ${size} used</small></div>
      <p>${note}</p>
      <div class="flc-table">
        <div class="flc-row"><span>Slots</span><b>${size}</b>${maxed ? '' : `<i>→</i><b class="next">${next}</b>`}</div>
        <div class="flc-row"><span>Free slots</span><b>${size - used}</b>${maxed ? '' : `<i>→</i><b class="next">${next - used}</b>`}</div>
        <div class="flc-row"><span>Maximum</span><b>${MAX_INVENTORY}</b></div>
      </div>`;
    const btn = this.wrap.querySelector<HTMLButtonElement>('#inv-expand')!;
    btn.disabled = maxed || s.gold < cost;
    btn.innerHTML = maxed ? 'Max size' : `+${next - size} slots <span class="coin-dot"></span>${fmt(cost)}`;
  }
}
