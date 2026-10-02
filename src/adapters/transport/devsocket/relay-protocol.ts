import type { Channel } from '../../../core/interfaces/transport.ts';

/**
 * Wire format between DevSocketTransport and the dev relay (tools/dev-relay.ts,
 * §13.4.2). Dev only: the relay is a localhost WebSocket server that stands in
 * for PeerJS so dev instances connect instantly, offline, with fixed peer ids.
 *
 * Control messages are JSON text frames. Game data is binary:
 *   [peer length u8][peer utf8][channel u8][payload]
 * Outgoing, `peer` is the target ('' = host, '*' = everyone else, or an id).
 * Incoming, it's the original sender.
 */

/** Every dev run uses the same code, so nobody re-enters one after a reload (§13.4.5). */
export const DEV_SESSION_CODE = 'DEVDEV';

export type RelayRequest = { op: 'host'; code: string } | { op: 'join'; code: string };

export type RelayEvent =
  | { op: 'hosted'; code: string }
  | { op: 'joined'; host: string }
  | { op: 'error'; message: string }
  | { op: 'peerJoined'; peer: string }
  | { op: 'peerLeft'; peer: string }
  | { op: 'hostLeft' };

/** Close code the relay uses when the same peer id connects again (a reload). */
export const RELAY_CLOSE_REPLACED = 4001;

export const RELAY_TARGET_HOST = '';
export const RELAY_TARGET_ALL = '*';

const CHANNELS: readonly Channel[] = ['reliable', 'unreliable'];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function writeRelayFrame(
  peer: string,
  channel: Channel,
  payload: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const p = encoder.encode(peer);
  const out = new Uint8Array(2 + p.length + payload.length);
  out[0] = p.length;
  out.set(p, 1);
  out[1 + p.length] = CHANNELS.indexOf(channel);
  out.set(payload, 2 + p.length);
  return out;
}

export function readRelayFrame(
  bytes: Uint8Array,
): { peer: string; channel: Channel; payload: Uint8Array } | null {
  const len = bytes[0];
  if (len === undefined || bytes.length < 2 + len) return null;
  const channel = CHANNELS[bytes[1 + len] ?? -1];
  if (!channel) return null;
  return {
    peer: decoder.decode(bytes.subarray(1, 1 + len)),
    channel,
    payload: bytes.subarray(2 + len),
  };
}
