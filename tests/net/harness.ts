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

export interface Peer {
  name: string;
  world: FakeWorld;
  session: NetSession;
  notices: string[];
}

/** Peers sharing one LoopbackNetwork, stepped together at the sim rate. */
export class Harness {
  readonly net: LoopbackNetwork;
  readonly peers: Peer[] = [];
  private transports = 0;

  constructor(conditions: Partial<LinkConditions> = {}, seed = 3) {
    this.net = new LoopbackNetwork({ conditions, seed });
  }

  addPeer(
    name: string,
    opts: { startClock?: number; phase?: number; wrap?: (t: Transport) => Transport } = {},
  ): Peer {
    const world = new FakeWorld(`${name}:1`, opts.startClock ?? 0, opts.phase ?? 0);
    const session = new NetSession({
      createTransport: () => {
        const t = this.net.createTransport(`${name}-${++this.transports}`);
        return opts.wrap ? opts.wrap(t) : t;
      },
      world,
      name,
      buildId: 'test',
    });
    const peer = { name, world, session, notices: [] as string[] };
    session.onNotice((n) => peer.notices.push(n));
    this.peers.push(peer);
    return peer;
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
