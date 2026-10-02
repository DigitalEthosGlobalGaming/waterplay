import { type BoatHandling, type BoatTypeId, boatTypes } from '../../data/boats.ts';
import { safeMass } from '../../data/tuning-limits.ts';
import type { EntityId, Quat, Vec3 } from '../interfaces/common.ts';
import type { BodyHandle, PhysicsWorld } from '../interfaces/physics.ts';
import {
  add,
  clamp,
  conjugate,
  cross,
  IDENTITY_QUAT,
  rotate,
  sampleCurve,
  scale,
  sub,
} from '../math/vec.ts';
import type { WaterSampler } from '../water/gerstner.ts';

/** What the driver asks for this tick. Throttle and steer are -1..1. */
export interface BoatControls {
  throttle: number;
  steer: number;
  boost: boolean;
}

/** Saved / replicated boat state (§13.4.3). Absolute world coordinates. */
export interface BoatState {
  id: EntityId;
  boatType: BoatTypeId;
  position: Vec3;
  rotation: Quat;
  linVel: Vec3;
  angVel: Vec3;
  /** Actual (ramped) throttle. */
  throttle: number;
  steer: number;
}

export interface BoatTelemetry {
  /** Speed over water, m/s. */
  speed: number;
  /** Signed speed along the bow, m/s. */
  forwardSpeed: number;
  /** 0..1 share of buoyancy points under water. */
  submerged: number;
  propellerInWater: boolean;
}

const FORWARD: Vec3 = { x: 0, y: 0, z: 1 };

/**
 * A boat and its handling model (§7.1). Every force is ours, applied through
 * PhysicsWorld; the engine only integrates. Handling is read live from
 * data/boats.ts each tick so tuning applies instantly.
 */
export class Boat {
  readonly id: EntityId;
  readonly type: BoatTypeId;
  readonly body: BodyHandle;
  controls: BoatControls = { throttle: 0, steer: 0, boost: false };
  /** Ramped throttle actually driving the propeller. */
  throttle: number;
  telemetry: BoatTelemetry = { speed: 0, forwardSpeed: 0, submerged: 0, propellerInWater: false };

  private appliedMass = { mass: Number.NaN, x: 0, y: 0, z: 0 };

  constructor(
    readonly physics: PhysicsWorld,
    state: BoatState,
  ) {
    this.id = state.id;
    this.type = state.boatType;
    this.throttle = state.throttle;
    this.controls.steer = state.steer;
    const type = boatTypes[state.boatType];
    const h = type.handling;
    this.body = physics.createBody({
      type: 'dynamic',
      position: state.position,
      rotation: state.rotation,
      mass: safeMass(h.mass),
      centerOfMass: h.centerOfMassOffset,
      colliders: [
        {
          shape: { kind: 'box', halfExtents: type.hull.halfExtents },
          offset: type.hull.offset,
          friction: 0.3,
          restitution: 0.2,
        },
      ],
      userData: state.id,
    });
    physics.setVelocities(this.body, state.linVel, state.angVel);
    this.rememberMass(h);
  }

  get handling(): BoatHandling {
    return boatTypes[this.type].handling;
  }

