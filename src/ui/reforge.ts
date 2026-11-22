import { fmt } from '../core/format';
import { sfx } from '../audio/sfx';
import { GLOW_DMG, GLOW_HP, PERKS, PERK_IDS, REFORGE_MIN_STAGE, embersFor, type PerkId } from '../sim/meta';
import type { Sim } from '../sim/sim';
import { confirmDialog } from './dialog';

/** Reforge tab: ember balance, prestige button with a confirm step, and the ember perk shop. */
export class ReforgePanel {
  private readonly cache = new Map<HTMLElement, string>();
  private readonly el: Record<string, HTMLElement>;
  private readonly rows: { id: PerkId; lvl: HTMLElement; eff: HTMLElement; btn: HTMLButtonElement; cost: HTMLElement }[] = [];

  constructor(root: HTMLElement, private readonly sim: Sim, private readonly toast: (m: string) => void) {
    root.innerHTML = `
      <div class="reforge-card">
        <div class="rf-embers"><span class="ember" aria-hidden="true"></span><b id="rf-balance"></b><span>embers</span></div>
        <div class="rf-glow" id="rf-glow"></div>
        <p class="rf-text" id="rf-text"></p>
        <button type="button" class="btn danger" id="rf-btn">Reforge</button>
        <p class="rf-keep">Reforging resets stage, gold, shards, upgrades, weapons and forge level. You keep embers, perks, achievements and lifetime stats.</p>
      </div>
      <h3 class="section-title">Ember perks</h3>
      <ul class="perk-list"></ul>`;
    const $ = (sel: string) => root.querySelector<HTMLElement>(sel)!;
    this.el = { balance: $('#rf-balance'), glow: $('#rf-glow'), text: $('#rf-text'), btn: $('#rf-btn') };
    this.el.btn.addEventListener('click', () => this.doReforge());

    const list = $('.perk-list');
    for (const id of PERK_IDS) {
      const def = PERKS[id];
      const li = document.createElement('li');
      li.className = 'upgrade';
      li.innerHTML = `
        <span class="icon" style="--c:${def.color}">${def.icon}</span>
        <span class="info"><span class="name">${def.name} <span class="lvl"></span></span><span class="value"></span></span>
        <button class="buy ember-buy" type="button"><span class="count">+1</span><span class="cost"></span></button>`;
      const btn = li.querySelector<HTMLButtonElement>('.buy')!;
      btn.addEventListener('click', () => { if (sim.buyPerk(id)) this.refresh(); });
      list.appendChild(li);
      this.rows.push({ id, lvl: li.querySelector('.lvl')!, eff: li.querySelector('.value')!, btn, cost: li.querySelector('.cost')! });
    }
  }

  private async doReforge(): Promise<void> {
    const gain = this.sim.reforgeGain;
    if (gain <= 0) return;
    const ok = await confirmDialog({
      title: 'Reforge?',
      body: `<p>Start a new run from stage ${Math.max(1, Math.min(1 + this.sim.save.perks.headstart * 5, this.sim.save.bestEver))} and gain <b>${fmt(gain)} embers</b>.</p>
             <p class="modal-note">Stage, gold, shards, upgrades, weapons and forge level reset. Embers, perks and achievements stay.</p>`,
      confirm: `Reforge (+${fmt(gain)})`,
      danger: true,
    });
    if (!ok) return;
    const got = this.sim.reforge();
    if (got) { this.toast(`Reforged! +${fmt(got)} embers`); sfx.play('area'); }
    this.refresh();
  }

  private set(el: HTMLElement, text: string): void {
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text);
    el.textContent = text;
  }

  refresh(): void {
    const s = this.sim.save;
    const gain = this.sim.reforgeGain;
    this.set(this.el.balance, fmt(s.embers));
    this.set(this.el.glow, s.embersEarned > 0
      ? `Ember Glow: +${fmt(s.embersEarned * GLOW_DMG * 100)}% damage, +${fmt(s.embersEarned * GLOW_HP * 100)}% HP (from ${fmt(s.embersEarned)} embers earned)`
      : `Every ember you earn adds +${GLOW_DMG * 100}% damage and +${GLOW_HP * 100}% HP forever, even after spending it.`);
    const best = s.highestStage;
    if (gain > 0) {
      const next = embersFor(best + 1) - gain;
      this.set(this.el.text, `Best stage this run: ${best}. Reforge now for +${fmt(gain)} embers (next stage adds about ${fmt(Math.max(1, next))} more).`);
    } else {
      this.set(this.el.text, `Reach stage ${REFORGE_MIN_STAGE} to unlock Reforge (best this run: ${best}).`);
    }
    const btn = this.el.btn as HTMLButtonElement;
    if (btn.disabled === gain > 0) btn.disabled = gain <= 0;
    this.set(this.el.btn, gain > 0 ? `Reforge  +${fmt(gain)}` : 'Reforge (locked)');

    for (const r of this.rows) {
      const def = PERKS[r.id];
      const lvl = s.perks[r.id];
      const maxed = lvl >= def.maxLevel;
      const cost = this.sim.perkQuote(r.id);
      this.set(r.lvl, `Lv ${lvl}`);
      this.set(r.eff, maxed ? `${def.effect(lvl)} (max)` : `${lvl ? def.effect(lvl) : 'Not learned'} → ${def.effect(lvl + 1)}`);
      this.set(r.cost, maxed ? 'MAX' : fmt(cost));
      const can = !maxed && cost <= s.embers;
      if (r.btn.disabled === can) r.btn.disabled = !can;
    }
  }

  badge(): string {
    const s = this.sim.save;
    const affordable = PERK_IDS.some((id) => this.sim.perkQuote(id) <= s.embers);
    return affordable ? '!' : '';
  }
}
