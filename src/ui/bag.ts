import { morphInto } from './morph';
import { sfx } from '../audio/sfx';
import { fmt } from '../core/format';
import type { Sim } from '../sim/sim';
import { RARITY_NAMES, weaponName, weaponPower } from '../sim/weapons';
import { bindSheetTaps } from './tap';
import { REFORGE_MIN_STAGE } from '../sim/meta';
import { zoneName, zoneStage } from '../sim/zones';

/** Where Reforge opens (the same rule as the Reforge page). */
const REFORGE_ZONE = (() => { let z = 0; while (zoneStage(z) < REFORGE_MIN_STAGE) z++; return zoneName(z); })();

/**
 * The Bag: everything the hero is carrying. Treasures (gold, shards, gems, embers) as item
 * tiles; tap a tile for what it is and where it comes from.
 * A weapons summary links to the Forge, where weapons are managed.
 */

interface ItemDef {
  id: string;
  name: string;
  icon: string;               // markup for the tile icon
  amount: (sim: Sim) => number;
  about: string;              // what it's for
  source: string;             // where to get more
}

const ITEMS: { title: string; items: ItemDef[] }[] = [
  {
    title: 'Treasures',
    items: [
      { id: 'gold', name: 'Gold', icon: '<i class="coin"></i>', amount: (s) => s.save.gold,
        about: 'Buys upgrades, forge levels and weapon slots.',
        source: 'Every monster drops gold. Greed and Fortune raise it.' },
      { id: 'shards', name: 'Shards', icon: '<i class="gem"></i>', amount: (s) => s.save.shards,
        about: 'Forge new weapons. Each forge level makes better weapons but costs more shards.',
        source: 'Monsters sometimes drop them; elites and bosses always do. Salvage spare weapons for a few back.' },
      { id: 'gems', name: 'Gems', icon: '<i class="jewel"></i>', amount: (s) => s.save.missions.gems,
        about: 'Spend them in the Gem Shop.',
        source: 'Daily login, mission gifts, the codex and Level Road rewards.' },
      { id: 'embers', name: 'Embers', icon: '<i class="ember"></i>', amount: (s) => s.save.embers,
        about: 'Buy permanent perks in the Reforge tab.',
        source: `Reforge once you reach ${REFORGE_ZONE}, Level Road rewards and the Gem Shop.` },
    ],
  },
];

export class BagUI {
  private wrap: HTMLElement | null = null;
  private sig = '';
  private selected = 'gold';

  constructor(private readonly sim: Sim, private readonly openForge: () => void) {}

  get isOpen(): boolean { return this.wrap !== null; }

  open(): void {
    if (this.wrap && !this.wrap.isConnected) this.close();
    if (this.wrap) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal sheet-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <div class="sheet bag-sheet">
        <div class="ribbon"><span class="ribbon-text">Bag</span></div>
        <button type="button" class="sheet-x" aria-label="Close">✕</button>
        <div class="sheet-body"></div>
      </div>`;
    bindSheetTaps(wrap, (act) => this.run(act));
    document.addEventListener('keydown', this.onKey);
    document.body.appendChild(wrap);
    this.wrap = wrap;
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
    if (action === 'close') { this.close(); return; }
    const [act, id] = action.split(':');
    if (act === 'item') { this.selected = id; sfx.play('tick'); this.sig = ''; this.refresh(); }
    else if (act === 'forge') { this.close(); this.openForge(); }
  }

  /** Re-render when anything shown changes. Called by the HUD ~10×/s. */
  refresh(): void {
    if (!this.wrap) return;
    const sim = this.sim, s = sim.save;
    const amounts = ITEMS.flatMap((g) => g.items.map((it) => Math.floor(it.amount(sim))));
    const weapons = s.weapons.filter(Boolean);
    const sig = JSON.stringify([this.selected, amounts, weapons.length, s.weapons.length, s.equipped?.id]);
    if (sig === this.sig) return;
    this.sig = sig;

    const all = ITEMS.flatMap((g) => g.items);
    const sel = all.find((it) => it.id === this.selected) ?? all[0];
    const tile = (it: ItemDef) => `
      <button type="button" class="bag-tile ${it.id === sel.id ? 'sel' : ''}" data-act="item:${it.id}" aria-label="${it.name}">
        <span class="bag-ico">${it.icon}</span>
        <span class="bag-name">${it.name}</span>
        <b class="bag-amt">${fmt(it.amount(sim))}</b>
      </button>`;
    const best = weapons.reduce<typeof weapons[number]>((b, w) => (!b || weaponPower(w!) > weaponPower(b) ? w : b), null);
    const eq = s.equipped;

    // Every item's details are laid in the same spot and only the chosen one shows, so the box is
    // always as tall as the longest and the sheet never changes size when another tile is tapped.
    const detail = (it: ItemDef) => `
      <div class="bag-detail-item" ${it.id === sel.id ? '' : 'aria-hidden="true"'} data-on="${it.id === sel.id}">
        <span class="bag-ico big">${it.icon}</span>
        <div class="bag-detail-text">
          <div class="bag-detail-name">${it.name} <b>${fmt(it.amount(sim))}</b></div>
          <div class="bag-about">${it.about}</div>
          <div class="bag-source">📍 ${it.source}</div>
        </div>
      </div>`;
    // The tiles come first: only their heading sits beside the close button.
    // Patched in place (gold changes with every kill; the tiles and 3D weapons stay put).
    morphInto(this.wrap.querySelector('.sheet-body')!, `
      ${ITEMS.map((g) => `<h3 class="bag-title">${g.title}</h3><div class="bag-grid">${g.items.map(tile).join('')}</div>`).join('')}
      <div class="bag-detail">${all.map(detail).join('')}</div>
      <h3 class="bag-title">Weapons</h3>
      <div class="bag-weapons">
        <div class="bag-wline">⚔ <b>${weapons.length}/${s.weapons.length}</b> weapon slots used</div>
        <div class="bag-wline">Equipped: <b>${eq ? `${RARITY_NAMES[eq.rarity]} ${weaponName(eq)}` : 'nothing'}</b></div>
        <div class="bag-wline">Best in bag: <b>${best ? `${RARITY_NAMES[best.rarity]} ${weaponName(best)}` : 'none yet'}</b></div>
        <button type="button" class="btn small primary" data-act="forge:">Open Forge ›</button>
      </div>`);
  }
}
