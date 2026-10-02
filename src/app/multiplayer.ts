import { BUILD_ID } from 'virtual:build-id';
import type { Transport } from '../core/interfaces/transport.ts';
import { NetSession, type NetWorld } from '../core/net/net-session.ts';
import { formatShareCode } from '../core/net/share-code.ts';
import { loadPlayerName, savePlayerName } from './player-name.ts';

/** Per tab: a host that refreshes comes back on the same code so friends reconnect. */
const HOSTING_KEY = 'waterplay.hostingCode';
const JOIN_PARAM = 'join';

export interface NetSnapshot {
  role: 'host' | 'client' | 'offline';
  sessionCode: string;
  localPeerId: string;
}

/**
 * App-side multiplayer: owns the NetSession and everything browser-specific
 * around it (invite links, the ?join= URL, re-hosting after a refresh, the
 * saved player name).
 */
export class Multiplayer {
  readonly session: NetSession;
  /** Only the first resume (dev snapshot or page URL) acts. */
  private resumed = false;

  constructor(world: NetWorld, createTransport: () => Transport) {
    this.session = new NetSession({
      createTransport,
      world,
      name: loadPlayerName(),
      buildId: BUILD_ID,
      // Dev instances wait for each other to finish reloading (§13.4.5).
      strictBuild: import.meta.env.DEV,
    });
    // Keep the URL and tab storage in step with the session, so a refresh puts you back.
    this.session.onStatus((s) => {
      if (s.kind === 'hosting') {
        writeSession(HOSTING_KEY, s.code);
        setJoinParam(null);
      } else if (s.kind === 'connected') {
        writeSession(HOSTING_KEY, null);
        setJoinParam(s.code);
      } else if (s.kind === 'offline') {
        writeSession(HOSTING_KEY, null);
        setJoinParam(null);
      }
    });
  }

  /** On page load: follow an invite link, or carry on hosting after a refresh. */
  resumeFromPage(): void {
    if (this.resumed) return;
    this.resumed = true;
    const join = new URLSearchParams(location.search).get(JOIN_PARAM);
    if (join) {
      // A bad code still goes through join(), which explains what's wrong with it.
      void this.session.join(join);
      return;
    }
    const hosting = readSession(HOSTING_KEY);
    if (hosting) void this.session.host(hosting);
  }

  /** Dev restore (§13.4): rejoin or re-host whatever the snapshot was in. */
  resumeFromSnapshot(net: NetSnapshot): void {
    if (this.resumed || !net.sessionCode) return;
    this.resumed = true;
    if (net.role === 'host') void this.session.host(net.sessionCode);
    else if (net.role === 'client') void this.session.join(net.sessionCode);
  }

  /**
   * Dev instances on the relay (§13.4.5): the host always hosts the fixed dev
   * code and clients keep trying to join it, whatever the snapshot said.
   */
  resumeDev(role: 'host' | 'client', code: string): void {
    if (this.resumed) return;
    this.resumed = true;
    if (role === 'host') void this.session.host(code);
    else void this.session.join(code, { keepTrying: true });
  }

  snapshot(): NetSnapshot {
    const s = this.session.status;
    const code = 'code' in s ? s.code : '';
    const role = s.kind === 'hosting' ? 'host' : code ? 'client' : 'offline';
    return { role, sessionCode: code, localPeerId: this.session.localId ?? '' };
  }

  host(): Promise<void> {
    return this.session.host();
  }

  join(code: string): Promise<void> {
    return this.session.join(code);
  }

  leave(): Promise<void> {
    return this.session.leave();
  }

  get name(): string {
    return this.session.name;
  }

  setName(name: string): void {
    this.session.setName(name);
    savePlayerName(this.session.name);
  }

  /** Link that drops a friend straight into this game. */
  inviteLink(): string | null {
    const s = this.session.status;
    if (s.kind !== 'hosting' && s.kind !== 'connected') return null;
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set(JOIN_PARAM, formatShareCode(s.code));
    return url.toString();
  }

  async copyInviteLink(): Promise<boolean> {
    const link = this.inviteLink();
    if (!link) return false;
    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch {
      return false;
    }
  }
}

function setJoinParam(code: string | null): void {
  const url = new URL(location.href);
  const current = url.searchParams.get(JOIN_PARAM);
  const wanted = code ? formatShareCode(code) : null;
  if (current === wanted) return;
  if (wanted) url.searchParams.set(JOIN_PARAM, wanted);
  else url.searchParams.delete(JOIN_PARAM);
  history.replaceState(history.state, '', url);
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: refresh just won't resume the session.
  }
}
