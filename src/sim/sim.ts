import { Explored } from './explore';
import { DEFAULT_SKIN, SKINS, STARTERS, canWield, skinDef, type ClassMods } from './skins';
import { Rng } from '../core/rng';
import { areaFor, type MonsterDef } from './areas';
import {
  AUTO_IDLE_DELAY, BOSS, BOSS_TIME, CRIT_MULT, HERO_RADIUS, HERO_REGEN, HERO_SPEED,
  TICK, UPGRADES, UPGRADE_IDS,
  enemyDmg, enemyGold, enemyHp, maxAffordable, maxAlive, upgradeCost,
  type UpgradeId,
} from './balance';
import { Ev, EventQueue } from './events';
import {
  ACHIEVEMENTS, ACH_BONUS_PER_TIER, GLOW_DMG, GLOW_HP, PERKS, ROMAN, embersFor, freshPerks, freshStats, perkCost,
  type AchStat, type PerkId, type Perks, type Stats,
} from './meta';
import * as RQ from './regionQuests';
import { forestRoute } from './route';
import type { Reward } from './missions';
import { OFFLINE_CAP_HOURS } from './offline';
import { addRewards, freshMissions, type MissionSave } from './missions';
import { MissionSystem } from './missionSystem';
import { GameMap, MAP_H, MAP_W } from './map';
import { BIOMES, FOREST_H, FOREST_W, biomeArrival, forestRegion, forestZone, type Territory } from './forest';
import { MAX_LEVEL, levelBonus, milestoneReward, xpForKill, xpToNext, MILESTONES, type MilestoneReward } from './level';
import { PLAYABLE_ZONES, stagePower, zoneArea, zoneBoss, zoneBossName, zoneLevel, zoneName, zoneStage, bossCooldown } from './zones';
import {
  forgeCost, forgeLevelCap, INVENTORY_SIZE, INVENTORY_STEP, MAX_FORGE_LEVEL, MAX_INVENTORY, inventoryExpandCost, mergeCount, bonusWeapon, compareWeapons, forgeAtkBonus, forgeUpgradeCost, forgeWeapon, matchingSlots, mergePartners, mergeWeapons,
  salvageValue, starterWeapon, weaponStats, type RangedDef, type Weapon,
} from './weapons';

export const MAX_ENEMIES = 128; // room for the forest's crowds and hordes
export const MAX_SHOTS = 32;

/** Fighting style codes stored on each enemy (see MonsterStyle in areas.ts). */
export const STYLE_MELEE = 0, STYLE_DASHER = 1, STYLE_SPITTER = 2;
const STYLE_CODE = { melee: STYLE_MELEE, dasher: STYLE_DASHER, spitter: STYLE_SPITTER } as const;

// Monster skills. Wind-ups are telegraphed by the renderer so the player can react.
const DASH_WIND = 0.45, DASH_TIME = 0.32, DASH_SPEED = 3.4, DASH_RANGE = 75;
const SPIT_WIND = 0.35, SPIT_RANGE = 95, SPIT_SPEED = 95, SPIT_KEEP = 45;
export const SLAM_WIND = 0.9, SLAM_RADIUS = 34;
/** Elites: rarer, tougher variants with a golden aura. */
export const ELITE = { hp: 3, dmg: 1.4, gold: 4, radius: 2, scale: 1.3 };

/** A monster projectile in flight. */
export interface Shot {
  alive: boolean;
  x: number; y: number; prevX: number; prevY: number;
  vx: number; vy: number;
  dmg: number;
  life: number;
  monster: number; // who fired it (for its colour)
}
/** A hero projectile (arrow, crossbow bolt or magic orb) in flight. */
export interface HeroShot {
  alive: boolean;
  x: number; y: number; prevX: number; prevY: number;
  vx: number; vy: number;
  dmg: number;
  crit: boolean;
  life: number;
  pierce: number;   // enemies it can still pass through
  splash: number;   // explosion radius on hit (0 = none)
  kind: RangedDef['kind'];
  rarity: number;   // for its colour
  /** Enemies already hit (so a piercing shot never hits the same one twice). */
  hits: Enemy[];
}
export const MAX_HERO_SHOTS = 24;
const RATE_BUCKETS = 60;
const RATE_BUCKET_SECONDS = 5;

export type BuyMode = 1 | 10 | 'max';

/** Everything that persists between sessions. Kept flat and JSON-friendly. */
export interface SaveData {
  v: 7;
  stage: number;
  highestStage: number;
  gold: number;
  kills: number;
  farming: boolean;
  upgrades: Record<UpgradeId, number>;
  buyMode: BuyMode;
  fps: 30 | 60;
  auto: boolean;
  sound: boolean;
  quality: 'high' | 'low';
  /** Minimap frame: a circle or a rounded square (same view around the hero). */
  minimap: 'circle' | 'square';
  shards: number;
  forgeLevel: number;
  weapons: (Weapon | null)[];   // fixed-size inventory grid
  equipped: Weapon | null;   // the current hero's weapon
  /** The other heroes' equipped weapons, by skin id (v7: weapons are class-locked). */
  gear: Record<string, Weapon | null>;
  nextWeaponId: number;
  // Meta progression (v3)
  embers: number;
  embersEarned: number;      // lifetime total, drives Ember Glow
  perks: Perks;
  bestEver: number;          // highest stage across all runs (highestStage is this run's best)
  stats: Stats;
  /** Region quests (the Quest Book): lifetime progress per zone. Kept through Reforge. */
  regions: RQ.RegionProgress[];
  achievements: Record<string, number>; // tiers unlocked per achievement id
  // Engagement (v4): gems, login calendar, daily/weekly boards, 7-day journey, codex
  missions: MissionSave;
  // Hero level (v5): persists through Reforge.
  level: number;
  xp: number;                // progress toward the next level
  levelClaimed: number[];    // Level Road milestones already claimed (5, 10, …)
  // World map (v6). `stage` is now the current zone's difficulty in stage units (zoneStage).
  zone: number;              // the zone the hero is in
  zoneBosses: number;        // zone bosses beaten, in order: zone z's boss is down when z < zoneBosses
  zoneBest: number;          // furthest zone ever unlocked (across runs)
  /** The hero (class) being played and every hero owned. Kept through Reforge. */
  skin: string;
  skins: string[];
  /** Chosen style per hero (e.g. the Knight's visor), by skin id. Cosmetic. */
  looks: Record<string, string>;
  /** Chosen colour scheme per hero (0 = default, 1-3 = alternates), by skin id. Cosmetic. */
  palettes: Record<string, number>;
  /** Zone → wall-clock time (ms) when its beaten boss can be rematched again. */
  bossReady: Record<string, number>;
  /** Forest fog of war: the cells the hero has seen (base64 bitset, see Explored). Kept through Reforge. */
  explored: string;
  /** Has the player picked their first hero (the first-launch choice)? Old saves count as yes. */
  starterChosen: boolean;
  /** Recent earnings per second, used to pay out offline progress. */
  rates: { gold: number; shards: number };
  savedAt: number;
}

export function freshSave(): SaveData {
  return {
    v: 7, stage: 1, highestStage: 1, gold: 0, kills: 0, farming: false,
    upgrades: { atk: 0, hp: 0, aspd: 0, crit: 0, gold: 0 },
    buyMode: 1, fps: 60, auto: true, sound: true, quality: 'high', minimap: 'circle',
    shards: 0, forgeLevel: 1, weapons: Array(INVENTORY_SIZE).fill(null), equipped: starterWeapon(), gear: {}, nextWeaponId: 2,
    rates: { gold: 0, shards: 0 },
    embers: 0, embersEarned: 0, perks: freshPerks(), bestEver: 1, stats: freshStats(), regions: RQ.freshRegions(), achievements: {},
    missions: freshMissions(),
    level: 1, xp: 0, levelClaimed: [],
    zone: 0, zoneBosses: 0, zoneBest: 0,
    skin: DEFAULT_SKIN, skins: [DEFAULT_SKIN], looks: {}, palettes: {}, bossReady: {}, explored: '', starterChosen: false,
    savedAt: Date.now(),
  };
}

export interface Enemy {
  alive: boolean;
  monster: number;   // index into its terrain's roster (0..2), or 3 for the boss
  /** The terrain the monster comes from (forest regions borrow monsters from every terrain). */
  area: number;
  boss: boolean;
  elite: boolean;
  style: number;     // STYLE_* code
  /** >0 while winding up a skill (dash, spit or boss slam); it fires when this reaches 0. */
  windT: number;
  /** >0 while charging in a straight line (dashers). */
  dashT: number;
  dirX: number; dirY: number;  // locked direction for a dash
  dashHit: boolean;            // this dash already landed
  skillCd: number;
  x: number; y: number;
  prevX: number; prevY: number;
  kx: number; ky: number;      // knockback velocity
  radius: number;
  hp: number; maxHp: number;
  dmg: number;
  speed: number;
  atkInterval: number;
  atkCd: number;
  gold: number;
  aggro: boolean;
  wanderA: number; wanderT: number;
  spawnT: number;    // >0 while materialising (inactive)
  chasing: boolean;  // tried to move toward the hero last tick
  stuckT: number;
  detourT: number;
  detourA: number;
  hitT: number;
  lungeT: number;
  seed: number;
  /** Forest: the territory it belongs to (-1 = none), its home circle, and its zone's difficulty. */
  terr: number;
  homeX: number; homeY: number; homeR: number;
  stage: number;
}

export interface Hero {
  x: number; y: number;
  prevX: number; prevY: number;
  hp: number; maxHp: number;
  atkCd: number;
  swingT: number;
  swingAngle: number;
  hitT: number;
  faceX: 1 | -1;
  moving: boolean;
}

export type Phase = 'playing' | 'dead';

// Uniform grid for enemy-enemy separation (rebuilt every tick; typed arrays, no allocation).
const SEP_CELL = 24;
const SEP_COLS = Math.ceil(Math.max(MAP_W, FOREST_W) / SEP_CELL);
const SEP_ROWS = Math.ceil(Math.max(MAP_H, FOREST_H) / SEP_CELL);

export class Sim {
  readonly save: SaveData;
  readonly events = new EventQueue();
  readonly enemies: Enemy[] = [];
  readonly rng: Rng;

  map: GameMap;
  phase: Phase = 'playing';
  phaseT = 0;
  bossT = 0;
  bossActive = false;
  /** Seconds left in the arena after a boss falls, before heading back to the zone. */
  private returnT = 0;
  /** Furthest zone already announced as unlocked. */
  private knownMaxZone = 0;
  time = 0;
  /** Wall clock (ms) for boss cooldowns; tests swap it for a fixed or simulated clock. */
  clock: () => number = () => Date.now();
  private spawnT = 0;
  readonly shots: Shot[] = Array.from({ length: MAX_SHOTS }, () => ({
    alive: false, x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, dmg: 0, life: 0, monster: 0,
  }));

