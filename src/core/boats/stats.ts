import { BOAT_TYPE_IDS, type BoatType, type BoatTypeId, boatTypes } from '../../data/boats.ts';

/** What the boat picker compares, worked out from handling so it never drifts from the physics. */
export interface BoatStats {
  /** m/s at full throttle on flat water, without boost. */
  topSpeed: number;
  /** m/s² from a standstill. */
  acceleration: number;
  /** Rough yaw rate at full rudder (rad/s): rudder moment over yaw damping. */
  turning: number;
  /** kg. */
  weight: number;
  /** Cargo grid cells. */
  cargo: number;
}

export type StatName = keyof BoatStats;

export function boatStats(type: BoatType): BoatStats {
  const h = type.handling;
  const a = h.dragForward;
  const b = h.dragForwardLinear;
  // Where thrust meets quadratic plus linear drag.
  const topSpeed =
    a > 0 ? (-b + Math.sqrt(b * b + 4 * a * h.maxThrust)) / (2 * a) : h.maxThrust / Math.max(b, 1);
  return {
    topSpeed,
    acceleration: h.maxThrust / Math.max(h.mass, 1),
    turning: (h.rudderStrength * Math.abs(h.propellerPoint.z)) / Math.max(h.angularDamping.y, 1),
    weight: h.mass,
    cargo: h.cargoGrid.width * h.cargoGrid.height,
  };
}

/**
 * Each stat as 0..1 against the best boat in the lineup, for bars. Never
 * quite empty, so the weakest boat still shows a sliver.
 */
export function statBars(id: BoatTypeId): Record<StatName, number> {
  const all = BOAT_TYPE_IDS.map((t) => boatStats(boatTypes[t]));
  const mine = boatStats(boatTypes[id]);
  const bars = {} as Record<StatName, number>;
  for (const k of Object.keys(mine) as StatName[]) {
    const max = Math.max(...all.map((s) => s[k]));
    bars[k] = max > 0 ? Math.max(0.08, mine[k] / max) : 0;
  }
  return bars;
}
