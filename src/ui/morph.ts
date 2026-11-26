/**
 * Update an element to new markup by patching only what changed, instead of replacing everything
 * (innerHTML). Screens that redraw while the game runs (the Codex after every kill) keep their
 * elements: live 3D portrait canvases stay painted, images aren't reloaded, and the browser only
 * re-lays out the bits that changed. Nodes are matched by position and tag (a canvas also by its
 * model), which suits screens that re-render the same template with new numbers.
 */
export function morphInto(target: Element, html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(target, tpl.content);
}

/** Classes the page adds at runtime (not in the markup) that a patch must keep. */
const KEEP_CLASSES = ['has3d'];

function same(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== Node.ELEMENT_NODE) return true;
  const x = a as Element, y = b as Element;
  if (x.tagName !== y.tagName) return false;
  // A portrait canvas showing a different model is a different portrait.
  return x.tagName !== 'CANVAS' || x.getAttribute('data-model') === y.getAttribute('data-model');
}

function patchAttrs(a: Element, b: Element): void {
  for (const { name, value } of [...b.attributes]) {
    if (name === 'class') {
      const keep = KEEP_CLASSES.filter((c) => a.classList.contains(c));
      const want = keep.length ? `${value} ${keep.join(' ')}`.trim() : value;
      if (a.getAttribute('class') !== want) a.setAttribute('class', want);
    } else if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  }
  for (const { name } of [...a.attributes]) {
    // A canvas's pixel size is set by its painter, not the markup.
    if (a.tagName === 'CANVAS' && (name === 'width' || name === 'height')) continue;
    if (!b.hasAttribute(name)) a.removeAttribute(name);
  }
}

function patchChildren(a: Node, b: Node): void {
  const ac = [...a.childNodes], bc = [...b.childNodes];
  for (let i = 0; i < bc.length; i++) {
    const x = ac[i], y = bc[i];
    if (!x) { a.appendChild(y); continue; }
    if (!same(x, y)) { a.replaceChild(y, x); continue; }
    if (x.nodeType !== Node.ELEMENT_NODE) {
      if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
      continue;
    }
    patchAttrs(x as Element, y as Element);
    if ((x as Element).tagName !== 'CANVAS') patchChildren(x, y);
  }
  for (let i = ac.length - 1; i >= bc.length; i--) a.removeChild(ac[i]);
}
