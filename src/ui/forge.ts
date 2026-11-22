import { fmt } from '../core/format';
import { haptic, sfx } from '../audio/sfx';
import type { Sim } from '../sim/sim';
import {
  FORGE_COST, FORMS, MAX_FORGE_LEVEL, RARITY_COLORS, RARITY_NAMES, TRAITS, canMerge, forgeOdds, forgeTiers,
  forgeUpgradeCost, salvageValue, weaponName, weaponPower, weaponSummary, type Weapon,
} from '../sim/weapons';

/**
 * Forge tab: the equipped/selected weapon card, forge + auto-merge actions, forge level, and
 * the inventory grid. Tap a weapon to select it (Equip / Salvage appear); tap another weapon of
 * the same tier to merge them. The grid only re-renders when the inventory actually changes.
 */
export class ForgePanel {
  private selected = -1;
  private renderedVersion = -1;
  private renderedSelected = -2;
  private readonly slots: HTMLButtonElement[] = [];
  private readonly cache = new Map<HTMLElement, string>();
  private readonly el: Record<string, HTMLElement>;
  private highlight = new Set<number>();
  private highlightKind: 'new' | 'pop' = 'new';

  constructor(root: HTMLElement, private readonly sim: Sim, private readonly icons: string[][], private readonly toast: (msg: string) => void) {
    root.innerHTML = `
      <div class="weapon-card" id="weapon-card">
        <div class="wc-icon"><img alt="" /></div>
        <div class="wc-body">
          <div class="wc-title"><span class="wc-tag"></span><span class="wc-name"></span></div>
          <div class="wc-summary"></div>
          <ul class="wc-traits"></ul>
          <div class="wc-hint"></div>
        </div>
        <div class="wc-actions">
          <button type="button" class="btn small primary" id="equip-btn">Equip</button>
          <button type="button" class="btn small ghost" id="salvage-btn">Salvage</button>
        </div>
      </div>
      <div class="forge-actions">
        <button type="button" class="btn primary" id="forge-1">Forge <span class="cost"><i class="gem"></i>${FORGE_COST}</span></button>
        <button type="button" class="btn" id="forge-10">x10</button>
        <button type="button" class="btn" id="auto-merge">Auto-merge</button>
      </div>
      <div class="forge-level">
        <div class="fl-text"><b id="fl-level"></b><span id="fl-odds"></span></div>
        <button type="button" class="btn small" id="forge-up">Upgrade <span class="coin-dot"></span><span id="fl-cost"></span></button>
      </div>
      <div class="inv-grid" id="inv-grid" role="grid" aria-label="Weapon inventory"></div>`;

    const $ = (sel: string) => root.querySelector<HTMLElement>(sel)!;
    this.el = {
      card: $('#weapon-card'), icon: $('.wc-icon img'), tag: $('.wc-tag'), name: $('.wc-name'),
      summary: $('.wc-summary'), traits: $('.wc-traits'), hint: $('.wc-hint'),
      equip: $('#equip-btn'), salvage: $('#salvage-btn'),
      forge1: $('#forge-1'), forge10: $('#forge-10'), autoMerge: $('#auto-merge'),
      level: $('#fl-level'), odds: $('#fl-odds'), up: $('#forge-up'), upCost: $('#fl-cost'),
      grid: $('#inv-grid'),
    };

    for (let i = 0; i < sim.save.weapons.length; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      b.innerHTML = '<img alt="" /><span class="tier"></span><span class="better">▲</span>';
      b.addEventListener('click', () => { this.tap(i); this.refresh(); });
      this.el.grid.appendChild(b);
      this.slots.push(b);
    }

    // Every action redraws immediately rather than waiting for the next HUD tick.
    root.addEventListener('click', () => queueMicrotask(() => this.refresh()));
    this.el.forge1.addEventListener('click', () => this.doForge(1));
    this.el.forge10.addEventListener('click', () => this.doForge(10));
    this.el.autoMerge.addEventListener('click', () => {
      const merged = sim.autoMerge();
      if (merged.length) { this.flash(merged, 'pop'); this.selected = -1; sfx.play('merge'); haptic(20); }
      else this.toast('Nothing to merge');
    });
    this.el.up.addEventListener('click', () => {
      if (sim.upgradeForge()) this.toast(`Forge level ${sim.save.forgeLevel}`);
    });
    this.el.equip.addEventListener('click', () => {
      if (this.selected >= 0 && sim.equip(this.selected)) {
        this.flash([this.selected], 'pop');
        this.selected = -1;
      }
    });
    this.el.salvage.addEventListener('click', () => {
      if (this.selected < 0) return;
      const got = sim.salvage(this.selected);
      if (got) this.toast(`+${got} shards`);
      this.selected = -1;
    });
  }

  private doForge(n: number): void {
    const filled = this.sim.forge(n);
    if (filled.length) { this.flash(filled, 'new'); this.selected = -1; sfx.play('forge'); }
    else if (this.sim.freeSlots() === 0) this.toast('Inventory full: merge or salvage');
    else this.toast(`Need ${FORGE_COST} shards`);
  }

  private flash(slots: number[], kind: 'new' | 'pop'): void {
    this.highlight = new Set(slots);
    this.highlightKind = kind;
    this.renderedVersion = -1;
  }

