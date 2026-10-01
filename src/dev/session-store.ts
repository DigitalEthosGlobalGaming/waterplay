import type { DevBridge } from '../adapters/platform/desktop-bridge.ts';

/** Synchronous so saves complete inside `vite:beforeFullReload` / `beforeunload`. */
export interface DevSessionStore {
  readonly kind: 'disk' | 'localStorage';
  load(): string | null;
  save(json: string): void;
  /** Forget everything this store saved. */
  clear(): void;
}

/** Electron: main process writes `.dev-sessions/<instance>.json` (§13.4.3). */
export function diskStore(bridge: DevBridge): DevSessionStore {
  return {
    kind: 'disk',
    load: () => bridge.loadSession(),
    save: (json) => bridge.saveSession(json),
    clear: () => bridge.clearSession(),
  };
}

/** Browser `npm run dev`: survives reloads of this tab's origin. */
export function localStorageStore(instance: string): DevSessionStore {
  const key = `waterplay.devSession.${instance}`;
  return {
    kind: 'localStorage',
    load: () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    save: (json) => {
      try {
        localStorage.setItem(key, json);
      } catch {
        // Storage full or blocked: losing a dev snapshot is fine.
      }
    },
    clear: () => {
      // Every waterplay key, not just this instance: a reset means a clean slate.
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('waterplay.')) localStorage.removeItem(k);
        }
      } catch {
        // Blocked storage: nothing to clear.
      }
    },
  };
}
