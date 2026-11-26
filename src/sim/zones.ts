import { areaFor, areaName } from './areas';
import { BIOMES, REGION_MONSTERS } from './forest';

/**
 * The world map: zones you travel between. Every terrain (area) has three zones, each a step
 * harder than the last, and the third ends in the terrain's own boss. A zone unlocks when the
 * hero reaches its level AND the previous zone's boss has been beaten. Unlocked zones can be
 * revisited any time, so a tough zone can be left for an easier one to farm.
 *
 * Difficulty is expressed in the old "stage" units (zoneStage) so monster stats, gold and
 * quest scaling keep their tuned curves: 3 zones span what 10 stages used to.
 */

export const ZONES_PER_AREA = 3;
/**
 * Zones per terrain: the Greenwood is one big world of nine regions, each its own zone (a long
 * climb); every other terrain has three. Past the last listed terrain they repeat in threes.
 */
const AREA_ZONES: readonly number[] = [9, 3, 3, 3, 3, 3];
const AREA_START: readonly number[] = AREA_ZONES.map((_, i) => AREA_ZONES.slice(0, i).reduce((a, b) => a + b, 0));
const LISTED_ZONES = AREA_ZONES.reduce((a, b) => a + b, 0);
/** Zones that can be played: the Greenwood's nine. The other terrains arrive with their art packs. */
export const PLAYABLE_ZONES = 9;
/** Zones with their own names; past this the terrains repeat as "+" tiers. */
export const NAMED_ZONES = LISTED_ZONES;

/** The Greenwood's zones are its regions, easiest first (forest.ts lays them out). */
const ZONE_NAMES: readonly string[] = [
  'Meadow Outskirts', 'Goldenrod Fields', 'Mistwater Glade', 'Emberleaf Woods', 'Bloomwood Groves',
  'Tidepine Thicket', 'Crimson Hollow', 'Old Mill Crossing', 'Emerald Mere',
  'Mirewood Edge', 'Sunken Grove', 'Bogroot Crossing',
  'Dune Approach', 'Oasis Thicket', 'Sunscar Crossroads',
  'Hollow Mouth', 'Crystal Garden', 'Deep Junction',
  'Frostveil Pass', 'Pine Hollow', 'Glacier Crossing',
  'Ashen Foothills', 'Ember Grove', 'Caldera Heart',
];

/** Emoji for each terrain on the world map. */
export const AREA_ICONS: readonly string[] = ['🌿', '🍄', '🌵', '💎', '❄️', '🌋'];

/** The terrain (area index) a zone belongs to. */
export function zoneArea(zone: number): number {
  if (zone >= LISTED_ZONES) return AREA_ZONES.length + Math.floor((zone - LISTED_ZONES) / ZONES_PER_AREA);
  let a = 0;
  while (a + 1 < AREA_START.length && AREA_START[a + 1] <= zone) a++;
  return a;
}
/** Which of its terrain's zones this is (0 = the first). */
function zoneIndex(zone: number): number {
  return zone >= LISTED_ZONES ? (zone - LISTED_ZONES) % ZONES_PER_AREA : zone - AREA_START[zoneArea(zone)];
}
/** How many zones the zone's terrain has. */
const zonesIn = (zone: number) => (zone >= LISTED_ZONES ? ZONES_PER_AREA : AREA_ZONES[zoneArea(zone)]);

/** Zone difficulty in stage units: zone 0 → 1, zone 3 → 13, zone 6 → 25, … (×~2 monster HP per zone) */
export const zoneStage = (zone: number) => 1 + zone * 4;

/**
 * Hero level needed to enter each named zone: the Greenwood's nine regions climb steadily (a
 * new region every while, slower as it goes), then the later terrains. Past them, level 100.
 */
const ZONE_LEVELS: readonly number[] = [1, 5, 9, 14, 19, 25, 31, 38, 46, 50, 54, 58, 62, 66, 70, 74, 78, 82, 86, 90, 93, 95, 97, 99];
export function zoneLevel(zone: number): number {
  if (zone <= 0) return 1;
  return zone < ZONE_LEVELS.length ? ZONE_LEVELS[zone] : 100;
}

