import { liveTunable } from './registry.ts';

/** Multiplayer (§8). Read live; tuning applies to the running session. */
export interface NetTunables {
  /** Boat state broadcasts per second. */
  sendRateHz: number;
  /** Remote boats are drawn this far (s) in the past so there's always a newer state to blend to. */
  interpolationDelay: number;
  /** Past the newest state, remote boats coast on their velocity for at most this long (s). */
  maxExtrapolation: number;
  /** Client → host clock pings, seconds apart. */
  pingInterval: number;
  /** Clock errors bigger than this (s) snap instead of easing in. */
  clockSnapThreshold: number;
  /** Share of a pending clock correction applied per step. */
  clockEaseRate: number;
  /** A client tries to get back to a vanished host for this long (s) before giving up. */
  reconnectWindow: number;
  /** First retry comes this soon (s); each one after waits twice as long, up to reconnectInterval. */
  reconnectFirstDelay: number;
  reconnectInterval: number;
  /** How long (s) a joining client waits for the host's Welcome. */
  welcomeTimeout: number;
  /** A remote boat with no news for this long (s) is removed. */
  staleTimeout: number;
  /** Boat-on-boat bumps between players: spring (1/s²) and damper (1/s) on the reduced mass. */
  contactStiffness: number;
  contactDamping: number;
  /** WebRTC ICE servers. TURN (for strict NATs) needs an account; see README. */
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
}

export const netTunables = liveTunable<NetTunables>('net', {
  sendRateHz: 20,
  interpolationDelay: 0.12,
  maxExtrapolation: 0.25,
  pingInterval: 2,
  clockSnapThreshold: 1,
  clockEaseRate: 0.05,
  reconnectWindow: 20,
  reconnectFirstDelay: 0.1,
  reconnectInterval: 2,
  welcomeTimeout: 10,
  staleTimeout: 10,
  contactStiffness: 150,
  contactDamping: 20,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }],
});

import.meta.hot?.accept();
