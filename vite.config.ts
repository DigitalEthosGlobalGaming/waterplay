import { defineConfig } from 'vite';
import { buildIdPlugin } from './tools/vite-build-id.ts';

export default defineConfig({
  root: 'apps/web',
  // Relative asset URLs so the production build also loads from file:// in Electron.
  base: './',
  // Kenney GLBs and other static assets are served from /assets/...
  publicDir: '../../assets',
  // BUILD_ID distinguishes builds in session snapshots, the dev indicator and the
  // dev build handshake (§13.4.3, §13.4.5).
  plugins: [buildIdPlugin()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    target: 'es2023',
    // Three.js (~600 kB) + Rapier with its WASM embedded as base64 (~5 MB, ~1.8 MB gzipped).
    chunkSizeWarningLimit: 5500,
  },
});
