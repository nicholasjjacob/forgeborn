import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

/**
 * A short fingerprint of every model and texture in public/models (by path), so the game asks for
 * `models/x.glb?v=<hash>`: a changed file gets a new address no browser or CDN cache has seen
 * (GitHub Pages lets browsers keep files for 10 minutes), while unchanged ones stay cached.
 */
function assetHashes(dir = 'public/models', base = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    const p = join(dir, f), rel = base ? `${base}/${f}` : f;
    if (statSync(p).isDirectory()) Object.assign(out, assetHashes(p, rel));
    else out[rel] = createHash('sha1').update(readFileSync(p)).digest('hex').slice(0, 10);
  }
  return out;
}

export default defineConfig({
  // Relative asset paths: the build works from any folder or sub-path (and inside app wrappers).
  base: './',
  define: {
    // Build time, shown in Settings so it's easy to tell which version a device is running.
    __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
    __ASSET_HASHES__: JSON.stringify(assetHashes()),
  },
  server: { port: 5173, host: true },
  build: {
    chunkSizeWarningLimit: 1200, // Three.js (3D world) + PixiJS core (overlay) live in the main chunk
    target: 'es2022',
    // (no manualChunks: forcing Pixi into one chunk would defeat its lazy-loaded renderer splits)
  },
});
