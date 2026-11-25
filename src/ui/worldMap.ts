import { monsterSlot, paintMonsterPortraits } from './monsterPreview';
import { gi, terrainIcon } from './icons';
import { sfx } from '../audio/sfx';
import { fmt } from '../core/format';
import { areaFor, areaName } from '../sim/areas';
import { xpForKill } from '../sim/level';
import type { Sim } from '../sim/sim';
import {
  PLAYABLE_ZONES,
  ZONES_PER_AREA, isTerrainBossZone, zoneArea, zoneBossName, zoneLevel, zoneName, zoneStage,
} from '../sim/zones';
import { bindSheetTaps } from './tap';


/**
 * The world map: every terrain discovered so far as a card painted in its own ground colours,
 * with its three zones on a trail. Unlocked zones can be travelled to any time (farm an easier
 * one when a zone gets too tough); locked ones show what they need. One undiscovered terrain
 * teases what's next.
 */
export class WorldMapUI {
  private wrap: HTMLElement | null = null;
  private sig = '';

  constructor(
    private readonly sim: Sim,
    private readonly toast: (m: string) => void,
    private readonly codexIcon: (area: number, slot: number) => string,
  ) {}

  get isOpen(): boolean { return this.wrap !== null; }

  open(): void {
    if (this.wrap && !this.wrap.isConnected) this.close();
    if (this.wrap) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal sheet-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'World map');
    wrap.innerHTML = `
      <div class="sheet map-sheet">
        <div class="ribbon"><span class="ribbon-text">World Map</span></div>
        <button type="button" class="sheet-x" aria-label="Close">✕</button>
        <div class="sheet-body"></div>
      </div>`;
    bindSheetTaps(wrap, (act) => this.run(act));
    document.addEventListener('keydown', this.onKey);
    document.body.appendChild(wrap);
    this.wrap = wrap;
    this.sig = '';
    this.refresh();
    // Start scrolled to where the hero is.
    wrap.querySelector('.zone.here')?.scrollIntoView({ block: 'center' });
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
    const [act, arg] = action.split(':');
    if (act === 'travel') {
      const z = Number(arg);
      if (this.sim.isBossStage) { this.toast('Finish the boss fight first'); return; }
      if (this.sim.travel(z)) { sfx.play('area'); this.close(); }
    } else if (act === 'locked') {
      sfx.play('tick');
      this.toast(this.lockText(Number(arg)));
    }
  }

  private lockText(z: number): string {
    const s = this.sim.save;
    const needBoss = z > s.zoneBosses;
    const needLv = s.level < zoneLevel(z);
    if (needBoss && needLv) return `Reach Lv ${zoneLevel(z)} and beat the ${zoneBossName(z - 1)}`;
    if (needBoss) return `Beat the ${zoneBossName(z - 1)} in ${zoneName(z - 1)} to open the way`;
    return `Reach hero level ${zoneLevel(z)} to enter`;
  }

  /** Re-render when progress changes. Called by the HUD ~10×/s. */
  refresh(): void {
    if (!this.wrap) return;
    const sim = this.sim, s = sim.save;
    const max = sim.maxZone;
    const sig = `${s.zone}|${s.zoneBosses}|${s.level}|${max}|${sim.isBossStage}`;
    if (sig === this.sig) return;
    this.sig = sig;

    // Show every playable terrain up to the one holding the next locked zone, then one mystery
    // card (the terrains past the Greenwood arrive with their art).
    const nextLocked = Math.min(max + 1, PLAYABLE_ZONES - 1);
    const lastArea = zoneArea(nextLocked);
    const cards: string[] = [];
    for (let a = 0; a <= lastArea; a++) cards.push(this.areaCard(a, max));
    cards.push(`<div class="map-area mystery"><div class="map-area-head"><span class="map-ico">${gi('compass', 'gold')}</span><b>More lands coming soon</b></div>
      <p>Beyond the Greenwood lie marshes, dunes, caverns, snowfields and fire. Their roads open in a future update.</p></div>`);

    this.wrap.querySelector('.sheet-body')!.innerHTML = `
      <div class="map-you">📍 <b>${zoneName(s.zone)}</b> · Hero Lv ${s.level}</div>
      <p class="sheet-note">Zones open as your hero levels up and you beat each zone's boss. Stuck? Travel back and farm an easier zone.</p>
      ${cards.join('')}`;
    paintMonsterPortraits();
  }

  private areaCard(a: number, max: number): string {
    const { def } = areaFor(a);
    const s = this.sim.save;
    const g = def.ground;
    const discovered = a * ZONES_PER_AREA <= max;
    const mons = discovered
      ? [0, 1, 2].map((slot) => monsterSlot(a, slot, this.codexIcon(a, slot), 'map-mon')).join('')
      : '';
    const zones: string[] = [];
    for (let i = 0; i < ZONES_PER_AREA; i++) {
      const z = a * ZONES_PER_AREA + i;
      const open = this.sim.zoneUnlocked(z);
      const here = z === s.zone;
      const beaten = z < s.zoneBosses;
      const xp = xpForKill(zoneStage(z), false);
      const node = here ? gi('position-marker', 'red') : !open ? gi('padlock', 'grey') : beaten ? gi('check-mark', 'white') : String(z + 1);
      const end = here
        ? '<span class="zone-tag here">Here</span>'
        : open
          ? `<button type="button" class="btn small green" data-act="travel:${z}">Travel</button>`
          : `<button type="button" class="zone-lock" data-act="locked:${z}">Lv ${zoneLevel(z)}${z > s.zoneBosses ? ' · ☠' : ''}</button>`;
      zones.push(`
        <div class="zone ${here ? 'here' : ''} ${open ? 'open' : 'locked'} ${beaten ? 'beaten' : ''}">
          <span class="zone-node">${node}</span>
          <div class="zone-main">
            <div class="zone-name">${open ? zoneName(z) : discovered ? zoneName(z) : '???'}</div>
            <div class="zone-sub">XP <b>${fmt(xp)}</b>/kill · ${isTerrainBossZone(z) ? gi('crown', 'gold') : gi('skull-crossed-bones', 'white')} ${open || discovered ? zoneBossName(z) : '???'}${beaten ? ' ✓' : ''}</div>
          </div>
          ${end}
        </div>`);
    }
    return `
      <div class="map-area ${discovered ? '' : 'undiscovered'}" style="--g1:${g.light};--g2:${g.base};--g3:${g.dark}">
        <div class="map-area-head"><span class="map-ico">${terrainIcon(a)}</span><b>${discovered ? areaName(a) : 'Unknown land'}</b>
          <span class="map-mons">${mons}</span></div>
        <div class="zone-trail">${zones.join('')}</div>
      </div>`;
  }
}
