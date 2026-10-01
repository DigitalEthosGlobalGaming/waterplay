import { describe, expect, it } from 'vitest';
import { NullPhysicsWorld } from '../../src/adapters/physics/null/null-physics-world.ts';
import { Sim } from '../../src/core/sim/sim.ts';
import { simTunables } from '../../src/data/sim.ts';

describe('Sim (headless)', () => {
  it('advances the world clock at the fixed step', () => {
    const sim = new Sim({ physics: new NullPhysicsWorld(), world: { seed: 1 } });
    for (let i = 0; i < 600; i++) sim.step();
    expect(sim.tick).toBe(600);
    expect(sim.worldClock).toBeCloseTo(600 * simTunables.dt, 6);
  });

  it('wraps the world clock at the loop period', () => {
    const sim = new Sim({
      physics: new NullPhysicsWorld(),
      world: {
        seed: 1,
        tick: 0,
        worldClock: simTunables.worldClockLoopPeriod - simTunables.dt / 2,
        rngState: 1,
      },
    });
    sim.step();
    expect(sim.worldClock).toBeLessThan(simTunables.dt);
  });

  it('two sims with the same seed stay identical', () => {
    const a = new Sim({ physics: new NullPhysicsWorld(), world: { seed: 77 } });
    const b = new Sim({ physics: new NullPhysicsWorld(), world: { seed: 77 } });
    for (let i = 0; i < 1000; i++) {
      a.step();
      b.step();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