  /** Apply this tick's forces. Call once per fixed step, before physics.step(). */
  applyForces(water: WaterSampler, dt: number, gravity: number): void {
    const p = this.physics;
    const b = this.body;
    const h = this.handling;
    this.syncMass(h);

    const { rotation: q } = p.getTransform(b);
    const v = p.getLinearVelocity(b);
    const w = p.getAngularVelocity(b);
    const com = p.localToWorld(b, h.centerOfMassOffset);

    // 1. Gravity at the centre of mass.
    p.applyForceAtPoint(b, { x: 0, y: -safeMass(h.mass) * gravity, z: 0 }, com);

    // 2. Buoyancy + vertical drag per hull point. Uneven lift gives pitch and roll on waves.
    const points = h.buoyancyPoints;
    const verticalDragPerPoint = h.dragVertical / Math.max(1, points.length);
    let submergedCount = 0;
    for (const local of points) {
      const wp = p.localToWorld(b, local);
      const depth = water.height(wp.x, wp.z) - wp.y;
      if (depth <= 0) continue;
      submergedCount++;
      const pointVel = add(v, cross(w, sub(wp, com)));
      const lift =
        h.buoyancyStrength * Math.min(depth, h.maxBuoyancyDepth) -
        verticalDragPerPoint * pointVel.y;
      p.applyForceAtPoint(b, { x: 0, y: lift, z: 0 }, wp);
    }
    const submerged = submergedCount / Math.max(1, points.length);

    // 3. Hull drag in boat space: glides forward, resists sliding sideways (keel).
    const vLocal = rotate(conjugate(q), v);
    const dragLocal: Vec3 = {
      x: -h.dragSideways * vLocal.x * submerged,
      y: 0,
      z:
        -(h.dragForward * vLocal.z * Math.abs(vLocal.z) + h.dragForwardLinear * vLocal.z) *
        submerged,
    };
    p.applyForceAtPoint(b, rotate(q, dragLocal), com);

    // 4. Thrust at the stern. The throttle ramps; it is never instant.
    const target = clamp(this.controls.throttle, -1, 1);
    const maxStep = h.throttleResponse * dt;
    this.throttle += clamp(target - this.throttle, -maxStep, maxStep);
    const prop = p.localToWorld(b, h.propellerPoint);
    const propellerInWater = water.height(prop.x, prop.z) > prop.y;
    if (propellerInWater && this.throttle !== 0) {
      const boost = this.controls.boost && this.throttle > 0 ? h.boostThrustMultiplier : 1;
      const thrust =
        this.throttle > 0
          ? this.throttle * h.maxThrust * boost
          : this.throttle * h.maxThrust * h.reverseThrustRatio;
      p.applyForceAtPoint(b, scale(rotate(q, FORWARD), thrust), prop);
    }

    // 5. Rudder: sideways force at the stern, scaled by forward speed. +steer turns right (-X).
    const steer = clamp(this.controls.steer, -1, 1);
    const forwardSpeed = vLocal.z;
    const speedFactor = sampleCurve(h.rudderSpeedCurve, Math.abs(forwardSpeed));
    if (propellerInWater && steer !== 0) {
      const side = steer * h.rudderStrength * speedFactor * Math.sign(forwardSpeed);
      p.applyForceAtPoint(b, rotate(q, { x: side, y: 0, z: 0 }), prop);
    }

    // Idle turn assist (yaw) and banking into the turn (roll), both in boat space.
    const idle = Math.max(0, 1 - Math.abs(forwardSpeed) / Math.max(0.01, h.idleTurnFadeSpeed));
    const steerTorqueLocal: Vec3 = {
      x: 0,
      y: -steer * h.idleTurnTorque * idle * submerged,
      z: steer * h.bankTorque * speedFactor * submerged,
    };

    // 6. Angular damping: heavy on roll/pitch, moderate on yaw. Light in the air.
    const wLocal = rotate(conjugate(q), w);
    const damp = Math.max(submerged, 0.15);
    const torqueLocal: Vec3 = {
      x: steerTorqueLocal.x - h.angularDamping.x * wLocal.x * damp,
      y: steerTorqueLocal.y - h.angularDamping.y * wLocal.y * damp,
      z: steerTorqueLocal.z - h.angularDamping.z * wLocal.z * damp,
    };
    p.applyTorque(b, rotate(q, torqueLocal));

    const speed = Math.hypot(v.x, v.y, v.z);
    this.telemetry = { speed, forwardSpeed, submerged, propellerInWater };
  }

  state(): BoatState {
    const { position, rotation } = this.physics.getTransform(this.body);
    return {
      id: this.id,
      boatType: this.type,
      position,
      rotation,
      linVel: this.physics.getLinearVelocity(this.body),
      angVel: this.physics.getAngularVelocity(this.body),
      throttle: this.throttle,
      steer: this.controls.steer,
    };
  }

  dispose(): void {
    this.physics.removeBody(this.body);
  }

  /** Mass and centre of mass are tunable live (and become cargo-dependent in M5). */
  private syncMass(h: BoatHandling): void {
    const a = this.appliedMass;
    const c = h.centerOfMassOffset;
    if (a.mass === h.mass && a.x === c.x && a.y === c.y && a.z === c.z) return;
    this.physics.setMassProperties(this.body, safeMass(h.mass), c);
    this.rememberMass(h);
  }

  private rememberMass(h: BoatHandling): void {
    const c = h.centerOfMassOffset;
    this.appliedMass = { mass: h.mass, x: c.x, y: c.y, z: c.z };
  }
}

/** A stationary boat with its hull bottom at sea level. */
export function restingBoatState(
  id: EntityId,
  boatType: BoatTypeId,
  x: number,
  z: number,
  rotation: Quat = IDENTITY_QUAT,
): BoatState {
  return {
    id,
    boatType,
    position: { x, y: 0, z },
    rotation: { ...rotation },
    linVel: { x: 0, y: 0, z: 0 },
    angVel: { x: 0, y: 0, z: 0 },
    throttle: 0,
    steer: 0,
  };
}
