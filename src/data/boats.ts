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
  /**
   * Fan boats push air: thrust and steering work even when the stern is out
   * of the water, and the rudder steers the same way going backwards.
   */
  propellerInAir: boolean;
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
  /** One line for the boat picker. */
  description: string;
  model: ModelId;
  /** Render-only scale of the Kenney model; physics values above are already in metres. */
  modelScale: number;
  /** Collision box (local). */
  hull: { halfExtents: Vec3; offset: Vec3 };
  /** Multiplier on this boat's wake height. Heavy boats push more water. */
  wakeScale: number;
  /** Multiplier on the chase camera's distance and height, for bigger boats. */
  cameraScale: number;
  handling: BoatHandling;
}

export type BoatTypeId = 'speedboat' | 'racer' | 'fanboat' | 'fishing' | 'tug';

/** Order shown in the boat picker. */
export const BOAT_TYPE_IDS: readonly BoatTypeId[] = [
  'speedboat',
  'racer',
  'fanboat',
  'fishing',
  'tug',
];

export const DEFAULT_BOAT_TYPE: BoatTypeId = 'speedboat';

/**
 * Buoyancy points in the speedboat's layout, scaled to a hull's half-width
 * and half-length: two at the stern, two aft, two forward, two narrow at the bow.
 */
function buoyancyPoints(halfWidth: number, halfLength: number): Vec3[] {
  const rows: [z: number, x: number, y: number][] = [
    [-0.85, 0.82, 0.15],
    [-0.31, 0.88, 0.15],
    [0.27, 0.81, 0.2],
    [0.73, 0.4, 0.35],
  ];
  const round = (v: number) => Math.round(v * 100) / 100;
  return rows.flatMap(([z, x, y]) => [
    { x: round(x * halfWidth), y, z: round(z * halfLength) },
    { x: round(-x * halfWidth), y, z: round(z * halfLength) },
  ]);
}

/**
 * Sizes are the Kenney models' measured bounds × modelScale. Buoyancy
 * strength puts each boat at its draft: about mass × g / (8 × draft).
 * Top speed is where maxThrust = dragForward·v² + dragForwardLinear·v.
 */