  readonly heroShots: HeroShot[] = Array.from({ length: MAX_HERO_SHOTS }, (): HeroShot => ({
    alive: false, x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, dmg: 0, crit: false, life: 0,
    pierce: 0, splash: 0, kind: 'arrow', rarity: 0, hits: [],
  }));

  readonly hero: Hero = {
    x: MAP_W / 2, y: MAP_H / 2, prevX: MAP_W / 2, prevY: MAP_H / 2,
    hp: 0, maxHp: 0, atkCd: 0, swingT: 0, swingAngle: 0, hitT: 0, faceX: 1, moving: false,
  };

  /** Player input. moveX/moveY: joystick/keys (length ≤ 1). Target: click-to-move. */
  readonly input = { moveX: 0, moveY: 0, targetX: 0, targetY: 0, hasTarget: false, idleT: 99 };

  // Derived stats, recomputed only when upgrades or the equipped weapon change.
  atk = 0;
  aspd = 0;
  crit = 0;
  critMult = CRIT_MULT;
  goldMult = 0;
  range = 22;
  arc = 1.25;
  knockback = 1;
  lifesteal = 0;
  shock = 0;
  /** The current hero's class modifiers (see skins.ts). */
  cls: ClassMods = {};
  /** Projectile of the equipped weapon, if it is ranged. */
  ranged: RangedDef | null = null;
  /** Bumped whenever the inventory/equipped weapon changes, so the UI can redraw lazily. */
  invVersion = 0;
  moveSpeed = HERO_SPEED;
  shardMult = 1;
  /** +damage/+gold multiplier from achievement tiers. */
  achBonus = 1;
  /** Messages for the HUD (quest complete, achievement unlocked). Drained by the UI. */
  readonly notices: string[] = [];
  readonly missions = new MissionSystem(this);
  private metaT = 0;

  // Rolling window of recent earnings: 60 buckets × 5 s = the last 5 minutes of play.
  private readonly earnGold = new Float64Array(RATE_BUCKETS);
  private readonly earnShards = new Float64Array(RATE_BUCKETS);
  private earnIdx = 0;
  private earnFilled = 0;
  private bucketT = 0;
  private bucketGold = 0;
  private bucketShards = 0;

  // Stuck recovery for the hero: if movement stalls, sidestep briefly and pick another target.
  private stuckT = 0;
  private detourT = 0;
  /** Tap-to-move progress: closest distance to the target so far, and time since it improved. */
  private targetBest = Infinity;
  private targetStall = 0;
  private detourX = 0;
  private detourY = 0;
  private ignore: Enemy | null = null;
  private ignoreT = 0;

  private readonly sepHead = new Int16Array(SEP_COLS * SEP_ROWS);
  private readonly sepNext = new Int16Array(MAX_ENEMIES);

  constructor(save: SaveData = freshSave(), seed?: number) {
    this.save = save;
    this.rng = new Rng(seed ?? (Date.now() & 0xffffffff));
    for (let i = 0; i < MAX_ENEMIES; i++) {
      this.enemies.push({
        alive: false, monster: 0, area: 0, boss: false, elite: false, style: 0, windT: 0, dashT: 0, dirX: 0, dirY: 0, dashHit: false, skillCd: 0, x: 0, y: 0, prevX: 0, prevY: 0, kx: 0, ky: 0, radius: 5,
        hp: 0, maxHp: 0, dmg: 0, speed: 0, atkInterval: 1, atkCd: 0, gold: 0, aggro: false,
        wanderA: 0, wanderT: 0, spawnT: 0, chasing: false, stuckT: 0, detourT: 0, detourA: 0, hitT: 0, lungeT: 0, seed: 0,
        terr: -1, homeX: 0, homeY: 0, homeR: 0, stage: 1,
      });
    }
    save.stage = zoneStage(save.zone);
    this.map = new GameMap(zoneArea(save.zone), save.zone);
    this.placeHeroAtSpawn();
    this.knownMaxZone = this.maxZone;
    // Quests already claimable when the game opens aren't announced again.
    for (const k of this.claimableQuestKeys()) this.notifiedQuests.add(k);
    this.recalc();
    this.hero.hp = this.hero.maxHp;
  }

  // --- Queries used by the UI ----------------------------------------------

  get stage(): number { return this.save.stage; }
  get gold(): number { return this.save.gold; }
  get area(): number { return this.map.area; }
  /** True during a boss fight. */
  get isBossStage(): boolean { return this.bossActive; }
  get zone(): number { return this.save.zone; }

  /** Can the hero travel to `zone`? Needs its level, and every earlier zone's boss beaten. */
  zoneUnlocked(zone: number): boolean {
    if (zone <= 0) return zone === 0;
    if (zone >= PLAYABLE_ZONES) return false; // the other terrains are still to come
    return zone <= this.save.zoneBosses && this.save.level >= zoneLevel(zone);
  }

  /** The furthest zone the hero can travel to. */
  get maxZone(): number {
    let z = 0;
    while (this.zoneUnlocked(z + 1)) z++;
    return z;
  }

  /** Has the current zone's boss been beaten (at least once)? */
  get zoneBossBeaten(): boolean { return this.save.zone < this.save.zoneBosses; }

  monsterDef(e: Enemy): MonsterDef {
    const { def } = areaFor(e.area);
    return e.monster === 3 ? def.boss : def.monsters[e.monster];
  }

  /** How many levels the current buy mode would purchase, and what it costs. */
  quote(id: UpgradeId): { count: number; cost: number } {
    const def = UPGRADES[id];
    const lvl = this.save.upgrades[id];
    const room = def.maxLevel - lvl;
    if (room <= 0) return { count: 0, cost: Infinity };
    const mode = this.save.buyMode;
    const count = mode === 'max' ? Math.max(1, maxAffordable(def, lvl, this.save.gold)) : Math.min(mode, room);
    return { count, cost: upgradeCost(def, lvl, count) };
  }

  // --- Commands ------------------------------------------------------------

  buy(id: UpgradeId): boolean {
    const { count, cost } = this.quote(id);
    if (count <= 0 || cost > this.save.gold) return false;
    this.save.gold -= cost;
    this.save.upgrades[id] += count;
    const prevMax = this.hero.maxHp;
    this.recalc();
    if (this.phase !== 'dead') this.hero.hp += this.hero.maxHp - prevMax;
    return true;
  }

  setBuyMode(mode: BuyMode): void { this.save.buyMode = mode; }
  setAuto(on: boolean): void { this.save.auto = on; }

  /** Joystick / keyboard direction (any length; clamped to 1). Pass 0,0 to release. */
  setMove(x: number, y: number): void {
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    this.input.moveX = x * k;
    this.input.moveY = y * k;
    if (len > 0) { this.input.hasTarget = false; this.input.idleT = 0; this.route.length = 0; }
  }

  /** Click / tap-to-move destination in world coordinates. */
  moveTo(x: number, y: number): void {
    // A tap on a tree, rock or cactus aims at a spot the hero can't stand on; walk to its edge
    // instead (a few passes, so a spot between two touching props ends up outside both).
    const t = { x, y };
    for (let i = 0; i < 4; i++) this.map.resolve(t, HERO_RADIUS + 0.5);
    this.input.targetX = t.x;
    this.input.targetY = t.y;
    this.input.hasTarget = true;
    this.route.length = 0;
    this.input.idleT = 0;
    this.targetBest = Infinity;
    this.targetStall = 0;
  }

  /** Step into the current zone's boss arena. Bosses can be fought (and re-fought) any time. */
  /**
   * Fight this zone's boss. A first attempt can be retried freely; a beaten boss can only be
   * rematched once its cooldown (bossCooldown) has passed, and each rematch starts it again.
   * Returns false if the fight didn't start. `now` is wall-clock ms (cooldowns survive restarts).
   */
  challengeBoss(now = this.clock()): boolean {
    if (this.bossActive || this.phase !== 'playing' || this.returnT > 0) return false;
    const z = this.save.zone;
    const lair = this.map.forest?.lairs.find((l) => l.zone === z);
    if (lair) {
      if (this.zoneBossBeaten && this.bossCooldownLeft(now) > 0) return false;
      this.moveTo(lair.x, lair.y);
      return true;
    }
    if (this.zoneBossBeaten) {
      if (this.bossCooldownLeft(now) > 0) return false;
      this.save.bossReady[z] = now + bossCooldown(z) * 1000;
    }
    this.map = new GameMap(zoneArea(z), z, true);
    this.resetField();
    this.startBoss();
    return true;
  }

  /** Seconds until this zone's beaten boss can be rematched (0 = now, or not beaten yet). */
  bossCooldownLeft(now = this.clock()): number {
    if (!this.zoneBossBeaten) return 0;
    const at = this.save.bossReady[this.save.zone] ?? 0;
    // A clock moved backwards can't trap the player: never more than the full cooldown.
    return Math.min(bossCooldown(this.save.zone), Math.max(0, (at - now) / 1000));
  }

  /** Travel to an unlocked zone (not during a boss fight). */
  travel(zone: number): boolean {
    if (!this.zoneUnlocked(zone) || this.bossActive || this.phase !== 'playing') return false;
    const s = this.save;
    s.zone = zone;
    s.stage = zoneStage(zone);
    this.returnT = 0;
    this.enterZoneMap(true);
    return true;
  }

  /** The forest region (biome) the hero is in: -1 off the forest. */
  biome = -1;

  /** Fast travel to a forest region (its tier must be open). */
  travelTo(biome: number): boolean {
    const f = this.map.forest, b = BIOMES[biome];
    if (!f || !b || !this.zoneUnlocked(b.zone) || this.bossActive || this.phase !== 'playing') return false;
    const s = this.save;
    s.zone = b.zone;
    s.stage = zoneStage(b.zone);
    this.returnT = 0;
    this.route.length = 0;
    this.resetField();
    const p = biomeArrival(biome);
    this.hero.x = this.hero.prevX = p.x;
    this.hero.y = this.hero.prevY = p.y;
    this.events.push(Ev.AreaEnter, 0, 0, b.zone);
    return true;
  }

  /** Waypoints the hero is walking along (World Map "go there"); empty when not. */
  readonly route: { x: number; y: number }[] = [];
  private routeBest = Infinity;
  private routeStall = 0;
  private routeSkips = 0;

  /**
   * Walk to a spot picked on the World Map (a monster haunt, a boss lair), following the trails
   * through open passes; stops `keepOut` short (outside a lair, so the boss only rises when the
   * hero steps in). False if the region is closed or there's no way there.
   */
  walkToSpot(x: number, y: number, keepOut = 0): boolean {
    const f = this.map.forest, b = forestRegion(x, y);
    if (!f || b < 0 || !this.zoneUnlocked(BIOMES[b].zone) || this.bossActive || this.phase !== 'playing') return false;
    // Barricades judged by the same rule that opens them (a pass opening this moment counts).
    const pts = forestRoute(this.map, this.hero.x, this.hero.y, x, y, (z) => this.zoneUnlocked(z), keepOut);
    if (!pts) return false;
    this.route.length = 0;
    this.route.push(...pts);
    this.input.hasTarget = false;
    this.input.moveX = this.input.moveY = 0;
    this.input.idleT = 0;
    this.routeBest = Infinity;
    this.routeStall = 0;
    this.routeSkips = 0;
    return true;
  }

