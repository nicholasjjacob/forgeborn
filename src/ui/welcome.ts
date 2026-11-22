import { fmt } from '../core/format';
import { OFFLINE_CAP_HOURS, OFFLINE_EFFICIENCY, formatDuration, type OfflineReward } from '../sim/offline';

/**
 * "Welcome back" dialog listing offline earnings. Rewards are applied before this opens (so
 * closing the tab never loses them); the button only dismisses it.
 */
export function showWelcome(r: OfflineReward, capHours = OFFLINE_CAP_HOURS): void {
  const modal = document.getElementById('modal')!;
  const capped = r.capped;
  modal.querySelector('#modal-away')!.textContent =
    `You were away for ${formatDuration(r.away)}${capped ? ` (earnings capped at ${capHours}h)` : ''}. Your hero kept fighting:`;
  modal.querySelector('#modal-gold')!.textContent = `+${fmt(r.gold)}`;
  modal.querySelector('#modal-shards')!.textContent = `+${fmt(r.shards)}`;
  modal.querySelector('#modal-shards-row')!.toggleAttribute('hidden', r.shards <= 0);
  modal.querySelector('#modal-note')!.textContent =
    `Offline you earn ${Math.round(OFFLINE_EFFICIENCY * 100)}% of your recent gold rate (shards at a lower share), for up to ${capHours} hours.`;
  modal.hidden = false;
  const btn = modal.querySelector<HTMLButtonElement>('#modal-ok')!;
  const close = () => { modal.hidden = true; btn.removeEventListener('click', close); };
  btn.addEventListener('click', close);
  btn.focus();
}
