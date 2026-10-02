import type { Plugin } from 'vite';

const ID = 'virtual:build-id';
const RESOLVED = `\0${ID}`;

/**
 * `import { BUILD_ID } from 'virtual:build-id'` (§13.4.3, §13.4.5).
 *
 * Production: one id per build. Dev: it also changes on every code edit that
 * reloads the page, so dev instances can tell when a peer is still on the old
 * code. Data files hot-swap without a reload, so they leave it alone.
 */
export function buildIdPlugin(fixed?: string): Plugin {
  const start = fixed ?? Date.now().toString(36);
  let edits = 0;
  return {
    name: 'waterplay-build-id',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load: (id) => {
      if (id !== RESOLVED) return undefined;
      const value = edits === 0 ? start : `${start}.${edits}`;
      return `export const BUILD_ID = ${JSON.stringify(value)};`;
    },
    hotUpdate(options) {
      if (this.environment.name !== 'client' || !reloadsPage(options.file)) return;
      edits++;
      const graph = this.environment.moduleGraph;
      const mod = graph.getModuleById(RESOLVED);
      if (mod) graph.invalidateModule(mod);
    },
  };
}

/** Code outside src/data has no HMR boundary: editing it reloads the page. */
function reloadsPage(file: string): boolean {
  const f = file.replaceAll('\\', '/');
  return /\/(src|apps\/web)\//.test(f) && /\.ts$/.test(f) && !f.includes('/src/data/');
}
