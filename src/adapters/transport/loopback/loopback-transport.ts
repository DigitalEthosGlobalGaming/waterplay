import type { Unsubscribe } from '../../../core/interfaces/common.ts';
import type {
  Channel,
  ConnectionState,
  PeerId,
  Transport,
} from '../../../core/interfaces/transport.ts';
import { generateShareCode, normalizeShareCode } from '../../../core/net/share-code.ts';
import { Rng } from '../../../core/sim/rng.ts';

export interface LinkConditions {
  /** One-way latency per hop, ms. */
  latencyMs: number;
  /** Uniform extra delay in [0, jitterMs), ms. Can reorder unreliable messages. */
  jitterMs: number;
  /** Probability [0, 1] an unreliable message is dropped. Reliable messages are never dropped. */
  lossRate: number;
}

const PERFECT: LinkConditions = { latencyMs: 0, jitterMs: 0, lossRate: 0 };

interface Pending {
  at: number;
  seq: number;
  deliver: () => void;
}

/**
 * In-memory network shared by LoopbackTransports (§5.2). Runs on a virtual clock:
 * tests call `advance(ms)` (no real waiting); dev mode can call `runRealtime()`.
 *
 * Mirrors the PeerJS star topology: clients only talk to the host, and messages a
 * client addresses to other peers are relayed by the host (so they take two hops).
 */
export class LoopbackNetwork {
  conditions: LinkConditions;
  private now = 0;
  private seq = 0;
  private queue: Pending[] = [];
  private hosts = new Map<string, LoopbackTransport>();
  /** Last scheduled delivery per directed link+channel, for reliable ordering. */
  private lastReliable = new Map<string, number>();
  private readonly rng: Rng;

  constructor(opts: { conditions?: Partial<LinkConditions>; seed?: number } = {}) {
    this.conditions = { ...PERFECT, ...opts.conditions };
    this.rng = new Rng(opts.seed ?? 1);
  }

  get time(): number {
    return this.now;
  }

  /** Advance the virtual clock, delivering everything due, in order. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.queue[0];
      if (!next || next.at > target) break;
      this.queue.shift();
      this.now = next.at;
      next.deliver();
    }
    this.now = target;
  }

  /** Deliver everything currently queued (and anything it triggers). */
  flush(): void {
    while (this.queue.length > 0) {
      const last = Math.max(...this.queue.map((p) => p.at));
      this.advance(last - this.now);
    }
  }

  /** Drive the virtual clock from wall time. Returns a stop function. */
  runRealtime(intervalMs = 4): () => void {
    let last = Date.now();
    const id = setInterval(() => {
      const t = Date.now();
      this.advance(t - last);
      last = t;
    }, intervalMs);
    return () => clearInterval(id);
  }

  createTransport(peerId: string): LoopbackTransport {
    return new LoopbackTransport(this, peerId as PeerId);
  }

  /** @internal */
  registerHost(t: LoopbackTransport): string {
    let code: string;
    do code = generateShareCode(this.rng);
    while (this.hosts.has(code));
    this.hosts.set(code, t);
    return code;
  }

  /** @internal */
  unregisterHost(code: string): void {
    this.hosts.delete(code);
  }

  /** @internal */
  findHost(code: string): LoopbackTransport | undefined {
    return this.hosts.get(code);
  }

  /** @internal Schedule a single hop. Returns false if the message was dropped. */
  schedule(from: PeerId, to: PeerId, channel: Channel, deliver: () => void, hops = 1): boolean {
    const c = this.conditions;
    if (channel === 'unreliable' && c.lossRate > 0) {
      for (let i = 0; i < hops; i++) if (this.rng.next() < c.lossRate) return false;
    }
    let at = this.now;
    for (let i = 0; i < hops; i++)
      at += c.latencyMs + (c.jitterMs > 0 ? this.rng.next() * c.jitterMs : 0);
    if (channel === 'reliable') {
      const key = `${from}>${to}`;
      at = Math.max(at, this.lastReliable.get(key) ?? 0);
      this.lastReliable.set(key, at);
    }
    this.queue.push({ at, seq: this.seq++, deliver });
    return true;
  }

  /** @internal */
  enqueue(deliver: () => void): void {
    this.queue.push({ at: this.now, seq: this.seq++, deliver });
  }
}

type MessageCb = (from: PeerId, channel: Channel, data: Uint8Array) => void;

