import type { Game } from '../app/game.ts';
import { restoreSession, serializeSession } from '../app/session.ts';
import { parseDevFlags } from './dev-flags.ts';
import { DevIndicator } from './dev-indicator.ts';
import { type DevSessionStore, diskStore, localStorageStore } from './session-store.ts';

const SAFETY_SAVE_INTERVAL_MS = 2000;

export interface DevSessionControls {
  /** Wipe the saved session and tuning overrides, then reload into a fresh game. */
  resetGame(): void;
}

/**
 * Dev session persistence (§13.4): restore on boot, save before every reload,
 * on orchestrator request, and every 2s as a safety net. Only ever imported
 * behind `import.meta.env.DEV`.
 */
export function installDevSession(game: Game): DevSessionControls {
  const bridge = window.waterplayDesktop?.dev;
  const flags = parseDevFlags(location.search, {
    instance: bridge?.instance ?? 'web',
    fresh: bridge?.fresh ?? false,
  });
  const store: DevSessionStore = bridge ? diskStore(bridge) : localStorageStore(flags.instance);
  const indicator = new DevIndicator(flags.instance, bridge?.role ?? 'solo', __BUILD_ID__);

  game.devFlags = { ...flags.flags };

  if (flags.fresh) {
    indicator.setRestore(null);
  } else {
    const json = store.load();
    if (json) {
      // restoreSession never throws; applySession only applies what parsed.
      const restored = restoreSession(json);
      game.applySession(restored);
      // Electron dev instances pick their session back up after a restart. Browser tabs
      // share localStorage, so they rely on the per-tab page state instead.
      if (bridge && restored.net) game.multiplayer.resumeFromSnapshot(restored.net);
      indicator.setRestore({ warnings: restored.warnings, storeKind: store.kind });
      if (restored.warnings.length)
        console.warn('[dev] partial session restore:', restored.warnings);
    } else {
      indicator.setRestore(null);
    }
  }

  // Set during a reset so the safety/unload saves can't write the old state back.
  let resetting = false;
  const save = () => {
    if (resetting) return;
    try {
      store.save(
        serializeSession(game.captureSession(), {
          buildId: __BUILD_ID__,
          instance: flags.instance,
          savedAt: Date.now(),
        }),
      );
    } catch (e) {
      console.warn('[dev] session save failed', e);
    }
  };

  import.meta.hot?.on('vite:beforeFullReload', save);
  window.addEventListener('beforeunload', save);
  setInterval(save, SAFETY_SAVE_INTERVAL_MS);
  bridge?.onSaveNow(() => {
    save();
    bridge.ackSaveNow();
  });

  return {
    resetGame: () => {
      resetting = true;
      // Overrides live in the snapshot, so clearing the store drops them too.
      store.clear();
      console.info(`[dev] session cleared (${store.kind}); reloading fresh`);
      location.reload();
    },
  };
}
