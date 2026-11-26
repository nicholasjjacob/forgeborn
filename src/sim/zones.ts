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
 * The Greenwood's region bosses, by zone: a giant of one of the region's own monsters (its index
 * in REGION_MONSTERS), each with a name of its own. The Greenwood's own boss (the Necromancer)
 * is its world boss, in a lair of its own once all nine have fallen (see WORLD_BOSS).
 */
const REGION_BOSSES: readonly { pick: number; name: string }[] = [
  { pick: 0, name: 'Big Mossy' },           // Meadow Outskirts: Moss Blob
  { pick: 0, name: 'Goldhorn' },            // Goldenrod Fields: Dune Dino
  { pick: 0, name: 'Gloomglub' },           // Mistwater Glade: Bog Glub
  { pick: 0, name: 'Warchief Cinderjaw' },  // Emberleaf Woods: Cinder Orc
  { pick: 0, name: 'Queen Thornbuzz' },     // Bloomwood Groves: Mire Bee
  { pick: 0, name: 'Old Rimeback' },        // Tidepine Thicket: Frost Yeti
  { pick: 0, name: 'Hollowshade' },         // Crimson Hollow: Cave Ghost
  { pick: 0, name: 'Gristlegrind' },        // Old Mill Crossing: Bone Brute
  { pick: 0, name: 'Deepcoil' },            // Emerald Mere: Ice Squid
];

/**
 * A zone's boss as [terrain, roster slot]. In the Greenwood: the region's giant (a big version of
 * one of its monsters, slot 0-2). Later terrains: a champion per zone, the terrain's boss last.
 */
export function zoneBoss(zone: number): { area: number; slot: number } {
  const area = zoneArea(zone);
  if (area === 0) {
    const b = BIOMES.findIndex((x) => x.zone === zone);
    const [a, s] = REGION_MONSTERS[b][REGION_BOSSES[zone % 9].pick];
    return { area: a, slot: s };
  }
  if (isTerrainBossZone(zone)) return { area, slot: 3 };
  return { area, slot: zoneIndex(zone) };
}

/** The Greenwood's world boss: its own boss (the Necromancer), in a lair in its last region. */
export const WORLD_BOSS = { area: 0, slot: 3, zone: PLAYABLE_ZONES - 1 } as const;
/** The world boss is a little tougher than the last region's. */
export const worldBossStage = () => zoneStage(WORLD_BOSS.zone) + 2;
export const worldBossName = () => areaFor(WORLD_BOSS.area).def.boss.name;

/**
 * Seconds a beaten zone boss needs before a rematch: longer for tougher bosses, and half as long
 * again for a terrain's own boss. Stops endless rematches farming boss rewards (missions, codex).
 * 2 min in the first zone, ~5 min by the third terrain, ~29 min at the Caldera's heart.
 */
export function bossCooldown(zone: number): number {
  return Math.round((120 + 60 * Math.max(0, zone)) * (zoneArea(zone) > 0 && isTerrainBossZone(zone) ? 1.5 : 1));
}
/** The world boss's rest between fights. */
export const worldBossCooldown = () => Math.round(bossCooldown(WORLD_BOSS.zone) * 1.5);

/**
 * Codex key of a region's boss: its kills are kept apart from its monster's, under this "area"
 * (slot 3), so each region's giant has a Codex entry of its own.
 */
export const regionBossKey = (zone: number) => 100 + zone;

/** The Codex's pages: one per region (by zone), then the world boss's. */
export const CODEX_WORLD_PAGE = PLAYABLE_ZONES;

/** A page's Codex entries as [area, slot]: the region's three monsters and its boss, or the world boss. */
export function codexEntries(page: number): [number, number][] {
  if (page === CODEX_WORLD_PAGE) return [[WORLD_BOSS.area, WORLD_BOSS.slot]];
  const b = BIOMES.findIndex((x) => x.zone === page);
  return b < 0 ? [] : [...REGION_MONSTERS[b].map(([a, s]) => [a, s] as [number, number]), [regionBossKey(page), 3]];
}

/** What a Codex entry shows: its name, the monster model drawn (region bosses: their giant), and whether it's a boss. */
export function codexEntry(area: number, slot: number): { name: string; area: number; slot: number; boss: boolean } {
  if (area >= 100) {
    const z = area - 100, g = zoneBoss(z);
    return { name: zoneBossName(z), area: g.area, slot: g.slot, boss: true };
  }
  const { def } = areaFor(area);
  return { name: slot === 3 ? def.boss.name : def.monsters[slot].name, area, slot, boss: slot === 3 };
}

export function zoneBossName(zone: number): string {
  if (zoneArea(zone) === 0) return REGION_BOSSES[zone % 9].name;
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


