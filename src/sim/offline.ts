import type { SaveData } from './sim';

/** Offline progress: a share of your recent earning rate, for up to OFFLINE_CAP_HOURS. */
export const OFFLINE_CAP_HOURS = 8;
export const OFFLINE_EFFICIENCY = 0.5;
/** Shards come in at a lower share so a long nap can't flood the forge. */
export const OFFLINE_SHARD_EFFICIENCY = 0.2;
/** Absences shorter than this are simulated live instead (see main.ts). */
export const MIN_OFFLINE_SECONDS = 60;

export interface OfflineReward {
  seconds: number;   // time credited (after the cap)
  away: number;      // actual time away
  gold: number;
  shards: number;
  capped: boolean;   // true if the absence exceeded the offline cap
}

/**
 * Rewards for `awaySeconds` of absence, based on the earning rates saved with the game.
 * Pure function: no clock access, so it is easy to test and can't be skewed mid-call.
 */
export function offlineReward(save: Pick<SaveData, 'rates'>, awaySeconds: number, capHours = OFFLINE_CAP_HOURS): OfflineReward {
  // Guard against clock changes (negative or absurd values).
  const away = Number.isFinite(awaySeconds) ? Math.max(0, awaySeconds) : 0;
  const seconds = Math.min(away, capHours * 3600);
  const capped = away > capHours * 3600;
  if (seconds < MIN_OFFLINE_SECONDS) return { seconds: 0, away, gold: 0, shards: 0, capped };
  return {
    seconds,
    away,
    gold: Math.max(0, save.rates.gold) * seconds * OFFLINE_EFFICIENCY,
    shards: Math.floor(Math.max(0, save.rates.shards) * seconds * OFFLINE_SHARD_EFFICIENCY),
    capped,
  };
}

/** Worth showing the welcome-back dialog for? */
export function hasReward(r: OfflineReward): boolean {
  return r.seconds > 0 && (r.gold >= 1 || r.shards >= 1);
}

export function applyOfflineReward(save: SaveData, r: OfflineReward): void {
  save.gold += r.gold;
  save.shards += r.shards;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}
