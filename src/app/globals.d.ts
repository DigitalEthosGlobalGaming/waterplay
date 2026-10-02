/** Provided by tools/vite-build-id.ts. Changes with every page-reloading edit in dev. */
declare module 'virtual:build-id' {
  export const BUILD_ID: string;
}

/** Optional build-time settings (see README, "Playing online"). */
interface ImportMetaEnv {
  /** Comma-separated TURN urls, for players behind strict NATs. */
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}
