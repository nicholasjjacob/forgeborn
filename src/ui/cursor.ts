/**
 * PC mouse cursors: a chunky gold RPG arrow with a dark outline and a drop shadow (easy to spot
 * over the busy 3D world), and a brighter, glowing version over anything clickable. Drawn as SVG
 * at 1x, 1.5x and 2x, so it stays crisp and the same size under Windows display scaling. The CSS
 * (html.pc rules in style.css) picks them up from the --cur-arrow / --cur-hand variables.
 */

/** The arrow outline (in a 32-unit box, tip at 3,2). */
const ARROW = 'M3 2 L3 25 L9 19.6 L13.4 29 L18 26.9 L13.6 17.7 L21.6 17.4 Z';

function svg(size: number, glow: boolean): string {
  const fill = glow
    ? '<stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#fff2a0"/><stop offset="1" stop-color="#ffc21f"/>'
    : '<stop offset="0" stop-color="#fff0a8"/><stop offset="0.5" stop-color="#ffc02c"/><stop offset="1" stop-color="#c2760b"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">${fill}</linearGradient></defs>
  <path d="${ARROW}" transform="translate(1.6 1.8)" fill="#000" opacity="0.4" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/>
  ${glow ? `<path d="${ARROW}" fill="none" stroke="#ffe066" stroke-opacity="0.75" stroke-width="5.5" stroke-linejoin="round"/>` : ''}
  <path d="${ARROW}" fill="url(#g)" stroke="#2a1404" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M5.2 6.4 L5.2 19.2 L7.6 17 Z" fill="#fff" opacity="0.65"/>
</svg>`;
}

const url = (size: number, glow: boolean) => `url("data:image/svg+xml,${encodeURIComponent(svg(size, glow))}")`;

/** A cursor value with sharp versions for high-DPI screens; the hotspot is the arrow's tip. */
function cursor(glow: boolean, fallback: string): string {
  const set = `image-set(${url(32, glow)} 1x, ${url(48, glow)} 1.5x, ${url(64, glow)} 2x)`;
  return CSS.supports('cursor', `${set} 4 3, ${fallback}`) ? `${set} 4 3, ${fallback}` : `${url(32, glow)} 4 3, ${fallback}`;
}

export function installCursors(): void {
  const root = document.documentElement.style;
  root.setProperty('--cur-arrow', cursor(false, 'default'));
  root.setProperty('--cur-hand', cursor(true, 'pointer'));
}
