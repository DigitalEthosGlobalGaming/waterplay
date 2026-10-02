import type { BoatTypeId } from '../../data/boats.ts';
import { netTunables } from '../../data/net.ts';
import { simTunables } from '../../data/sim.ts';
import type { BoatState } from '../boats/boat.ts';
import type { RemoteHull } from '../boats/contacts.ts';
import type { Unsubscribe } from '../interfaces/common.ts';
import type { Channel, PeerId, Transport } from '../interfaces/transport.ts';
import { InterpolationBuffer, wrapDelta } from './interpolation.ts';
import { cleanName, decodeMessage, encodeMessage, type NetMessage } from './protocol.ts';
import { normalizeShareCode } from './share-code.ts';

export type NetStatus =
  | { kind: 'offline'; error?: string }
  | { kind: 'starting' }
  | { kind: 'hosting'; code: string }
  | { kind: 'joining'; code: string }
  | { kind: 'connected'; code: string }
  | { kind: 'reconnecting'; code: string };

/** What the session needs from the game world. */
export interface NetWorld {
  readonly seed: number;
  readonly worldClock: number;
  setWorldClock(t: number): void;
  /** Boats this peer simulates and broadcasts. */
  ownedBoats(): BoatState[];
}

export interface NetSessionOptions {
  /** A fresh, unconnected transport. Called for every host/join attempt. */
  createTransport: () => Transport;
  world: NetWorld;
  name: string;
  buildId: string;
  /**
   * Host turns away clients on a different build (dev, §13.4.5). They keep
   * retrying, since the older side is about to reload. Off in production, where
   * any two builds with the same PROTOCOL_VERSION can play together.
   */
  strictBuild?: boolean;
}

export interface NetPlayer {
  peerId: PeerId;
  name: string;
  isHost: boolean;
  isLocal: boolean;
}

export interface RemoteBoat extends RemoteHull {
  peerId: PeerId;
  name: string;
  throttle: number;
}

interface Remote {
  peerId: PeerId;
  boatType: BoatTypeId;
  buffer: InterpolationBuffer;
  /** Session time the last state arrived. */
  heardAt: number;
}

/** Reject reason: the host is on a different build. Retried, not fatal. */
export const REJECT_BUILD = 'build';

export const INCOMPATIBLE_MESSAGE =
  'That game is running a different version of Waterplay. Refresh both pages to update.';

/**
 * One multiplayer session (§8): host or client, over any Transport. Pure: time
 * only moves when the game calls tick() once per sim step.
 *
 * - Clients say hello; the host welcomes them with its world clock and roster.
 * - Every peer broadcasts the boats it owns ~20×/s on the unreliable channel;
 *   everyone else draws them a little in the past, interpolated.
 * - Clients keep their world clock in step with the host via ping/pong.
 * - If the host disappears, clients keep retrying the same code for a while
 *   (the host may just be refreshing) before ending the session.
 */
export class NetSession {
  private _status: NetStatus = { kind: 'offline' };
  private transport: Transport | null = null;
  private unsubs: Unsubscribe[] = [];
  /** Bumped on every host/join/leave so stale async results are ignored. */
  private generation = 0;
  private code = '';
  private hostId: PeerId | null = null;
  private localName: string;
  private readonly roster = new Map<PeerId, string>();
  private readonly remotes = new Map<string, Remote>();
  private readonly lastSeq = new Map<PeerId, number>();
  private readonly departed = new Set<PeerId>();

  /** Seconds of session time, advanced by tick(). */
  private elapsed = 0;
  private sendDebt = 0;
  private seq = 0;
  private nextPingAt = 0;
  private clockSynced = false;
  private pendingClockCorrection = 0;
  private welcomeDeadline = Number.POSITIVE_INFINITY;
  private reconnect: {
    until: number;
    nextAttemptAt: number;
    /** Seconds until the next attempt after this one; doubles up to reconnectInterval. */
    backoff: number;
    attempting: boolean;
  } | null = null;
  /** Shown once per wait, so retries against an old-build host don't spam. */
  private waitingForBuild = false;

  private readonly statusCbs = new Set<(s: NetStatus) => void>();
  private readonly noticeCbs = new Set<(text: string) => void>();

