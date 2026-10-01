import RAPIER from '@dimforge/rapier3d-compat';
import type { EntityId, Quat, Vec3 } from '../../../core/interfaces/common.ts';
import type {
  BodyDesc,
  BodyHandle,
  ColliderDesc,
  CollisionEvent,
  PhysicsWorld,
} from '../../../core/interfaces/physics.ts';

type Rapier = typeof RAPIER;

let initialised: Promise<Rapier> | null = null;

/** Loads the embedded WASM once. Works the same in Vite, Electron and Node (Vitest). */
export function loadRapier(): Promise<Rapier> {
  initialised ??= RAPIER.init().then(() => RAPIER);
  return initialised;
}

export async function createRapierPhysicsWorld(): Promise<RapierPhysicsWorld> {
  return new RapierPhysicsWorld(await loadRapier());
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/**
 * PhysicsWorld on Rapier (§5.1). The engine has no gravity: gravity, buoyancy
 * and drag are our own forces. Forces are cleared after every step so callers
 * re-apply them each tick.
 */
export class RapierPhysicsWorld implements PhysicsWorld {
  private readonly world: RAPIER.World;
  private readonly events: RAPIER.EventQueue;
  /** Collider handle → entity, for collision events. */
  private readonly colliderOwners = new Map<number, EntityId>();
  /** Body handle → local half-extents of its collider bounds, for derived inertia. */
  private readonly bodyBounds = new Map<number, Vec3>();

  constructor(private readonly R: Rapier) {
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this.events = new R.EventQueue(true);
  }

  createBody(desc: BodyDesc): BodyHandle {
    const R = this.R;
    const bd =
      desc.type === 'dynamic'
        ? R.RigidBodyDesc.dynamic().setCanSleep(false)
        : desc.type === 'kinematic'
          ? R.RigidBodyDesc.kinematicPositionBased()
          : R.RigidBodyDesc.fixed();
    bd.setTranslation(desc.position.x, desc.position.y, desc.position.z);
    if (desc.rotation) bd.setRotation(desc.rotation);
    if (desc.linearDamping !== undefined) bd.setLinearDamping(desc.linearDamping);
    if (desc.angularDamping !== undefined) bd.setAngularDamping(desc.angularDamping);
    const body = this.world.createRigidBody(bd);

    // With an explicit mass, colliders carry no density and mass comes from setMassProperties.
    const explicitMass = desc.type === 'dynamic' && desc.mass !== undefined;
    for (const c of desc.colliders) {
      const collider = this.world.createCollider(this.colliderDesc(c, explicitMass), body);
      if (desc.userData !== undefined) this.colliderOwners.set(collider.handle, desc.userData);
    }
    this.bodyBounds.set(body.handle, colliderBounds(desc.colliders));

    const handle = body.handle as BodyHandle;
    if (explicitMass && desc.mass !== undefined) {
      this.setMassProperties(
        handle,
        desc.mass,
        desc.centerOfMass ?? { x: 0, y: 0, z: 0 },
        desc.principalInertia,
      );
    }
    return handle;
  }

  removeBody(h: BodyHandle): void {
    const body = this.world.getRigidBody(h);
    if (!body) return;
    for (let i = 0; i < body.numColliders(); i++) {
      this.colliderOwners.delete(body.collider(i).handle);
    }
    this.bodyBounds.delete(h);
    this.world.removeRigidBody(body);
  }

  getTransform(h: BodyHandle): { position: Vec3; rotation: Quat } {
    const body = this.body(h);
    return { position: copyVec(body.translation()), rotation: copyQuat(body.rotation()) };
  }

  setTransform(h: BodyHandle, position: Vec3, rotation: Quat): void {
    const body = this.body(h);
    body.setTranslation(position, true);
    body.setRotation(rotation, true);
  }

  getLinearVelocity(h: BodyHandle): Vec3 {
    return copyVec(this.body(h).linvel());
  }

  getAngularVelocity(h: BodyHandle): Vec3 {
    return copyVec(this.body(h).angvel());
  }

  setVelocities(h: BodyHandle, linear: Vec3, angular: Vec3): void {
    const body = this.body(h);
    body.setLinvel(linear, true);
    body.setAngvel(angular, true);
  }

  setMassProperties(
    h: BodyHandle,
    mass: number,
    centerOfMass: Vec3,
    principalInertia?: Vec3,
  ): void {
    const inertia = principalInertia ?? boxInertia(mass, this.bodyBounds.get(h));
    this.body(h).setAdditionalMassProperties(mass, centerOfMass, inertia, IDENTITY, true);
  }

  applyForceAtPoint(h: BodyHandle, force: Vec3, worldPoint: Vec3): void {
    this.body(h).addForceAtPoint(force, worldPoint, true);
  }

  applyImpulseAtPoint(h: BodyHandle, impulse: Vec3, worldPoint: Vec3): void {
    this.body(h).applyImpulseAtPoint(impulse, worldPoint, true);
  }

  applyTorque(h: BodyHandle, torque: Vec3): void {
    this.body(h).addTorque(torque, true);
  }

  localToWorld(h: BodyHandle, local: Vec3): Vec3 {
    const body = this.body(h);
    const t = body.translation();
    const q = body.rotation();
    // v' = v + w*t + cross(q.xyz, t), t = 2 * cross(q.xyz, v)
    const tx = 2 * (q.y * local.z - q.z * local.y);
    const ty = 2 * (q.z * local.x - q.x * local.z);
    const tz = 2 * (q.x * local.y - q.y * local.x);
    return {
      x: t.x + local.x + q.w * tx + (q.y * tz - q.z * ty),
      y: t.y + local.y + q.w * ty + (q.z * tx - q.x * tz),
      z: t.z + local.z + q.w * tz + (q.x * ty - q.y * tx),
    };
  }

  private pending: CollisionEvent[] = [];

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step(this.events);
    this.events.drainCollisionEvents((c1, c2, started) => {
      const a = this.colliderOwners.get(c1);
      const b = this.colliderOwners.get(c2);
      if (a !== undefined && b !== undefined) this.pending.push({ a, b, started });
    });
    // Forces are per-step in our interface; Rapier keeps them until reset.
    this.world.forEachRigidBody((body) => {
      if (!body.isDynamic()) return;
      body.resetForces(false);
      body.resetTorques(false);
    });
  }

  drainCollisionEvents(): CollisionEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  rebase(offset: Vec3): void {
    this.world.forEachRigidBody((body) => {
      const t = body.translation();
      body.setTranslation({ x: t.x - offset.x, y: t.y - offset.y, z: t.z - offset.z }, false);
    });
  }

  dispose(): void {
    this.events.free();
    this.world.free();
  }

  private body(h: BodyHandle): RAPIER.RigidBody {
    return this.world.getRigidBody(h);
  }

  private colliderDesc(c: ColliderDesc, massless: boolean): RAPIER.ColliderDesc {
    const R = this.R;
    const s = c.shape;
    let cd: RAPIER.ColliderDesc | null;
    switch (s.kind) {
      case 'box':
        cd = R.ColliderDesc.cuboid(s.halfExtents.x, s.halfExtents.y, s.halfExtents.z);
        break;
      case 'sphere':
        cd = R.ColliderDesc.ball(s.radius);
        break;
      case 'capsule':
        cd = R.ColliderDesc.capsule(s.halfHeight, s.radius);
        break;
      case 'convexHull':
        cd = R.ColliderDesc.convexHull(s.points);
        break;
    }
    if (!cd) throw new Error(`Could not build ${s.kind} collider`);
    if (c.offset) cd.setTranslation(c.offset.x, c.offset.y, c.offset.z);
    if (c.friction !== undefined) cd.setFriction(c.friction);
    if (c.restitution !== undefined) cd.setRestitution(c.restitution);
    if (c.sensor) cd.setSensor(true);
    if (massless) cd.setDensity(0);
    cd.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    return cd;
  }
}