  private tap(i: number): void {
    const inv = this.sim.save.weapons;
    const w = inv[i];
    if (!w) { this.selected = -1; return; }
    if (this.selected === i) { this.selected = -1; return; }
    const sel = this.selected >= 0 ? inv[this.selected] : null;
    if (sel && canMerge(sel, w)) {
      // Merge the selected weapon into the tapped one.
      if (this.sim.merge(this.selected, i)) {
        const result = inv[i]!;
        this.flash([i], 'pop');
        sfx.play('merge');
        haptic(20);
        this.selected = i;
        if (result.rarity > Math.max(sel.rarity, w.rarity)) this.toast(`${RARITY_NAMES[result.rarity]}!`);
      }
      return;
    }
    this.selected = i;
  }

  private set(el: HTMLElement, text: string): void {
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text);
    el.textContent = text;
  }

  private disable(el: HTMLElement, off: boolean): void {
    const b = el as HTMLButtonElement;
    if (b.disabled !== off) b.disabled = off;
  }

  /** Called by the HUD ~10×/s while the Forge tab is visible. */
  refresh(): void {
    const sim = this.sim, s = sim.save;
    const free = sim.freeSlots();
    this.disable(this.el.forge1, s.shards < FORGE_COST || free === 0);
    this.disable(this.el.forge10, s.shards < FORGE_COST * 2 || free < 2);
    this.disable(this.el.autoMerge, !hasPair(s.weapons));

    const maxed = s.forgeLevel >= MAX_FORGE_LEVEL;
    const [lo, hi] = forgeTiers(s.forgeLevel);
    const [pr, pe, pl] = forgeOdds(s.forgeLevel);
    this.set(this.el.level, `Forge Lv ${s.forgeLevel}`);
    this.set(this.el.odds, ` · T${lo === hi ? hi : `${lo}–${hi}`} · Rare ${pct(pr)} · Epic ${pct(pe)} · Leg ${pct(pl)}`);
    const upCost = forgeUpgradeCost(s.forgeLevel);
    this.set(this.el.upCost, maxed ? 'MAX' : fmt(upCost));
    this.disable(this.el.up, maxed || s.gold < upCost);

    if (this.selected >= 0 && !s.weapons[this.selected]) this.selected = -1;
    if (sim.invVersion !== this.renderedVersion || this.selected !== this.renderedSelected) this.render();
  }

  private render(): void {
    const s = this.sim.save;
    const sel = this.selected >= 0 ? s.weapons[this.selected] : null;
    const eqPower = s.equipped ? weaponPower(s.equipped) : 0;

    s.weapons.forEach((w, i) => {
      const b = this.slots[i];
      const img = b.firstElementChild as HTMLImageElement;
      b.className = 'slot';
      if (!w) {
        b.classList.add('empty');
        img.removeAttribute('src');
        b.setAttribute('aria-label', 'Empty slot');
        return;
      }
      const src = this.icons[w.form][w.rarity];
      if (img.getAttribute('src') !== src) img.src = src;
      b.style.setProperty('--rc', RARITY_COLORS[w.rarity]);
      (b.children[1] as HTMLElement).textContent = `T${w.tier}`;
      if (weaponPower(w) > eqPower * 1.001) b.classList.add('is-better');
      if (i === this.selected) b.classList.add('selected');
      else if (sel && canMerge(sel, w)) b.classList.add('mergeable');
      if (this.highlight.has(i)) b.classList.add(this.highlightKind);
      b.setAttribute('aria-label', `${RARITY_NAMES[w.rarity]} ${weaponName(w)}, tier ${w.tier}`);
    });
    this.highlight.clear();

    // Card: the selected weapon (with actions) or the equipped one.
    const w = sel ?? s.equipped;
    const card = this.el.card;
    card.classList.toggle('selecting', !!sel);
    if (w) {
      const img = this.el.icon as HTMLImageElement;
      img.src = this.icons[w.form][w.rarity];
      card.style.setProperty('--rc', RARITY_COLORS[w.rarity]);
      this.el.tag.textContent = sel ? `${RARITY_NAMES[w.rarity]} · T${w.tier}` : `Equipped · ${RARITY_NAMES[w.rarity]} · T${w.tier}`;
      this.el.name.textContent = weaponName(w);
      this.el.summary.textContent = weaponSummary(w);
      this.el.traits.replaceChildren(...w.traits.map((t) => {
        const li = document.createElement('li');
        li.textContent = TRAITS[t.t].show(t.v);
        return li;
      }));
      if (sel) {
        const others = s.weapons.some((o, j) => o && j !== this.selected && canMerge(sel, o));
        const delta = eqPower > 0 ? weaponPower(sel) / eqPower : 1;
        this.el.hint.textContent = (others ? `Tap another T${sel.tier} to merge · ` : '') +
          (delta >= 1.001 ? `▲ ${((delta - 1) * 100).toFixed(0)}% stronger than equipped` : delta <= 0.999 ? `▼ ${((1 - delta) * 100).toFixed(0)}% weaker than equipped` : 'Same as equipped');
        this.el.salvage.textContent = `Salvage +${salvageValue(sel)}`;
      } else {
        this.el.hint.textContent = `${FORMS[w.form].name}: ${FORMS[w.form].blurb.toLowerCase()} · tap a weapon below to inspect`;
      }
    }
    this.renderedVersion = this.sim.invVersion;
    this.renderedSelected = this.selected;
  }

  /** Something worth doing in the forge (for the tab badge). */
  badge(): string {
    const s = this.sim.save;
    const forges = Math.min(Math.floor(s.shards / FORGE_COST), this.sim.freeSlots());
    if (forges > 0) return String(forges);
    return hasPair(s.weapons) ? '!' : '';
  }
}

function hasPair(inv: (Weapon | null)[]): boolean {
  const seen = new Set<number>();
  for (const w of inv) {
    if (!w) continue;
    if (seen.has(w.tier)) return true;
    seen.add(w.tier);
  }
  return false;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
}
