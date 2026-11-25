import { areaFor, areaName } from './areas';

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
/** Zones that can be played: the Greenwood's three. The other terrains arrive with their art packs. */
export const PLAYABLE_ZONES = 3;
/** Zones with their own names; past this the terrains repeat as "+" tiers. */
export const NAMED_ZONES = 18;

const ZONE_NAMES: readonly string[] = [
  'Meadow Outskirts', 'Bloomwood Groves', 'Old Mill Crossing',
  'Mirewood Edge', 'Sunken Grove', 'Bogroot Crossing',
  'Dune Approach', 'Oasis Thicket', 'Sunscar Crossroads',
  'Hollow Mouth', 'Crystal Garden', 'Deep Junction',
  'Frostveil Pass', 'Pine Hollow', 'Glacier Crossing',
  'Ashen Foothills', 'Ember Grove', 'Caldera Heart',
];

/** Emoji for each terrain on the world map. */
export const AREA_ICONS: readonly string[] = ['🌿', '🍄', '🌵', '💎', '❄️', '🌋'];

/** The terrain (area index) a zone belongs to. */
export const zoneArea = (zone: number) => Math.floor(zone / ZONES_PER_AREA);

/** Zone difficulty in stage units: zone 0 → 1, zone 3 → 13, zone 6 → 25, … (×~2 monster HP per zone) */
export const zoneStage = (zone: number) => 1 + zone * 4;

/**
 * Hero level needed to enter each named zone, tuned so a steady player opens a new zone every
 * few minutes early on and every 10-20 minutes later. Past the named zones, level 100.
 */
const ZONE_LEVELS: readonly number[] = [1, 4, 6, 8, 10, 12, 15, 18, 22, 26, 31, 37, 44, 52, 60, 70, 80, 90];
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

/** True for the third zone of a terrain: its boss is the terrain's own boss. */
export const isTerrainBossZone = (zone: number) => zone % ZONES_PER_AREA === ZONES_PER_AREA - 1;

/** Roster slot of a zone's boss: a champion of one of the terrain's monsters, or the terrain boss (3). */
export function zoneBossMonster(zone: number): number {
  const i = zone % ZONES_PER_AREA;
  return i === 0 ? 0 : i === 1 ? 1 : 3;
}

/**
 * Seconds a beaten zone boss needs before a rematch: longer for tougher bosses, and half as long
 * again for a terrain's own boss. Stops endless rematches farming boss rewards (missions, codex).
 * 2 min in the first zone, ~5 min by the third terrain, ~29 min at the Caldera's heart.
 */
export function bossCooldown(zone: number): number {
  return Math.round((120 + 60 * Math.max(0, zone)) * (isTerrainBossZone(zone) ? 1.5 : 1));
}

export function zoneBossName(zone: number): string {
  const { def } = areaFor(zoneArea(zone));
  const m = zoneBossMonster(zone);
  return m === 3 ? def.boss.name : `${def.monsters[m].name} Champion`;
}
