import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRapierPhysicsWorld } from '../../src/adapters/physics/rapier/rapier-physics-world.ts';
import { type Boat, restingBoatState } from '../../src/core/boats/boat.ts';
import { headingOf, rotate } from '../../src/core/math/vec.ts';
import { Sim } from '../../src/core/sim/sim.ts';
import { boatTypes } from '../../src/data/boats.ts';
import { simTunables } from '../../src/data/sim.ts';
import { waterParams } from '../../src/data/water.ts';

const STEPS_PER_SECOND = Math.round(1 / simTunables.dt);
const defaultAmplitude = waterParams.amplitudeScale;

let sim: Sim | null = null;

async function setup(opts: { waves: boolean }) {
  waterParams.amplitudeScale = opts.waves ? defaultAmplitude : 0;
  // Far from the placeholder platforms.
  const s = new Sim({ physics: await createRapierPhysicsWorld(), world: { seed: 1 } });
  sim = s;
  const boat = s.addBoat(restingBoatState('test:1', 'speedboat', 500, 500));
  return { sim: s, boat };
}

function run(s: Sim, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds * STEPS_PER_SECOND; i++) {
    s.step();
    each?.();
  }
}

/** World up vector of the boat's deck; y = cos(tilt). */
function uprightness(b: Boat): number {
  return rotate(b.state().rotation, { x: 0, y: 1, z: 0 }).y;
}

beforeAll(async () => {
  await createRapierPhysicsWorld(); // warm the WASM once
});

afterEach(() => {
  sim?.dispose();
  sim = null;
  waterParams.amplitudeScale = defaultAmplitude;
});

