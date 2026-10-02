import { type DataConnection, Peer, type PeerError } from 'peerjs';
import type { Unsubscribe } from '../../../core/interfaces/common.ts';
import type {
  Channel,
  ConnectionState,
  PeerId,
  Transport,
} from '../../../core/interfaces/transport.ts';
import {
  formatShareCode,
  generateShareCode,
  normalizeShareCode,
} from '../../../core/net/share-code.ts';
import { Rng } from '../../../core/sim/rng.ts';
import { netTunables } from '../../../data/net.ts';

/** Every brokered id starts with this, so codes can't collide with other PeerJS apps. */
const ID_PREFIX = 'waterplay-';
const SIGNALLING_TIMEOUT_MS = 15_000;
/**
 * Data channels normally open in 1–3 s. Kept short because a host that just
 * refreshed can briefly leave a dead id behind: an attempt aimed at it hangs
 * until this timeout, and only then can the client retry against the new one.
 */
const CONNECT_TIMEOUT_MS = 8_000;
/** After a refresh the signalling server can hold on to the old host id briefly. */
const PREFERRED_CODE_RETRIES = 4;
const PREFERRED_CODE_RETRY_MS = 1500;

const LABEL: Record<Channel, string> = { reliable: 'r', unreliable: 'u' };

interface Link {
  peer: PeerId;
  reliable?: DataConnection;
  unreliable?: DataConnection;
  /** Both channels open and peerJoined emitted. */
  ready: boolean;
}

/**
 * Transport over WebRTC data channels, brokered by the free PeerJS cloud
 * server (§5.2). Star topology: clients connect only to the host, which relays.
 *
 * Each link is two DataConnections: an ordered reliable one and an unordered
 * one for frequent state. Messages are raw bytes inside a small envelope that
 * says who a relayed message is from (host → client) or for (client → host).
 */
export class PeerJsTransport implements Transport {
  private peer: Peer | null = null;
  private id: PeerId;
  private hosting = false;
  private state: ConnectionState = 'disconnected';
  /** Host: one per client. Client: just the host. */
  private readonly links = new Map<PeerId, Link>();
  private hostPeer: PeerId | null = null;

  private readonly messageCbs = new Set<(from: PeerId, ch: Channel, d: Uint8Array) => void>();
  private readonly joinedCbs = new Set<(p: PeerId) => void>();
  private readonly leftCbs = new Set<(p: PeerId) => void>();
  private readonly stateCbs = new Set<(s: ConnectionState) => void>();
  private readonly onPageHide = () => this.peer?.destroy();

  constructor() {
    this.id = `${ID_PREFIX}p-${randomToken(10)}` as PeerId;
    // Closing the tab tells the other side straight away instead of after an ICE timeout.
    window.addEventListener('pagehide', this.onPageHide);
  }

  get localId(): PeerId {
    return this.id;
  }

  get isHost(): boolean {
    return this.hosting;
  }

