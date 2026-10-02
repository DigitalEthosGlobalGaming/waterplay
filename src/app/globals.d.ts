/** Injected by Vite `define` (vite.config.ts / vitest.config.ts). */
declare const __BUILD_ID__: string;

/** Optional build-time settings (see README, "Playing online"). */
interface ImportMetaEnv {
  /** Comma-separated TURN urls, for players behind strict NATs. */
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}