function copyVec(v: { x: number; y: number; z: number }): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function copyQuat(q: { x: number; y: number; z: number; w: number }): Quat {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** Half-size of the axis-aligned box enclosing all colliders (local space). */
function colliderBounds(colliders: ColliderDesc[]): Vec3 {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const c of colliders) {
    const o = c.offset ?? { x: 0, y: 0, z: 0 };
    const s = c.shape;
    const half =
      s.kind === 'box'
        ? s.halfExtents
        : s.kind === 'sphere'
          ? { x: s.radius, y: s.radius, z: s.radius }
          : s.kind === 'capsule'
            ? { x: s.radius, y: s.halfHeight + s.radius, z: s.radius }
            : { x: 1, y: 1, z: 1 };
    for (const k of ['x', 'y', 'z'] as const) {
      min[k] = Math.min(min[k], o[k] - half[k]);
      max[k] = Math.max(max[k], o[k] + half[k]);
    }
  }
  if (!Number.isFinite(min.x)) return { x: 0.5, y: 0.5, z: 0.5 };
  return { x: (max.x - min.x) / 2, y: (max.y - min.y) / 2, z: (max.z - min.z) / 2 };
}

/** Solid box inertia about its centre. */
function boxInertia(mass: number, half: Vec3 = { x: 1, y: 1, z: 1 }): Vec3 {
  const w = 2 * half.x;
  const h = 2 * half.y;
  const l = 2 * half.z;
  return {
    x: (mass / 12) * (h * h + l * l),
    y: (mass / 12) * (w * w + l * l),
    z: (mass / 12) * (w * w + h * h),
  };
}
