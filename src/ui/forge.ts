import { fmt } from '../core/format';
import { haptic, sfx } from '../audio/sfx';
import type { Sim } from '../sim/sim';
import {
  FORGE_COST, FORMS, MAX_FORGE_LEVEL, MAX_TIER, MERGE_COUNT, RARITY_COLORS, RARITY_NAMES, TRAITS, forgeOdds, forgeTiers,
  forgeUpgradeCost, mergePartners, salvageValue, weaponName, weaponPower, weaponSummary, type Weapon,
} from '../sim/weapons';

/**
 * Forge tab: the equipped/selected weapon card, forge + auto-merge actions, forge level, and
 * the inventory grid. Tap a weapon to select it (Equip / Salvage appear, plus how your attack
 * would change). Three weapons of the same type, tier and rarity can be merged (Merge button)
 * into one of the next tier; matching weapons glow when one of them is selected. The grid only re-renders when the inventory actually changes.
 */
export class ForgePanel {
  private selected = -1;
  private renderedVersion = -1;
  private renderedSelected = -2;
  private renderedAtk = -1;
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
          <div class="wc-atk"></div>
          <div class="wc-summary"></div>
          <ul class="wc-traits"></ul>
          <div class="wc-hint"></div>
        </div>
        <div class="wc-actions">
          <button type="button" class="btn small primary" id="equip-btn">Equip</button>
          <button type="button" class="btn small merge-btn" id="merge-btn">Merge</button>
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
      summary: $('.wc-summary'), atk: $('.wc-atk'), traits: $('.wc-traits'), hint: $('.wc-hint'),
      equip: $('#equip-btn'), salvage: $('#salvage-btn'), merge: $('#merge-btn'),
      forge1: $('#forge-1'), forge10: $('#forge-10'), autoMerge: $('#auto-merge'),
      level: $('#fl-level'), odds: $('#fl-odds'), up: $('#forge-up'), upCost: $('#fl-cost'),
      grid: $('#inv-grid'),
    };

    for (let i = 0; i < sim.save.weapons.length; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      b.innerHTML = '<img alt="" /><span class="tier"></span><span class="better">▲</span><span class="rar"></span>';
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
    this.el.merge.addEventListener('click', () => {
      const i = this.selected;
      if (i < 0) return;
      const before = sim.save.weapons[i];
      if (!before || !sim.merge(i)) return;
      const result = sim.save.weapons[i]!;
      this.flash([i], 'pop');
      sfx.play('merge');
      haptic(20);
      this.toast(result.rarity > before.rarity ? `${RARITY_NAMES[result.rarity]}! ${weaponName(result)} T${result.tier}` : `Merged into ${weaponName(result)} T${result.tier}`);
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

  /** Tap a slot: select it (or deselect). Merging is done with the Merge button. */
  private tap(i: number): void {
    const w = this.sim.save.weapons[i];
    this.selected = !w || this.selected === i ? -1 : i;
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
    // Also redraw when attack changes (upgrades, level-ups) so the preview stays accurate.
    if (sim.invVersion !== this.renderedVersion || this.selected !== this.renderedSelected || Math.round(sim.atk) !== this.renderedAtk) this.render();
  }

  private render(): void {
    const s = this.sim.save;
    const sel = this.selected >= 0 ? s.weapons[this.selected] : null;
    const eqPower = s.equipped ? weaponPower(s.equipped) : 0;
    const partners = sel ? mergePartners(s.weapons, this.selected) : [];

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
      // Rarity letter (C/R/E/L): merges need matching rarity, so make it readable at a glance.
      (b.children[3] as HTMLElement).textContent = RARITY_NAMES[w.rarity][0];
      if (weaponPower(w) > eqPower * 1.001) b.classList.add('is-better');
      if (i === this.selected) b.classList.add('selected');
      else if (partners.includes(i)) b.classList.add('mergeable');
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
      this.el.name.textContent = `${RARITY_NAMES[w.rarity]} ${weaponName(w)}`;
      this.el.summary.textContent = weaponSummary(w);
      this.el.traits.replaceChildren(...w.traits.map((t) => {
        const li = document.createElement('li');
        li.textContent = TRAITS[t.t].show(t.v);
        return li;
      }));
      const now = this.sim.atk;
      if (sel) {
        // Attack if equipped, vs. the current attack.
        const next = this.sim.attackWith(sel);
        const diff = next - now;
        const pctDiff = now > 0 ? (diff / now) * 100 : 0;
        const dir = Math.abs(pctDiff) < 0.5 ? 'same' : diff > 0 ? 'up' : 'down';
        this.el.atk.className = `wc-atk ${dir}`;
        this.el.atk.innerHTML = `<span class="wc-atk-lbl">⚔ Attack</span> ${fmt(now)} → <b>${fmt(next)}</b> ` +
          (dir === 'same' ? '<em>no change</em>'
            : `<em>${dir === 'up' ? '▲ +' : '▼ −'}${fmt(Math.abs(diff))} (${dir === 'up' ? '+' : '−'}${Math.abs(pctDiff).toFixed(0)}%)</em>`);
        // Merge needs MERGE_COUNT of the same type, tier and rarity (this one included).
        const have = partners.length + 1;
        const ready = have >= MERGE_COUNT && sel.tier < MAX_TIER;
        const kind = `${RARITY_NAMES[sel.rarity]} T${sel.tier} ${FORMS[sel.form].name}s`;
        this.el.merge.textContent = `Merge ${Math.min(have, MERGE_COUNT)}/${MERGE_COUNT}`;
        this.disable(this.el.merge, !ready);
        const delta = eqPower > 0 ? weaponPower(sel) / eqPower : 1;
        const overall = delta >= 1.005 ? `overall ▲ ${((delta - 1) * 100).toFixed(0)}%` : delta <= 0.995 ? `overall ▼ ${((1 - delta) * 100).toFixed(0)}%` : 'overall about the same';
        // Same type and tier but another rarity don't count: say so, it's the easy thing to miss.
        const otherRarity = new Map<number, number>();
        for (const o of s.weapons) {
          if (o && o.form === sel.form && o.tier === sel.tier && o.rarity !== sel.rarity) otherRarity.set(o.rarity, (otherRarity.get(o.rarity) ?? 0) + 1);
        }
        const others = [...otherRarity].map(([r, n]) => `${n} ${RARITY_NAMES[r]}`).join(', ');
        const rarityNote = !ready && others ? ` Your ${others} T${sel.tier} ${FORMS[sel.form].name} don't count: rarity must match.` : '';
        this.el.hint.textContent = (sel.tier >= MAX_TIER ? 'Max tier · '
          : ready ? `Merge 3 ${kind} → T${sel.tier + 1} · `
          : `Merge needs 3 ${kind} (have ${have}).${rarityNote} · `) + `${overall} incl. speed & traits`;
        this.el.salvage.textContent = `Salvage +${salvageValue(sel)}`;
      } else {
        this.el.atk.className = 'wc-atk';
        this.el.atk.innerHTML = `<span class="wc-atk-lbl">⚔ Attack</span> <b>${fmt(now)}</b>`;
        this.el.hint.textContent = `${FORMS[w.form].name}: ${FORMS[w.form].blurb.toLowerCase()} · tap a weapon below to compare`;
      }
    }
    this.renderedVersion = this.sim.invVersion;
    this.renderedSelected = this.selected;
    this.renderedAtk = Math.round(this.sim.atk);
  }

  /** Something worth doing in the forge (for the tab badge). */
  badge(): string {
    const s = this.sim.save;
    const forges = Math.min(Math.floor(s.shards / FORGE_COST), this.sim.freeSlots());
    if (forges > 0) return String(forges);
    return hasPair(s.weapons) ? '!' : '';
  }
}

/** Any MERGE_COUNT weapons of the same type, tier and rarity (i.e. something to merge)? */
function hasPair(inv: (Weapon | null)[]): boolean {
  const count = new Map<number, number>();
  for (const w of inv) {
    if (!w || w.tier >= MAX_TIER) continue;
    const key = (w.tier * 4 + w.rarity) * 16 + w.form;
    const n = (count.get(key) ?? 0) + 1;
    if (n >= MERGE_COUNT) return true;
    count.set(key, n);
  }
  return false;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
}
