/**
 * The loading screen (in index.html, so it shows before any code arrives): a progress bar and a
 * line saying what's happening. Covers the game while everything is downloaded, built and warmed
 * up, then fades away.
 */
const root = document.getElementById('loading');
const fill = root?.querySelector<HTMLElement>('.ld-fill') ?? null;
const text = root?.querySelector<HTMLElement>('.ld-text') ?? null;
let shown = 0.03;

/** Move the bar to `frac` (0-1; it never goes backwards) and say what's loading. */
export function loadingStep(frac: number, label?: string): void {
  shown = Math.max(shown, Math.min(1, frac));
  if (fill) fill.style.transform = `scaleX(${shown.toFixed(3)})`;
  if (label && text && text.textContent !== label) text.textContent = label;
  if (import.meta.env.DEV && label && !label.includes('%')) ((window as unknown as { __load?: [string, number][] }).__load ??= []).push([label, Math.round(performance.now())]);
}

/** Let the browser paint the bar before the next long step (a timer, which also runs in a background tab). */
export function loadingPaint(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** Fade the loading screen out and remove it. */
export function loadingDone(): void {
  if (!root) return;
  loadingStep(1, 'Done');
  root.classList.add('gone');
  setTimeout(() => root.remove(), 600);
}

/** Startup failed: say so on the loading screen, with a way to retry. */
export function loadingFailed(message: string): void {
  if (!text) return;
  text.textContent = `Couldn't start: ${message}. Tap to retry.`;
  root?.addEventListener('click', () => location.reload(), { once: true });
}
