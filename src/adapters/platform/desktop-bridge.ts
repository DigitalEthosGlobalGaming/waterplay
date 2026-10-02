/**
 * The narrow API the Electron preload exposes on `window.waterplayDesktop` via
 * contextBridge (§5.3). Types only; shared by preload and renderer.
 */
export interface DesktopBridge {
  /** Present only in dev builds launched by tools/dev-electron.ts. */
  dev?: DevBridge;
}

export interface DevBridge {
  instance: string;
  role: 'host' | 'client';
  fresh: boolean;
  /** Dev relay to connect through, when the orchestrator started one (§13.4.5). */
  relayUrl: string | null;
  /** Synchronous so it can run inside `vite:beforeFullReload` before the page unloads. */
  loadSession(): string | null;
  saveSession(json: string): void;
  /** Delete this instance's snapshot file. */
  clearSession(): void;
  /** Orchestrator asks for a save before a process restart (§13.4.5). */
  onSaveNow(cb: () => void): void;
  ackSaveNow(): void;
}

declare global {
  interface Window {
    waterplayDesktop?: DesktopBridge;
  }
}
