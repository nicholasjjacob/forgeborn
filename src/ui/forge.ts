import { gi } from './icons';
import { fmt } from '../core/format';
import { haptic, sfx } from '../audio/sfx';
import type { Sim } from '../sim/sim';
import { ForgeLevelUI } from './forgeLevel';
import { InventoryUI } from './inventoryUI';
import { Pager } from './pager';
import { skinDef, wieldersOf } from '../sim/skins';
import {
  forgeCost, forgeLevelCap, FORMS, MAX_FORGE_LEVEL, MAX_RARITY, mergeCount, RARITY_COLORS, RARITY_NAMES, TRAITS, forgeOdds,
  forgeUpgradeCost, inventoryExpandCost, MAX_INVENTORY, matchingSlots, mergePartners, mergePreview, salvageValue, weaponName, weaponPower, weaponSummary, type Weapon,
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
  /** Attack count-up after an equip or merge: from → to over ATK_ANIM ms. */
  private atkAnim: { from: number; to: number; start: number } | null = null;
  private readonly levelUI: ForgeLevelUI;
  private readonly invUI: InventoryUI;
  private readonly slots: HTMLButtonElement[] = [];
  private readonly cache = new Map<HTMLElement, string>();
  private readonly el: Record<string, HTMLElement>;
  private highlight = new Set<number>();
  private highlightKind: 'new' | 'pop' = 'new';
  /** The inventory shows two rows at a time; swipe or ‹ › for the rest (the menu never scrolls). */
  private readonly pager: Pager;

  constructor(root: HTMLElement, private readonly sim: Sim, private readonly icons: string[][], private readonly toast: (msg: string) => void) {
    root.innerHTML = `
      <div class="weapon-card" id="weapon-card">
        <div class="wc-icon"><img alt="" /></div>
        <div class="wc-body">
          <div class="wc-title"><span class="wc-tag"></span><span class="wc-name"></span></div>
          <div class="wc-atk"></div>
          <div class="wc-merge"></div>
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
        <button type="button" class="btn primary" id="forge-1">Forge <span class="cost"><i class="gem"></i><b id="forge-cost">10</b></span></button>
        <button type="button" class="btn" id="forge-10">x10</button>
        <button type="button" class="btn" id="auto-merge">Auto<br>merge</button>
        <button type="button" class="forge-level-btn mini" id="forge-level-btn" aria-label="Forge level and upgrades">
          <span class="flb-ico">${gi('anvil-impact', 'grey')}</span><b id="fl-level"></b><small id="fl-odds" hidden></small>
          <b class="dot" id="fl-dot" hidden>!</b>
        </button>
        <button type="button" class="forge-level-btn mini" id="inv-btn" aria-label="Inventory size">
          <span class="flb-ico">${gi('crossed-swords', 'white')}</span><b id="inv-count"></b><small id="inv-sub" hidden></small>
          <b class="dot" id="inv-dot" hidden>!</b>
        </button>
      </div>
      <div class="inv-wrap"><div class="inv-grid paged" id="inv-grid" role="grid" aria-label="Weapon inventory"></div></div>`;

    const $ = (sel: string) => root.querySelector<HTMLElement>(sel)!;
    this.el = {
      card: $('#weapon-card'), icon: $('.wc-icon img'), tag: $('.wc-tag'), name: $('.wc-name'),
      summary: $('.wc-summary'), atk: $('.wc-atk'), mergeInfo: $('.wc-merge'), traits: $('.wc-traits'), hint: $('.wc-hint'),
      equip: $('#equip-btn'), salvage: $('#salvage-btn'), merge: $('#merge-btn'),
      forge1: $('#forge-1'), forge10: $('#forge-10'), autoMerge: $('#auto-merge'),
      level: $('#fl-level'), odds: $('#fl-odds'), levelBtn: $('#forge-level-btn'), levelDot: $('#fl-dot'), forgeCost: $('#forge-cost'),
      invBtn: $('#inv-btn'), invCount: $('#inv-count'), invSub: $('#inv-sub'), invDot: $('#inv-dot'),
      grid: $('#inv-grid'),
    };
    this.pager = new Pager(this.el.grid, 18);
    $('.inv-wrap').append(this.pager.el);

    this.ensureSlots();

    // Tidy an existing save's inventory right away (it's kept sorted after every action).
    sim.sortInventory();

    // Every action redraws immediately rather than waiting for the next HUD tick.
    root.addEventListener('click', () => queueMicrotask(() => this.refresh()));
    this.el.forge1.addEventListener('click', () => this.doForge(1));
    this.el.forge10.addEventListener('click', () => this.doForge(10));
    this.el.autoMerge.addEventListener('click', () => {
      const merged = sim.autoMerge();
      if (merged.length) { this.flash(this.resort(merged), 'pop'); this.selected = -1; sfx.play('merge'); haptic(20); }
      else this.toast('Nothing to merge');
    });
    // The forge's level lives in its own window (separate from the weapon card).
    this.levelUI = new ForgeLevelUI(sim, toast, () => { this.renderedAtk = -1; });
    this.el.levelBtn.addEventListener('click', () => { sfx.play('tick'); this.levelUI.open(); });
    // Inventory size: its own window too (buy rows of slots with gold).
    this.invUI = new InventoryUI(sim, toast, () => { this.renderedVersion = -1; });
    this.el.invBtn.addEventListener('click', () => { sfx.play('tick'); this.invUI.open(); });
    this.el.equip.addEventListener('click', () => {
      const before = sim.atk;
      if (this.selected >= 0 && sim.equip(this.selected)) {
        this.flash(this.resort([this.selected]), 'pop'); // the previously equipped weapon
        this.selected = -1;
        this.animateAtk(before);
      }
    });
    this.el.merge.addEventListener('click', () => {
      const i = this.selected;
      const before = i >= 0 ? sim.save.weapons[i] : sim.save.equipped;
      const atkBefore = sim.atk;
      if (!before) return;
      // A selected inventory weapon merges in place; with nothing selected, upgrade the equipped one.
      const ok = i >= 0 ? sim.merge(i) : sim.mergeEquipped();
      if (!ok) return;
      const result = i >= 0 ? sim.save.weapons[i]! : sim.save.equipped!;
      if (i >= 0) { const [at] = this.resort([i]); this.selected = at; this.flash([at], 'pop'); }
      else { this.resort([]); this.animateAtk(atkBefore); this.flashCard(); }
      sfx.play('merge');
      haptic(20);
      this.toast(`${RARITY_NAMES[result.rarity]}! ${weaponName(result)}`);
    });
    this.el.salvage.addEventListener('click', () => {
      if (this.selected < 0) return;
      const got = sim.salvage(this.selected);
      if (got) this.toast(`+${got} shards`);
      this.selected = -1;
      this.resort([]);
    });
  }

  private flashCard(): void {
    const card = this.el.card;
    card.classList.remove('upgraded');
    void card.offsetWidth;
    card.classList.add('upgraded');
  }

  /** Count the equipped Attack up (or down) from `from` to its new value, with a ▲/▼ chip. */
  private animateAtk(from: number): void {
    const to = this.sim.atk;
    if (Math.abs(to - from) < 0.01) return;
    this.atkAnim = { from, to, start: performance.now() };
    const step = () => {
      const a = this.atkAnim;
      if (!a) return;
      const k = Math.min(1, (performance.now() - a.start) / ATK_ANIM);
      const e = 1 - Math.pow(1 - k, 3);
      const num = this.el.atk.querySelector('b');
      if (num) num.textContent = fmt(a.from + (a.to - a.from) * e);
      if (k < 1) requestAnimationFrame(step);
      else this.atkAnim = null;
    };
    this.renderedAtk = -1; // force a redraw with the delta chip
    this.render();
    requestAnimationFrame(step);
  }

  private doForge(n: number): void {
    const filled = this.sim.forge(n);
    if (filled.length) { this.flash(this.resort(filled), 'new'); this.selected = -1; sfx.play('forge'); }
    else if (this.sim.freeSlots() === 0) this.toast('Weapon slots full: merge, salvage, or buy more slots');
    else this.toast(`Need ${forgeCost(this.sim.save.forgeLevel)} shards`);
  }

  /** One grid button per inventory slot; adds buttons when the inventory grows. */
  private ensureSlots(): void {
    const n = this.sim.save.weapons.length;
    for (let i = this.slots.length; i < n; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      b.innerHTML = '<img alt="" /><span class="tier"></span><span class="better">▲</span><span class="rar"></span>';
      b.addEventListener('click', () => { this.tap(i); this.refresh(); });
      this.el.grid.appendChild(b);
      this.slots.push(b);
    }
  }

  /** Sort the inventory and return the new positions of the weapons that were in `slots`. */
  private resort(slots: number[]): number[] {
    const inv = this.sim.save.weapons;
    const ids = slots.map((i) => inv[i]?.id).filter((id): id is number => id !== undefined);
    const where = this.sim.sortInventory();
    return ids.map((id) => where.get(id)!).filter((i) => i !== undefined);
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
    const cost = forgeCost(s.forgeLevel);
    this.set(this.el.forgeCost, String(cost));
    this.disable(this.el.forge1, s.shards < cost || free === 0);
    this.disable(this.el.forge10, s.shards < cost * 2 || free < 2);
    this.disable(this.el.autoMerge, !hasPair(s.weapons));

    const maxed = s.forgeLevel >= MAX_FORGE_LEVEL;
    const capped = s.forgeLevel >= forgeLevelCap(sim.maxZone);
    const [pu, pr, pe, pl] = forgeOdds(s.forgeLevel);
    this.set(this.el.level, `Lv ${s.forgeLevel}${maxed ? '★' : ''}`);
    this.set(this.el.odds, `Uncommon+ ${pct(pu + pr + pe + pl)} · Rare+ ${pct(pr + pe + pl)}`);
    // "!" when the next forge level is affordable.
    this.el.levelDot.hidden = capped || s.gold < forgeUpgradeCost(s.forgeLevel);
    this.levelUI.refresh();
    // Inventory: used / size; "!" when it's (nearly) full and another row is affordable.
    const size = s.weapons.length, used = size - free;
    const invMaxed = size >= MAX_INVENTORY;
    this.set(this.el.invCount, `${used}/${size}`);
    this.set(this.el.invSub, invMaxed ? 'Max size' : `+5 slots · ${fmt(inventoryExpandCost(size))} gold`);
    this.el.invDot.hidden = invMaxed || free > 2 || s.gold < inventoryExpandCost(size);
    this.invUI.refresh();

    if (this.selected >= 0 && !s.weapons[this.selected]) this.selected = -1;
    // Also redraw when attack changes (upgrades, level-ups) so the preview stays accurate.
    if (sim.invVersion !== this.renderedVersion || this.selected !== this.renderedSelected || Math.round(sim.atk) !== this.renderedAtk) this.render();
  }

  private render(): void {
    this.ensureSlots();
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
      (b.children[1] as HTMLElement).textContent = '';
      // Rarity letter (C/U/R/E/L/M/D): merges need matching rarity, so make it readable at a glance.
      (b.children[3] as HTMLElement).textContent = RARITY_NAMES[w.rarity][0];
      // Weapons are class-locked: another hero's weapons are dimmed (they still merge and salvage).
      const mine = this.sim.canWield(w);
      if (!mine) b.classList.add('other-class');
      else if (weaponPower(w) > eqPower * 1.001) b.classList.add('is-better');
      if (i === this.selected) b.classList.add('selected');
      else if (partners.includes(i)) b.classList.add('mergeable');
      if (this.highlight.has(i)) b.classList.add(this.highlightKind);
      b.setAttribute('aria-label', `${RARITY_NAMES[w.rarity]} ${weaponName(w)}${mine ? '' : ` (${heroNames(w.form)} weapon)`}`);
    });
    const shown = [...this.highlight][0] ?? (this.selected >= 0 ? this.selected : -1);
    this.highlight.clear();
    if (shown >= 0) this.pager.reveal(shown);
    this.pager.update();

    // Card: the selected weapon (with actions) or the equipped one.
    const w = sel ?? s.equipped;
    const card = this.el.card;
    card.classList.toggle('selecting', !!sel);
    // Matching weapons for the card's weapon: inventory partners, or for the equipped weapon,
    // matching inventory weapons (the equipped one counts as the first of the three).
    const eqMatches = !sel ? matchingSlots(s.weapons, s.equipped) : [];
    card.classList.toggle('eq-merge', !sel && eqMatches.length > 0);
    if (!sel) for (const i of eqMatches) this.slots[i].classList.add('mergeable');
    if (w) {
      const img = this.el.icon as HTMLImageElement;
      img.src = this.icons[w.form][w.rarity];
      card.style.setProperty('--rc', RARITY_COLORS[w.rarity]);
      this.el.tag.textContent = sel ? '' : 'Equipped';
      this.el.name.textContent = `${RARITY_NAMES[w.rarity]} ${weaponName(w)}`;
      this.el.summary.textContent = weaponSummary(w);
      this.el.traits.replaceChildren(...w.traits.map((t) => {
        const li = document.createElement('li');
        li.textContent = TRAITS[t.t].show(t.v);
        return li;
      }));
      const now = this.sim.atk;
      const theirs = sel && !this.sim.canWield(sel);
      this.el.equip.textContent = theirs ? `Not for ${skinDef(s.skin).name}` : 'Equip';
      this.disable(this.el.equip, !!theirs);
      if (sel && theirs) {
        // Another hero's weapon: it can't be compared, but it can still merge or be salvaged.
        this.el.atk.className = 'wc-atk';
        this.el.atk.innerHTML = `<span class="wc-atk-lbl">⚔</span> ${heroNames(sel.form)} weapon · switch hero to use it`;
      }
      if (sel && !theirs) {
        // Attack if equipped, vs. the current attack.
        const next = this.sim.attackWith(sel);
        const diff = next - now;
        const pctDiff = now > 0 ? (diff / now) * 100 : 0;
        const dir = Math.abs(pctDiff) < 0.5 ? 'same' : diff > 0 ? 'up' : 'down';
        this.el.atk.className = `wc-atk ${dir}`;
        this.el.atk.innerHTML = `<span class="wc-atk-lbl">⚔ Attack</span> ${fmt(now)} → <b>${fmt(next)}</b> ` +
          (dir === 'same' ? '<em>no change</em>'
            : `<em>${dir === 'up' ? '▲ +' : '▼ −'}${fmt(Math.abs(diff))} (${dir === 'up' ? '+' : '−'}${Math.abs(pctDiff).toFixed(0)}%)</em>`);
      }
      if (sel) {
        // Merge needs mergeCount of the same type and rarity (this one included).
        const have = partners.length + 1;
        const need = mergeCount(sel.rarity);
        const ready = have >= need && sel.rarity < MAX_RARITY;
        const kind = `${RARITY_NAMES[sel.rarity]} ${FORMS[sel.form].name}s`;
        this.el.merge.textContent = `Merge ${Math.min(have, need)}/${need}`;
        this.disable(this.el.merge, !ready);
        const delta = eqPower > 0 ? weaponPower(sel) / eqPower : 1;
        const overall = theirs ? 'not for this hero' : delta >= 1.005 ? `overall ▲ ${((delta - 1) * 100).toFixed(0)}%` : delta <= 0.995 ? `overall ▼ ${((1 - delta) * 100).toFixed(0)}%` : 'overall about the same';
        // Same type but another rarity don't count: say so, it's the easy thing to miss.
        const otherRarity = new Map<number, number>();
        for (const o of s.weapons) {
          if (o && o.form === sel.form && o.rarity !== sel.rarity) otherRarity.set(o.rarity, (otherRarity.get(o.rarity) ?? 0) + 1);
        }
        const others = [...otherRarity].map(([r, n]) => `${n} ${RARITY_NAMES[r]}`).join(', ');
        const rarityNote = !ready && others ? ` Your ${others} ${FORMS[sel.form].name} don't count: rarity must match.` : '';
        this.el.hint.textContent = (sel.rarity >= MAX_RARITY ? 'Max rarity · '
          : ready ? `Merge ${need} ${kind} → ${RARITY_NAMES[sel.rarity + 1]} · `
          : `Merge needs ${need} ${kind} (have ${have}).${rarityNote} · `) + (theirs ? overall : `${overall} incl. speed & traits`);
        this.el.salvage.textContent = `Salvage +${salvageValue(sel, s.forgeLevel)}`;
      } else {
        const a = this.atkAnim;
        const delta = a ? a.to - a.from : 0;
        this.el.atk.className = `wc-atk ${a ? (delta > 0 ? 'up' : 'down') : ''}`;
        this.el.atk.innerHTML = `<span class="wc-atk-lbl">⚔ Attack</span> <b>${fmt(a ? a.from : now)}</b>` +
          (a ? ` <i class="atk-delta">${delta > 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(delta))}</i>` : '');
        const have = eqMatches.length + 1;
        const need = mergeCount(w.rarity);
        const ready = have >= need && w.rarity < MAX_RARITY;
        this.el.merge.textContent = `Merge ${Math.min(have, need)}/${need}`;
        this.disable(this.el.merge, !ready);
        const kind = `${RARITY_NAMES[w.rarity]} ${FORMS[w.form].name}s`;
        this.el.hint.textContent = eqMatches.length
          ? (ready ? `Upgrade: merge with ${need - 1} matching ${kind} from your bag` : `Upgrade needs ${need} ${kind} (have ${have} incl. this one)`)
          : `${FORMS[w.form].name}: ${FORMS[w.form].blurb.toLowerCase()} · the forge makes ${forgeKinds(s.skin)} for your ${skinDef(s.skin).name}`;
      }
      // What the next merge would do to your Attack.
      const mw = sel ?? s.equipped;
      const canShow = mw && mw.rarity < MAX_RARITY && (sel ? partners.length + 1 >= mergeCount(mw.rarity) : eqMatches.length > 0);
      if (canShow && mw) {
        const after = this.sim.attackWith(mergePreview(mw));
        const base = sel ? this.sim.attackWith(sel) : now;
        this.el.mergeInfo.innerHTML = `⇧ After merge (${RARITY_NAMES[mw.rarity + 1]}): Attack ${fmt(base)} → <b>${fmt(after)}</b> <em>▲ +${fmt(after - base)}</em>`;
        this.el.mergeInfo.hidden = false;
      } else {
        this.el.mergeInfo.hidden = true;
      }
    }
    this.renderedVersion = this.sim.invVersion;
    this.renderedSelected = this.selected;
    this.renderedAtk = Math.round(this.sim.atk);
  }

  /** Something worth doing in the forge (for the tab badge). */
  badge(): string {
    const s = this.sim.save;
    const forges = Math.min(Math.floor(s.shards / forgeCost(s.forgeLevel)), this.sim.freeSlots());
    if (forges > 0) return String(forges);
    const eq = s.equipped;
    return hasPair(s.weapons) || (eq && matchingSlots(s.weapons, eq).length >= mergeCount(eq.rarity) - 1) ? '!' : '';
  }
}

/** Enough weapons of the same type and rarity to merge? */
function hasPair(inv: (Weapon | null)[]): boolean {
  const count = new Map<number, number>();
  for (const w of inv) {
    if (!w || w.rarity >= MAX_RARITY) continue;
    const key = w.rarity * 16 + w.form;
    const n = (count.get(key) ?? 0) + 1;
    if (n >= mergeCount(w.rarity)) return true;
    count.set(key, n);
  }
  return false;
}

const ATK_ANIM = 700; // ms

function pct(v: number): string {
  return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
}

/** "Knight" or "Rogue / Shadow Rogue": who can wield weapon type `form`. */
function heroNames(form: number): string {
  return wieldersOf(form).map((h) => h.name).join(' / ');
}

/** "Staffs & Wands": the weapon types the forge makes for hero `skin`. */
function forgeKinds(skin: string): string {
  return skinDef(skin).forms.map((f) => `${FORMS[f].name}s`).join(' & ');
}