  constructor(private readonly opts: NetSessionOptions) {
    this.localName = cleanName(opts.name);
  }

  get status(): NetStatus {
    return this._status;
  }

  get name(): string {
    return this.localName;
  }

  get isHost(): boolean {
    return this._status.kind === 'hosting';
  }

  /** Our id on the network, while in a session. */
  get localId(): PeerId | null {
    return this.transport?.localId ?? null;
  }

  /** In a session where boats are flowing. */
  get online(): boolean {
    const k = this._status.kind;
    return k === 'hosting' || k === 'connected';
  }

  onStatus(cb: (s: NetStatus) => void): Unsubscribe {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  /** Short human-readable events ("Ana joined"). */
  onNotice(cb: (text: string) => void): Unsubscribe {
    this.noticeCbs.add(cb);
    return () => this.noticeCbs.delete(cb);
  }

  players(): NetPlayer[] {
    const local = this.localId;
    return [...this.roster].map(([peerId, name]) => ({
      peerId,
      name,
      isHost: this.isHost ? peerId === local : peerId === this.hostId,
      isLocal: peerId === local,
    }));
  }

  setName(name: string): void {
    this.localName = cleanName(name);
    const id = this.localId;
    if (!id || !this.online) return;
    this.roster.set(id, this.localName);
    const player = { peerId: id, name: this.localName };
    this.send(this.isHost ? 'all' : 'host', 'reliable', { type: 'playerJoined', player });
  }

  async host(preferredCode?: string): Promise<void> {
    await this.teardown();
    const gen = this.generation;
    const t = this.opts.createTransport();
    this.setStatus({ kind: 'starting' });
    try {
      const { shareCode } = await t.host(preferredCode);
      if (gen !== this.generation) return void (await t.leave());
      this.attach(t, shareCode);
      this.roster.set(t.localId, this.localName);
      this.setStatus({ kind: 'hosting', code: shareCode });
    } catch (e) {
      if (gen === this.generation) this.setStatus({ kind: 'offline', error: errorText(e) });
    }
  }

  /**
   * `keepTrying` retries for the reconnect window instead of failing when
   * nobody is hosting yet (dev instances starting together).
   */
  async join(input: string, opts: { keepTrying?: boolean } = {}): Promise<void> {
    const code = normalizeShareCode(input);
    if (!code) {
      this.setStatus({
        kind: 'offline',
        error: `"${input}" isn't a game code. Codes look like K7M-Q4X.`,
      });
      return;
    }
    await this.teardown();
    this.setStatus({ kind: 'joining', code });
    if (opts.keepTrying) {
      this.code = code;
      this.startRetrying(0);
      return;
    }
    await this.connect(code);
  }

  async leave(): Promise<void> {
    await this.teardown();
    this.setStatus({ kind: 'offline' });
  }

  /** Call once per sim step, after Sim.step(). */
  tick(dt: number): void {
    this.elapsed += dt;
    const n = netTunables;

    if (this.pendingClockCorrection !== 0) {
      const step = this.pendingClockCorrection * n.clockEaseRate;
      this.pendingClockCorrection = Math.abs(step) < 1e-6 ? 0 : this.pendingClockCorrection - step;
      this.opts.world.setWorldClock(this.opts.world.worldClock + step);
    }

    this.tickReconnect();
    if (this._status.kind === 'joining' && !this.reconnect && this.elapsed > this.welcomeDeadline) {
      void this.fail("The host didn't answer. Check the code and try again.");
      return;
    }
    if (!this.online) return;

    // Boats out.
    this.sendDebt += dt * n.sendRateHz;
    if (this.sendDebt >= 1) {
      this.sendDebt = Math.min(this.sendDebt - 1, 1);
      const boats = this.opts.world.ownedBoats();
      if (boats.length > 0) {
        this.seq = (this.seq + 1) >>> 0;
        const t = this.opts.world.worldClock;
        this.send('all', 'unreliable', { type: 'state', seq: this.seq, t, boats });
      }
    }

    // Clock sync.
    if (!this.isHost && this.elapsed >= this.nextPingAt) {
      this.nextPingAt = this.elapsed + n.pingInterval;
      this.send('host', 'unreliable', { type: 'ping', c: this.elapsed });
    }

    // Forget boats nobody has heard from in a while, and old buffered states.
    const now = this.opts.world.worldClock;
    for (const [key, r] of this.remotes) {
      if (this.elapsed - r.heardAt > n.staleTimeout) this.remotes.delete(key);
      else r.buffer.prune(now, 1);
    }
  }

  /** Other players' boats at world time t (already in the past by the interpolation delay). */
  remoteBoats(t: number): RemoteBoat[] {
    const n = netTunables;
    const out: RemoteBoat[] = [];
    for (const [key, r] of this.remotes) {
      const s = r.buffer.sample(t - n.interpolationDelay, n.maxExtrapolation);
      if (!s) continue;
      out.push({
        key,
        peerId: r.peerId,
        name: this.roster.get(r.peerId) ?? '',
        boatType: r.boatType,
        position: s.position,
        rotation: s.rotation,
        linVel: s.linVel,
        throttle: s.throttle,
      });
    }
    return out;
  }

  // --- Connection lifecycle ---------------------------------------------------

  private async connect(code: string): Promise<boolean> {
    const gen = this.generation;
    const t = this.opts.createTransport();
    try {
      await t.join(code);
    } catch (e) {
      void t.leave();
      if (gen === this.generation && !this.reconnect) {
        this.setStatus({ kind: 'offline', error: errorText(e) });
      }
      return false;
    }
    if (gen !== this.generation) {
      await t.leave();
      return false;
    }
    this.attach(t, code);
    this.welcomeDeadline = this.elapsed + netTunables.welcomeTimeout;
    this.send('host', 'reliable', {
      type: 'hello',
      name: this.localName,
      buildId: this.opts.buildId,
    });
    return true;
  }

  private attach(t: Transport, code: string): void {
    this.transport = t;
    this.code = code;
    this.unsubs = [
      t.onMessage((from, _channel, data) => this.receive(t, from, data)),
      t.onPeerLeft((peer) => this.peerLeft(t, peer)),
      t.onConnectionStateChanged((s) => {
        if (s === 'disconnected' && t === this.transport && !t.isHost) this.lostHost();
      }),
    ];
  }

  /** Drop the transport and everything learned through it. */
  private async teardown(): Promise<void> {
    this.generation++;
    this.reconnect = null;
    this.waitingForBuild = false;
    await this.dropTransport();
  }

  private async dropTransport(): Promise<void> {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    const t = this.transport;
    this.transport = null;
    this.hostId = null;
    this.roster.clear();
    this.remotes.clear();
    this.lastSeq.clear();
    this.departed.clear();
    this.clockSynced = false;
    this.pendingClockCorrection = 0;
    this.welcomeDeadline = Number.POSITIVE_INFINITY;
    if (t) await t.leave();
  }

  private async fail(error: string): Promise<void> {
    await this.teardown();
    this.setStatus({ kind: 'offline', error });
  }

  private lostHost(): void {
    if (this._status.kind !== 'connected' || this.reconnect) return;
    const name = this.hostId ? this.roster.get(this.hostId) : undefined;
    this.notice(`Lost ${name ? `${name}'s` : 'the'} game, trying to reconnect…`);
    void this.dropTransport();
    this.startRetrying(netTunables.reconnectFirstDelay);
    this.setStatus({ kind: 'reconnecting', code: this.code });
  }

  /** Keep trying this.code for the reconnect window, backing off between attempts. */
  private startRetrying(firstDelay: number): void {
    if (this.reconnect) return;
    this.reconnect = {
      until: this.elapsed + netTunables.reconnectWindow,
      nextAttemptAt: this.elapsed + firstDelay,
      backoff: Math.max(firstDelay, netTunables.reconnectFirstDelay),
      attempting: false,
    };
  }

  /** The host is on another build: one of us is about to reload, so wait and retry. */
  private waitForBuild(): void {
    void this.dropTransport();
    this.startRetrying(netTunables.reconnectFirstDelay);
    if (this._status.kind === 'connected')
      this.setStatus({ kind: 'reconnecting', code: this.code });
    if (!this.waitingForBuild) {
      this.waitingForBuild = true;
      this.notice('Waiting for the host to reload…');
    }
  }

  private tickReconnect(): void {
    const r = this.reconnect;
    if (!r) return;
    if (this.elapsed > r.until && !r.attempting) {
      const joining = this._status.kind === 'joining';
      void this.fail(
        this.waitingForBuild
          ? INCOMPATIBLE_MESSAGE
          : joining
            ? "Couldn't find the host's game."
            : 'Lost connection to the host.',
      );
      return;
    }
    if (this.transport) {
      // Connected again and waiting for the Welcome.
      if (this.elapsed <= this.welcomeDeadline) return;
      void this.dropTransport();
    }
    if (r.attempting || this.elapsed < r.nextAttemptAt) return;
    r.attempting = true;
    r.nextAttemptAt = this.elapsed + r.backoff;
    r.backoff = Math.min(r.backoff * 2, Math.max(netTunables.reconnectInterval, r.backoff));
    void this.connect(this.code).then(() => {
      r.attempting = false;
    });
  }

  // --- Messages ---------------------------------------------------------------

  private receive(t: Transport, from: PeerId, data: Uint8Array): void {
    if (t !== this.transport) return;
    const decoded = decodeMessage(data);
    if (!decoded.ok) {
      if (decoded.reason === 'malformed') return;
      // Different protocol versions can't talk. Tell the other side in a way it will notice.
      if (this.isHost)
        t.send(from, 'reliable', encodeMessage({ type: 'reject', reason: 'version' }));
      else if (this._status.kind === 'joining' || from === this.hostId)
        void this.fail(INCOMPATIBLE_MESSAGE);
      return;
    }
    if (this.isHost) this.hostReceive(from, decoded.msg);
    else this.clientReceive(from, decoded.msg);
  }

  private hostReceive(from: PeerId, msg: NetMessage): void {
    const known = this.roster.has(from);
    switch (msg.type) {
      case 'hello': {
        const local = this.localId;
        if (!local) return;
        if (this.opts.strictBuild && msg.buildId !== this.opts.buildId) {
          this.send(from, 'reliable', { type: 'reject', reason: REJECT_BUILD });
          return;
        }
        // The same peer id again: a dev instance that reloaded, or a client whose
        // connection dropped and came back. Same player, fresh session (§13.4.5).
        const returning = known || this.departed.has(from);
        this.departed.delete(from);
        this.lastSeq.delete(from);
        this.roster.set(from, msg.name);
        const players = [...this.roster].map(([peerId, name]) => ({ peerId, name }));
        const world = this.opts.world;
        this.send(from, 'reliable', {
          type: 'welcome',
          seed: world.seed,
          worldClock: world.worldClock,
          buildId: this.opts.buildId,
          players,
        });
        this.send('all', 'reliable', {
          type: 'playerJoined',
          player: { peerId: from, name: msg.name },
        });
        this.notice(returning ? `${msg.name} is back` : `${msg.name} joined`);
        return;
      }
      case 'playerJoined':
        // A client renaming itself.
        if (!known || msg.player.peerId !== from) return;
        this.roster.set(from, msg.player.name);
        this.send('all', 'reliable', { type: 'playerJoined', player: msg.player });
        return;
      case 'ping':
        if (known) {
          const worldClock = this.opts.world.worldClock;
          this.send(from, 'unreliable', { type: 'pong', c: msg.c, worldClock });
        }
        return;
      case 'state':
        if (known) this.acceptState(from, msg);
        return;
      default:
        return;
    }
  }

  private clientReceive(from: PeerId, msg: NetMessage): void {
    const local = this.localId;
    switch (msg.type) {
      case 'welcome': {
        if (this._status.kind !== 'joining' && this._status.kind !== 'reconnecting') return;
        this.hostId = from;
        this.roster.clear();
        for (const p of msg.players) this.roster.set(p.peerId as PeerId, p.name);
        if (local) this.roster.set(local, this.localName);
        // Rough until the first pong measures the round trip.
        this.opts.world.setWorldClock(msg.worldClock);
        this.clockSynced = false;
        this.nextPingAt = this.elapsed;
        this.welcomeDeadline = Number.POSITIVE_INFINITY;
        const rejoined = this._status.kind === 'reconnecting';
        this.reconnect = null;
        this.waitingForBuild = false;
        this.setStatus({ kind: 'connected', code: this.code });
        const hostName = this.roster.get(from) ?? 'the host';
        this.notice(rejoined ? `Back in ${hostName}'s game` : `Joined ${hostName}'s game`);
        return;
      }
      case 'reject':
        if (msg.reason === REJECT_BUILD) this.waitForBuild();
        else void this.fail(msg.reason === 'version' ? INCOMPATIBLE_MESSAGE : msg.reason);
        return;
      case 'playerJoined': {
        const id = msg.player.peerId as PeerId;
        if (id === local) return;
        const isNew = !this.roster.has(id);
        this.roster.set(id, msg.player.name);
        this.departed.delete(id);
        // A returning peer restarts its sequence numbers.
        this.lastSeq.delete(id);
        if (isNew && this._status.kind === 'connected') this.notice(`${msg.player.name} joined`);
        return;
      }
      case 'playerLeft':
        this.forget(msg.peerId as PeerId);
        return;
      case 'pong':
        if (from === this.hostId) this.syncClock(msg.c, msg.worldClock);
        return;
      case 'state':
        if (this._status.kind === 'connected') this.acceptState(from, msg);
        return;
      default:
        return;
    }
  }

  private peerLeft(t: Transport, peer: PeerId): void {
    if (t !== this.transport) return;
    if (!this.isHost) {
      if (peer === this.hostId) this.lostHost();
      return;
    }
    if (!this.roster.has(peer)) return;
    this.forget(peer);
    this.send('all', 'reliable', { type: 'playerLeft', peerId: peer });
  }

  private forget(peer: PeerId): void {
    const name = this.roster.get(peer);
    this.roster.delete(peer);
    this.lastSeq.delete(peer);
    this.departed.add(peer);
    for (const [key, r] of this.remotes) if (r.peerId === peer) this.remotes.delete(key);
    if (name) this.notice(`${name} left`);
  }

  private acceptState(from: PeerId, msg: Extract<NetMessage, { type: 'state' }>): void {
    if (from === this.localId || this.departed.has(from)) return;
    const last = this.lastSeq.get(from);
    if (last !== undefined && msg.seq <= last) return;
    this.lastSeq.set(from, msg.seq);

    const period = simTunables.worldClockLoopPeriod;
    const keys = new Set<string>();
    for (const b of msg.boats) {
      const key = `${from}/${b.id}`;
      keys.add(key);
      let r = this.remotes.get(key);
      if (!r || r.boatType !== b.boatType) {
        r = {
          peerId: from,
          boatType: b.boatType,
          buffer: new InterpolationBuffer(period),
          heardAt: 0,
        };
        this.remotes.set(key, r);
      }
      r.heardAt = this.elapsed;
      r.buffer.push({ t: msg.t, ...b });
    }
    // Each message lists all of the sender's boats; anything missing is gone.
    for (const [key, r] of this.remotes)
      if (r.peerId === from && !keys.has(key)) this.remotes.delete(key);
  }

  private syncClock(sentAt: number, hostClock: number): void {
    const rtt = this.elapsed - sentAt;
    if (rtt < 0) return;
    const world = this.opts.world;
    const target = hostClock + rtt / 2;
    const error = wrapDelta(world.worldClock, target, simTunables.worldClockLoopPeriod);
    if (!this.clockSynced || Math.abs(error) > netTunables.clockSnapThreshold) {
      world.setWorldClock(target);
      this.pendingClockCorrection = 0;
      this.clockSynced = true;
    } else {
      this.pendingClockCorrection = error;
    }
  }

  private send(to: PeerId | 'all' | 'host', channel: Channel, msg: NetMessage): void {
    this.transport?.send(to, channel, encodeMessage(msg));
  }

  private setStatus(s: NetStatus): void {
    this._status = s;
    for (const cb of this.statusCbs) cb(s);
  }

  private notice(text: string): void {
    for (const cb of this.noticeCbs) cb(text);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
