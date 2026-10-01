import type { BuildOptions } from 'esbuild';

/** esbuild options for Electron main + preload, shared by dev and production builds. */
export function electronBuildOptions(dev: boolean): BuildOptions {
  return {
    entryPoints: ['apps/desktop/main.ts', 'apps/desktop/preload.ts'],
    outdir: 'dist-electron',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    // Sandboxed preloads must be CommonJS; main follows suit for simplicity.
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: dev ? 'inline' : false,
    define: { __DEV__: JSON.stringify(dev) },
    // Folds `if (false)` branches so dev-only IPC is stripped from production (§13.4.9).
    minifySyntax: !dev,
    treeShaking: true,
    logLevel: 'warning',
  };
}
