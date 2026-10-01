import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps/web',
  // Relative asset URLs so the production build also loads from file:// in Electron.
  base: './',
  // Kenney GLBs and other static assets are served from /assets/...
  publicDir: '../../assets',
  define: {
    // Distinguishes builds in session snapshots and the dev indicator (§13.4.3).
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  server: { port: 5173, strictPort: true },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    target: 'es2023',
    // Three.js (~600 kB) + Rapier with its WASM embedded as base64 (~5 MB, ~1.8 MB gzipped).
    chunkSizeWarningLimit: 5500,
  },
});
