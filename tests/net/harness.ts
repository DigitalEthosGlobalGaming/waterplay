import {
  type LinkConditions,
  LoopbackNetwork,
} from '../../src/adapters/transport/loopback/loopback-transport.ts';
import type { BoatState } from '../../src/core/boats/boat.ts';
import type { Transport } from '../../src/core/interfaces/transport.ts';
import { NetSession, type NetWorld } from '../../src/core/net/net-session.ts';
import { simTunables } from '../../src/data/sim.ts';

export const DT = 1 / 60;
const PERIOD = simTunables.worldClockLoopPeriod;

/** Where the test boat of a peer is at world time t: a lazy circle, so it is always moving. */
export function circlePosition(t: number, radius = 30, speed = 0.2, phase = 0) {
  const a = t * speed + phase;
  return {
    position: { x: radius * Math.cos(a), y: 0, z: radius * Math.sin(a) },
    linVel: { x: -radius * speed * Math.sin(a), y: 0, z: radius * speed * Math.cos(a) },
  };
}

/** A world whose clock ticks and whose one boat follows circlePosition(worldClock). */
export class FakeWorld implements NetWorld {
  seed = 1;
  worldClock: number;
  hasBoat = true;

  constructor(
    readonly boatId: string,
    startClock = 0,
    readonly phase = 0,
  ) {
    this.worldClock = startClock;
  }

  setWorldClock(t: number): void {
    this.worldClock = ((t % PERIOD) + PERIOD) % PERIOD;
  }

  step(): void {
    this.setWorldClock(this.worldClock + DT);
  }

  ownedBoats(): BoatState[] {
    if (!this.hasBoat) return [];
    return [
      {
        id: this.boatId,
        boatType: 'speedboat',
        ...circlePosition(this.worldClock, 30, 0.2, this.phase),
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        angVel: { x: 0, y: 0, z: 0 },
        throttle: 0.5,
        steer: 0,
      },
    ];
  }
}

export interface PeerOptions {
  startClock?: number;
  phase?: number;
  wrap?: (t: Transport) => Transport;
  /** Fixed peer id for every transport, like a dev instance (`dev-A`). Default: a new id each time. */
  peerId?: string;
  buildId?: string;
  strictBuild?: boolean;
}

export interface Peer {
  name: string;
  world: FakeWorld;
  session: NetSession;
  notices: string[];
  /** Transports created so far (one per host/join attempt). */
  attempts: number;
  opts: PeerOptions;
}

/** Peers sharing one LoopbackNetwork, stepped together at the sim rate. */
export class Harness {
  readonly net: LoopbackNetwork;
  readonly peers: Peer[] = [];
  private transports = 0;

  constructor(conditions: Partial<LinkConditions> = {}, seed = 3) {
    this.net = new LoopbackNetwork({ conditions, seed });
  }

  addPeer(name: string, opts: PeerOptions = {}): Peer {
    const world = new FakeWorld(`${name}:1`, opts.startClock ?? 0, opts.phase ?? 0);
    const peer: Peer = {
      name,
      world,
      session: null as unknown as NetSession,
      notices: [],
      attempts: 0,
      opts,
    };
    peer.session = this.newSession(peer);
    this.peers.push(peer);
    return peer;
  }

  /**
   * The page reloads (§13.4.5): the old session vanishes without a goodbye and a
   * new one starts with the same world (restored from its snapshot) and peer id.
   * The caller hosts or joins again, as the restored app would.
   */
  async reload(
    peer: Peer,
    opts: Partial<PeerOptions> & {
      /** The old page dies without its connection closing; the host only hears the new hello. */
      silent?: boolean;
    } = {},
  ): Promise<void> {
    // Silent: the old session is just abandoned (no more ticks), its transport left open.
    if (!opts.silent) await peer.session.leave();
    peer.opts = { ...peer.opts, ...opts };
    peer.notices.length = 0;
    peer.session = this.newSession(peer);
  }

  private newSession(peer: Peer): NetSession {
    const { opts, name } = peer;
    const session = new NetSession({
      createTransport: () => {
        peer.attempts++;
        const t = this.net.createTransport(opts.peerId ?? `${name}-${++this.transports}`);
        return opts.wrap ? opts.wrap(t) : t;
      },
      world: peer.world,
      name,
      buildId: opts.buildId ?? 'test',
      strictBuild: opts.strictBuild,
    });
    session.onNotice((n) => peer.notices.push(n));
    return session;
  }

  /** Run every peer for `seconds` of sim time, delivering network traffic as it goes. */
  async run(seconds: number): Promise<void> {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      for (const p of this.peers) {
        p.world.step();
        p.session.tick(DT);
      }
      this.net.advance(DT * 1000);
      // Let promise continuations (join/host resolving) run.
      await Promise.resolve();
      await Promise.resolve();
    }
  }
}

export function shareCode(p: Peer): string {
  const s = p.session.status;
  if (s.kind !== 'hosting') throw new Error(`${p.name} is not hosting (${s.kind})`);
  return s.code;
}
