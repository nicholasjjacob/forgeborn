import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the build works from any folder or sub-path (and inside app wrappers).
  base: './',
  server: { port: 5173, host: true },
  build: {
    chunkSizeWarningLimit: 450, // PixiJS core lives in the main chunk; renderers load lazily
    target: 'es2022',
    // (no manualChunks: forcing Pixi into one chunk would defeat its lazy-loaded renderer splits)
  },
});
