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
 * A Home Screen app (or a tab left open) keeps running the version it started with. Each time
 * the game comes back to the foreground, check whether a newer build is live (its main script
 * name changes with every build) and reload into it. The game saves when it's hidden, so the
 * reload loses nothing.
 */
function watchForUpdates(): void {
  const current = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')?.src;
  if (!current) return;
  const name = (src: string) => src.slice(src.lastIndexOf('/') + 1);
  let checking = false;
  const check = async () => {
    if (checking || document.hidden) return;
    checking = true;
    try {
      const res = await fetch('./', { cache: 'no-store' });
      const html = await res.text();
      const live = /assets\/(index-[\w-]+\.js)/.exec(html)?.[1];
      if (live && live !== name(current)) location.reload();
    } catch { /* offline: try again next time */ }
    checking = false;
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setInterval(check, 15 * 60 * 1000);
}
