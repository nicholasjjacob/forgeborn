import { sfx } from '../audio/sfx';

/**
 * Pages a list in place instead of scrolling it: only `size` children are shown at once, with
 * ‹ › buttons and a left/right swipe to move between pages. The bottom menu never scrolls.
 */
export class Pager {
  page = 0;
  /** The ‹ 1/3 › control; put it wherever it fits (hidden when there is only one page). */
  readonly el: HTMLElement;
  private readonly label: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private pages = 1;
  private swiped = 0;

  constructor(private readonly list: HTMLElement, private readonly size: number, private readonly onChange?: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'pager';
    this.el.innerHTML = '<button type="button" class="pg-btn" aria-label="Previous page">‹</button><span class="pg-label"></span><button type="button" class="pg-btn" aria-label="Next page">›</button>';
    [this.prev, this.next] = [...this.el.querySelectorAll<HTMLButtonElement>('button')];
    this.label = this.el.querySelector('.pg-label')!;
    this.prev.addEventListener('click', () => this.go(this.page - 1));
    this.next.addEventListener('click', () => this.go(this.page + 1));

    // Swipe sideways on the list to turn the page (a swipe never counts as a tap on an item).
    let x0 = 0, y0 = 0, id = -1;
    list.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; id = e.pointerId; });
    list.addEventListener('pointerup', (e) => {
      if (e.pointerId !== id) return;
      id = -1;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3 && this.pages > 1) {
        this.swiped = performance.now();
        this.go(this.page + (dx < 0 ? 1 : -1));
      }
    });
    list.addEventListener('click', (e) => {
      if (performance.now() - this.swiped < 350) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  private go(p: number): void {
    const to = Math.max(0, Math.min(this.pages - 1, p));
    if (to === this.page) return;
    this.page = to;
    sfx.play('tick');
    this.update();
    this.onChange?.();
  }

  /** Show the page holding item `i` (e.g. a weapon that was just forged or merged). */
  reveal(i: number): void {
    const p = Math.floor(i / this.size);
    if (p !== this.page) { this.page = p; this.update(); }
  }

  /** Re-apply after the list's children change. */
  update(): void {
    const items = this.list.children;
    this.pages = Math.max(1, Math.ceil(items.length / this.size));
    this.page = Math.min(this.page, this.pages - 1);
    const from = this.page * this.size, to = from + this.size;
    for (let i = 0; i < items.length; i++) {
      const el = items[i] as HTMLElement;
      const off = i < from || i >= to;
      if (el.hidden !== off) el.hidden = off;
    }
    this.el.classList.toggle('single', this.pages <= 1);
    const text = `${this.page + 1}/${this.pages}`;
    if (this.label.textContent !== text) this.label.textContent = text;
    this.prev.disabled = this.page === 0;
    this.next.disabled = this.page >= this.pages - 1;
  }
}

/**
 * Last line of defence for a locked (non-scrolling) panel page: if its content is still taller
 * than the page on a very short screen, shrink it to fit rather than letting it scroll.
 */
export function fitToPage(page: HTMLElement, inner: HTMLElement | null): void {
  if (!inner || page.hidden || page.offsetParent === null) return;
  const room = page.clientHeight, need = inner.scrollHeight;
  if (room <= 0) return;
  const k = need > room + 1 ? Math.max(0.7, room / need) : 1;
  const t = k < 1 ? `scale(${k.toFixed(3)})` : '';
  if (inner.style.transform !== t) inner.style.transform = t;
}

/**
 * Keeps every panel page fitted: refits the moment a page or its content changes size (a tab or
 * sub-tab switch, a new page of items), before the frame is drawn, so nothing visibly jumps.
 * While the menu is opening or closing the page height is mid-animation: `held()` skips those
 * measurements and `panel`'s transitionend refits at the final size.
 */
export function autoFit(panel: HTMLElement, held: () => boolean): () => void {
  const pages = [...panel.querySelectorAll<HTMLElement>('.tab-page')];
  const fitAll = (): void => { for (const p of pages) fitToPage(p, p.firstElementChild as HTMLElement | null); };
  const ro = new ResizeObserver(() => { if (!held()) fitAll(); });
  for (const p of pages) { ro.observe(p); if (p.firstElementChild) ro.observe(p.firstElementChild); }
  panel.addEventListener('transitionend', (e) => { if (e.target === panel) fitAll(); });
  return fitAll;
}

/**
 * Two-way switch at the top of a panel page (`.seg` buttons with data-seg) that shows one
 * `[data-seg-page]` block at a time: splits a page into halves that each fit without scrolling.
 */
export function bindSegments(root: HTMLElement, onChange?: () => void): void {
  const btns = [...root.querySelectorAll<HTMLButtonElement>('.seg button')];
  for (const b of btns) {
    b.addEventListener('click', () => {
      if (b.classList.contains('on')) return;
      for (const o of btns) { o.classList.toggle('on', o === b); o.setAttribute('aria-selected', String(o === b)); }
      for (const p of root.querySelectorAll<HTMLElement>('[data-seg-page]')) p.hidden = p.dataset.segPage !== b.dataset.seg;
      sfx.play('tick');
      onChange?.();
    });
  }
}
