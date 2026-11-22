/**
 * Minimal accessible confirm dialog (Escape / backdrop cancels). Resolves true on confirm.
 * Built on demand so it costs nothing until used.
 */
export function confirmDialog(opts: { title: string; body: string; confirm: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <div class="modal-card">
        <h2></h2>
        <div class="modal-body"></div>
        <div class="modal-buttons">
          <button type="button" class="btn ghost" data-act="no"></button>
          <button type="button" class="btn ${opts.danger ? 'danger' : 'primary'}" data-act="yes"></button>
        </div>
      </div>`;
    wrap.querySelector('h2')!.textContent = opts.title;
    wrap.querySelector('.modal-body')!.innerHTML = opts.body; // body is authored by the game, never user/target text
    wrap.querySelector<HTMLElement>('[data-act="no"]')!.textContent = opts.cancel ?? 'Cancel';
    wrap.querySelector<HTMLElement>('[data-act="yes"]')!.textContent = opts.confirm;

    const done = (v: boolean) => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(false); };
    wrap.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act) done(act === 'yes');
      else if (e.target === wrap) done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector<HTMLButtonElement>('[data-act="no"]')!.focus();
  });
}
