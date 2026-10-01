import type { Vec3 } from '../core/interfaces/common.ts';
import type { ModelId } from './models.ts';
import { liveTunable } from './registry.ts';

/**
 * Boat handling (§7.2). Body-local space: +Z forward, +Y up, -X is starboard
 * (right). The origin is the bottom of the hull. All values in SI units.
 */
export interface BoatHandling {
  /** kg, before cargo. */
  mass: number;
  /** Local. Keep LOW for stability. */
  centerOfMassOffset: Vec3;
  buoyancyPoints: Vec3[];
  /** N per metre of submersion, per point. */
  buoyancyStrength: number;
  /** Submersion (m) beyond which a point stops adding lift. */
  maxBuoyancyDepth: number;
  /** N at full throttle. */
  maxThrust: number;
  reverseThrustRatio: number;
  /** Thrust multiplier while boosting. */
  boostThrustMultiplier: number;
  /** Throttle units per second the actual throttle moves toward the target. */
  throttleResponse: number;
  /** Where thrust and rudder act (local; stern, below the waterline). */
  propellerPoint: Vec3;
  /** Forward drag, N per (m/s)². Sets top speed: sqrt(maxThrust / dragForward). */
  dragForward: number;
  /** Small linear forward drag, N per m/s, so coasting eventually stops. */
  dragForwardLinear: number;
  /** Sideways drag, N per m/s. HIGH: the keel effect that makes turns carve. */
  dragSideways: number;
  /** Vertical drag, N per m/s, shared across submerged buoyancy points. Damps bobbing. */
  dragVertical: number;
  /** Sideways force at the stern at full rudder (N), scaled by rudderSpeedCurve. */
  rudderStrength: number;
  /** [forward speed m/s, factor]. Slow boats turn poorly. */
  rudderSpeedCurve: [speed: number, factor: number][];
  /** Yaw torque (N·m) at full steer when stationary, fading out with speed. */
  idleTurnTorque: number;
  /** Forward speed (m/s) at which the idle turn assist reaches zero. */
  idleTurnFadeSpeed: number;
  /** Roll torque (N·m) leaning into turns at full steer and speed. */
  bankTorque: number;
  /** Damping torque per rad/s about local x (pitch), y (yaw), z (roll). */
  angularDamping: Vec3;
  cargoGrid: { width: number; height: number };
}

export interface BoatType {
  name: string;
  model: ModelId;
  /** Render-only scale of the Kenney model; physics values above are already in metres. */
  modelScale: number;
  /** Collision box (local). */
  hull: { halfExtents: Vec3; offset: Vec3 };
  handling: BoatHandling;
}

export type BoatTypeId = 'speedboat';

/** Kenney boat-speed-a at ×1.6: about 5.4 m long, 2.85 m wide. */
export const boatTypes = liveTunable<Record<BoatTypeId, BoatType>>('boats', {
  speedboat: {
    name: 'Speedboat',
    model: 'boat.speedA',
    modelScale: 1.6,
    hull: { halfExtents: { x: 1.36, y: 0.7, z: 2.6 }, offset: { x: 0, y: 0.7, z: 0 } },
    handling: {
      mass: 1200,
      centerOfMassOffset: { x: 0, y: 0.45, z: -0.2 },
      buoyancyPoints: [
        { x: 1.12, y: 0.15, z: -2.2 },
        { x: -1.12, y: 0.15, z: -2.2 },
        { x: 1.2, y: 0.15, z: -0.8 },
        { x: -1.2, y: 0.15, z: -0.8 },
        { x: 1.1, y: 0.2, z: 0.7 },
        { x: -1.1, y: 0.2, z: 0.7 },
        { x: 0.55, y: 0.35, z: 1.9 },
        { x: -0.55, y: 0.35, z: 1.9 },
      ],
      buoyancyStrength: 5900,
      maxBuoyancyDepth: 0.8,
      maxThrust: 8400,
      reverseThrustRatio: 0.4,
      boostThrustMultiplier: 1.5,
      throttleResponse: 0.95,
      propellerPoint: { x: 0, y: 0.05, z: -2.5 },
      dragForward: 32.4,
      dragForwardLinear: 60,
      dragSideways: 9000,
      dragVertical: 4500,
      rudderStrength: 2900,
      rudderSpeedCurve: [
        [0, 0],
        [2, 0.35],
        [6, 0.85],
        [12, 1],
        [20, 0.9],
      ],
      idleTurnTorque: 1500,
      idleTurnFadeSpeed: 3,
      bankTorque: 6000,
      angularDamping: { x: 4000, y: 7400, z: 2500 },
      cargoGrid: { width: 6, height: 4 },
    },
  },
});

import.meta.hot?.accept();
