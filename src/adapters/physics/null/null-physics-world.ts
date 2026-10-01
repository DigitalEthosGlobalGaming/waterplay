import type { EntityId, Quat, Vec3 } from '../../../core/interfaces/common.ts';
import type {
  BodyDesc,
  BodyHandle,
  CollisionEvent,
  PhysicsWorld,
} from '../../../core/interfaces/physics.ts';
import { add, conjugate, cross, rotate, scale, sub } from '../../../core/math/vec.ts';

interface NullBody {
  dynamic: boolean;
  position: Vec3;
  rotation: Quat;
  linVel: Vec3;
  angVel: Vec3;
  mass: number;
  centerOfMass: Vec3;
  inertia: Vec3;
  force: Vec3;
  torque: Vec3;
  userData?: EntityId;
}

/**
 * Engine-free PhysicsWorld (§5.1) for ultra-fast tests: semi-implicit Euler,
 * diagonal inertia, no collisions. Use Rapier when contacts matter.
 */
export class NullPhysicsWorld implements PhysicsWorld {
  private readonly bodies = new Map<number, NullBody>();
  private nextHandle = 1;

  createBody(desc: BodyDesc): BodyHandle {
    const h = this.nextHandle++;
    const mass = desc.mass ?? 1;
    this.bodies.set(h, {
      dynamic: desc.type === 'dynamic',
      position: { ...desc.position },
      rotation: { ...(desc.rotation ?? { x: 0, y: 0, z: 0, w: 1 }) },
      linVel: { x: 0, y: 0, z: 0 },
      angVel: { x: 0, y: 0, z: 0 },
      mass,
      centerOfMass: { ...(desc.centerOfMass ?? { x: 0, y: 0, z: 0 }) },
      inertia: desc.principalInertia ?? { x: mass, y: mass, z: mass },
      force: { x: 0, y: 0, z: 0 },
      torque: { x: 0, y: 0, z: 0 },
      userData: desc.userData,
    });
    return h as BodyHandle;
  }

  removeBody(h: BodyHandle): void {
    this.bodies.delete(h);
  }

  getTransform(h: BodyHandle): { position: Vec3; rotation: Quat } {
    const b = this.get(h);
    return { position: { ...b.position }, rotation: { ...b.rotation } };
  }

  setTransform(h: BodyHandle, position: Vec3, rotation: Quat): void {
    const b = this.get(h);
    b.position = { ...position };
    b.rotation = { ...rotation };
  }

  getLinearVelocity(h: BodyHandle): Vec3 {
    return { ...this.get(h).linVel };
  }

  getAngularVelocity(h: BodyHandle): Vec3 {
    return { ...this.get(h).angVel };
  }

  setVelocities(h: BodyHandle, linear: Vec3, angular: Vec3): void {
    const b = this.get(h);
    b.linVel = { ...linear };
    b.angVel = { ...angular };
  }

  setMassProperties(
    h: BodyHandle,
    mass: number,
    centerOfMass: Vec3,
    principalInertia?: Vec3,
  ): void {
    const b = this.get(h);
    b.mass = mass;
    b.centerOfMass = { ...centerOfMass };
    b.inertia = principalInertia ?? { x: mass, y: mass, z: mass };
  }

  applyForceAtPoint(h: BodyHandle, force: Vec3, worldPoint: Vec3): void {
    const b = this.get(h);
    b.force = add(b.force, force);
    b.torque = add(b.torque, cross(sub(worldPoint, this.worldCom(b)), force));
  }

  applyImpulseAtPoint(h: BodyHandle, impulse: Vec3, worldPoint: Vec3): void {
    const b = this.get(h);
    if (!b.dynamic) return;
    b.linVel = add(b.linVel, scale(impulse, 1 / b.mass));
    b.angVel = add(
      b.angVel,
      this.applyInverseInertia(b, cross(sub(worldPoint, this.worldCom(b)), impulse)),
    );
  }

  applyTorque(h: BodyHandle, torque: Vec3): void {
    const b = this.get(h);
    b.torque = add(b.torque, torque);
  }

  localToWorld(h: BodyHandle, local: Vec3): Vec3 {
    const b = this.get(h);
    return add(b.position, rotate(b.rotation, local));
  }

  step(dt: number): void {
    for (const b of this.bodies.values()) {
      if (b.dynamic) {
        const comBefore = this.worldCom(b);
        b.linVel = add(b.linVel, scale(b.force, dt / b.mass));
        b.angVel = add(b.angVel, scale(this.applyInverseInertia(b, b.torque), dt));
        b.rotation = integrateRotation(b.rotation, b.angVel, dt);
        // Rotate about the centre of mass, not the body origin.
        const comAfterRotation = this.worldCom(b);
        b.position = add(add(b.position, sub(comBefore, comAfterRotation)), scale(b.linVel, dt));
      }
      b.force = { x: 0, y: 0, z: 0 };
      b.torque = { x: 0, y: 0, z: 0 };
    }
  }

  drainCollisionEvents(): CollisionEvent[] {
    return [];
  }

  rebase(offset: Vec3): void {
    for (const b of this.bodies.values()) b.position = sub(b.position, offset);
  }

  private get(h: BodyHandle): NullBody {
    const b = this.bodies.get(h);
    if (!b) throw new Error(`No body ${h}`);
    return b;
  }

  private worldCom(b: NullBody): Vec3 {
    return add(b.position, rotate(b.rotation, b.centerOfMass));
  }

  /** World-space I⁻¹·v using the diagonal local inertia. */
  private applyInverseInertia(b: NullBody, v: Vec3): Vec3 {
    const local = rotate(conjugate(b.rotation), v);
    return rotate(b.rotation, {
      x: local.x / b.inertia.x,
      y: local.y / b.inertia.y,
      z: local.z / b.inertia.z,
    });
  }
}

function integrateRotation(q: Quat, w: Vec3, dt: number): Quat {
  const h = dt / 2;
  const x = q.x + h * (w.x * q.w + w.y * q.z - w.z * q.y);
  const y = q.y + h * (w.y * q.w + w.z * q.x - w.x * q.z);
  const z = q.z + h * (w.z * q.w + w.x * q.y - w.y * q.x);
  const qw = q.w - h * (w.x * q.x + w.y * q.y + w.z * q.z);
  const n = Math.hypot(x, y, z, qw) || 1;
  return { x: x / n, y: y / n, z: z / n, w: qw / n };
}
