import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRapierPhysicsWorld } from '../../src/adapters/physics/rapier/rapier-physics-world.ts';
import { restingBoatState } from '../../src/core/boats/boat.ts';
import { rotate } from '../../src/core/math/vec.ts';
import { Sim } from '../../src/core/sim/sim.ts';
import { simTunables } from '../../src/data/sim.ts';
import { waterParams } from '../../src/data/water.ts';

const STEPS_PER_SECOND = Math.round(1 / simTunables.dt);
const defaultAmplitude = waterParams.amplitudeScale;
let sim: Sim | null = null;

beforeAll(async () => {
  await createRapierPhysicsWorld();
});

afterEach(() => {
  sim?.dispose();
  sim = null;
  waterParams.amplitudeScale = defaultAmplitude;
});

/**
 * Flat sea, so wakes are the only thing moving the water. A speedboat runs
 * flat out along +Z past a boat sitting `gap` metres off its track.
 */
async function passBy(opts: { gap: number; driving: boolean }) {
  waterParams.amplitudeScale = 0;
  const s = new Sim({ physics: await createRapierPhysicsWorld(), world: { seed: 1 } });
  sim = s;
  const runner = s.addBoat(restingBoatState('runner:1', 'speedboat', 500, 400));
  const sitter = s.addBoat(restingBoatState('sitter:1', 'speedboat', 500 + opts.gap, 480));
  // Let both settle at their draft before anything moves.
  for (let i = 0; i < 4 * STEPS_PER_SECOND; i++) s.step();
  runner.controls = { throttle: opts.driving ? 1 : 0, steer: 0, boost: false };
  const rest = sitter.state();
  const restY = rest.position.y;
  // Boats sit with a little static trim; measure rocking relative to it.
  const restUp = rotate(rest.rotation, { x: 0, y: 1, z: 0 });
  let maxHeave = 0;
  let maxTilt = 0;
  for (let i = 0; i < 14 * STEPS_PER_SECOND; i++) {
    s.step();
    const st = sitter.state();
    maxHeave = Math.max(maxHeave, Math.abs(st.position.y - restY));
    const up = rotate(st.rotation, { x: 0, y: 1, z: 0 });
    const cos = up.x * restUp.x + up.y * restUp.y + up.z * restUp.z;
    maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, cos)));
  }
  return { maxHeave, maxTilt, runner, sitter, sim: s };
}

describe('wakes (headless, Rapier)', () => {
  it('a passing speedboat rocks a boat sitting off its track', async () => {
    const { maxHeave, maxTilt, sim: s } = await passBy({ gap: 12, driving: true });
    expect(s.wakes.emitters.length).toBeGreaterThan(20);
    expect(maxHeave).toBeGreaterThan(0.03);
    // Noticeable but cosy: a rock, not a capsize.
    expect(maxTilt).toBeGreaterThan(0.02);
    expect(maxTilt).toBeLessThan(0.5);
  });

  it('nothing moves without a passing boat', async () => {
    const { maxHeave, maxTilt, sim: s } = await passBy({ gap: 12, driving: false });
    expect(s.wakes.emitters).toEqual([]);
    expect(maxHeave).toBeLessThan(0.005);
    expect(maxTilt).toBeLessThan(0.005);
  });

  it('wakes fade with distance', async () => {
    const near = await passBy({ gap: 10, driving: true });
    near.sim.dispose();
    const far = await passBy({ gap: 45, driving: true });
    expect(far.maxHeave).toBeLessThan(near.maxHeave);
  });

  it("other players' boats make wakes from their replicated motion", async () => {
    waterParams.amplitudeScale = 0;
    const s = new Sim({ physics: await createRapierPhysicsWorld(), world: { seed: 1 } });
    sim = s;
    let z = 400;
    s.remoteHulls = () => [
      {
        key: 'friend/local:1',
        boatType: 'speedboat',
        position: { x: 500, y: 0, z },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        linVel: { x: 0, y: 0, z: 15 },
      },
    ];
    for (let i = 0; i < 60; i++) {
      s.step();
      z += 15 / 60;
    }
    expect(s.wakes.emitters.length).toBeGreaterThan(5);
    expect(s.wakes.emitters.every((e) => e.owner === 'friend/local:1')).toBe(true);
  });

  it("a boat isn't slowed by its own wake", async () => {
    const { runner } = await passBy({ gap: 200, driving: true });
    // Same 14 s straight run as the handling tests: well past 10 m/s.
    expect(runner.telemetry.speed).toBeGreaterThan(12);
  });
});