export class LoopbackTransport implements Transport {
  private hostRef: LoopbackTransport | null = null;
  private shareCode: string | null = null;
  /** Host: connected clients. Client: just the host. */
  private peers = new Set<LoopbackTransport>();
  private state: ConnectionState = 'disconnected';

  private readonly messageCbs = new Set<MessageCb>();
  private readonly joinedCbs = new Set<(p: PeerId) => void>();
  private readonly leftCbs = new Set<(p: PeerId) => void>();
  private readonly stateCbs = new Set<(s: ConnectionState) => void>();

  constructor(
    private readonly net: LoopbackNetwork,
    readonly localId: PeerId,
  ) {}

  get isHost(): boolean {
    return this.shareCode !== null;
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  async host(): Promise<{ shareCode: string }> {
    if (this.state !== 'disconnected')
      throw new Error('LoopbackTransport.host: already in a session');
    this.shareCode = this.net.registerHost(this);
    this.setState('connected');
    return { shareCode: this.shareCode };
  }

  async join(code: string): Promise<void> {
    if (this.state !== 'disconnected')
      throw new Error('LoopbackTransport.join: already in a session');
    const normalised = normalizeShareCode(code);
    const host = normalised ? this.net.findHost(normalised) : undefined;
    if (!host) throw new Error(`No session found for code "${code}"`);
    this.setState('connecting');
    this.hostRef = host;
    this.peers.add(host);
    host.acceptClient(this);
    this.setState('connected');
  }

  async leave(): Promise<void> {
    this.disconnect();
  }

  /**
   * Test helper: the connection drops without a clean leave. In-memory the two
   * look the same to peers; it exists so tests read as what they simulate.
   */
  simulateDrop(): void {
    this.disconnect();
  }

  private disconnect(): void {
    if (this.state === 'disconnected') return;
    if (this.isHost) {
      if (this.shareCode) this.net.unregisterHost(this.shareCode);
      this.shareCode = null;
      for (const client of this.peers) client.hostGone();
    } else {
      this.hostRef?.clientGone(this);
    }
    this.peers.clear();
    this.hostRef = null;
    this.setState('disconnected');
  }

  send(to: PeerId | 'all' | 'host', channel: Channel, data: Uint8Array): void {
    if (this.state !== 'connected') return;
    // Copy so callers can reuse their buffers, as with a real transport.
    const payload = data.slice();
    const from = this.localId;

    if (this.isHost) {
      for (const p of this.peers) {
        if (to === 'all' || p.localId === to)
          this.net.schedule(from, p.localId, channel, () => p.receive(from, channel, payload));
      }
      return;
    }

    const host = this.hostRef;
    if (!host) return;
    if (to === 'host' || to === host.localId) {
      this.net.schedule(from, host.localId, channel, () => host.receive(from, channel, payload));
      return;
    }
    // Relay via host: 'all' reaches the host directly plus every other client in two hops.
    if (to === 'all')
      this.net.schedule(from, host.localId, channel, () => host.receive(from, channel, payload));
    for (const p of host.peers) {
      if (p === this || (to !== 'all' && p.localId !== to)) continue;
      this.net.schedule(from, p.localId, channel, () => p.receive(from, channel, payload), 2);
    }
  }

  onMessage(cb: MessageCb): Unsubscribe {
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

  private acceptClient(client: LoopbackTransport): void {
    this.peers.add(client);
    this.net.enqueue(() => {
      for (const cb of this.joinedCbs) cb(client.localId);
      // Clients learn about the host as a peer too.
      for (const cb of client.joinedCbs) cb(this.localId);
    });
  }

  private clientGone(client: LoopbackTransport): void {
    if (!this.peers.delete(client)) return;
    this.net.enqueue(() => {
      for (const cb of this.leftCbs) cb(client.localId);
    });
  }

  private hostGone(): void {
    const host = this.hostRef;
    this.peers.clear();
    this.hostRef = null;
    this.setState('disconnected');
    if (host)
      this.net.enqueue(() => {
        for (const cb of this.leftCbs) cb(host.localId);
      });
  }

  private receive(from: PeerId, channel: Channel, data: Uint8Array): void {
    if (this.state !== 'connected') return;
    for (const cb of this.messageCbs) cb(from, channel, data);
  }

  private setState(s: ConnectionState): void {
    if (s === this.state) return;
    this.state = s;
    for (const cb of this.stateCbs) cb(s);
  }
}

function subscribe<T>(set: Set<T>, cb: T): Unsubscribe {
  set.add(cb);
  return () => set.delete(cb);
}
