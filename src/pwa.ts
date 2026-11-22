/**
 * Installable web app: registers the service worker (production only, so dev reloads stay
 * fresh) and captures the browser's install prompt so Settings can offer an Install button.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function registerPwa(): { canInstall(): boolean; install(): Promise<boolean> } {
  let deferred: InstallPromptEvent | null = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own button instead of the mini-infobar
    deferred = e as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => { deferred = null; });

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    // Register after load so it never competes with the first paint. boot() is async, so the
    // load event may already have fired by the time we get here.
    const register = () => navigator.serviceWorker.register('./sw.js').catch(() => { /* offline play just won't be available */ });
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }

  if (import.meta.env.PROD) watchForUpdates();

  return {
    canInstall: () => deferred !== null,
    async install() {
      if (!deferred) return false;
      const ev = deferred;
      deferred = null;
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      return outcome === 'accepted';
    },
  };
}

/**
 * A Home Screen app (or a tab left open) keeps running the version it started with. Check for
 * a newer build (its main script name changes with every build): when the game comes back to
 * the foreground, reload straight into it; while it's open, check every minute and offer a
 * "New version ready" banner instead of interrupting play. The game saves on pagehide, so a
 * reload loses nothing.
 */
function watchForUpdates(): void {
  const current = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')?.src;
  if (!current) return;
  const name = (src: string) => src.slice(src.lastIndexOf('/') + 1);
  let checking = false;
  let banner: HTMLButtonElement | null = null;
  const newer = async (): Promise<boolean> => {
    const res = await fetch('./', { cache: 'no-store' });
    const live = /assets\/(index-[\w-]+\.js)/.exec(await res.text())?.[1];
    return !!live && live !== name(current);
  };
  const check = async (reloadNow: boolean) => {
    if (checking || document.hidden) return;
    checking = true;
    try {
      if (await newer()) {
        if (reloadNow) location.reload();
        else showBanner();
      }
    } catch { /* offline: try again next time */ }
    checking = false;
  };
  const showBanner = () => {
    if (banner) return;
    banner = document.createElement('button');
    banner.type = 'button';
    banner.className = 'update-banner';
    banner.textContent = '✨ New version ready · Tap to update';
    banner.addEventListener('click', () => location.reload());
    document.body.appendChild(banner);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(true); });
  setInterval(() => check(false), 60 * 1000);
}
