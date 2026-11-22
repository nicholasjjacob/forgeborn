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
