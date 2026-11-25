/**
 * Reliable taps for sheets whose content re-renders while open (the game keeps running behind
 * them, so stats tick every second). A browser only fires `click` when press and release hit
 * the *same* element, so a re-render in between swallows the tap. Instead, remember which
 * action was pressed (by its data-act name, which survives re-renders) and run it on release.
 *
 * Actions: an element's `data-act`, or 'close' for the backdrop (`wrap` itself) and `.sheet-x`.
 * Native `click` is still handled for keyboards (Enter/Space give a click with detail 0).
 */
export function bindSheetTaps(wrap: HTMLElement, run: (action: string) => void): void {
  let down: { act: string; x: number; y: number } | null = null;

  const actOf = (t: HTMLElement): string | null => {
    if (t === wrap || t.closest('.sheet-x')) return 'close';
    return t.closest<HTMLElement>('[data-act]')?.dataset.act ?? null;
  };

  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) { down = null; return; }
    const act = actOf(e.target as HTMLElement);
    down = act ? { act, x: e.clientX, y: e.clientY } : null;
  });
  wrap.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    // A drag (scrolling the list) isn't a tap. Touch scrolls usually cancel the pointer anyway.
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14) return;
    const up = actOf(e.target as HTMLElement);
    // Run it if released on the same action (possibly a re-rendered copy of the button), or on
    // a spot with no action at all (the button moved a little in the re-render). Releasing on a
    // different button or the backdrop cancels, as with a normal click.
    if (up !== d.act && !(up === null && d.act !== 'close')) return;
    e.preventDefault();
    // The browser still sends a click after this release. If the action closes the sheet, that
    // click would land on whatever sits underneath (e.g. a side button under a sheet's
    // close button) and open it: swallow it.
    swallowNextClick();
    run(d.act);
  });
  wrap.addEventListener('pointercancel', () => { down = null; });
  wrap.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const act = actOf(e.target as HTMLElement);
    if (act) run(act);
  });
}

/** The current element for an action (it may have been re-rendered since the press). */
export function actionElement(wrap: HTMLElement, action: string): HTMLElement | null {
  return wrap.querySelector<HTMLElement>(`[data-act="${CSS.escape(action)}"]`);
}

/** Eat the click the browser sends right after a pointer release we already acted on. */
function swallowNextClick(): void {
  const eat = (e: MouseEvent) => {
    if (e.detail === 0) return; // keyboard "clicks" are real
    e.preventDefault();
    e.stopPropagation();
    done();
  };
  const done = () => { window.removeEventListener('click', eat, true); clearTimeout(timer); };
  const timer = setTimeout(done, 450);
  window.addEventListener('click', eat, true);
}
