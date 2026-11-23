import { fmt, pct } from '../core/format';

/** Fixed simulation step. 30 Hz is plenty for this kind of combat and halves CPU vs 60 Hz. */
export const TICK = 1 / 30;

export const STAGES_PER_AREA = 10;
export const BOSS_TIME = 45;

// --- Hero ------------------------------------------------------------------
export const HERO_RADIUS = 5;
export const HERO_SPEED = 72;          // world units / second
export const HERO_RANGE = 22;          // swing reach (edge to edge)
export const HERO_ARC = 1.25;          // half-angle of the swing cone (radians, ~72°)
export const HERO_REGEN = 0.02;        // fraction of max HP per second
export const CRIT_MULT = 2.5;
export const AUTO_IDLE_DELAY = 1.2;    // seconds without input before auto-hunt resumes

// --- Upgrades --------------------------------------------------------------
export type UpgradeId = 'atk' | 'hp' | 'aspd' | 'crit' | 'gold';
export const UPGRADE_IDS: readonly UpgradeId[] = ['atk', 'hp', 'aspd', 'crit', 'gold'];

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  baseCost: number;
  growth: number;
  maxLevel: number;
  value(level: number): number;
  show(v: number): string;
  color: number;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  atk: {
    id: 'atk', name: 'Attack', baseCost: 8, growth: 1.14, maxLevel: Infinity,
    value: (l) => 3 * (1 + l) * Math.pow(1.035, l),
    show: fmt, color: 0xe4572e,
  },
  hp: {
    id: 'hp', name: 'Vitality', baseCost: 10, growth: 1.15, maxLevel: Infinity,
    value: (l) => 40 * (1 + 0.6 * l) * Math.pow(1.035, l),
    show: fmt, color: 0x4caf50,
  },
  aspd: {
    id: 'aspd', name: 'Swing Speed', baseCost: 40, growth: 1.45, maxLevel: 40,
    value: (l) => 1.2 * (1 + 0.05 * l),
    show: (v) => v.toFixed(2) + '/s', color: 0x29b6f6,
  },
  crit: {
    id: 'crit', name: 'Precision', baseCost: 60, growth: 1.5, maxLevel: 45,
    value: (l) => 0.05 + 0.01 * l,
    show: pct, color: 0xffca28,
  },
  gold: {
    id: 'gold', name: 'Greed', baseCost: 50, growth: 1.3, maxLevel: Infinity,
    value: (l) => 1 + 0.12 * l,
    show: (v) => 'x' + v.toFixed(2), color: 0xffb300,
  },
};

export function upgradeCost(def: UpgradeDef, level: number, count: number): number {
  // Geometric series: base * g^level * (g^count - 1) / (g - 1)
  const g = def.growth;
  return def.baseCost * Math.pow(g, level) * (Math.pow(g, count) - 1) / (g - 1);
}

/** Largest n such that buying n levels is affordable (respecting maxLevel). */
export function maxAffordable(def: UpgradeDef, level: number, gold: number): number {
  const g = def.growth;
  const first = def.baseCost * Math.pow(g, level);
  if (gold < first) return 0;
  let n = Math.floor(Math.log((gold * (g - 1)) / first + 1) / Math.log(g));
  n = Math.min(n, def.maxLevel - level);
  // Guard against floating-point edge cases at the boundary.
  while (n > 0 && upgradeCost(def, level, n) > gold) n--;
  return Math.max(0, n);
}

// --- Enemy scaling (per stage; the area roster sets the per-monster multipliers) ---

export const enemyHp = (stage: number) => 15 * Math.pow(1.19, stage - 1);
export const enemyDmg = (stage: number) => 3 * Math.pow(1.165, stage - 1);
export const enemyGold = (stage: number) => 2.6 * Math.pow(1.17, stage - 1);

export const BOSS = { hp: 16, dmg: 3, gold: 15, radius: 13, speed: 30, atkInterval: 1.5 };

export const killsForStage = (stage: number) => Math.min(14 + Math.floor(stage / 2), 40);
export const maxAlive = (stage: number) => Math.min(6 + Math.floor(stage / 3), 26);

export const isBossStage = (stage: number) => stage % STAGES_PER_AREA === 0;
export const areaIndex = (stage: number) => Math.floor((stage - 1) / STAGES_PER_AREA);