export function zoneName(zone: number): string {
  const base = ZONE_NAMES[zone % NAMED_ZONES];
  const tier = Math.floor(zone / NAMED_ZONES);
  return tier === 0 ? base : `${base} ${'+'.repeat(Math.min(tier, 3))}${tier > 3 ? tier : ''}`;
}

/** "Sunscar Dunes" etc. for the zone's terrain. */
export const zoneTerrain = (zone: number) => areaName(zoneArea(zone));

/** True for a terrain's last zone: its boss is the terrain's own boss. */
export const isTerrainBossZone = (zone: number) => zoneIndex(zone) === zonesIn(zone) - 1;

/**
 * A zone's boss as [terrain, roster slot]: the terrain's own boss (slot 3) in its last zone,
 * otherwise a champion of a regular monster: in the Greenwood, one of the region's own monsters.
 */
export function zoneBoss(zone: number): { area: number; slot: number } {
  const area = zoneArea(zone);
  if (isTerrainBossZone(zone)) return { area, slot: 3 };
  if (area === 0) {
    const b = BIOMES.findIndex((x) => x.zone === zone);
    const [a, s] = REGION_MONSTERS[b][zone % 3];
    return { area: a, slot: s };
  }
  return { area, slot: zoneIndex(zone) };
}

/**
 * Seconds a beaten zone boss needs before a rematch: longer for tougher bosses, and half as long
 * again for a terrain's own boss. Stops endless rematches farming boss rewards (missions, codex).
 * 2 min in the first zone, ~5 min by the third terrain, ~29 min at the Caldera's heart.
 */
export function bossCooldown(zone: number): number {
  return Math.round((120 + 60 * Math.max(0, zone)) * (isTerrainBossZone(zone) ? 1.5 : 1));
}

/**
 * The map region a terrain's monsters call home (where most of them roam, the easiest on a tie),
 * or -1 if none of them is in a playable region yet. The Codex names its pages after it.
 */
export function codexHome(area: number): number {
  let best = -1, most = 0;
  BIOMES.forEach((b, i) => {
    if (b.zone < 0 || b.zone >= PLAYABLE_ZONES) return;
    const n = (REGION_MONSTERS[i] ?? []).filter(([a]) => a === area).length;
    if (n > most || (n === most && n > 0 && b.zone < best)) { most = n; best = b.zone; }
  });
  return best;
}

/** The playable zones (regions) where terrain `area`'s monster `slot` roams, easiest first. */
export function monsterZones(area: number, slot: number): number[] {
  const out: number[] = [];
  BIOMES.forEach((b, i) => {
    if (b.zone >= 0 && b.zone < PLAYABLE_ZONES && REGION_MONSTERS[i]?.some(([a, s]) => a === area && s === slot)) out.push(b.zone);
  });
  return out.sort((x, y) => x - y);
}

/** The playable zone whose lair holds terrain `area`'s own boss, or -1 while none does yet. */
export function bossLairZone(area: number): number {
  for (let z = 0; z < PLAYABLE_ZONES; z++) {
    const b = zoneBoss(z);
    if (b.area === area && b.slot === 3) return z;
  }
  return -1;
}

export function zoneBossName(zone: number): string {
  const { area, slot } = zoneBoss(zone);
  const { def } = areaFor(area);
  return slot === 3 ? def.boss.name : `${def.monsters[slot].name} Champion`;
}

/**
 * How much tougher each zone's monsters are than the base curve (health, damage). Calibrated with
 * a greedy simulated player: a zone's regulars take several hits when it opens and only fall in
 * one by the time the next one does; a fresh zone's crowd can still overwhelm you. Gold per kill
 * is unchanged (more of it would just feed the hero's upgrades). Zones past the table use its end.
 */
const ZONE_POWER: readonly [number, number][] = [
  [1, 1], [17, 6.5], [22, 9], [30, 13], [32, 15], [30, 15], [27, 14], [24, 13], [22, 12],
];
export function stagePower(stage: number): { hp: number; dmg: number } {
  const z = Math.max(0, Math.min(ZONE_POWER.length - 1, Math.round((stage - 1) / 4)));
  const [hp, dmg] = ZONE_POWER[z];
  return { hp, dmg };
}


