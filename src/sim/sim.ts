import { Rng } from '../core/rng';
import { areaFor, type MonsterDef } from './areas';
import {
  AUTO_IDLE_DELAY, BOSS, BOSS_TIME, CRIT_MULT, HERO_RADIUS, HERO_REGEN, HERO_SPEED,
  STAGES_PER_AREA, TICK, UPGRADES, UPGRADE_IDS,
  areaIndex, enemyDmg, enemyGold, enemyHp, isBossStage, killsForStage, maxAffordable, maxAlive, upgradeCost,
  type UpgradeId,
} from './balance';
import { Ev, EventQueue } from './events';
import {
  ACHIEVEMENTS, ACH_BONUS_PER_TIER, GLOW_DMG, GLOW_HP, PERKS, QUEST_SLOTS, ROMAN, embersFor, freshPerks, freshStats, makeQuest, perkCost,
  type AchStat, type PerkId, type Perks, type Quest, type QuestKind, type Stats,
} from './meta';
import { OFFLINE_CAP_HOURS } from './offline';
import { freshMissions, type MissionSave } from './missions';
import { MissionSystem } from './missionSystem';
import { GameMap, MAP_H, MAP_W } from './map';
import { Gatherer, freshMaterials, type Materials } from './gather';
import { MAX_LEVEL, levelBonus, milestoneReward, xpForKill, xpToNext, MILESTONES, type MilestoneReward } from './level';
import {
  FORGE_COST, INVENTORY_SIZE, MAX_FORGE_LEVEL, MERGE_COUNT, bonusWeapon, forgeUpgradeCost, forgeWeapon, mergePartners, mergeWeapons,
  salvageValue, starterWeapon, weaponStats, type Weapon,
} from './weapons';

export const MAX_ENEMIES = 40;
const RATE_BUCKETS = 60;
const RATE_BUCKET_SECONDS = 5;

export type BuyMode = 1 | 10 | 'max';

/** Everything that persists between sessions. Kept flat and JSON-friendly. */
export interface SaveData {
  v: 5;
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
  shards: number;
  forgeLevel: number;
  weapons: (Weapon | null)[];   // fixed-size inventory grid
  equipped: Weapon | null;
  nextWeaponId: number;
  // Meta progression (v3)
  embers: number;
  embersEarned: number;      // lifetime total, drives Ember Glow
  perks: Perks;
  bestEver: number;          // highest stage across all runs (highestStage is this run's best)
  stats: Stats;
  quests: Quest[];
  achievements: Record<string, number>; // tiers unlocked per achievement id
  // Engagement (v4): gems, login calendar, daily/weekly boards, 7-day journey, codex
  missions: MissionSave;
  // Hero level (v5): persists through Reforge.
  level: number;
  xp: number;                // progress toward the next level
  levelClaimed: number[];    // Level Road milestones already claimed (5, 10, …)
  // Building materials, gathered from the ground and by chopping trees/rocks. Kept through Reforge.
  materials: Materials;
  /** Recent earnings per second, used to pay out offline progress. */
  rates: { gold: number; shards: number };
  savedAt: number;
}

export function freshSave(): SaveData {
  return {
    v: 5, stage: 1, highestStage: 1, gold: 0, kills: 0, farming: false,
    upgrades: { atk: 0, hp: 0, aspd: 0, crit: 0, gold: 0 },
    buyMode: 1, fps: 60, auto: true, sound: true, quality: 'high',
    shards: 0, forgeLevel: 1, weapons: Array(INVENTORY_SIZE).fill(null), equipped: starterWeapon(), nextWeaponId: 2,
    rates: { gold: 0, shards: 0 },
    embers: 0, embersEarned: 0, perks: freshPerks(), bestEver: 1, stats: freshStats(), quests: [], achievements: {},
    missions: freshMissions(),
    level: 1, xp: 0, levelClaimed: [], materials: freshMaterials(),
    savedAt: Date.now(),
  };
}

