import { type BoatTypeId, boatTypes } from '../../data/boats.ts';
import { netTunables } from '../../data/net.ts';
import { safeMass } from '../../data/tuning-limits.ts';
import type { Quat, Vec3 } from '../interfaces/common.ts';
import { add, dot, rotate, scale, sub } from '../math/vec.ts';
import type { Boat } from './boat.ts';

/** Another player's boat as this peer sees it: drawn from replicated state, no physics body. */
export interface RemoteHull {
  boatType: BoatTypeId;
  position: Vec3;
  rotation: Quat;
  linVel: Vec3;
}

interface Capsule {
  a: Vec3;
  b: Vec3;
  radius: number;
}

/**
 * Bumping into other players' boats (§8). Each peer only pushes the boats it
 * owns, with a spring-damper on the reduced mass of the pair, so both sides
 * compute equal and opposite pushes without exchanging any messages. Hulls are
 * flat capsules along the keel, which is plenty for boats on water.
 */
export function applyRemoteContacts(boat: Boat, remotes: readonly RemoteHull[]): void {
  if (remotes.length === 0) return;
  const p = boat.physics;
  const { position, rotation } = p.getTransform(boat.body);
  const own = hullCapsule(boat.type, position, rotation);
  const ownMass = safeMass(boat.handling.mass);
  const comY = p.localToWorld(boat.body, boat.handling.centerOfMassOffset).y;
  const v = p.getLinearVelocity(boat.body);
  const { contactStiffness: k, contactDamping: c } = netTunables;

  for (const r of remotes) {
    const other = hullCapsule(r.boatType, r.position, r.rotation);
    const [pa, pb] = closestPointsXZ(own, other);
    const d = sub(pa, pb);
    const dist = Math.hypot(d.x, d.z);
    const penetration = own.radius + other.radius - dist;
    if (penetration <= 0) continue;

    const n =
      dist > 1e-6 ? { x: d.x / dist, y: 0, z: d.z / dist } : fallbackNormal(position, r.position);
    const closing = dot(sub(v, r.linVel), n);
    const otherMass = safeMass(boatTypes[r.boatType].handling.mass);
    const reduced = (ownMass * otherMass) / (ownMass + otherMass);
    const push = reduced * (k * penetration - c * Math.min(0, closing));
    if (push <= 0) continue;
    // Push at the contact on our hull, at centre-of-mass height: spins the boat, never flips it.
    const at = add(pa, scale(n, -own.radius));
    p.applyForceAtPoint(boat.body, scale(n, push), { x: at.x, y: comY, z: at.z });
  }
}

function hullCapsule(type: BoatTypeId, position: Vec3, rotation: Quat): Capsule {
  const hull = boatTypes[type].hull;
  const radius = hull.halfExtents.x;
  const half = Math.max(0, hull.halfExtents.z - radius);
  const centre = add(position, rotate(rotation, hull.offset));
  const axis = rotate(rotation, { x: 0, y: 0, z: half });
  return { a: sub(centre, axis), b: add(centre, axis), radius };
}

function fallbackNormal(own: Vec3, other: Vec3): Vec3 {
  const dx = own.x - other.x;
  const dz = own.z - other.z;
  const len = Math.hypot(dx, dz);
  return len > 1e-6 ? { x: dx / len, y: 0, z: dz / len } : { x: 1, y: 0, z: 0 };
}

/** Closest points between two segments, ignoring height. Results have y = 0. */
export function closestPointsXZ(s1: Capsule, s2: Capsule): [Vec3, Vec3] {
  const p1 = flat(s1.a);
  const q1 = flat(s1.b);
  const p2 = flat(s2.a);
  const q2 = flat(s2.b);
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  if (a <= 1e-9 && e <= 1e-9) return [p1, p2];
  if (a <= 1e-9) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-9) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  return [add(p1, scale(d1, s)), add(p2, scale(d2, t))];
}

function flat(v: Vec3): Vec3 {
  return { x: v.x, y: 0, z: v.z };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
