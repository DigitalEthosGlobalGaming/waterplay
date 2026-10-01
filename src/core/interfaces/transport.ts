import type { Unsubscribe } from './common.ts';

export type PeerId = string & { __brand: 'PeerId' };

export type Channel = 'reliable' | 'unreliable';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/**
 * Networking seam (§5.2). Star topology: clients connect to the host only, and the
 * host's transport relays messages addressed to other peers. `from` is always the
 * original sender.
 */
export interface Transport {
  readonly localId: PeerId;
  readonly isHost: boolean;

  /** Host: create a session and return a short share code. */
  host(): Promise<{ shareCode: string }>;
  /** Client: join using a share code. */
  join(shareCode: string): Promise<void>;
  leave(): Promise<void>;

  send(to: PeerId | 'all' | 'host', channel: Channel, data: Uint8Array): void;

  onMessage(cb: (from: PeerId, channel: Channel, data: Uint8Array) => void): Unsubscribe;
  onPeerJoined(cb: (peer: PeerId) => void): Unsubscribe;
  onPeerLeft(cb: (peer: PeerId) => void): Unsubscribe;
  onConnectionStateChanged(cb: (s: ConnectionState) => void): Unsubscribe;
}
