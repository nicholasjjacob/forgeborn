import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the build works from any folder or sub-path (and inside app wrappers).
  base: './',
  // Build time, shown in Settings so it's easy to tell which version a device is running.
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  server: { port: 5173, host: true },
  build: {
    chunkSizeWarningLimit: 1200, // Three.js (3D world) + PixiJS core (overlay) live in the main chunk
    target: 'es2022',
    // (no manualChunks: forcing Pixi into one chunk would defeat its lazy-loaded renderer splits)
  },
});
