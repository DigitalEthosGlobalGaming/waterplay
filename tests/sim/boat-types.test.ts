import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRapierPhysicsWorld } from '../../src/adapters/physics/rapier/rapier-physics-world.ts';
import { type Boat, restingBoatState } from '../../src/core/boats/boat.ts';
import { headingOf, rotate } from '../../src/core/math/vec.ts';
import { Sim } from '../../src/core/sim/sim.ts';
import { BOAT_TYPE_IDS, type BoatTypeId, boatTypes } from '../../src/data/boats.ts';
import { simTunables } from '../../src/data/sim.ts';
import { waterParams } from '../../src/data/water.ts';

const STEPS_PER_SECOND = Math.round(1 / simTunables.dt);
const defaultAmplitude = waterParams.amplitudeScale;

let sim: Sim | null = null;

async function setup(type: BoatTypeId, opts: { waves: boolean }) {
  waterParams.amplitudeScale = opts.waves ? defaultAmplitude : 0;
  const s = new Sim({ physics: await createRapierPhysicsWorld(), world: { seed: 1 } });
  sim = s;
  const boat = s.addBoat(restingBoatState('test:1', type, 500, 500));
  return { sim: s, boat };
}

function run(s: Sim, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds * STEPS_PER_SECOND; i++) {
    s.step();
    each?.();
  }
}

