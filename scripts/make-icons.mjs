// Generates the app icons (PNG) from pixel art drawn in code. No image tools needed:
// a tiny PNG encoder using Node's built-in zlib.  Run: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const N = 32; // art resolution

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
const C = {
  bg0: hex('#3a2a6a'), bg1: hex('#1d1638'), outline: hex('#140f24'),
  blade: hex('#dfe6f2'), bladeHi: hex('#ffffff'), bladeLo: hex('#8a96ac'),
  gold: hex('#ffc94a'), goldLo: hex('#c0780a'), grip: hex('#6b3f22'),
  ember: hex('#ff8a3a'), emberHi: hex('#ffe08a'),
};

function art() {
  const px = Array.from({ length: N * N }, () => null);
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) px[y * N + x] = c; };
  // Background: soft radial glow.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x - 17, y - 14) / 22;
    const t = Math.min(1, d);
    set(x, y, C.bg0.map((v, i) => (i === 3 ? 255 : Math.round(v * (1 - t) + C.bg1[i] * t))));
  }
  // Embers rising behind the blade.
  for (const [x, y] of [[22, 20], [25, 16], [19, 24], [27, 22], [24, 26]]) { set(x, y, C.ember); set(x, y - 1, C.emberHi); }
  // Diagonal blade from (9,22) to (26,5).
  for (let i = 0; i <= 17; i++) {
    const x = 9 + i, y = 22 - i;
    set(x - 1, y - 1, C.outline); set(x + 1, y + 1, C.outline);
    set(x, y, C.blade); set(x, y - 1, C.bladeHi); set(x + 1, y, C.bladeLo);
  }
  set(27, 4, C.outline); set(26, 4, C.bladeHi); set(27, 5, C.bladeLo);
  // Cross-guard (perpendicular to the blade).
  for (let i = -4; i <= 4; i++) { set(9 + i, 22 + i, C.gold); set(10 + i, 22 + i, C.goldLo); }
  // Grip and pommel.
  for (let i = 1; i <= 4; i++) { set(8 - i, 23 + i, C.grip); set(9 - i, 23 + i, C.grip); }
  set(3, 28, C.gold); set(4, 28, C.gold); set(3, 27, C.goldLo); set(4, 29, C.goldLo);
  return px;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Scale the art to `size`, with the art occupying `fill` of the canvas (maskable safe zone). */
function png(size, fill, bg) {
  const src = art();
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const artSize = Math.round(size * fill), off = Math.floor((size - artSize) / 2);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let c = bg;
      const ax = x - off, ay = y - off;
      if (ax >= 0 && ay >= 0 && ax < artSize && ay < artSize) {
        c = src[Math.floor((ay / artSize) * N) * N + Math.floor((ax / artSize) * N)] ?? bg;
      }
      raw.set(c, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': png(192, 1, C.bg1),
  'icon-512.png': png(512, 1, C.bg1),
  'maskable-512.png': png(512, 0.72, C.bg1), // keep the art inside the 80% safe circle
  'apple-touch-icon.png': png(180, 1, C.bg1),
  'favicon-32.png': png(32, 1, C.bg1),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name}  ${data.length} bytes`);
}
