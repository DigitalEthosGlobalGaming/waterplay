import { describe, expect, it } from 'vitest';
import { NullPhysicsWorld } from '../../src/adapters/physics/null/null-physics-world.ts';
import { restingBoatState } from '../../src/core/boats/boat.ts';
import { closestPointsXZ, type RemoteHull } from '../../src/core/boats/contacts.ts';
import { Sim } from '../../src/core/sim/sim.ts';

/**
 * Two players' boats, each simulated by its own Sim (as on two machines) and
 * seeing the other only as a RemoteHull, like after replication.
 */
function pair(gap: number, closing: number) {
  const a = new Sim({ physics: new NullPhysicsWorld(), world: { seed: 1 } });
  const b = new Sim({ physics: new NullPhysicsWorld(), world: { seed: 1 } });
  // Side by side, both facing +Z, A to the starboard (-X) of B.
  const boatA = a.addBoat(restingBoatState('a:1', 'speedboat', -gap / 2, 0));
  const boatB = b.addBoat(restingBoatState('b:1', 'speedboat', gap / 2, 0));
  a.physics.setVelocities(boatA.body, { x: closing / 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  b.physics.setVelocities(boatB.body, { x: -closing / 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const hull = (sim: Sim, id: string): RemoteHull[] => {
    const boat = sim.getBoat(id);
    if (!boat) return [];
    const { position, rotation } = sim.physics.getTransform(boat.body);
    return [
      { boatType: boat.type, position, rotation, linVel: sim.physics.getLinearVelocity(boat.body) },
    ];
  };
  a.remoteHulls = () => hull(b, 'b:1');
  b.remoteHulls = () => hull(a, 'a:1');
  const x = (sim: Sim, id: string) => {
    const boat = sim.getBoat(id);
    return boat ? sim.physics.getTransform(boat.body).position.x : Number.NaN;
  };
  return { a, b, xa: () => x(a, 'a:1'), xb: () => x(b, 'b:1') };
}

describe('boat-on-boat bumps between players', () => {
  it('ramming boats bounce apart symmetrically and do not pass through', () => {
    const { a, b, xa, xb } = pair(6, 8);
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 180; i++) {
      a.step();
      b.step();
      closest = Math.min(closest, xb() - xa());
    }
    // Hulls are ~2.7 m wide: they may squash a little but never cross.
    expect(closest).toBeGreaterThan(1.5);
    expect(xb() - xa()).toBeGreaterThan(2.72);
    // Equal and opposite: the pair's centre stays put.
    expect(Math.abs(xa() + xb())).toBeLessThan(0.05);
  });

  it('boats far apart feel nothing', () => {
    const near = pair(20, 0);
    const alone = pair(20, 0);
    alone.a.remoteHulls = () => [];
    for (let i = 0; i < 60; i++) {
      near.a.step();
      near.b.step();
      alone.a.step();
    }
    expect(near.xa()).toBe(alone.xa());
  });

  it('closest points between hull segments', () => {
    const seg = (ax: number, az: number, bx: number, bz: number) => ({
      a: { x: ax, y: 5, z: az },
      b: { x: bx, y: 5, z: bz },
      radius: 1,
    });
    const [p, q] = closestPointsXZ(seg(0, -1, 0, 1), seg(3, 0, 5, 0));
    expect(p).toEqual({ x: 0, y: 0, z: 0 });
    expect(q).toEqual({ x: 3, y: 0, z: 0 });
    // Crossing segments touch.
    const [r, s] = closestPointsXZ(seg(-1, 0, 1, 0), seg(0, -1, 0, 1));
    expect(Math.hypot(r.x - s.x, r.z - s.z)).toBeCloseTo(0);
  });
});