  async host(preferredCode?: string): Promise<{ shareCode: string }> {
    this.assertIdle();
    const preferred = preferredCode ? normalizeShareCode(preferredCode) : null;
    const rng = new Rng(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
    for (let attempt = 0; attempt < 10; attempt++) {
      const usePreferred = preferred !== null && attempt < PREFERRED_CODE_RETRIES;
      const code = usePreferred ? preferred : generateShareCode(rng);
      try {
        this.peer = await openPeer(`${ID_PREFIX}${code}`);
      } catch (e) {
        if (errorType(e) !== 'unavailable-id') throw friendlyError(e);
        if (usePreferred) await delay(PREFERRED_CODE_RETRY_MS);
        continue;
      }
      this.id = this.peer.id as PeerId;
      this.hosting = true;
      this.watchSignalling(this.peer);
      this.peer.on('connection', (conn) => this.acceptConnection(conn));
      this.setState('connected');
      return { shareCode: code };
    }
    throw new Error("Couldn't get a game code from the server. Try again in a moment.");
  }

  async join(input: string): Promise<void> {
    this.assertIdle();
    const code = normalizeShareCode(input);
    if (!code) throw new Error(`"${input}" isn't a game code. Codes look like K7M-Q4X.`);
    this.setState('connecting');
    try {
      const peer = await openPeer(this.id);
      this.peer = peer;
      this.watchSignalling(peer);
      const hostId = `${ID_PREFIX}${code}` as PeerId;
      const link: Link = { peer: hostId, ready: false };
      this.links.set(hostId, link);
      this.hostPeer = hostId;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(new Error("Couldn't connect to the host. Their network may be blocking it.")),
          CONNECT_TIMEOUT_MS,
        );
        const fail = (e: PeerError<string>) => {
          clearTimeout(timer);
          reject(
            e.type === 'peer-unavailable'
              ? new Error(
                  `No game found for code ${formatShareCode(code)}. Check the code with the host.`,
                )
              : friendlyError(e),
          );
        };
        peer.once('error', fail);
        for (const channel of ['reliable', 'unreliable'] as const) {
          const conn = peer.connect(hostId, {
            label: LABEL[channel],
            reliable: channel === 'reliable',
            serialization: 'raw',
          });
          this.wire(link, channel, conn, () => {
            clearTimeout(timer);
            peer.off('error', fail);
            resolve();
          });
        }
      });
      this.setState('connected');
    } catch (e) {
      this.shutdown();
      throw e;
    }
  }

  async leave(): Promise<void> {
    this.shutdown();
    window.removeEventListener('pagehide', this.onPageHide);
  }

  send(to: PeerId | 'all' | 'host', channel: Channel, data: Uint8Array): void {
    if (this.state !== 'connected') return;
    if (this.hosting) {
      for (const link of this.links.values()) {
        if (to === 'all' || to === link.peer) this.write(link, channel, this.id, data);
      }
      return;
    }
    const host = this.hostPeer ? this.links.get(this.hostPeer) : undefined;
    if (!host) return;
    const target = to === 'host' || to === this.hostPeer ? '' : to === 'all' ? '*' : to;
    this.write(host, channel, target, data);
  }

  onMessage(cb: (from: PeerId, channel: Channel, data: Uint8Array) => void): Unsubscribe {
    return subscribe(this.messageCbs, cb);
  }

  onPeerJoined(cb: (peer: PeerId) => void): Unsubscribe {
    return subscribe(this.joinedCbs, cb);
  }

  onPeerLeft(cb: (peer: PeerId) => void): Unsubscribe {
    return subscribe(this.leftCbs, cb);
  }

  onConnectionStateChanged(cb: (s: ConnectionState) => void): Unsubscribe {
    return subscribe(this.stateCbs, cb);
  }

  // --- Internals ---------------------------------------------------------------

  private assertIdle(): void {
    if (this.peer) throw new Error('PeerJsTransport: already in a session; create a new one');
  }

  /** Keep the signalling connection alive so the host stays joinable. */
  private watchSignalling(peer: Peer): void {
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
  }

  /** Host: a client opened one of its two channels. */
  private acceptConnection(conn: DataConnection): void {
    const channel =
      conn.label === LABEL.reliable
        ? 'reliable'
        : conn.label === LABEL.unreliable
          ? 'unreliable'
          : null;
    if (!channel || conn.serialization !== 'raw') {
      conn.close();
      return;
    }
    const peerId = conn.peer as PeerId;
    let link = this.links.get(peerId);
    if (!link) {
      link = { peer: peerId, ready: false };
      this.links.set(peerId, link);
    }
    this.wire(link, channel, conn);
  }

  private wire(link: Link, channel: Channel, conn: DataConnection, onReady?: () => void): void {
    link[channel]?.close();
    link[channel] = conn;
    conn.on('open', () => {
      if (link.ready || !link.reliable?.open || !link.unreliable?.open) return;
      link.ready = true;
      onReady?.();
      for (const cb of this.joinedCbs) cb(link.peer);
    });
    conn.on('data', (raw) => {
      if (!link.ready || !(raw instanceof ArrayBuffer)) return;
      this.receive(link, channel, new Uint8Array(raw));
    });
    const drop = () => {
      if (link[channel] === conn) this.dropLink(link);
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  private dropLink(link: Link): void {
    if (this.links.get(link.peer) !== link) return;
    this.links.delete(link.peer);
    const wasReady = link.ready;
    link.ready = false;
    link.reliable?.close();
    link.unreliable?.close();
    if (wasReady) for (const cb of this.leftCbs) cb(link.peer);
    if (!this.hosting && link.peer === this.hostPeer) this.shutdown();
  }

  private receive(link: Link, channel: Channel, bytes: Uint8Array): void {
    const env = readEnvelope(bytes);
    if (!env) return;
    if (!this.hosting) {
      // From the host: the envelope names the original sender.
      const from = (env.peer || link.peer) as PeerId;
      for (const cb of this.messageCbs) cb(from, channel, env.payload);
      return;
    }
    // At the host: the envelope says where the client wants it to go.
    const from = link.peer;
    const to = env.peer;
    if (to === '' || to === '*' || to === this.id) {
      for (const cb of this.messageCbs) cb(from, channel, env.payload);
    }
    if (to === '' || to === this.id) return;
    for (const other of this.links.values()) {
      if (other === link || (to !== '*' && other.peer !== to)) continue;
      this.write(other, channel, from, env.payload);
    }
  }

  private write(link: Link, channel: Channel, peer: string, payload: Uint8Array): void {
    const conn = link[channel];
    if (!link.ready || !conn?.open) return;
    void conn.send(writeEnvelope(peer, payload));
  }

  private shutdown(): void {
    const peer = this.peer;
    this.peer = null;
    const links = [...this.links.values()];
    this.links.clear();
    for (const link of links) {
      link.reliable?.close();
      link.unreliable?.close();
    }
    if (!this.hosting) {
      const host = this.hostPeer;
      const wasConnected = links.some((l) => l.ready);
      this.hostPeer = null;
      if (host && wasConnected) for (const cb of this.leftCbs) cb(host);
    }
    peer?.destroy();
    this.setState('disconnected');
  }

  private setState(s: ConnectionState): void {
    if (s === this.state) return;
    this.state = s;
    for (const cb of this.stateCbs) cb(s);
  }
}

/** Resolves once the signalling server has accepted our id. */
function openPeer(id: string): Promise<Peer> {
  const turn = turnServer();
  const peer = new Peer(id, {
    debug: 1,
    config: { iceServers: [...netTunables.iceServers, ...(turn ? [turn] : [])] },
  });
  return new Promise((resolve, reject) => {
    const fail = (e: unknown) => {
      clearTimeout(timer);
      peer.destroy();
      reject(e);
    };
    const timer = setTimeout(
      () => fail(new Error("Couldn't reach the matchmaking server. Check your connection.")),
      SIGNALLING_TIMEOUT_MS,
    );
    peer.once('error', fail);
    peer.once('open', () => {
      clearTimeout(timer);
      peer.off('error', fail);
      resolve(peer);
    });
  });
}

/** Optional TURN relay from build-time env (needs an account, e.g. Cloudflare or Metered). */
function turnServer(): RTCIceServer | null {
  const env = import.meta.env;
  const urls = env.VITE_TURN_URL;
  if (typeof urls !== 'string' || urls === '') return null;
  return {
    urls: urls.split(',').map((u) => u.trim()),
    username: env.VITE_TURN_USERNAME,
    credential: env.VITE_TURN_CREDENTIAL,
  };
}

function errorType(e: unknown): string {
  return typeof e === 'object' && e !== null && 'type' in e ? String(e.type) : '';
}

function friendlyError(e: unknown): Error {
  switch (errorType(e)) {
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return new Error("Couldn't reach the matchmaking server. Check your connection.");
    case 'browser-incompatible':
      return new Error("This browser can't play online (no WebRTC).");
    case 'webrtc':
      return new Error(
        "Couldn't connect to the other player. A strict network may be blocking it.",
      );
    default:
      return e instanceof Error ? e : new Error(String(e));
  }
}

// --- Envelope: [peer length u8][peer utf8][payload] ----------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeEnvelope(peer: string, payload: Uint8Array): Uint8Array {
  const p = encoder.encode(peer);
  const out = new Uint8Array(1 + p.length + payload.length);
  out[0] = p.length;
  out.set(p, 1);
  out.set(payload, 1 + p.length);
  return out;
}

function readEnvelope(bytes: Uint8Array): { peer: string; payload: Uint8Array } | null {
  const len = bytes[0];
  if (len === undefined || bytes.length < 1 + len) return null;
  return {
    peer: decoder.decode(bytes.subarray(1, 1 + len)),
    payload: bytes.subarray(1 + len),
  };
}

function randomToken(length: number): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(length))]
    .map((b) => alphabet[b % alphabet.length])
    .join('');
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function subscribe<T>(set: Set<T>, cb: T): Unsubscribe {
  set.add(cb);
  return () => set.delete(cb);
}