  /** Seconds until a zone's beaten boss rises again (0: ready, or not beaten yet). */
  lairCooldownLeft(zone: number, now = this.clock()): number {
    if (zone >= this.save.zoneBosses) return 0;
    const at = this.save.bossReady[zone] ?? 0;
    return Math.min(bossCooldown(zone), Math.max(0, (at - now) / 1000));
  }

  /** The forest region the hero stands in (or the current zone on the old maps). */
  private trackRegion(): void {
    const f = this.map.forest;
    if (!f) { this.biome = -1; return; }
    const b = forestRegion(this.hero.x, this.hero.y);
    const z = forestZone(this.hero.x, this.hero.y);
    const s = this.save;
    if (b >= 0 && b !== this.biome) {
      // Into another region: announced by name (not on the very first look around).
      if (this.biome >= 0) this.events.push(Ev.RegionEnter, this.hero.x, this.hero.y, b);
      this.biome = b;
    }
    if (z >= 0 && z !== s.zone) {
      s.zone = z;
      s.stage = zoneStage(z);
    }
    // Passes open once their region is unlocked (level + the previous region's boss).
    for (const g of f.gates) {
      const open = this.zoneUnlocked(g.zone);
      if (open !== this.map.openGates.has(g.zone)) {
        if (open) { this.map.openGates.add(g.zone); this.events.push(Ev.GateOpen, g.x, g.y, g.zone); }
        else this.map.openGates.delete(g.zone);
      }
      // Standing at a closed pass: say what it takes, now and then.
      if (!open && Math.hypot(this.hero.x - g.x, this.hero.y - g.y) < 70 && this.time > this.gateHintT) {
        this.gateHintT = this.time + 6;
        const lvl = zoneLevel(g.zone), boss = zoneBossName(g.zone - 1);
        const parts = [this.save.level < lvl ? `reach Lv ${lvl}` : '', this.save.zoneBosses < g.zone ? `defeat the ${boss}` : ''].filter(Boolean);
        this.notices.push(`The way to ${zoneName(g.zone)} is blocked: ${parts.join(' and ')}`);
      }
    }
  }
  private gateHintT = 0;

  /** Forest fog of war (null off the forest). */
  explored: Explored | null = null;
  private explore(): void {
    const map = this.map;
    if (!map.forest) return;
    if (!this.explored) this.explored = new Explored(map.w, map.h, this.save.explored);
    if (this.explored.reveal(this.hero.x, this.hero.y)) this.save.explored = this.explored.toString();
  }

  /** Forest boss lairs: walking into the current region's lair calls up its boss. */
  private updateLair(): void {
    const f = this.map.forest;
    if (!f || this.phase !== 'playing') return;
    const z = this.save.zone;
    const lair = f.lairs.find((l) => l.zone === z);
    if (!lair) return;
    const h = this.hero;
    const d = Math.hypot(h.x - lair.x, h.y - lair.y);
    if (this.bossActive) {
      if (d > lair.r + 150) this.abandonBoss(); // ran off: the boss returns to its lair
      return;
    }
    if (d > lair.r * 0.75) return;
    const now = this.clock();
    if (this.zoneBossBeaten) {
      const left = this.bossCooldownLeft(now);
      if (left > 0) return; // still recovering: a countdown floats over the lair (render/scene.ts)
      this.save.bossReady[z] = now + bossCooldown(z) * 1000;
    }
    // One on one: the lair's surroundings are cleared, then the boss rises at its heart.
    for (const e of this.enemies) if (e.alive && Math.hypot(e.x - lair.x, e.y - lair.y) < lair.r + 80) e.alive = false;
    this.bossActive = true;
    this.bossT = BOSS_TIME;
    const b = this.enemies.find((e) => !e.alive) ?? this.enemies[0];
    const boss = zoneBoss(z);
    this.setEnemy(b, boss.slot, true, lair.x, lair.y - lair.r * 0.3, false, zoneStage(z), boss.area);
    b.homeX = lair.x; b.homeY = lair.y; b.homeR = lair.r;
    this.events.push(Ev.BossSpawn);
  }

  /** The hero left the lair mid-fight: the boss goes back to waiting (no penalty). */
  private abandonBoss(): void {
    for (const e of this.enemies) if (e.alive && e.boss) e.alive = false;
    this.bossActive = false;
    this.events.push(Ev.BossFail);
  }

  /** Forest territories: keep each nearby territory stocked; let far-away ones empty out. */
  private readonly terrT: number[] = [];
  private spawnTerritories(dt: number): void {
    const f = this.map.forest!;
    const h = this.hero;
    const alive = new Array<number>(f.territories.length).fill(0);
    for (const e of this.enemies) {
      if (!e.alive || e.terr < 0) continue;
      const t = f.territories[e.terr];
      // Far from the hero and not chasing: tidy away (the territory restocks when he returns).
      if (!e.aggro && Math.hypot(e.x - h.x, e.y - h.y) > 520 && Math.hypot(t.x - h.x, t.y - h.y) > t.r + 420) { e.alive = false; continue; }
      alive[e.terr]++;
    }
    f.territories.forEach((t, i) => {
      if (Math.hypot(t.x - h.x, t.y - h.y) > t.r + 380) return; // only near the hero
      this.terrT[i] = (this.terrT[i] ?? 0) - dt;
      if (alive[i] >= t.count || this.terrT[i] > 0) return;
      const slot = this.enemies.find((e) => !e.alive);
      if (!slot) return;
      const pos = this.territoryPoint(t);
      if (!pos) return;
      // Restock quickly when nearly empty (or the hero isn't looking), steadily otherwise.
      this.terrT[i] = alive[i] < t.count / 2 ? 0.35 : 1.4;
      const elite = t.zone > 0 ? this.rng.chance(0.03 + 0.02 * t.zone) : this.rng.chance(0.01);
      this.setEnemy(slot, t.monster, false, pos.x, pos.y, elite, zoneStage(t.zone), t.area);
      slot.terr = i; slot.homeX = t.x; slot.homeY = t.y; slot.homeR = t.r;
    });
  }

  /** A free spot inside territory `t`, not right next to the hero. */
  private territoryPoint(t: Territory): { x: number; y: number } | null {
    for (let k = 0; k < 10; k++) {
      const a = this.rng.range(0, Math.PI * 2), d = Math.sqrt(this.rng.next()) * t.r;
      const x = t.x + Math.cos(a) * d, y = t.y + Math.sin(a) * d;
      if (this.map.blocked(x, y, 7) || Math.hypot(x - this.hero.x, y - this.hero.y) < 70) continue;
      this.tmpPoint.x = x; this.tmpPoint.y = y;
      return this.tmpPoint;
    }
    return null;
  }

  /** Put the hero at the current region's arrival point (forest) or the map's centre. */
  private placeHeroAtSpawn(): void {
    const h = this.hero, sp = this.map.forest?.spawns[Math.min(this.save.zone, this.map.forest.spawns.length - 1)];
    h.x = h.prevX = sp ? sp.x : this.map.w / 2;
    h.y = h.prevY = sp ? sp.y : this.map.h / 2;
  }

  // --- Simulation ----------------------------------------------------------

  recalc(): void {
    const u = this.save.upgrades;
    const w = weaponStats(this.save.equipped);
    const p = this.save.perks;
    let tiers = 0;
    for (const id in this.save.achievements) tiers += this.save.achievements[id];
    this.achBonus = (1 + tiers * ACH_BONUS_PER_TIER) * (1 + RQ.MASTERY_BONUS * RQ.masteredRegions(this.save.regions));
    const swift = 1 + 0.04 * p.swift;
    const glow = this.save.embersEarned;
    const lb = levelBonus(this.save.level);
    const c = this.cls = skinDef(this.save.skin).mods;
    this.atk = this.attackWith(this.save.equipped);
    this.hero.maxHp = UPGRADES.hp.value(u.hp) * (1 + 0.25 * p.vigor) * (1 + GLOW_HP * glow) * lb.hp * (c.hp ?? 1);
    this.aspd = UPGRADES.aspd.value(u.aspd) * w.form.speed * (1 + w.speed) * swift * (c.aspd ?? 1);
    this.moveSpeed = HERO_SPEED * swift * (c.move ?? 1);
    this.shardMult = (1 + 0.15 * p.shards) * (1 + (c.shards ?? 0));
    this.crit = Math.min(0.9, UPGRADES.crit.value(u.crit) + w.crit + (c.crit ?? 0));
    this.critMult = CRIT_MULT + w.critDmg + (c.critDmg ?? 0);
    this.goldMult = UPGRADES.gold.value(u.gold) * (1 + w.gold + (c.gold ?? 0)) * (1 + 0.2 * p.fortune) * this.achBonus * lb.gold;
    this.range = w.form.range * (1 + w.reach);
    this.arc = w.form.arc * (c.arc ?? 1);
    this.knockback = w.form.knockback;
    this.lifesteal = w.lifesteal;
    this.shock = Math.min(0.6, w.shock + (c.shock ?? 0));
    this.ranged = w.form.ranged ?? null;
  }

  /** Hero attack if `weapon` were equipped (everything else unchanged). Used for previews. */
  attackWith(weapon: Weapon | null): number {
    const s = this.save, p = s.perks, w = weaponStats(weapon);
    let tiers = 0;
    for (const id in s.achievements) tiers += s.achievements[id];
    const ach = (1 + tiers * ACH_BONUS_PER_TIER) * (1 + RQ.MASTERY_BONUS * RQ.masteredRegions(s.regions));
    return UPGRADES.atk.value(s.upgrades.atk) * w.mult * w.form.dmg * (1 + 0.25 * p.might) * ach
      * (1 + GLOW_DMG * s.embersEarned) * levelBonus(s.level).atk * forgeAtkBonus(s.forgeLevel) * (skinDef(s.skin).mods.dmg ?? 1);
  }

  // --- Forge ---------------------------------------------------------------

  freeSlots(): number {
    let n = 0;
    for (const w of this.save.weapons) if (!w) n++;
    return n;
  }

  /** Forge up to `count` weapons (limited by shards and free slots). Returns the slots filled. */
  forge(count = 1): number[] {
    const s = this.save;
    const filled: number[] = [];
    const cost = forgeCost(s.forgeLevel);
    for (let n = 0; n < count && s.shards >= cost; n++) {
      const slot = s.weapons.indexOf(null);
      if (slot < 0) break;
      s.shards -= cost;
      const w = forgeWeapon(this.rng, s.nextWeaponId++, s.forgeLevel, skinDef(s.skin).forms);
      s.weapons[slot] = w;
      s.stats.forged++;
      if (w.rarity === 3) s.stats.legendaries++;
      filled.push(slot);
    }
    if (filled.length) this.invVersion++;
    return filled;
  }

