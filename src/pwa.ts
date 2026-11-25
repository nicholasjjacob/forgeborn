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
 * A Home Screen app (or a tab left open, or a page a browser cache held on to) can keep running
 * an older version. Check for a newer build (its main script name changes with every build):
 * right at startup and whenever the game comes back to the foreground, reload straight into it;
 * while it's open, check every minute and offer a "New version ready" banner instead of
 * interrupting play. The game saves on pagehide, so a reload loses nothing.
 */
const UPDATED_FLAG = 'fb-just-updated';
const TRIED_KEY = 'fb-update-tried';

/**
 * Reload into the new build, and say so once it's running. The reload goes to the page with a
 * one-off `?v=` query, which no browser or CDN cache has seen, so it can't serve the old page.
 */
function reloadIntoUpdate(live?: string): void {
  try {
    sessionStorage.setItem(UPDATED_FLAG, '1');
    if (live) sessionStorage.setItem(TRIED_KEY, live);
  } catch { /* storage blocked: reload anyway */ }
  location.replace(`${location.pathname}?v=${encodeURIComponent(live ?? String(Date.now()))}${location.hash}`);
}

/** Already reloaded for this build in this session (and still not running it)? Don't loop. */
function alreadyTried(live: string): boolean {
  try { return sessionStorage.getItem(TRIED_KEY) === live; } catch { return true; }
}

/** After an update reload: a short "Updated" note at the top of the screen. */
function announceUpdate(): void {
  let was = false;
  try { was = sessionStorage.getItem(UPDATED_FLAG) === '1'; sessionStorage.removeItem(UPDATED_FLAG); } catch { /* ignore */ }
  if (!was) return;
  const note = document.createElement('div');
  note.className = 'update-banner done';
  note.textContent = `✨ Updated to the latest version (${__BUILD__})`;
  document.body.appendChild(note);
  setTimeout(() => note.classList.add('gone'), 3500);
  setTimeout(() => note.remove(), 4200);
}

function watchForUpdates(): void {
  announceUpdate();
  // Tidy the one-off cache-busting query out of the address bar.
  if (new URLSearchParams(location.search).has('v')) history.replaceState(null, '', location.pathname + location.hash);
  const current = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')?.src;
  if (!current) return;
  const name = (src: string) => src.slice(src.lastIndexOf('/') + 1);
  let checking = false;
  let banner: HTMLButtonElement | null = null;
  /** The live build's main script name, if it differs from the running one. */
  const newer = async (): Promise<string | null> => {
    const res = await fetch('./', { cache: 'no-store' });
    const live = /assets\/(index-[\w-]+\.js)/.exec(await res.text())?.[1];
    return live && live !== name(current) ? live : null;
  };
  const check = async (reloadNow: boolean) => {
    if (checking || document.hidden) return;
    checking = true;
    try {
      const live = await newer();
      if (live) {
        if (reloadNow && !alreadyTried(live)) reloadIntoUpdate(live);
        else showBanner(live);
      }
    } catch { /* offline: try again next time */ }
    checking = false;
  };
  const showBanner = (live: string) => {
    if (banner) return;
    banner = document.createElement('button');
    banner.type = 'button';
    banner.className = 'update-banner';
    banner.textContent = '✨ New version ready · Tap to update';
    banner.addEventListener('click', () => reloadIntoUpdate(`${live}-${Date.now()}`));
    document.body.appendChild(banner);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(true); });
  check(true); // a stale page from some cache: straight into the new version
  setInterval(() => check(false), 60 * 1000);
}