describe('boat handling (headless, Rapier)', () => {
  it('floats at a sensible draft in calm water', async () => {
    const { sim, boat } = await setup({ waves: false });
    run(sim, 10);
    const y = boat.state().position.y;
    // Hull bottom sits a little below the surface, not sunk and not flying.
    expect(y).toBeLessThan(0);
    expect(y).toBeGreaterThan(-0.6);
    expect(Math.abs(boat.state().linVel.y)).toBeLessThan(0.05);
    expect(uprightness(boat)).toBeGreaterThan(0.999);
  });

  it('stays upright and afloat in waves', async () => {
    const { sim, boat } = await setup({ waves: true });
    let minUp = 1;
    let minY = Infinity;
    run(sim, 30, () => {
      minUp = Math.min(minUp, uprightness(boat));
      minY = Math.min(minY, boat.state().position.y);
    });
    expect(minUp).toBeGreaterThan(Math.cos((30 * Math.PI) / 180));
    expect(minY).toBeGreaterThan(-1.5);
  });

  it('rights itself after being knocked over to 40°', async () => {
    const { sim, boat } = await setup({ waves: false });
    run(sim, 2);
    const s = boat.state();
    const roll = (40 * Math.PI) / 180;
    sim.physics.setTransform(boat.body, s.position, {
      x: 0,
      y: 0,
      z: Math.sin(roll / 2),
      w: Math.cos(roll / 2),
    });
    run(sim, 6);
    expect(uprightness(boat)).toBeGreaterThan(0.995);
  });

  it('accelerates gradually and settles at the expected top speed', async () => {
    const { sim, boat } = await setup({ waves: false });
    boat.controls.throttle = 1;
    run(sim, 0.5);
    const h = boatTypes.speedboat.handling;
    const theoreticalTop = Math.sqrt(h.maxThrust / h.dragForward);
    // Weight: half a second in, nowhere near top speed.
    expect(boat.telemetry.forwardSpeed).toBeLessThan(theoreticalTop * 0.15);
    run(sim, 40);
    const top = boat.telemetry.forwardSpeed;
    expect(top).toBeGreaterThan(theoreticalTop * 0.8);
    expect(top).toBeLessThan(theoreticalTop * 1.05);
  });

  it('gets from 0 to 10 m/s in about 2.3 s (tuned 20% quicker in M1)', async () => {
    const { sim, boat } = await setup({ waves: false });
    boat.controls.throttle = 1;
    let reached = Number.POSITIVE_INFINITY;
    for (let i = 1; i <= 6 * STEPS_PER_SECOND; i++) {
      sim.step();
      if (boat.telemetry.forwardSpeed >= 10) {
        reached = i / STEPS_PER_SECOND;
        break;
      }
    }
    expect(reached).toBeGreaterThan(2.0);
    expect(reached).toBeLessThan(2.6);
  });

  it('boost raises top speed', async () => {
    const { sim, boat } = await setup({ waves: false });
    boat.controls.throttle = 1;
    run(sim, 40);
    const normal = boat.telemetry.forwardSpeed;
    boat.controls.boost = true;
    run(sim, 30);
    expect(boat.telemetry.forwardSpeed).toBeGreaterThan(normal * 1.1);
  });

  it('carves turns: turns right on +steer with little sideways slip, leaning in', async () => {
    const { sim, boat } = await setup({ waves: false });
    boat.controls.throttle = 1;
    run(sim, 15);
    const before = headingOf(boat.state().rotation);
    boat.controls.steer = 1;
    let maxSlip = 0;
    let lean = 0;
    run(sim, 3, () => {
      const s = boat.state();
      const local = rotate({ ...s.rotation, w: -s.rotation.w }, s.linVel);
      maxSlip = Math.max(maxSlip, Math.abs(Math.atan2(local.x, Math.max(0.1, local.z))));
      // Starboard is -X: leaning into a right turn lifts the port (+X) side.
      lean = Math.max(lean, rotate(s.rotation, { x: 1, y: 0, z: 0 }).y);
    });
    const turned = headingOf(boat.state().rotation) - before;
    // Right turn = heading decreases (toward -X).
    expect(turned).toBeLessThan(-0.8);
    expect(maxSlip).toBeLessThan((15 * Math.PI) / 180);
    expect(lean).toBeGreaterThan(0.05);
  });

  it('turns slowly but not at all stuck when stationary', async () => {
    const { sim, boat } = await setup({ waves: false });
    boat.controls.steer = 1;
    const before = headingOf(boat.state().rotation);
    run(sim, 3);
    const turned = headingOf(boat.state().rotation) - before;
    expect(turned).toBeLessThan(-0.05);
    expect(turned).toBeGreaterThan(-1.5);
  });

  it('coasts to a stop slowly once throttle is released', async () => {
    const { sim, boat } = await setup({ waves: false });
    boat.controls.throttle = 1;
    run(sim, 20);
    const cruising = boat.telemetry.forwardSpeed;
    boat.controls.throttle = 0;
    run(sim, 2);
    expect(boat.telemetry.forwardSpeed).toBeGreaterThan(cruising * 0.3);
    run(sim, 60);
    expect(boat.telemetry.forwardSpeed).toBeLessThan(0.5);
  });

  it('survives a zero mass from a bad data edit (no NaN, still floats)', async () => {
    const { sim, boat } = await setup({ waves: false });
    const h = boatTypes.speedboat.handling;
    const mass = h.mass;
    try {
      h.mass = 0;
      run(sim, 3);
      const s = boat.state();
      expect(Number.isFinite(s.position.y)).toBe(true);
      expect(Number.isFinite(s.linVel.y)).toBe(true);
    } finally {
      h.mass = mass;
    }
  });

  it('is deterministic for identical inputs', async () => {
    const trace = async () => {
      const { sim, boat } = await setup({ waves: true });
      boat.controls.throttle = 1;
      boat.controls.steer = 0.4;
      run(sim, 10);
      const s = boat.state();
      sim.dispose();
      return s;
    };
    const a = await trace();
    const b = await trace();
    expect(b).toEqual(a);
  });
});
