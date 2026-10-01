import type { Unsubscribe } from './common.ts';

/** Platform seam (§5.3): web build vs Electron + Steam. */
export interface Platform {
  readonly kind: 'web' | 'steam';
  getPlayerName(): string;
  unlockAchievement(id: string): void;
  /** Steam Cloud on Steam, IndexedDB on web. */
  saveData(key: string, data: Uint8Array): Promise<void>;
  loadData(key: string): Promise<Uint8Array | null>;
  /** Steam only. */
  openInviteOverlay?(): void;
  onJoinRequested?(cb: (shareCodeOrLobby: string) => void): Unsubscribe;
}