export interface Enemy {
  alive: boolean;
  monster: number;   // index into the area roster (0..2), or 3 for the boss
  boss: boolean;
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
const SEP_COLS = Math.ceil(MAP_W / SEP_CELL);
const SEP_ROWS = Math.ceil(MAP_H / SEP_CELL);

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
  killsInStage = 0;
  time = 0;
  private spawnT = 0;

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
  /** Bumped whenever the inventory/equipped weapon changes, so the UI can redraw lazily. */
  invVersion = 0;
  moveSpeed = HERO_SPEED;
  shardMult = 1;
  /** +damage/+gold multiplier from achievement tiers. */
  achBonus = 1;
  /** Messages for the HUD (quest complete, achievement unlocked). Drained by the UI. */
  readonly notices: string[] = [];
  readonly missions = new MissionSystem(this);
  readonly gather = new Gatherer(this);
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
        alive: false, monster: 0, boss: false, x: 0, y: 0, prevX: 0, prevY: 0, kx: 0, ky: 0, radius: 5,
        hp: 0, maxHp: 0, dmg: 0, speed: 0, atkInterval: 1, atkCd: 0, gold: 0, aggro: false,
        wanderA: 0, wanderT: 0, spawnT: 0, chasing: false, stuckT: 0, detourT: 0, detourA: 0, hitT: 0, lungeT: 0, seed: 0,
      });
    }
    this.map = new GameMap(areaIndex(save.stage));
    this.gather.reset();
    this.fillQuests();
    this.recalc();
    this.hero.hp = this.hero.maxHp;
    if (isBossStage(save.stage) && !save.farming) this.startBoss();
  }

  // --- Queries used by the UI ----------------------------------------------

  get stage(): number { return this.save.stage; }
  get gold(): number { return this.save.gold; }
  get area(): number { return this.map.area; }
  get isBossStage(): boolean { return isBossStage(this.save.stage) && !this.save.farming; }
  get killsNeeded(): number { return killsForStage(this.save.stage); }

  monsterDef(e: Enemy): MonsterDef {
    const { def } = areaFor(this.map.area);
    return e.boss ? def.boss : def.monsters[e.monster];
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
    if (len > 0) { this.input.hasTarget = false; this.input.idleT = 0; }
  }

  /** Click / tap-to-move destination in world coordinates. */
  moveTo(x: number, y: number): void {
    this.input.targetX = x;
    this.input.targetY = y;
    this.input.hasTarget = true;
    this.input.idleT = 0;
  }

  /** Leave farming and go straight to the boss of the next stage. */
  challengeBoss(): void {
    if (!this.save.farming) return;
    this.save.farming = false;
    this.save.stage += 1;
    this.killsInStage = 0;
    this.hero.hp = this.hero.maxHp;
    if (isBossStage(this.save.stage)) this.startBoss();
  }

  // --- Simulation ----------------------------------------------------------

  recalc(): void {
    const u = this.save.upgrades;
    const w = weaponStats(this.save.equipped);
    const p = this.save.perks;
    let tiers = 0;
    for (const id in this.save.achievements) tiers += this.save.achievements[id];
    this.achBonus = 1 + tiers * ACH_BONUS_PER_TIER;
    const swift = 1 + 0.04 * p.swift;
    const glow = this.save.embersEarned;
    const lb = levelBonus(this.save.level);
    this.atk = this.attackWith(this.save.equipped);
    this.hero.maxHp = UPGRADES.hp.value(u.hp) * (1 + 0.25 * p.vigor) * (1 + GLOW_HP * glow) * lb.hp;
    this.aspd = UPGRADES.aspd.value(u.aspd) * w.form.speed * (1 + w.speed) * swift;
    this.moveSpeed = HERO_SPEED * swift;
    this.shardMult = 1 + 0.15 * p.shards;
    this.crit = Math.min(0.9, UPGRADES.crit.value(u.crit) + w.crit);
    this.critMult = CRIT_MULT + w.critDmg;
    this.goldMult = UPGRADES.gold.value(u.gold) * (1 + w.gold) * (1 + 0.2 * p.fortune) * this.achBonus * lb.gold;
    this.range = w.form.range * (1 + w.reach);
    this.arc = w.form.arc;
    this.knockback = w.form.knockback;
    this.lifesteal = w.lifesteal;
    this.shock = w.shock;
  }

  /** Hero attack if `weapon` were equipped (everything else unchanged). Used for previews. */
  attackWith(weapon: Weapon | null): number {
    const s = this.save, p = s.perks, w = weaponStats(weapon);
    let tiers = 0;
    for (const id in s.achievements) tiers += s.achievements[id];
    const ach = 1 + tiers * ACH_BONUS_PER_TIER;
    return UPGRADES.atk.value(s.upgrades.atk) * w.mult * w.form.dmg * (1 + 0.25 * p.might) * ach
      * (1 + GLOW_DMG * s.embersEarned) * levelBonus(s.level).atk;
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
    for (let n = 0; n < count && s.shards >= FORGE_COST; n++) {
      const slot = s.weapons.indexOf(null);
      if (slot < 0) break;
      s.shards -= FORGE_COST;
      const w = forgeWeapon(this.rng, s.nextWeaponId++, s.forgeLevel);
      s.weapons[slot] = w;
      s.stats.forged++;
      if (w.rarity === 3) s.stats.legendaries++;
      filled.push(slot);
    }
    if (filled.length) this.invVersion++;
    return filled;
  }

  /**
   * Merge the weapon in `into` with MERGE_COUNT - 1 matching weapons (same type, tier and
   * rarity) into one of the next tier, which lands in `into`. Uses `withSlots` if given (and
   * valid), otherwise picks partners automatically. Returns false if there aren't enough matches.
   */
  merge(into: number, withSlots?: number[]): boolean {
    const s = this.save;
    const keep = s.weapons[into];
    if (!keep) return false;
    const partners = mergePartners(s.weapons, into);
    const use = withSlots ?? partners.slice(0, MERGE_COUNT - 1);
    if (use.length !== MERGE_COUNT - 1 || new Set(use).size !== use.length || use.some((i) => !partners.includes(i))) return false;
    const m = mergeWeapons(this.rng, s.nextWeaponId++, keep, use.map((i) => s.weapons[i]!));
    s.weapons[into] = m;
    for (const i of use) s.weapons[i] = null;
    s.stats.merges++;
    if (m.rarity === 3 && keep.rarity < 3) s.stats.legendaries++;
    this.invVersion++;
    return true;
  }

  /**
   * Repeatedly merge every group of MERGE_COUNT matching weapons (same type, tier and rarity),
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
        const key = (w.tier * 4 + w.rarity) * 16 + w.form;
        const list = groups.get(key);
        if (list) list.push(i); else groups.set(key, [i]);
      });
      for (const key of [...groups.keys()].sort((x, y) => x - y)) {
        const slots = groups.get(key)!;
        if (slots.length < MERGE_COUNT) continue;
        const [into, ...rest] = slots.slice(0, MERGE_COUNT);
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

  /** Swap the weapon in `slot` with the equipped one. */
  equip(slot: number): boolean {
    const s = this.save;
    const w = s.weapons[slot];
    if (!w) return false;
    s.weapons[slot] = s.equipped;
    s.equipped = w;
    this.applyWeaponChange();
    return true;
  }

  salvage(slot: number): number {
    const s = this.save;
    const w = s.weapons[slot];
    if (!w) return 0;
    const value = salvageValue(w);
    s.weapons[slot] = null;
    s.shards += value;
    this.invVersion++;
    return value;
  }

  upgradeForge(): boolean {
    const s = this.save;
    if (s.forgeLevel >= MAX_FORGE_LEVEL) return false;
    const cost = forgeUpgradeCost(s.forgeLevel);
    if (s.gold < cost) return false;
    s.gold -= cost;
    s.forgeLevel++;
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

    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * HERO_REGEN * dt);
    this.moveHero(dt);
    this.updateEnemies(dt);
    this.heroAttack();
    this.gather.update(dt);
    this.spawn(dt);

    if (this.bossActive) {
      this.bossT -= dt;
      if (this.bossT <= 0) return this.failBoss(false);
    }
    if (h.hp <= 0) this.heroDied();
  }

  // --- Meta: quests, achievements, perks, reforge -------------------------------

  statValue(k: QuestKind | AchStat): number {
    const s = this.save;
    if (k === 'kills') return s.kills;
    if (k === 'bestEver') return s.bestEver;
    return s.stats[k];
  }

  questProgress(q: Quest): number {
    return Math.max(0, this.statValue(q.kind) - q.start);
  }

  questDone(q: Quest): boolean {
    return this.questProgress(q) >= q.target;
  }

  private fillQuests(): void {
    const qs = this.save.quests;
    while (qs.length < QUEST_SLOTS) {
      qs.push(makeQuest(this.rng, this.save.stage, (k) => this.statValue(k), qs.map((q) => q.kind)));
    }
  }

  claimQuest(i: number): boolean {
    const qs = this.save.quests;
    const q = qs[i];
    if (!q || !this.questDone(q)) return false;
    this.save.gold += q.gold;
    this.save.shards += q.shards;
    this.save.stats.quests++;
    const others = qs.filter((_, j) => j !== i).map((x) => x.kind);
    qs[i] = makeQuest(this.rng, this.save.stage, (k) => this.statValue(k), [...others, q.kind]);
    this.notifiedQuests.delete(q);
    return true;
  }

  private readonly notifiedQuests = new Set<Quest>();

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
    for (const q of s.quests) {
      if (!this.notifiedQuests.has(q) && this.questDone(q)) {
        this.notifiedQuests.add(q);
        this.notices.push('Quest complete! Claim it in Quests');
      }
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
    return embersFor(this.save.highestStage);
  }

  /** Offline cap including the Night Watch perk. */
  get offlineCapHours(): number {
    return OFFLINE_CAP_HOURS + this.save.perks.offline;
  }

  /**
   * Prestige: bank embers for this run's best stage, then restart. Keeps embers, perks,
   * achievements, lifetime stats and settings; resets stage, gold, shards, upgrades and weapons.
   */
  reforge(): number {
    const gain = this.reforgeGain;
    if (gain <= 0) return 0;
    const s = this.save;
    s.embers += gain;
    s.embersEarned += gain;
    s.stats.reforges++;
    const start = Math.max(1, Math.min(1 + s.perks.headstart * 5, s.bestEver));
    s.stage = start;
    s.highestStage = start;
    s.farming = false;
    s.gold = 0;
    s.shards = 0;
    for (const id of UPGRADE_IDS) s.upgrades[id] = 0;
    s.weapons = s.weapons.map(() => null);
    s.equipped = { ...starterWeapon(), id: s.nextWeaponId++ };
    s.forgeLevel = Math.min(MAX_FORGE_LEVEL, 1 + s.perks.forgemaster);
    s.quests = [];
    this.notifiedQuests.clear();
    this.fillQuests();
    this.killsInStage = 0;
    this.bossActive = false;
    this.phase = 'playing';
    this.recalc();
    this.enterArea(areaIndex(s.stage));
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
    } else if (inp.hasTarget) {
      const dx = inp.targetX - h.x, dy = inp.targetY - h.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) inp.hasTarget = false;
      else { vx = dx / d; vy = dy / d; }
    } else {
      inp.idleT += dt;
      if (this.save.auto && inp.idleT > AUTO_IDLE_DELAY) {
        // Auto-hunt: walk toward the nearest enemy until it's comfortably in reach.
        const e = this.nearestEnemy(Infinity, this.ignoreT > 0 ? this.ignore : null);
        target = e;
        if (e) {
          const dx = e.x - h.x, dy = e.y - h.y;
          const d = Math.hypot(dx, dy);
          if (d > HERO_RADIUS + e.radius + this.range * 0.6) { vx = dx / d; vy = dy / d; }
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

  private nearestEnemy(maxEdgeDist: number, skip: Enemy | null = null): Enemy | null {
    const h = this.hero;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = this.enemies[i];
      if (!e.alive || e.spawnT > 0 || e === skip) continue;
      const d = Math.hypot(e.x - h.x, e.y - h.y) - e.radius - HERO_RADIUS;
      if (d < bestD && d <= maxEdgeDist) { bestD = d; best = e; }
    }
    return best;
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
    this.events.push(Ev.Swing, h.x, h.y, ang);
    this.gather.chop(ang, this.range, this.arc);

    const isCrit = this.rng.chance(this.crit);
    const dmg = this.atk * (isCrit ? this.critMult : 1);
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
      dealt += Math.min(dmg, Math.max(0, e.hp));
      e.hp -= dmg;
      e.hitT = 0.12;
      e.aggro = true;
      const kb = (e.boss ? 25 : 90) * this.knockback;
      e.kx += (dx / (d || 1)) * kb;
      e.ky += (dy / (d || 1)) * kb;
      this.events.push(Ev.Hit, e.x, e.y - e.radius * 2 - 4, dmg, isCrit ? 1 : 0);
      if (e.hp <= 0) this.kill(e);
    }

    // Chain shock: arcs from the target to up to 3 nearby enemies for 60% damage.
    if (this.shock > 0 && this.rng.chance(this.shock)) {
      let fromX = target.x, fromY = target.y;
      for (let jump = 0; jump < 3; jump++) {
        let next: Enemy | null = null;
        let best = 60;
        for (let i = 0; i < MAX_ENEMIES; i++) {
          const e = this.enemies[i];
          if (!e.alive || e.spawnT > 0 || e === target || e.hitT > 0.11) continue;
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
    }

    if (this.lifesteal > 0 && dealt > 0) h.hp = Math.min(h.maxHp, h.hp + dealt * this.lifesteal);
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
      if (!e.aggro && (d < 120 || e.boss)) e.aggro = true;

      const reach = HERO_RADIUS + e.radius + 2;
      if (e.aggro) {
        if (e.detourT > 0) {
          e.detourT -= dt;
          e.x += Math.cos(e.detourA) * e.speed * dt;
          e.y += Math.sin(e.detourA) * e.speed * dt;
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
            h.hp -= e.dmg;
            h.hitT = 0.15;
            this.events.push(Ev.HeroHit, h.x, h.y - 18, e.dmg);
          }
        }
      } else {
        e.wanderT -= dt;
        if (e.wanderT <= 0) { e.wanderT = this.rng.range(1, 3); e.wanderA = this.rng.range(0, Math.PI * 2); }
        e.x += Math.cos(e.wanderA) * e.speed * 0.3 * dt;
        e.y += Math.sin(e.wanderA) * e.speed * 0.3 * dt;
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

  private sepCell(x: number, y: number): number {
    const c = Math.max(0, Math.min(SEP_COLS - 1, Math.floor(x / SEP_CELL)));
    const r = Math.max(0, Math.min(SEP_ROWS - 1, Math.floor(y / SEP_CELL)));
    return r * SEP_COLS + c;
  }

  private spawn(dt: number): void {
    if (this.isBossStage) return; // boss fights are one-on-one
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

    // Later stages within an area bring in more of the tougher monsters.
    const s = ((this.save.stage - 1) % STAGES_PER_AREA) + 1;
    const p0 = Math.max(0.25, 0.7 - s * 0.05);
    const p2 = Math.min(0.4, s * 0.045);
    const r = this.rng.next();
    const monster = r < p0 ? 0 : r < 1 - p2 ? 1 : 2;

    const pos = this.findSpawnPoint(130, 230);
    if (!pos) return;
    this.setEnemy(slot, monster, false, pos.x, pos.y);
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

  private setEnemy(e: Enemy, monster: number, boss: boolean, x: number, y: number): void {
    const { def } = areaFor(this.map.area);
    const m = boss ? def.boss : def.monsters[monster];
    const stage = this.save.stage;
    e.alive = true;
    e.monster = boss ? 3 : monster;
    e.boss = boss;
    e.x = e.prevX = x; e.y = e.prevY = y;
    e.kx = e.ky = 0;
    e.radius = boss ? BOSS.radius : m.radius;
    e.maxHp = e.hp = enemyHp(stage) * m.hp * (boss ? BOSS.hp : 1);
    e.dmg = enemyDmg(stage) * m.dmg * (boss ? BOSS.dmg : 1);
    e.speed = boss ? BOSS.speed : m.speed * this.rng.range(0.9, 1.1);
    e.atkInterval = boss ? BOSS.atkInterval : m.atkInterval;
    e.atkCd = e.atkInterval * 0.6;
    e.gold = enemyGold(stage) * m.gold * (boss ? BOSS.gold : 1);
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
    this.missions.recordKill(this.map.area, e.boss ? 3 : e.monster);
    this.gainXp(xpForKill(this.save.stage, e.boss));

    // Shards for the forge: bosses always drop a bundle, regular monsters sometimes drop one.
    const per = 1 + Math.floor(this.save.stage / 12);
    const raw = (e.boss ? 10 * per : this.rng.chance(0.2) ? per : 0) * this.shardMult;
    // Random rounding keeps fractional bonuses fair over time.
    const shards = Math.floor(raw) + (this.rng.chance(raw % 1) ? 1 : 0);
    if (shards > 0) {
      this.save.shards += shards;
      this.bucketShards += shards;
      this.events.push(Ev.Shard, e.x, e.y, shards);
    }

    if (e.boss) {
      this.bossActive = false;
      this.save.stats.bosses++;
      this.advanceStage();
      return;
    }
    this.killsInStage++;
    if (this.killsInStage >= this.killsNeeded) {
      this.killsInStage = 0;
      if (!this.save.farming) this.advanceStage();
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
  claimLevelReward(level: number): MilestoneReward | 'full' | null {
    const s = this.save;
    if (!MILESTONES.includes(level) || level > s.level || s.levelClaimed.includes(level)) return null;
    const r = this.levelReward(level);
    if (r.weapon) {
      const slot = s.weapons.indexOf(null);
      if (slot < 0) return 'full';
      const tier = Math.min(MAX_FORGE_LEVEL, s.forgeLevel + r.weapon.tierBonus);
      s.weapons[slot] = bonusWeapon(this.rng, s.nextWeaponId++, tier, r.weapon.rarity);
      this.invVersion++;
    }
    s.levelClaimed.push(level);
    this.missions.apply(r);
    return r;
  }

  private advanceStage(): void {
    const s = this.save;
    const prevArea = areaIndex(s.stage);
    s.stage++;
    s.stats.stages++;
    if (s.stage > s.highestStage) s.highestStage = s.stage;
    if (s.stage > s.bestEver) s.bestEver = s.stage;
    this.killsInStage = 0;
    if (areaIndex(s.stage) !== prevArea) {
      this.enterArea(areaIndex(s.stage));
    } else {
      this.events.push(Ev.StageClear);
      if (isBossStage(s.stage)) this.startBoss();
    }
  }

  private enterArea(area: number): void {
    this.map = new GameMap(area);
    this.clearEnemies();
    const h = this.hero;
    h.x = h.prevX = MAP_W / 2;
    h.y = h.prevY = MAP_H / 2;
    h.hp = h.maxHp;
    this.input.hasTarget = false;
    this.spawnT = 1;
    this.gather.reset();
    this.events.push(Ev.AreaEnter, 0, 0, area);
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
    this.setEnemy(this.enemies[0], 0, true, x, y);
    this.events.push(Ev.BossSpawn);
  }

  private failBoss(died: boolean): void {
    this.events.push(Ev.BossFail);
    this.clearEnemies();
    this.bossActive = false;
    this.save.farming = true;
    this.save.stage = Math.max(1, this.save.stage - 1);
    this.killsInStage = 0;
    if (died) { this.phase = 'dead'; this.phaseT = 1.5; }
  }

  private heroDied(): void {
    const h = this.hero;
    h.hp = 0;
    this.events.push(Ev.HeroDie, h.x, h.y);
    if (this.bossActive) return this.failBoss(true);
    this.phase = 'dead';
    this.phaseT = 1.5;
  }

  private respawn(): void {
    const h = this.hero;
    this.clearEnemies();
    h.x = h.prevX = MAP_W / 2;
    h.y = h.prevY = MAP_H / 2;
    h.hp = h.maxHp;
    this.killsInStage = 0;
    this.input.hasTarget = false;
    this.phase = 'playing';
    this.spawnT = 0.8;
    if (this.isBossStage) this.startBoss();
  }

  private clearEnemies(): void {
    for (const e of this.enemies) e.alive = false;
  }
}

export { UPGRADE_IDS };
