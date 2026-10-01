/**
 * Production build of Electron main + preload. Packaging (electron-builder) and
 * steamworks.js arrive in M8.
 */
import { build } from 'esbuild';
import { electronBuildOptions } from './electron-esbuild.ts';

await build(electronBuildOptions(false));
console.log('Built dist-electron/');