  /**
   * Merge the weapon in `into` with mergeCount - 1 matching weapons (same type, tier and
   * rarity) into one of the next tier, which lands in `into`. Uses `withSlots` if given (and
   * valid), otherwise picks partners automatically. Returns false if there aren't enough matches.
   */
  merge(into: number, withSlots?: number[]): boolean {
    const s = this.save;
    const keep = s.weapons[into];
    if (!keep) return false;
    const partners = mergePartners(s.weapons, into);
    const need = mergeCount(keep.rarity) - 1;
    const use = withSlots ?? partners.slice(0, need);
    if (use.length !== need || new Set(use).size !== use.length || use.some((i) => !partners.includes(i))) return false;
    const m = mergeWeapons(this.rng, s.nextWeaponId++, keep, use.map((i) => s.weapons[i]!));
    s.weapons[into] = m;
    for (const i of use) s.weapons[i] = null;
    s.stats.merges++;
    if (m.rarity === 3 && keep.rarity < 3) s.stats.legendaries++;
    this.invVersion++;
    return true;
  }

  /**
   * Upgrade the equipped weapon: merge it with mergeCount - 1 matching inventory weapons. The
   * result stays equipped. Returns false if there aren't enough matches.
   */
  mergeEquipped(): boolean {
    const s = this.save;
    const eq = s.equipped;
    if (!eq) return false;
    const need = mergeCount(eq.rarity) - 1;
    const use = matchingSlots(s.weapons, eq).slice(0, need);
    if (use.length < need) return false;
    const m = mergeWeapons(this.rng, s.nextWeaponId++, eq, use.map((i) => s.weapons[i]!));
    s.equipped = m;
    for (const i of use) s.weapons[i] = null;
    s.stats.merges++;
    if (m.rarity === 3 && eq.rarity < 3) s.stats.legendaries++;
    this.applyWeaponChange();
    return true;
  }

  /**
   * Repeatedly merge every group of mergeCount matching weapons (same type, tier and rarity),
   * lowest tiers first, so results can merge again. Returns the slots holding merged weapons.
   */
  autoMerge(): number[] {
    const s = this.save;
    const results: number[] = [];
    for (let changed = true; changed;) {
      changed = false;
      const groups = new Map<number, number[]>(); // key orders by tier, then rarity, then form
      s.weapons.forEach((w, i) => {
        if (!w) return;
        const key = w.rarity * 16 + w.form; // lowest rarity first, so results can merge again
        const list = groups.get(key);
        if (list) list.push(i); else groups.set(key, [i]);
      });
      for (const key of [...groups.keys()].sort((x, y) => x - y)) {
        const slots = groups.get(key)!;
        const n = mergeCount(Math.floor(key / 16));
        if (slots.length < n) continue;
        const [into, ...rest] = slots.slice(0, n);
        if (this.merge(into, rest)) {
          for (const r of rest) { const at = results.indexOf(r); if (at >= 0) results.splice(at, 1); }
          if (!results.includes(into)) results.push(into);
          changed = true;
          break;
        }
      }
    }
    return results;
  }

  /**
   * Sort the inventory (type, tier, rarity; empties last). Returns where each weapon id ended up,
   * so callers can keep a selection or highlight on the same weapons.
   */
  sortInventory(): Map<number, number> {
    const s = this.save;
    const list = s.weapons.filter((w): w is Weapon => w !== null).sort(compareWeapons);
    const changed = list.some((w, i) => s.weapons[i] !== w);
    s.weapons = [...list, ...Array(s.weapons.length - list.length).fill(null)];
    if (changed) this.invVersion++;
    return new Map(list.map((w, i) => [w.id, i]));
  }

  /** Can the current hero wield `w`? (Weapons are class-locked.) */
  canWield(w: Weapon): boolean { return canWield(this.save.skin, w.form); }

  /** Swap the weapon in `slot` with the equipped one (only weapons the current hero can wield). */
  equip(slot: number): boolean {
    const s = this.save;
    const w = s.weapons[slot];
    if (!w || !this.canWield(w)) return false;
    s.weapons[slot] = s.equipped;
    s.equipped = w;
    this.applyWeaponChange();
    return true;
  }

  salvage(slot: number): number {
    const s = this.save;
    const w = s.weapons[slot];
    if (!w) return 0;
    const value = salvageValue(w, s.forgeLevel);
    s.weapons[slot] = null;
    s.shards += value;
    this.invVersion++;
    return value;
  }

  /** Buy one more row of inventory slots with gold. Permanent (kept through Reforge). */
  expandInventory(): boolean {
    const s = this.save;
    const size = s.weapons.length;
    if (size >= MAX_INVENTORY) return false;
    const cost = inventoryExpandCost(size);
    if (s.gold < cost) return false;
    s.gold -= cost;
    s.weapons = [...s.weapons, ...Array(Math.min(INVENTORY_STEP, MAX_INVENTORY - size)).fill(null)];
    this.invVersion++;
    return true;
  }

  upgradeForge(): boolean {
    const s = this.save;
    if (s.forgeLevel >= forgeLevelCap(this.maxZone)) return false;
    const cost = forgeUpgradeCost(s.forgeLevel);
    if (s.gold < cost) return false;
    s.gold -= cost;
    s.forgeLevel++;
    this.recalc(); // forge mastery raises weapon attack
    this.invVersion++;
    return true;
  }

  private applyWeaponChange(): void {
    const frac = this.hero.maxHp > 0 ? this.hero.hp / this.hero.maxHp : 1;
    this.recalc();
    this.hero.hp = this.hero.maxHp * frac;
    this.invVersion++;
  }

  /** Advance one fixed step of TICK seconds. */
  tick(): void {
    const dt = TICK;
    this.trackEarnings(dt);
    this.save.stats.play += dt;
    this.metaT += dt;
    if (this.metaT >= 0.5) { this.metaT = 0; this.checkMeta(); }
    this.time += dt;
    const h = this.hero;
    h.prevX = h.x; h.prevY = h.y;
    h.swingT = Math.max(0, h.swingT - dt);
    h.hitT = Math.max(0, h.hitT - dt);
    h.atkCd -= dt;

    if (this.phase === 'dead') {
      for (const e of this.enemies) { e.prevX = e.x; e.prevY = e.y; }
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.respawn();
      return;
    }

    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * (HERO_REGEN + (this.cls.regen ?? 0)) * dt);
    this.moveHero(dt);
    this.trackRegion();
    this.explore();
    this.updateLair();
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updateHeroShots(dt);
    this.heroAttack();
    this.spawn(dt);

