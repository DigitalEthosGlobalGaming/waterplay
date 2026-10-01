import type { Vec3 } from '../interfaces/common.ts';

/**
 * Day/night cycle maths. Pure and driven only by the shared world clock, so
 * every player sees the same time of day and nothing extra needs saving.
 */

export interface DayCycleParams {
  dayLengthSeconds: number;
  timeOffset: number;
}

/**
 * Time of day in [0, 1): 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
 * The day length is snapped so a whole number of days fits the clock loop,
 * which keeps the cycle seamless when the world clock wraps.
 */
export function timeOfDay(worldClock: number, p: DayCycleParams, loopPeriod: number): number {
  const days = Math.max(1, Math.round(loopPeriod / Math.max(1, p.dayLengthSeconds)));
  const dayLength = loopPeriod / days;
  return fract(worldClock / dayLength + p.timeOffset);
}

/**
 * Unit vector toward the sun. It rises in the east (+X), peaks at noon leaning
 * `tilt` radians toward the south (-Z), and sets in the west (-X).
 */
export function sunDirection(t: number, tilt: number): Vec3 {
  const a = 2 * Math.PI * (t - 0.25);
  const up = Math.sin(a);
  return { x: Math.cos(a), y: up * Math.cos(tilt), z: -up * Math.sin(tilt) };
}

/**
 * Where `t` falls between cyclic keyframe times (sorted ascending, in [0, 1)).
 * Returns the two neighbouring indices and the blend factor between them.
 */
export function cyclicKeyframes(
  times: readonly number[],
  t: number,
): { from: number; to: number; f: number } {
  const n = times.length;
  if (n === 0) return { from: 0, to: 0, f: 0 };
  const x = fract(t);
  for (let i = 0; i < n; i++) {
    const a = times[i] as number;
    const b = i + 1 < n ? (times[i + 1] as number) : (times[0] as number) + 1;
    // Before the first keyframe, wrap from the last one.
    const xx = x < (times[0] as number) ? x + 1 : x;
    if (xx >= a && xx < b) return { from: i, to: (i + 1) % n, f: (xx - a) / (b - a || 1) };
  }
  return { from: n - 1, to: 0, f: 0 };
}

function fract(v: number): number {
  return v - Math.floor(v);
}