/** Heading change in radians, wrapped to ±π. Negative is a right turn. */
function turned(before: number, after: number): number {
  const d = after - before;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

function uprightness(b: Boat): number {
  return rotate(b.state().rotation, { x: 0, y: 1, z: 0 }).y;
}

async function topSpeed(type: BoatTypeId): Promise<number> {
  const { sim: s, boat } = await setup(type, { waves: false });
  boat.controls.throttle = 1;
  run(s, 40);
  const top = boat.telemetry.forwardSpeed;
  s.dispose();
  sim = null;
  return top;
}

beforeAll(async () => {
  await createRapierPhysicsWorld();
});

afterEach(() => {
  sim?.dispose();
  sim = null;
  waterParams.amplitudeScale = defaultAmplitude;
});

describe.each(BOAT_TYPE_IDS)('%s (headless, Rapier)', (type) => {
  it('floats level at a sensible draft in calm water', async () => {
    const { sim, boat } = await setup(type, { waves: false });
    run(sim, 10);
    const y = boat.state().position.y;
    expect(y).toBeLessThan(0);
    expect(y).toBeGreaterThan(-0.7);
    expect(Math.abs(boat.state().linVel.y)).toBeLessThan(0.05);
    expect(uprightness(boat)).toBeGreaterThan(0.998);
  });

  it('stays upright and afloat in waves, driving and turning', async () => {
    const { sim, boat } = await setup(type, { waves: true });
    boat.controls.throttle = 1;
    boat.controls.steer = 0.5;
    let minUp = 1;
    let minY = Number.POSITIVE_INFINITY;
    run(sim, 30, () => {
      minUp = Math.min(minUp, uprightness(boat));
      minY = Math.min(minY, boat.state().position.y);
    });
    expect(minUp).toBeGreaterThan(Math.cos((35 * Math.PI) / 180));
    // Long boats bury their bows in a swell at speed; that's fine, sinking isn't.
    expect(minY).toBeGreaterThan(-2);
  });

  it('rights itself after being knocked over to 35°', async () => {
    const { sim, boat } = await setup(type, { waves: false });
    run(sim, 2);
    const roll = (35 * Math.PI) / 180;
    sim.physics.setTransform(boat.body, boat.state().position, {
      x: 0,
      y: 0,
      z: Math.sin(roll / 2),
      w: Math.cos(roll / 2),
    });
    run(sim, 8);
    expect(uprightness(boat)).toBeGreaterThan(0.995);
  });

  it('reaches about its designed top speed', async () => {
    const h = boatTypes[type].handling;
    // Where thrust meets quadratic plus linear drag.
    const a = h.dragForward;
    const b = h.dragForwardLinear;
    const designed = (-b + Math.sqrt(b * b + 4 * a * h.maxThrust)) / (2 * a);
    const top = await topSpeed(type);
    expect(top).toBeGreaterThan(designed * 0.85);
    expect(top).toBeLessThan(designed * 1.1);
  });

  it('turns right on +steer at speed', async () => {
    const { sim, boat } = await setup(type, { waves: false });
    boat.controls.throttle = 1;
    run(sim, 15);
    const before = headingOf(boat.state().rotation);
    boat.controls.steer = 1;
    run(sim, 3);
    expect(turned(before, headingOf(boat.state().rotation))).toBeLessThan(-0.5);
  });

  it('can turn when stationary', async () => {
    const { sim, boat } = await setup(type, { waves: false });
    boat.controls.steer = 1;
    const before = headingOf(boat.state().rotation);
    run(sim, 3);
    expect(turned(before, headingOf(boat.state().rotation))).toBeLessThan(-0.05);
  });
});

describe('boat lineup', () => {
  it('top speeds run racer > speedboat > fan boat > fishing boat > tug', async () => {
    const speeds: Record<string, number> = {};
    for (const t of BOAT_TYPE_IDS) speeds[t] = await topSpeed(t);
    expect(speeds.racer).toBeGreaterThan(speeds.speedboat as number);
    expect(speeds.speedboat).toBeGreaterThan(speeds.fanboat as number);
    expect(speeds.fanboat).toBeGreaterThan(speeds.fishing as number);
    expect(speeds.fishing).toBeGreaterThan(speeds.tug as number);
  });

  it('the fan boat slides through turns more than the speedboat', async () => {
    const slip = async (type: BoatTypeId) => {
      const { sim: s, boat } = await setup(type, { waves: false });
      boat.controls.throttle = 1;
      run(s, 15);
      boat.controls.steer = 1;
      let max = 0;
      run(s, 3, () => {
        const st = boat.state();
        const local = rotate({ ...st.rotation, w: -st.rotation.w }, st.linVel);
        max = Math.max(max, Math.abs(Math.atan2(local.x, Math.max(0.1, local.z))));
      });
      s.dispose();
      sim = null;
      return max;
    };
    expect(await slip('fanboat')).toBeGreaterThan(2 * (await slip('speedboat')));
  });

  it('a heavy boat leaves a bigger wake than a light one at the same speed', async () => {
    waterParams.amplitudeScale = 0;
    const s = new Sim({ physics: await createRapierPhysicsWorld(), world: { seed: 1 } });
    sim = s;
    let z = 400;
    const hull = (key: string, boatType: BoatTypeId, x: number) => ({
      key,
      boatType,
      position: { x, y: 0, z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linVel: { x: 0, y: 0, z: 10 },
    });
    s.remoteHulls = () => [hull('a/tug', 'tug', 400), hull('b/fan', 'fanboat', 600)];
    for (let i = 0; i < 30; i++) {
      s.step();
      z += 10 / 60;
    }
    const peak = (owner: string) =>
      Math.max(...s.wakes.emitters.filter((e) => e.owner === owner).map((e) => e.amplitude));
    expect(peak('a/tug')).toBeGreaterThan(2 * peak('b/fan'));
  });

  it('changing boat type keeps the id, place, heading and way, then settles', async () => {
    const { sim: s, boat } = await setup('speedboat', { waves: false });
    boat.controls.throttle = 1;
    boat.controls.steer = 0.3;
    run(s, 8);
    const before = boat.state();
    const tug = s.changeBoatType('test:1', 'tug');
    expect(tug?.type).toBe('tug');
    expect(s.getBoat('test:1')).toBe(tug);
    expect([...s.allBoats()]).toHaveLength(1);
    const after = tug?.state();
    expect(after?.position).toEqual(before.position);
    expect(headingOf(after?.rotation ?? before.rotation)).toBeCloseTo(headingOf(before.rotation));
    expect(after?.linVel.x).toBeCloseTo(before.linVel.x);
    expect(after?.linVel.z).toBeCloseTo(before.linVel.z);
    expect(tug?.throttle).toBe(0);
    if (!tug) return;
    run(s, 10);
    expect(uprightness(tug)).toBeGreaterThan(0.995);
    expect(tug.state().position.y).toBeGreaterThan(-0.8);
    // Same type again is a no-op.
    expect(s.changeBoatType('test:1', 'tug')).toBe(tug);
  });

  it('the fan boat still drives with its stern lifted clear of the water', async () => {
    const { sim: s, boat } = await setup('fanboat', { waves: false });
    run(s, 2);
    // Pitch nose-down 20° so the stern rises; a water propeller would do nothing.
    const pitch = (20 * Math.PI) / 180;
    s.physics.setTransform(boat.body, boat.state().position, {
      x: Math.sin(pitch / 2),
      y: 0,
      z: 0,
      w: Math.cos(pitch / 2),
    });
    boat.controls.throttle = 1;
    s.step();
    expect(boat.telemetry.propellerInWater).toBe(false);
    run(s, 1);
    expect(boat.telemetry.forwardSpeed).toBeGreaterThan(0.5);
  });
});
