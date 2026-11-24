import { ICON_DATA } from './iconData';

/**
 * Game icons (game-icons.net silhouettes, CC BY 3.0) drawn in the UI's super casual style:
 * a glossy top-lit gradient fill with a thick dark outline. Returns inline SVG markup.
 */

export type IconColor = 'white' | 'gold' | 'red' | 'green' | 'blue' | 'purple' | 'pink' | 'orange' | 'brown' | 'grey' | 'cyan';

const GRADIENTS: Record<IconColor, [string, string, string]> = {
  white: ['#ffffff', '#e8eeff', '#a8b6e6'],
  gold: ['#fff4a8', '#ffc93a', '#d0740c'],
  red: ['#ffb4a4', '#ff4a52', '#a3142c'],
  green: ['#d0ffa0', '#5ad83a', '#1c8428'],
  blue: ['#c0eeff', '#3aa8ff', '#1448c4'],
  purple: ['#efd4ff', '#b06cff', '#5420ac'],
  pink: ['#ffd4ec', '#ff6ab6', '#ac2068'],
  orange: ['#ffe4a4', '#ff9a3a', '#c0460c'],
  brown: ['#f4cc94', '#b4763c', '#663610'],
  grey: ['#eef1f8', '#aab2c8', '#5a6282'],
  cyan: ['#d4fcff', '#4ae0ff', '#1474b0'],
};

let installed = false;
/** One hidden <svg> holding the shared gradients that every icon refers to. */
function installDefs(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const stops = (Object.keys(GRADIENTS) as IconColor[]).map((k) => {
    const [a, b, c] = GRADIENTS[k];
    return `<linearGradient id="gi-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.45" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
  }).join('');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = `<defs>${stops}</defs>`;
  document.body.prepend(svg);
}

/** Inline SVG icon. Size it with CSS (it is 1em square by default). */
export function gi(name: string, color: IconColor = 'white', cls = ''): string {
  installDefs();
  const body = ICON_DATA[name] ?? '';
  return `<svg class="gi ${cls}" viewBox="-40 -40 592 592" aria-hidden="true"><g fill="url(#gi-${color})" stroke="#0a1035" stroke-width="44" stroke-linejoin="round" paint-order="stroke">${body}</g></svg>`;
}