    if (this.returnT > 0) {
      this.returnT -= dt;
      if (this.returnT <= 0) this.enterZoneMap(false);
    }
    if (this.bossActive) {
      this.bossT -= dt;
      if (this.bossT <= 0) return this.failBoss(false);
    }
    if (h.hp <= 0) this.heroDied();
  }

  // --- Meta: quests, achievements, perks, reforge -------------------------------

  statValue(k: AchStat): number {
    const s = this.save;
    if (k === 'kills') return s.kills;
    if (k === 'bestEver') return s.bestEver;
    if (k === 'zones') return s.zoneBest + 1;
    return s.stats[k];
  }

  // --- Region quests (the Quest Book) ---

  private exploreCache: { ver: number; ex: Explored | null; pct: number[] } | null = null;

  /** Percent of each zone's region explored (cached until the fog changes). */
  explorePercents(): number[] {
    if (!this.explored && this.map.forest) this.explored = new Explored(this.map.w, this.map.h, this.save.explored);
    const ex = this.explored, ver = ex?.version ?? -1;
    if (!this.exploreCache || this.exploreCache.ex !== ex || this.exploreCache.ver !== ver) {
      this.exploreCache = { ver, ex, pct: RQ.explorePercents(ex) };
    }
    return this.exploreCache.pct;
  }

  /** A region's quests can be claimed once it has been opened. */
  regionOpen(zone: number): boolean {
    return zone >= 0 && zone < PLAYABLE_ZONES && zone <= this.save.zoneBest;
  }

  /** Current value of quest `qi` in `zone`. */
  regionQuestValue(zone: number, qi: number): number {
    const q = RQ.regionQuests(zone)[qi];
    return q ? RQ.questValue(q, this.save.regions[zone], this.explorePercents()[zone]) : 0;
  }

  canClaimRegionQuest(zone: number, qi: number): boolean {
    if (!this.regionOpen(zone)) return false;
    const q = RQ.regionQuests(zone)[qi], tier = this.save.regions[zone].claimed[qi];
    return !!q && tier < q.tiers.length && this.regionQuestValue(zone, qi) >= q.tiers[tier];
  }

  /** Claim the next tier of a region quest: one star, gold, shards (and gems on the last tier). */
  claimRegionQuest(zone: number, qi: number): Reward | null {
    if (!this.canClaimRegionQuest(zone, qi)) return null;
    const r = this.save.regions[zone];
    const reward = RQ.tierReward(zone, r.claimed[qi]);
    r.claimed[qi]++;
    this.save.stats.quests++;
    this.missions.apply(reward);
    return reward;
  }

  canClaimRegionMilestone(zone: number, i: number): boolean {
    const r = this.save.regions[zone];
    return this.regionOpen(zone) && i === r.milestones && i < RQ.MILESTONES.length && RQ.regionStars(r) >= RQ.MILESTONES[i].stars;
  }

  claimRegionMilestone(zone: number, i: number): Reward | null {
    if (!this.canClaimRegionMilestone(zone, i)) return null;
    const m = RQ.milestoneReward(zone, i);
    this.save.regions[zone].milestones++;
    this.missions.apply(m.reward);
    if (m.mastery) {
      this.recalc();
      this.notices.push(`👑 ${RQ.regionName(zone)} mastered! +${Math.round(RQ.MASTERY_BONUS * 100)}% dmg & gold`);
    }
    return m.reward;
  }

  /** Claimable quest tiers and milestones in a zone's region. */
  regionClaimable(zone: number): number {
    let n = 0;
    for (let qi = 0; qi < RQ.QUESTS_PER_REGION; qi++) if (this.canClaimRegionQuest(zone, qi)) n++;
    if (this.canClaimRegionMilestone(zone, this.save.regions[zone].milestones)) n++;
    return n;
  }

  /** Everything claimable in the Quest Book (the Quests button's badge). */
  questBadge(): number {
    let n = 0;
    for (let z = 0; z < PLAYABLE_ZONES; z++) n += this.regionClaimable(z);
    return n;
  }

  /** Record a kill in its region's quest progress. */
  private recordRegionKill(e: Enemy): void {
    if (!this.map.forest) return;
    const zone = e.boss ? this.save.zone : forestZone(e.x, e.y);
    const r = this.save.regions[zone];
    if (!r) return;
    if (e.boss) { r.bosses++; return; }
    if (e.elite) r.elites++;
    const slot = RQ.huntSlot(zone, e.area, e.monster);
    if (slot >= 0) r.hunt[slot]++;
  }

  private *claimableQuestKeys(): Generator<string> {
    for (let z = 0; z < PLAYABLE_ZONES; z++) {
      if (!this.regionOpen(z)) continue;
      const r = this.save.regions[z];
      for (let qi = 0; qi < RQ.QUESTS_PER_REGION; qi++) if (this.canClaimRegionQuest(z, qi)) yield `${z}:${qi}:${r.claimed[qi]}`;
      if (this.canClaimRegionMilestone(z, r.milestones)) yield `${z}:m:${r.milestones}`;
    }
  }

  private readonly notifiedQuests = new Set<string>();

  /** Unlock achievement tiers and announce finished quests (runs twice a second). */
  private checkMeta(): void {
    const s = this.save;
    let changed = false;
    for (const a of ACHIEVEMENTS) {
      let tier = s.achievements[a.id] ?? 0;
      const v = this.statValue(a.stat);
      while (tier < a.tiers.length && v >= a.tiers[tier]) {
        tier++;
        changed = true;
        this.notices.push(`🏆 ${a.name} ${ROMAN[tier]} · +${Math.round(ACH_BONUS_PER_TIER * 100)}% dmg & gold`);
      }
      s.achievements[a.id] = tier;
    }
    if (changed) this.recalc();
    for (const k of this.claimableQuestKeys()) {
      if (this.notifiedQuests.has(k)) continue;
      this.notifiedQuests.add(k);
      const [z, q] = k.split(':');
      const zone = Number(z);
      const what = q === 'm' ? 'Milestone reached' : `Quest done: ${RQ.regionQuests(zone)[Number(q)].name}`;
      this.notices.push(`📜 ${what} · ${RQ.regionName(zone)}. Claim it in Quests`);
    }
  }

  perkQuote(id: PerkId): number {
    const def = PERKS[id];
    const lvl = this.save.perks[id];
    return lvl >= def.maxLevel ? Infinity : perkCost(def, lvl);
  }

  buyPerk(id: PerkId): boolean {
    const cost = this.perkQuote(id);
    if (cost > this.save.embers) return false;
    this.save.embers -= cost;
    this.save.perks[id]++;
    const prevMax = this.hero.maxHp;
    this.recalc();
    if (this.phase !== 'dead') this.hero.hp += this.hero.maxHp - prevMax;
    return true;
  }

  get reforgeGain(): number {
    // The furthest zone open this run counts even if highestStage lagged (it only updates on a
    // boss win; a zone can also open later by levelling up past its level gate).
    return embersFor(Math.max(this.save.highestStage, zoneStage(this.maxZone)));
  }

  /** Offline cap including the Night Watch perk. */
  get offlineCapHours(): number {
    return OFFLINE_CAP_HOURS + this.save.perks.offline;
  }

  /**
   * Prestige: bank embers for this run's best stage, then restart. Keeps embers, perks,
   * achievements, lifetime stats and settings; resets stage, gold, shards, upgrades and weapons.
   */
  // --- Hero skins (cosmetic) ------------------------------------------------------------

  ownsSkin(id: string): boolean { return this.save.skins.includes(id); }

  /**
   * First launch: start as one of the STARTERS. It becomes the only hero owned (the other two wait
   * in the Heroes screen with the rest), with its own starter weapon. Only once per save.
   */
  chooseStarter(id: string): boolean {
    const s = this.save;
    if (s.starterChosen || !STARTERS.includes(id)) return false;
    s.skins = [id];
    s.skin = id;
    s.gear = {};
    s.equipped = starterWeapon(skinDef(id).forms[0], s.nextWeaponId++);
    s.starterChosen = true;
    for (const sh of this.heroShots) sh.alive = false;
    this.applyWeaponChange();
    return true;
  }

  /** Buy a skin with gems. Returns false if already owned, unknown or unaffordable. */
  buySkin(id: string): boolean {
    const def = SKINS.find((s) => s.id === id);
    const m = this.save.missions;
    if (!def || this.ownsSkin(id) || m.gems < def.cost || this.save.level < (def.minLevel ?? 0)) return false;
    m.gems -= def.cost;
    this.save.skins.push(id);
    this.save.gear[id] = starterWeapon(def.forms[0], this.save.nextWeaponId++);
    this.selectSkin(id);
    return true;
  }

  /** Choose a colour scheme for an owned hero: 0 = its own, 1-3 = the alternates (cosmetic). */
  setPalette(skin: string, n: number): boolean {
    if (!this.ownsSkin(skin) || !skinDef(skin).palette || !Number.isInteger(n) || n < 0 || n > 3) return false;
    this.save.palettes[skin] = n;
    return true;
  }

  /** Choose a style for an owned hero (cosmetic). */
  setLook(skin: string, look: string): boolean {
    if (!this.ownsSkin(skin) || !skinDef(skin).looks?.some((l) => l.id === look)) return false;
    this.save.looks[skin] = look;
    return true;
  }

  /** Play as an owned hero: the current hero's weapon is put away and the new hero's comes out. */
  selectSkin(id: string): boolean {
    const s = this.save;
    if (!this.ownsSkin(id)) return false;
    if (id === s.skin) return true;
    s.gear[s.skin] = s.equipped;
    s.skin = id;
    const mine = s.gear[id];
    delete s.gear[id];
    s.equipped = mine && canWield(id, mine.form) ? mine : starterWeapon(skinDef(id).forms[0], s.nextWeaponId++);
    for (const sh of this.heroShots) sh.alive = false;
    this.applyWeaponChange();
    return true;
  }

  reforge(): number {
    const gain = this.reforgeGain;
    if (gain <= 0) return 0;
    const s = this.save;
    s.embers += gain;
    s.embersEarned += gain;
    s.stats.reforges++;
    // Back to the start of the map at hero level 1 (Head Start begins higher, with the zone
    // bosses up to that level already beaten).
    s.level = Math.min(MAX_LEVEL, 1 + s.perks.headstart * 5);
    s.xp = 0;
    let beaten = 0;
    while (zoneLevel(beaten + 1) <= s.level) beaten++;
    s.zoneBosses = beaten;
    s.zone = this.maxZone;
    s.stage = zoneStage(s.zone);
    s.highestStage = s.stage;
    s.farming = false;
    s.gold = 0;
    s.shards = 0;
    for (const id of UPGRADE_IDS) s.upgrades[id] = 0;
    s.weapons = s.weapons.map(() => null);
    s.equipped = starterWeapon(skinDef(s.skin).forms[0], s.nextWeaponId++);
    s.gear = {};
    s.forgeLevel = Math.min(MAX_FORGE_LEVEL, 1 + s.perks.forgemaster);
    this.bossActive = false;
    this.returnT = 0;
    this.phase = 'playing';
    this.recalc();
    this.knownMaxZone = this.maxZone;
    this.enterZoneMap(true);
    this.checkMeta();
    this.invVersion++;
    return gain;
  }

  private trackEarnings(dt: number): void {
    this.bucketT += dt;
    if (this.bucketT < RATE_BUCKET_SECONDS) return;
    this.earnGold[this.earnIdx] = this.bucketGold;
    this.earnShards[this.earnIdx] = this.bucketShards;
    this.earnIdx = (this.earnIdx + 1) % RATE_BUCKETS;
    this.earnFilled = Math.min(RATE_BUCKETS, this.earnFilled + 1);
    this.bucketT -= RATE_BUCKET_SECONDS;
    this.bucketGold = this.bucketShards = 0;
    // Need at least a minute of data before trusting the live rate over the saved one.
    if (this.earnFilled >= 12) {
      let g = 0, sh = 0;
      for (let i = 0; i < this.earnFilled; i++) { g += this.earnGold[i]; sh += this.earnShards[i]; }
      const secs = this.earnFilled * RATE_BUCKET_SECONDS;
      this.save.rates.gold = g / secs;
      this.save.rates.shards = sh / secs;
    }
  }

  /** Advance by real seconds (used for short catch-up after tab switches). */
  advance(seconds: number, maxSteps = 30 * 60): void {
    const steps = Math.min(maxSteps, Math.floor(seconds / TICK));
    for (let i = 0; i < steps; i++) this.tick();
  }

  private moveHero(dt: number): void {
    const h = this.hero, inp = this.input;
    let vx = 0, vy = 0;
    let target: Enemy | null = null;
    this.ignoreT -= dt;
    const manual = inp.moveX !== 0 || inp.moveY !== 0;
    if (manual) {
      vx = inp.moveX; vy = inp.moveY;
      this.detourT = 0;
    } else if (this.detourT > 0) {
      this.detourT -= dt;
      vx = this.detourX; vy = this.detourY;
    } else if (this.route.length && this.phase === 'playing' && !this.bossActive) {
      // Walking a World Map route: on to the next waypoint (passed when close). Gives up if it
      // stops getting anywhere for a few seconds.
      let w = this.route[0];
      let d = Math.hypot(w.x - h.x, w.y - h.y);
      if (d < (this.route.length > 1 ? 18 : 6)) {
        this.route.shift();
        this.routeBest = Infinity;
        w = this.route[0];
        d = w ? Math.hypot(w.x - h.x, w.y - h.y) : 0;
      }
      if (w) {
        // A waypoint it can't get any closer to (a trail point on rocks by a pass): skip on to
        // the next one; several in a row and the walk is given up.
        if (d < this.routeBest - 1) { this.routeBest = d; this.routeStall = 0; this.routeSkips = 0; }
        else if ((this.routeStall += dt) > 0.8) {
          this.routeStall = 0;
          this.routeBest = Infinity;
          if (this.route.length > 1 && this.routeSkips++ < 4) this.route.shift();
          else this.route.length = 0;
        }
        if (d > 0) { vx = (w.x - h.x) / d; vy = (w.y - h.y) / d; }
      }
      inp.idleT = 0;
    } else if (inp.hasTarget) {
      const dx = inp.targetX - h.x, dy = inp.targetY - h.y;
      const d = Math.hypot(dx, dy);
      // Give up when the target stops getting closer (blocked by props), instead of shuffling
      // back and forth against an obstacle forever.
      if (d < this.targetBest - 0.5) { this.targetBest = d; this.targetStall = 0; }
      else this.targetStall += dt;
      if (d < 3 || this.targetStall > 0.6) inp.hasTarget = false;
      else { vx = dx / d; vy = dy / d; }
    } else {
      inp.idleT += dt;
      if (this.save.auto && inp.idleT > AUTO_IDLE_DELAY) {
        // Auto-hunt: walk toward the nearest enemy until it's comfortably in reach. In the forest,
        // only monsters in the hero's own region (not across a cliff); with none about, head for
        // the nearest of the region's territories.
        const f = this.map.forest;
        const e = this.nearestEnemy(f ? 420 : Infinity, this.ignoreT > 0 ? this.ignore : null, f ? this.biome : -1);
        target = e;
        if (e) {
          const dx = e.x - h.x, dy = e.y - h.y;
          const d = Math.hypot(dx, dy);
          // Ranged heroes keep their distance: shoot from just outside a monster's notice range.
          if (d > HERO_RADIUS + e.radius + this.range * (this.ranged ? 0.8 : 0.6)) { vx = dx / d; vy = dy / d; }
        } else if (f) {
          let best: Territory | null = null, bd = Infinity;
          for (const t of f.territories) {
            if (t.biome !== this.biome) continue; // only this region's (the borders are walls)
            const d = Math.hypot(t.x - h.x, t.y - h.y);
            if (d > t.r * 0.5 && d < bd) { bd = d; best = t; }
          }
          if (best) { vx = (best.x - h.x) / bd; vy = (best.y - h.y) / bd; }
        }
      }
    }
    h.moving = vx !== 0 || vy !== 0;
    if (h.moving) {
      const mag = Math.min(1, Math.hypot(vx, vy)); // joystick can request partial speed
      this.map.steer(h.x, h.y, HERO_RADIUS, vx / (mag || 1), vy / (mag || 1), this.steerOut);
      vx = this.steerOut.x * mag; vy = this.steerOut.y * mag;
      const sx = h.x, sy = h.y;
      h.x += vx * this.moveSpeed * dt;
      h.y += vy * this.moveSpeed * dt;
      if (Math.abs(vx) > 0.15 && h.swingT <= 0) h.faceX = vx > 0 ? 1 : -1;
      this.map.resolve(h, HERO_RADIUS);

      // Stuck detection (automatic movement only; a player steering can see and fix it).
      if (!manual && this.detourT <= 0) {
        const moved = Math.hypot(h.x - sx, h.y - sy);
        this.stuckT = moved < mag * this.moveSpeed * dt * 0.3 ? this.stuckT + dt : Math.max(0, this.stuckT - dt);
        if (this.stuckT > 0.35) {
          this.stuckT = 0;
          const side = this.rng.chance(0.5) ? 1 : -1;
          this.detourX = -vy * side; this.detourY = vx * side;
          this.detourT = 0.5;
          if (target) { this.ignore = target; this.ignoreT = 3; }
        }
      }
    } else {
      this.stuckT = 0;
    }
  }

  private nearestEnemy(maxEdgeDist: number, skip: Enemy | null = null, region = -1): Enemy | null {
    const h = this.hero;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = this.enemies[i];
      if (!e.alive || e.spawnT > 0 || e === skip) continue;
      if (region >= 0 && forestRegion(e.x, e.y) !== region) continue;
      const d = Math.hypot(e.x - h.x, e.y - h.y) - e.radius - HERO_RADIUS;
      if (d < bestD && d <= maxEdgeDist) { bestD = d; best = e; }
    }
    return best;
  }

  /** Damage multiplier from the Berserker's rage (more as HP drops). */
  private rageMult(): number {
    const r = this.cls.rage ?? 0, h = this.hero;
    return r > 0 && h.maxHp > 0 ? 1 + r * Math.max(0, 1 - h.hp / h.maxHp) : 1;
  }

  private heroAttack(): void {
    const h = this.hero;
    if (h.atkCd > 0) return;
    const target = this.nearestEnemy(this.range);
    if (!target) { h.atkCd = 0; return; }

    h.atkCd = 1 / this.aspd;
    h.swingT = 0.22;
    const ang = Math.atan2(target.y - h.y, target.x - h.x);
    h.swingAngle = ang;
    h.faceX = Math.cos(ang) >= 0 ? 1 : -1;
    this.events.push(Ev.Swing, h.x, h.y, ang, this.ranged ? 1 : 0);

    const isCrit = this.rng.chance(this.crit);
    const dmg = this.atk * this.rageMult() * (isCrit ? this.critMult : 1);

    if (this.ranged) {
      const r = this.ranged, n = r.pellets ?? 1;
      // A shotgun blast fans its pellets out; together they hit harder than one shot (up close).
      for (let k = 0; k < n; k++) this.fire(ang + (n > 1 ? (k / (n - 1) - 0.5) * (r.spread ?? 0) : 0), n > 1 ? (dmg / n) * 2 : dmg, isCrit, r);
      return;
    }

    let dealt = 0;
    // Cone sweep: everything in reach and within the arc gets hit.
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = this.enemies[i];
      if (!e.alive || e.spawnT > 0) continue;
      const dx = e.x - h.x, dy = e.y - h.y;
      const d = Math.hypot(dx, dy);
      if (d - e.radius - HERO_RADIUS > this.range) continue;
      let da = Math.atan2(dy, dx) - ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > this.arc && d > e.radius + HERO_RADIUS + 2) continue;
      dealt += this.strike(e, dmg, isCrit, dx / (d || 1), dy / (d || 1), 1);
    }
    if (this.shock > 0 && this.rng.chance(this.shock)) dealt += this.chainShock(target, dmg);
    if (this.lifesteal > 0 && dealt > 0) h.hp = Math.min(h.maxHp, h.hp + dealt * this.lifesteal);
  }

  /**
   * Hit one enemy for `dmg` (an Assassin's ambush turns a hit on an unhurt enemy into a crit),
   * knocking it along (nx, ny). Returns the damage actually dealt.
   */
  private strike(e: Enemy, dmg: number, crit: boolean, nx: number, ny: number, kbScale: number): number {
    if (!crit && this.cls.ambush && e.hp >= e.maxHp) { dmg *= this.critMult; crit = true; }
    const dealt = Math.min(dmg, Math.max(0, e.hp));
    e.hp -= dmg;
    e.hitT = 0.12;
    e.aggro = true;
    const kb = (e.boss ? 25 : 90) * this.knockback * kbScale;
    e.kx += nx * kb;
    e.ky += ny * kb;
    this.events.push(Ev.Hit, e.x, e.y - e.radius * 2 - 4, dmg, crit ? 1 : 0);
    if (e.hp <= 0) this.kill(e);
    return dealt;
  }

  /** Chain shock: arcs from `from` to nearby enemies (3, or more for the Mage) for 60% damage. */
  private chainShock(from: Enemy, dmg: number): number {
    let dealt = 0;
    let fromX = from.x, fromY = from.y;
    const jumps = 3 + (this.cls.shockJumps ?? 0);
    for (let jump = 0; jump < jumps; jump++) {
      let next: Enemy | null = null;
      let best = 60;
      for (let i = 0; i < MAX_ENEMIES; i++) {
        const e = this.enemies[i];
        if (!e.alive || e.spawnT > 0 || e === from || e.hitT > 0.11) continue;
        const d = Math.hypot(e.x - fromX, e.y - fromY);
        if (d < best) { best = d; next = e; }
      }
      if (!next) break;
      const zap = dmg * 0.6;
      dealt += Math.min(zap, Math.max(0, next.hp));
      next.hp -= zap;
      next.hitT = 0.12;
      next.aggro = true;
      this.events.push(Ev.Shock, next.x, next.y - next.radius, zap, 0, fromX, fromY - 6);
      this.events.push(Ev.Hit, next.x, next.y - next.radius * 2 - 4, zap, 2);
      fromX = next.x; fromY = next.y;
      if (next.hp <= 0) this.kill(next);
    }
    return dealt;
  }

  /** Loose a projectile from the hero along `ang`. */
  private fire(ang: number, dmg: number, crit: boolean, r: RangedDef): void {
    const sh = this.heroShots.find((x) => !x.alive);
    if (!sh) return;
    const h = this.hero;
    sh.alive = true;
    sh.x = sh.prevX = h.x + Math.cos(ang) * 6;
    sh.y = sh.prevY = h.y + Math.sin(ang) * 6;
    sh.vx = Math.cos(ang) * r.speed;
    sh.vy = Math.sin(ang) * r.speed;
    sh.dmg = dmg;
    sh.crit = crit;
    sh.life = (this.range * 1.25 + 20) / r.speed;
    sh.pierce = r.pierce + (this.cls.pierce ?? 0);
    sh.splash = r.splash;
    sh.kind = r.kind;
    sh.rarity = this.save.equipped?.rarity ?? 0;
    sh.hits.length = 0;
  }

  private updateHeroShots(dt: number): void {
    for (const sh of this.heroShots) {
      if (!sh.alive) continue;
      sh.prevX = sh.x; sh.prevY = sh.y;
      sh.x += sh.vx * dt; sh.y += sh.vy * dt;
      sh.life -= dt;
      if (sh.life <= 0) { sh.alive = false; continue; }
      for (let i = 0; i < MAX_ENEMIES && sh.alive; i++) {
        const e = this.enemies[i];
        if (!e.alive || e.spawnT > 0 || sh.hits.includes(e)) continue;
        if (Math.hypot(e.x - sh.x, e.y - sh.y) > e.radius + 4) continue;
        this.shotHit(sh, e);
      }
    }
  }

  private shotHit(sh: HeroShot, e: Enemy): void {
    const sp = Math.hypot(sh.vx, sh.vy) || 1;
    sh.hits.push(e);
    let dealt = this.strike(e, sh.dmg, sh.crit, sh.vx / sp, sh.vy / sp, 0.6);
    if (sh.splash > 0) {
      // Magic orbs burst: everything else nearby takes half damage.
      this.events.push(Ev.Burst, sh.x, sh.y, sh.splash, sh.rarity);
      for (let i = 0; i < MAX_ENEMIES; i++) {
        const o = this.enemies[i];
        if (o === e || !o.alive || o.spawnT > 0) continue;
        const dx = o.x - sh.x, dy = o.y - sh.y, d = Math.hypot(dx, dy);
        if (d > sh.splash + o.radius) continue;
        dealt += this.strike(o, sh.dmg * 0.5, false, dx / (d || 1), dy / (d || 1), 0.4);
      }
    }
    if (this.shock > 0 && this.rng.chance(this.shock)) dealt += this.chainShock(e, sh.dmg);
    if (this.lifesteal > 0 && dealt > 0) this.hero.hp = Math.min(this.hero.maxHp, this.hero.hp + dealt * this.lifesteal);
    if (sh.pierce > 0) sh.pierce--;
    else sh.alive = false;
  }

  private updateEnemies(dt: number): void {
    const h = this.hero;
    const head = this.sepHead, next = this.sepNext;
    head.fill(-1);

    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = this.enemies[i];
      // Stuck check on last tick's displacement, before prev is overwritten.
      if (e.alive && e.chasing && e.detourT <= 0) {
        const moved = Math.hypot(e.x - e.prevX, e.y - e.prevY);
        e.stuckT = moved < e.speed * dt * 0.2 ? e.stuckT + dt : Math.max(0, e.stuckT - dt);
        if (e.stuckT > 0.5) {
          e.stuckT = 0;
          e.detourT = 0.6;
          e.detourA = Math.atan2(h.y - e.y, h.x - e.x) + (this.rng.chance(0.5) ? 1.6 : -1.6);
        }
      }
      e.chasing = false;
      e.prevX = e.x; e.prevY = e.y;
      if (!e.alive) continue;
      e.hitT = Math.max(0, e.hitT - dt);
      e.lungeT = Math.max(0, e.lungeT - dt);
      if (e.spawnT > 0) { e.spawnT -= dt; continue; }

      const dx = h.x - e.x, dy = h.y - e.y;
      const d = Math.hypot(dx, dy) || 0.001;
      // Forest monsters only take on a hero in their own region (not across a rock wall).
      const home = e.terr >= 0 && this.map.forest ? this.map.forest.territories[e.terr] : null;
      const sameRegion = !home || home.biome === this.biome;
      if (!e.aggro && sameRegion && (d < (e.terr >= 0 ? 72 : 120) || e.boss)) e.aggro = true;
      // Territory monsters chase only so far from home, then head back (healed).
      if (e.aggro && e.terr >= 0 && (!sameRegion || Math.hypot(e.x - e.homeX, e.y - e.homeY) > e.homeR + 170 || d > 240)) {
        // (No instant heal: one stuck against rocks far from home could otherwise never die.)
        e.aggro = false; e.windT = 0; e.dashT = 0;
      }
      // Calm territory monsters recover quickly (a lost chase heals them up on the way home).
      if (!e.aggro && e.terr >= 0 && e.hp < e.maxHp && e.hitT <= 0) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.2 * dt);

      const reach = HERO_RADIUS + e.radius + 2;
      if (e.aggro && e.windT > 0) {
        // Winding up: stand still (the renderer shows the tell), then let it rip.
        e.windT -= dt;
        if (e.windT <= 0) this.releaseSkill(e, d);
      } else if (e.aggro && e.dashT > 0) {
        e.dashT -= dt;
        e.x += e.dirX * e.speed * DASH_SPEED * dt;
        e.y += e.dirY * e.speed * DASH_SPEED * dt;
        if (!e.dashHit && d <= reach + 2) {
          e.dashHit = true;
          this.hurtHero(e.dmg * 1.3);
        }
      } else if (e.aggro) {
        e.skillCd -= dt;
        if (this.startSkill(e, d, reach)) {
          // wind-up started
        } else if (e.detourT > 0) {
          e.detourT -= dt;
          e.x += Math.cos(e.detourA) * e.speed * dt;
          e.y += Math.sin(e.detourA) * e.speed * dt;
        } else if (e.style === STYLE_SPITTER && d < SPIT_KEEP && d > reach) {
          // Spitters back off to their preferred range.
          this.map.steer(e.x, e.y, e.radius, -dx / d, -dy / d, this.steerOut);
          e.x += this.steerOut.x * e.speed * 0.8 * dt;
          e.y += this.steerOut.y * e.speed * 0.8 * dt;
        } else if (e.style === STYLE_SPITTER && d < SPIT_RANGE * 0.8 && d > reach) {
          // In range: circle the hero slowly while the next shot loads.
          const side = e.seed > Math.PI ? 1 : -1;
          e.x += (-dy / d) * side * e.speed * 0.35 * dt;
          e.y += (dx / d) * side * e.speed * 0.35 * dt;
        } else if (d > reach) {
          e.chasing = true;
          this.map.steer(e.x, e.y, e.radius, dx / d, dy / d, this.steerOut);
          e.x += this.steerOut.x * e.speed * dt;
          e.y += this.steerOut.y * e.speed * dt;
        } else {
          e.atkCd -= dt;
          if (e.atkCd <= 0) {
            e.atkCd = e.atkInterval;
            e.lungeT = 0.18;
            this.hurtHero(e.dmg);
          }
        }
      } else {
        e.wanderT -= dt;
        if (e.wanderT <= 0) {
          e.wanderT = this.rng.range(1, 3);
          // Wander, but drift back toward home when outside the territory.
          const away = e.terr >= 0 ? Math.hypot(e.x - e.homeX, e.y - e.homeY) : 0;
          e.wanderA = away > e.homeR * 0.8 ? Math.atan2(e.homeY - e.y, e.homeX - e.x) + this.rng.range(-0.5, 0.5) : this.rng.range(0, Math.PI * 2);
        }
        const home = e.terr >= 0 && Math.hypot(e.x - e.homeX, e.y - e.homeY) > e.homeR;
        const k = home ? 0.8 : 0.3;
        this.map.steer(e.x, e.y, e.radius, Math.cos(e.wanderA), Math.sin(e.wanderA), this.steerOut);
        e.x += this.steerOut.x * e.speed * k * dt;
        e.y += this.steerOut.y * e.speed * k * dt;
      }

      // Knockback decays quickly.
      e.x += e.kx * dt; e.y += e.ky * dt;
      const damp = Math.max(0, 1 - 10 * dt);
      e.kx *= damp; e.ky *= damp;

      const cell = this.sepCell(e.x, e.y);
      next[i] = head[cell];
      head[cell] = i;
    }

    // Separation: push overlapping enemies apart (checks the 3×3 neighbourhood only).
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = this.enemies[i];
      if (!e.alive || e.spawnT > 0) continue;
      const cx = Math.floor(e.x / SEP_CELL), cy = Math.floor(e.y / SEP_CELL);
      for (let oy = -1; oy <= 1; oy++) {
        const ry = cy + oy;
        if (ry < 0 || ry >= SEP_ROWS) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const rx = cx + ox;
          if (rx < 0 || rx >= SEP_COLS) continue;
          for (let j = head[ry * SEP_COLS + rx]; j !== -1; j = next[j]) {
            if (j <= i) continue;
            const o = this.enemies[j];
            const sx = o.x - e.x, sy = o.y - e.y;
            const min = e.radius + o.radius;
            const d2 = sx * sx + sy * sy;
            if (d2 >= min * min || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const push = (min - d) * 0.5;
            const wE = e.boss ? 0.1 : o.boss ? 0.9 : 0.5; // bosses barely budge
            e.x -= (sx / d) * push * 2 * wE; e.y -= (sy / d) * push * 2 * wE;
            o.x += (sx / d) * push * 2 * (1 - wE); o.y += (sy / d) * push * 2 * (1 - wE);
          }
        }
      }
      this.map.resolve(e, e.radius);
    }
  }

  private hurtHero(dmg: number): void {
    const h = this.hero;
    dmg *= this.cls.dmgTaken ?? 1;
    h.hp -= dmg;
    h.hitT = 0.15;
    this.events.push(Ev.HeroHit, h.x, h.y - 18, dmg);
  }

  /** Maybe begin a skill wind-up. Returns true if one started. */
  private startSkill(e: Enemy, d: number, reach: number): boolean {
    if (e.skillCd > 0) return false;
    const h = this.hero;
    if (e.boss) {
      if (d > SLAM_RADIUS + 10) return false;
      e.windT = SLAM_WIND;
      e.skillCd = this.rng.range(4.5, 6.5);
      this.events.push(Ev.Telegraph, e.x, e.y, SLAM_RADIUS, 1);
      return true;
    }
    if (e.style === STYLE_DASHER) {
      if (d > DASH_RANGE || d < reach + 6) return false;
      e.windT = DASH_WIND;
      e.dirX = (h.x - e.x) / d; e.dirY = (h.y - e.y) / d;
      e.skillCd = this.rng.range(2.6, 3.8);
      this.events.push(Ev.Telegraph, e.x, e.y, 0, 0);
      return true;
    }
    if (e.style === STYLE_SPITTER) {
      if (d > SPIT_RANGE || d < reach) return false;
      e.windT = SPIT_WIND;
      e.skillCd = this.rng.range(1.9, 2.8);
      return true;
    }
    return false;
  }

  /** The wind-up finished: dash, spit or slam. */
  private releaseSkill(e: Enemy, d: number): void {
    const h = this.hero;
    if (e.boss) {
      this.events.push(Ev.Slam, e.x, e.y, SLAM_RADIUS);
      if (d <= SLAM_RADIUS + HERO_RADIUS) this.hurtHero(e.dmg * 1.2);
    } else if (e.style === STYLE_DASHER) {
      e.dashT = DASH_TIME;
      e.dashHit = false;
    } else if (e.style === STYLE_SPITTER) {
      const shot = this.shots.find((s) => !s.alive);
      if (!shot) return;
      // Aim where the hero is now; moving players can sidestep.
      const ax = h.x - e.x, ay = h.y - 4 - e.y, len = Math.hypot(ax, ay) || 1;
      shot.alive = true;
      shot.x = shot.prevX = e.x; shot.y = shot.prevY = e.y - 4;
      shot.vx = (ax / len) * SPIT_SPEED; shot.vy = (ay / len) * SPIT_SPEED;
      shot.dmg = e.dmg * 0.9;
      shot.life = SPIT_RANGE * 1.4 / SPIT_SPEED;
      shot.monster = e.monster;
      e.lungeT = 0.18;
      this.events.push(Ev.Shoot, e.x, e.y);
    }
  }

  private updateShots(dt: number): void {
    const h = this.hero;
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.prevX = s.x; s.prevY = s.y;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.life -= dt;
      if (Math.hypot(s.x - h.x, s.y - (h.y - 4)) < HERO_RADIUS + 2.5) {
        s.alive = false;
        if (this.phase === 'playing') this.hurtHero(s.dmg);
        continue;
      }
      if (s.life <= 0 || this.map.blocked(s.x, s.y + 4, 1)) {
        s.alive = false;
        this.events.push(Ev.ShotPop, s.x, s.y);
      }
    }
  }

  private sepCell(x: number, y: number): number {
    const c = Math.max(0, Math.min(SEP_COLS - 1, Math.floor(x / SEP_CELL)));
    const r = Math.max(0, Math.min(SEP_ROWS - 1, Math.floor(y / SEP_CELL)));
    return r * SEP_COLS + c;
  }

  private spawn(dt: number): void {
    if (this.bossActive || this.returnT > 0) return; // boss fights are one-on-one
    if (this.map.forest) { this.spawnTerritories(dt); return; }
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    let alive = 0;
    for (const e of this.enemies) if (e.alive) alive++;
    const cap = maxAlive(this.save.stage);
    if (alive >= cap) return;
    // Refill quickly when the field is sparse, steadily otherwise.
    this.spawnT = alive < cap / 2 ? 0.12 : 0.45;
    let slot: Enemy | null = null;
    for (let i = 0; i < MAX_ENEMIES && !slot; i++) if (!this.enemies[i].alive) slot = this.enemies[i];
    if (!slot) return;

    // Deeper zones of a terrain bring in more of its tougher monsters.
    const s = 1 + (this.save.zone % 3) * 4;
    const p0 = Math.max(0.25, 0.7 - s * 0.05);
    const p2 = Math.min(0.4, s * 0.045);
    const r = this.rng.next();
    const monster = r < p0 ? 0 : r < 1 - p2 ? 1 : 2;

    const pos = this.findSpawnPoint(130, 230);
    if (!pos) return;
    // Elites: a few in every zone past the first, more in a terrain's deeper zones.
    const elite = this.save.zone > 0 && this.rng.chance(0.03 + 0.004 * s);
    this.setEnemy(slot, monster, false, pos.x, pos.y, elite);
  }

  private readonly tmpPoint = { x: 0, y: 0 };
  private readonly steerOut = { x: 0, y: 0 };
  private findSpawnPoint(minD: number, maxD: number): { x: number; y: number } | null {
    const h = this.hero;
    for (let t = 0; t < 12; t++) {
      const a = this.rng.range(0, Math.PI * 2), d = this.rng.range(minD, maxD);
      const x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a) * d;
      if (this.map.blocked(x, y, 7)) continue;
      this.tmpPoint.x = x; this.tmpPoint.y = y;
      return this.tmpPoint;
    }
    return null;
  }

  private setEnemy(e: Enemy, monster: number, boss: boolean, x: number, y: number, elite = false, stage = this.save.stage, area = this.map.area): void {
    const { def } = areaFor(area);
    e.area = area;
    const m = monster === 3 ? def.boss : def.monsters[monster];
    e.stage = stage;
    e.terr = -1; e.homeX = x; e.homeY = y; e.homeR = 0;
    // Champions (zone bosses that are a big version of a regular monster) are a bit softer.
    const champ = boss && monster !== 3 ? 0.65 : 1;
    e.alive = true;
    e.monster = monster;
    e.boss = boss;
    e.x = e.prevX = x; e.y = e.prevY = y;
    e.kx = e.ky = 0;
    e.radius = boss ? (monster === 3 ? BOSS.radius : 10) : m.radius;
    const power = stagePower(stage);
    e.maxHp = e.hp = enemyHp(stage) * power.hp * m.hp * (boss ? BOSS.hp * champ : 1);
    e.dmg = enemyDmg(stage) * power.dmg * m.dmg * (boss ? BOSS.dmg * champ : 1);
    e.speed = boss ? BOSS.speed : m.speed * this.rng.range(0.9, 1.1);
    e.atkInterval = boss ? BOSS.atkInterval : m.atkInterval;
    e.atkCd = e.atkInterval * 0.6;
    e.gold = enemyGold(stage) * m.gold * (boss ? BOSS.gold : 1);
    e.elite = elite;
    e.style = boss ? STYLE_MELEE : STYLE_CODE[m.style];
    if (elite) {
      e.maxHp = e.hp = e.maxHp * ELITE.hp;
      e.dmg *= ELITE.dmg;
      e.gold *= ELITE.gold;
      e.radius += ELITE.radius;
    }
    e.windT = 0; e.dashT = 0; e.dashHit = false;
    e.skillCd = this.rng.range(1, 2.5);
    e.aggro = boss;
    e.wanderT = 0;
    e.spawnT = 0.35;
    e.chasing = false; e.stuckT = 0; e.detourT = 0;
    e.hitT = 0; e.lungeT = 0;
    e.seed = this.rng.range(0, Math.PI * 2);
    this.events.push(Ev.Spawn, x, y, boss ? 1 : 0);
  }

  private kill(e: Enemy): void {
    e.alive = false;
    const gold = e.gold * this.goldMult;
    this.save.gold += gold;
    this.bucketGold += gold;
    this.save.stats.gold += gold;
    this.save.kills++;
    this.events.push(Ev.Kill, e.x, e.y, gold, e.boss ? 1 : 0);
    this.missions.recordKill(e.area, e.monster);
    this.recordRegionKill(e);
    if (e.elite) this.save.stats.elites++;
    this.gainXp(xpForKill(e.stage, e.boss));

    // Shards for the forge: bosses always drop a bundle, regular monsters sometimes drop one.
    const per = 1 + Math.floor(e.stage / 12);
    const raw = (e.boss ? 10 * per : e.elite ? 3 * per : this.rng.chance(0.1) ? per : 0) * this.shardMult;
    // Random rounding keeps fractional bonuses fair over time.
    const shards = Math.floor(raw) + (this.rng.chance(raw % 1) ? 1 : 0);
    if (shards > 0) {
      this.save.shards += shards;
      this.bucketShards += shards;
      this.events.push(Ev.Shard, e.x, e.y, shards);
    }

    if (e.boss) {
      const s = this.save;
      this.bossActive = false;
      s.stats.bosses++;
      if (s.zone === s.zoneBosses) {
        // First win here: a big bonus, and the way to the next zone opens (level permitting).
        s.zoneBosses++;
        const bonus = { gold: enemyGold(s.stage) * 150, shards: 15 * per, gems: 10 };
        this.missions.apply(bonus);
        this.events.push(Ev.ZoneClear, e.x, e.y, s.zone);
        this.updateReach();
      }
      if (!this.map.forest) this.returnT = 2.2; // the old arenas send you back; the forest carries on
      // In the forest the boss recovers in its lair before a rematch (even after the first win).
      else s.bossReady[s.zone] = Math.max(s.bossReady[s.zone] ?? 0, this.clock() + bossCooldown(s.zone) * 1000);
    }
  }

  /** Track the furthest unlocked zone; announce a newly opened one. */
  private updateReach(): void {
    const s = this.save, z = this.maxZone;
    if (z > s.zoneBest) s.zoneBest = z;
    s.highestStage = Math.max(s.highestStage, zoneStage(z));
    if (s.highestStage > s.bestEver) s.bestEver = s.highestStage;
    if (z > this.knownMaxZone) {
      this.knownMaxZone = z;
      this.events.push(Ev.ZoneUnlock, 0, 0, z);
      this.notices.push(`New zone unlocked: ${zoneName(z)}! Open the 🗺 Map`);
    }
  }

  // --- Hero level ----------------------------------------------------------

  /** XP needed for the next level (Infinity at the cap). */
  get xpNeeded(): number { return xpToNext(this.save.level); }

  gainXp(amount: number): void {
    const s = this.save;
    if (s.level >= MAX_LEVEL) return;
    s.xp += amount;
    let ups = 0;
    while (s.level < MAX_LEVEL && s.xp >= xpToNext(s.level)) {
      s.xp -= xpToNext(s.level);
      s.level++;
      ups++;
    }
    if (!ups) return;
    if (s.level >= MAX_LEVEL) s.xp = 0;
    const before = this.hero.maxHp;
    this.recalc();
    // Level-ups heal you fully: a small reward you feel immediately.
    this.hero.hp = Math.max(this.hero.hp + (this.hero.maxHp - before), this.hero.maxHp);
    this.events.push(Ev.LevelUp, this.hero.x, this.hero.y, s.level);
    this.updateReach();
    if (MILESTONES.some((m) => m > s.level - ups && m <= s.level)) this.notices.push('Level reward ready! Tap your level');
  }

  /** Milestones reached but not yet claimed. */
  levelRewardsReady(): number {
    return MILESTONES.filter((m) => m <= this.save.level && !this.save.levelClaimed.includes(m)).length;
  }

  /** The reward milestone `level` would give right now (it scales with your best stage). */
  levelReward(level: number): MilestoneReward {
    return milestoneReward(level, this.save.bestEver);
  }

  /**
   * Claim a Level Road milestone. Returns the reward, 'full' if a weapon reward needs a free
   * inventory slot, or null if it isn't claimable.
   */
  /**
   * Claim every Level Road milestone that is ready (tapping any ready one), lowest first. Bonus
   * weapons need free slots: stops at the first that doesn't fit ('full' if none could be claimed).
   */
  claimReadyLevelRewards(): { reward: MilestoneReward; weapons: number[] } | 'full' | null {
    let total: MilestoneReward | null = null;
    const weapons: number[] = [];
    for (const lv of MILESTONES) {
      if (lv > this.save.level || this.save.levelClaimed.includes(lv)) continue;
      const r = this.claimLevelReward(lv);
      if (r === 'full') return total ? { reward: total, weapons } : 'full';
      if (!r) continue;
      if (r.weapon) weapons.push(r.weapon.rarity);
      const { weapon: _w, ...rest } = r;
      total = total ? addRewards(total, rest) : rest;
    }
    return total ? { reward: total, weapons } : null;
  }

  claimLevelReward(level: number): MilestoneReward | 'full' | null {
    const s = this.save;
    if (!MILESTONES.includes(level) || level > s.level || s.levelClaimed.includes(level)) return null;
    const r = this.levelReward(level);
    if (r.weapon) {
      const slot = s.weapons.indexOf(null);
      if (slot < 0) return 'full';
      s.weapons[slot] = bonusWeapon(this.rng, s.nextWeaponId++, s.forgeLevel, r.weapon.rarity, skinDef(s.skin).forms);
      this.invVersion++;
      this.sortInventory();
    }
    s.levelClaimed.push(level);
    this.missions.apply(r);
    return r;
  }

  /** Clear the field and put the hero back in the map's open centre. */
  private resetField(): void {
    this.clearEnemies();
    const h = this.hero;
    this.placeHeroAtSpawn();
    h.hp = h.maxHp;
    this.input.hasTarget = false;
    this.spawnT = 1;
  }

  /** Build the current zone's (field) map. `announce` shows the zone's name banner. */
  private enterZoneMap(announce: boolean): void {
    const z = this.save.zone;
    // The forest is one map for all its zones: keep it (and its opened passes).
    if (!(this.map.forest && zoneArea(z) === this.map.area)) this.map = new GameMap(zoneArea(z), z);
    this.resetField();
    if (announce) this.events.push(Ev.AreaEnter, 0, 0, z);
  }

  private startBoss(): void {
    // Clear the field and drop the boss in a little way off from the hero.
    this.clearEnemies();
    this.bossActive = true;
    this.bossT = BOSS_TIME;
    const h = this.hero;
    let x = h.x + 70, y = h.y;
    const p = this.findSpawnPoint(60, 90);
    if (p) { x = p.x; y = p.y; }
    const boss = zoneBoss(this.save.zone);
    this.setEnemy(this.enemies[0], boss.slot, true, x, y, false, this.save.stage, boss.area);
    this.events.push(Ev.BossSpawn);
  }

  private failBoss(died: boolean): void {
    this.events.push(Ev.BossFail);
    this.clearEnemies();
    this.bossActive = false;
    if (died) { this.phase = 'dead'; this.phaseT = 1.5; }
    else this.enterZoneMap(false);
  }

  private heroDied(): void {
    const h = this.hero;
    h.hp = 0;
    this.events.push(Ev.HeroDie, h.x, h.y);
    if (this.bossActive && !this.map.forest) return this.failBoss(true);
    if (this.bossActive) { this.abandonBoss(); this.phase = 'dead'; this.phaseT = 1.5; return; }
    this.phase = 'dead';
    this.phaseT = 1.5;
  }

  private respawn(): void {
    this.phase = 'playing';
    if (this.map.forest) this.resetField();
    else if (this.map.boss || this.map.zone !== this.save.zone) this.enterZoneMap(false);
    else this.resetField();
  }

  private clearEnemies(): void {
    for (const e of this.enemies) e.alive = false;
    for (const s of this.shots) s.alive = false;
    for (const s of this.heroShots) s.alive = false;
  }
}

export { UPGRADE_IDS };