export const boatTypes = liveTunable<Record<BoatTypeId, BoatType>>('boats', {
  /** Kenney boat-speed-a at ×1.6: about 5.4 m long, 2.85 m wide. */
  speedboat: {
    name: 'Speedboat',
    description: 'A friendly all-rounder. Quick, steady and easy to drive.',
    model: 'boat.speedA',
    modelScale: 1.6,
    hull: { halfExtents: { x: 1.36, y: 0.7, z: 2.6 }, offset: { x: 0, y: 0.7, z: 0 } },
    wakeScale: 1,
    cameraScale: 1,
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
      propellerInAir: false,
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

  /** Kenney boat-speed-j at ×1.6: about 6.8 m long and low. */
  racer: {
    name: 'Racer',
    description: 'Long, light and the fastest thing afloat. Twitchy, and wakes throw it about.',
    model: 'boat.speedJ',
    modelScale: 1.6,
    hull: { halfExtents: { x: 1.36, y: 0.6, z: 3.3 }, offset: { x: 0, y: 0.6, z: 0 } },
    wakeScale: 0.9,
    cameraScale: 1.05,
    handling: {
      mass: 950,
      centerOfMassOffset: { x: 0, y: 0.4, z: -0.3 },
      buoyancyPoints: buoyancyPoints(1.37, 3.31),
      buoyancyStrength: 5300,
      maxBuoyancyDepth: 0.7,
      maxThrust: 9800,
      reverseThrustRatio: 0.35,
      boostThrustMultiplier: 1.6,
      throttleResponse: 1.3,
      propellerPoint: { x: 0, y: 0.05, z: -3.2 },
      propellerInAir: false,
      dragForward: 23.3,
      dragForwardLinear: 48,
      dragSideways: 8000,
      dragVertical: 3300,
      rudderStrength: 3400,
      rudderSpeedCurve: [
        [0, 0],
        [3, 0.3],
        [8, 0.85],
        [15, 1],
        [25, 0.85],
      ],
      idleTurnTorque: 1800,
      idleTurnFadeSpeed: 3,
      bankTorque: 5200,
      angularDamping: { x: 3300, y: 9500, z: 1300 },
      cargoGrid: { width: 4, height: 2 },
    },
  },

  /** Kenney boat-fan at ×1.6: about 4.6 m long, flat bottomed, big fan at the back. */
  fanboat: {
    name: 'Fan boat',
    description: 'Pushed by a big fan, so it slides through turns and spins on the spot.',
    model: 'boat.fan',
    modelScale: 1.6,
    hull: { halfExtents: { x: 1.36, y: 0.55, z: 2.2 }, offset: { x: 0, y: 0.55, z: 0 } },
    wakeScale: 0.6,
    cameraScale: 1,
    handling: {
      mass: 800,
      centerOfMassOffset: { x: 0, y: 0.5, z: -0.2 },
      buoyancyPoints: buoyancyPoints(1.37, 2.22),
      buoyancyStrength: 5450,
      maxBuoyancyDepth: 0.6,
      maxThrust: 5600,
      reverseThrustRatio: 0.25,
      boostThrustMultiplier: 1.4,
      throttleResponse: 1.6,
      // The fan sits high, but a thrust line that high would push the nose under.
      propellerPoint: { x: 0, y: 0.5, z: -2.1 },
      propellerInAir: true,
      dragForward: 24.1,
      dragForwardLinear: 40,
      // Flat bottom, no keel: it drifts.
      dragSideways: 1500,
      dragVertical: 3000,
      rudderStrength: 2200,
      rudderSpeedCurve: [
        [0, 0.25],
        [4, 0.7],
        [10, 1],
        [20, 0.9],
      ],
      idleTurnTorque: 800,
      idleTurnFadeSpeed: 4,
      bankTorque: 2500,
      angularDamping: { x: 1950, y: 4000, z: 1700 },
      cargoGrid: { width: 4, height: 3 },
    },
  },

  /** Kenney boat-fishing-small at ×1.6: about 6.2 m long with a tall cabin. */
  fishing: {
    name: 'Fishing boat',
    description: 'Heavy and steady, with the biggest hold. Takes its time but never fusses.',
    model: 'boat.fishingSmall',
    modelScale: 1.6,
    hull: { halfExtents: { x: 1.36, y: 0.8, z: 3.0 }, offset: { x: 0, y: 0.8, z: 0 } },
    wakeScale: 1.4,
    cameraScale: 1.2,
    handling: {
      mass: 2600,
      centerOfMassOffset: { x: 0, y: 0.45, z: -0.2 },
      buoyancyPoints: buoyancyPoints(1.37, 3.0),
      buoyancyStrength: 9960,
      maxBuoyancyDepth: 0.9,
      maxThrust: 13500,
      reverseThrustRatio: 0.45,
      boostThrustMultiplier: 1.35,
      throttleResponse: 0.7,
      propellerPoint: { x: 0, y: 0.05, z: -2.88 },
      propellerInAir: false,
      dragForward: 76,
      dragForwardLinear: 130,
      dragSideways: 22500,
      dragVertical: 9750,
      rudderStrength: 5450,
      rudderSpeedCurve: [
        [0, 0],
        [2, 0.4],
        [5, 0.85],
        [10, 1],
        [16, 0.95],
      ],
      idleTurnTorque: 3250,
      idleTurnFadeSpeed: 2.5,
      bankTorque: 9000,
      angularDamping: { x: 15000, y: 21350, z: 7150 },
      cargoGrid: { width: 8, height: 5 },
    },
  },

  /** Kenney boat-tug-a at ×1.7: about 5.9 m long, stubby and tall. */
  tug: {
    name: 'Tug',
    description:
      'Enormously strong and slow. Shrugs off wakes, wins every bump, leaves a big wake.',
    model: 'boat.tugA',
    modelScale: 1.7,
    hull: { halfExtents: { x: 1.45, y: 0.9, z: 2.85 }, offset: { x: 0, y: 0.9, z: 0 } },
    wakeScale: 1.8,
    cameraScale: 1.2,
    handling: {
      mass: 4500,
      centerOfMassOffset: { x: 0, y: 0.45, z: -0.2 },
      buoyancyPoints: buoyancyPoints(1.45, 2.85),
      buoyancyStrength: 14500,
      maxBuoyancyDepth: 1,
      maxThrust: 26000,
      reverseThrustRatio: 0.6,
      boostThrustMultiplier: 1.3,
      throttleResponse: 0.6,
      propellerPoint: { x: 0, y: 0.05, z: -2.74 },
      propellerInAir: false,
      dragForward: 237.5,
      dragForwardLinear: 225,
      dragSideways: 40700,
      dragVertical: 16900,
      rudderStrength: 7200,
      rudderSpeedCurve: [
        [0, 0.15],
        [2, 0.5],
        [5, 0.9],
        [10, 1],
      ],
      idleTurnTorque: 4100,
      idleTurnFadeSpeed: 2.5,
      bankTorque: 12000,
      angularDamping: { x: 27000, y: 33300, z: 16000 },
      cargoGrid: { width: 6, height: 6 },
    },
  },
});

/** Narrows a stored or received value to a boat type, falling back to the default. */
export function boatTypeOr(id: unknown, fallback: BoatTypeId = DEFAULT_BOAT_TYPE): BoatTypeId {
  return typeof id === 'string' && Object.hasOwn(boatTypes, id) ? (id as BoatTypeId) : fallback;
}

import.meta.hot?.accept();
