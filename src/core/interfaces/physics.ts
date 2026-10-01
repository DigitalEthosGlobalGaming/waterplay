import type { EntityId, Quat, Vec3 } from './common.ts';

export type BodyHandle = number & { __brand: 'BodyHandle' };

export type ColliderShape =
  | { kind: 'box'; halfExtents: Vec3 }
  | { kind: 'sphere'; radius: number }
  | { kind: 'capsule'; halfHeight: number; radius: number }
  | { kind: 'convexHull'; points: Float32Array };

export interface ColliderDesc {
  shape: ColliderShape;
  offset?: Vec3;
  friction?: number;
  restitution?: number;
  sensor?: boolean;
}

export interface BodyDesc {
  type: 'dynamic' | 'kinematic' | 'static';
  position: Vec3;
  rotation?: Quat;
  /** Dynamic only. */
  mass?: number;
  /** Local space. Boats want this LOW for stability. */
  centerOfMass?: Vec3;
  /** Principal moments of inertia (local axes). Derived from the colliders when omitted. */
  principalInertia?: Vec3;
  linearDamping?: number;
  angularDamping?: number;
  colliders: ColliderDesc[];
  userData?: EntityId;
}

export interface CollisionEvent {
  a: EntityId;
  b: EntityId;
  started: boolean;
  impulse?: number;
}

/**
 * Physics seam (§5.1). Gravity, buoyancy and drag are OUR code, applied via
 * applyForceAtPoint each step. The engine only integrates and resolves collisions.
 */
export interface PhysicsWorld {
  createBody(desc: BodyDesc): BodyHandle;
  removeBody(h: BodyHandle): void;

  getTransform(h: BodyHandle): { position: Vec3; rotation: Quat };
  /** Teleport / rebase. */
  setTransform(h: BodyHandle, position: Vec3, rotation: Quat): void;
  /** Velocity of the centre of mass. */
  getLinearVelocity(h: BodyHandle): Vec3;
  getAngularVelocity(h: BodyHandle): Vec3;
  setVelocities(h: BodyHandle, linear: Vec3, angular: Vec3): void;
  /** Live mass changes (tuning, cargo). Inertia derived from the colliders when omitted. */
  setMassProperties(h: BodyHandle, mass: number, centerOfMass: Vec3, principalInertia?: Vec3): void;

  /** Forces and torques act for the next step() only, then are cleared. */
  applyForceAtPoint(h: BodyHandle, force: Vec3, worldPoint: Vec3): void;
  applyImpulseAtPoint(h: BodyHandle, impulse: Vec3, worldPoint: Vec3): void;
  applyTorque(h: BodyHandle, torque: Vec3): void;

  localToWorld(h: BodyHandle, local: Vec3): Vec3;

  step(dt: number): void;
  drainCollisionEvents(): CollisionEvent[];

  /** Shift every body by -offset. Used for floating origin (§9.2). */
  rebase(offset: Vec3): void;
}
