import { platforms } from '../../data/platforms.ts';
import { simTunables } from '../../data/sim.ts';
import { waterParams } from '../../data/water.ts';
import { Boat, type BoatState } from '../boats/boat.ts';
import { applyRemoteContacts, type RemoteHull } from '../boats/contacts.ts';
import type { EntityId, Quat, Vec3 } from '../interfaces/common.ts';
import type { BodyHandle, PhysicsWorld } from '../interfaces/physics.ts';
import { lerp3, slerp } from '../math/vec.ts';
import { createWaterSampler, type WaterSampler, waveConstants } from '../water/gerstner.ts';
import { Rng, type RngState } from './rng.ts';

/** Host-authoritative shared world state. Everything here is in the session snapshot. */
export interface WorldSimState {
  seed: number;
  tick: number;
  /** Shared world clock in seconds (§6.1), wrapped at worldClockLoopPeriod. */
  worldClock: number;
  rngState: RngState;
}

export interface SimContext {
  readonly dt: number;
  readonly rng: Rng;
  readonly worldClock: number;
}

export interface SimOptions {
  physics: PhysicsWorld;
  world: { seed: number } | WorldSimState;
}

export interface Pose {
  position: Vec3;
  rotation: Quat;
}

/**
 * The pure simulation. No DOM, no rendering, no async in the tick path.
 * Owns every body it creates in `physics` and removes them on dispose().
 */
export class Sim {
  readonly seed: number;
  readonly physics: PhysicsWorld;
  private rng: Rng;
  private tickCount: number;
  private clock: number;
  private readonly boats = new Map<EntityId, Boat>();
  /** Poses at the start of the last step, for render interpolation. Transient. */
  private readonly previousPoses = new Map<EntityId, Pose>();
  private readonly statics: BodyHandle[] = [];
  /** Other players' boats at a given world time, for bumping (§8). Transient; set by the net layer. */
  remoteHulls: (worldClock: number) => readonly RemoteHull[] = () => [];

  constructor(opts: SimOptions) {
    const init = opts.world;
    this.physics = opts.physics;
    this.seed = init.seed;
    if ('tick' in init) {
      this.rng = Rng.fromState(init.rngState);
      this.tickCount = init.tick;
      this.clock = init.worldClock;
    } else {
      this.rng = new Rng(init.seed);
      this.tickCount = 0;
      this.clock = 0;
    }
    this.buildStatics();
  }

  get tick(): number {
    return this.tickCount;
  }

  get worldClock(): number {
    return this.clock;
  }

  /** Clients follow the host's clock (§8). Wrapped into the loop period. */
  setWorldClock(t: number): void {
    const period = simTunables.worldClockLoopPeriod;
    this.clock = ((t % period) + period) % period;
  }

  /** Context handed to systems each tick. */
  context(): SimContext {
    return { dt: simTunables.dt, rng: this.rng, worldClock: this.clock };
  }

  /** The water surface at world time t (defaults to now), using live wave tunables. */
  water(t = this.clock): WaterSampler {
    const s = simTunables;
    return createWaterSampler(waveConstants(waterParams, s.gravity, s.worldClockLoopPeriod), t);
  }

  addBoat(state: BoatState): Boat {
    this.removeBoat(state.id);
    const boat = new Boat(this.physics, state);
    this.boats.set(boat.id, boat);
    return boat;
  }

  removeBoat(id: EntityId): void {
    this.boats.get(id)?.dispose();
    this.boats.delete(id);
    this.previousPoses.delete(id);
  }

  getBoat(id: EntityId): Boat | undefined {
    return this.boats.get(id);
  }

  allBoats(): IterableIterator<Boat> {
    return this.boats.values();
  }

  step(): void {
    const { dt, worldClockLoopPeriod, gravity } = simTunables;
    const water = this.water();
    const remotes = this.remoteHulls(this.clock);
    for (const boat of this.boats.values()) {
      this.previousPoses.set(boat.id, this.physics.getTransform(boat.body));
      boat.applyForces(water, dt, gravity);
      applyRemoteContacts(boat, remotes);
    }
    this.physics.step(dt);
    this.tickCount += 1;
    this.clock = (this.clock + dt) % worldClockLoopPeriod;
  }

  /** Pose blended between the previous and current step (alpha 0..1). */
  interpolatedPose(id: EntityId, alpha: number): Pose | undefined {
    const boat = this.boats.get(id);
    if (!boat) return undefined;
    const current = this.physics.getTransform(boat.body);
    const prev = this.previousPoses.get(id);
    if (!prev) return current;
    return {
      position: lerp3(prev.position, current.position, alpha),
      rotation: slerp(prev.rotation, current.rotation, alpha),
    };
  }

  snapshot(): WorldSimState {
    return {
      seed: this.seed,
      tick: this.tickCount,
      worldClock: this.clock,
      rngState: this.rng.state,
    };
  }

  dispose(): void {
    for (const id of [...this.boats.keys()]) this.removeBoat(id);
    for (const h of this.statics) this.physics.removeBody(h);
    this.statics.length = 0;
  }

  /** Placeholder platforms as static boxes; they become streamed chunks in M4. */
  private buildStatics(): void {
    for (const p of platforms.list) {
      this.statics.push(
        this.physics.createBody({
          type: 'static',
          position: { x: p.position.x, y: p.size.y / 2 - 1, z: p.position.z },
          colliders: [
            {
              shape: { kind: 'box', halfExtents: scaleHalf(p.size) },
              friction: 0.4,
              restitution: 0.2,
            },
          ],
          userData: `platform:${p.id}`,
        }),
      );
    }
  }
}

function scaleHalf(v: Vec3): Vec3 {
  return { x: v.x / 2, y: v.y / 2, z: v.z / 2 };
}
