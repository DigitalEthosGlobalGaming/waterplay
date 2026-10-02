import type { Quat, Vec3 } from '../interfaces/common.ts';
import { add, lerp3, scale, slerp } from '../math/vec.ts';

export interface TimedState {
  /** Sender's world clock, seconds. */
  t: number;
  position: Vec3;
  rotation: Quat;
  linVel: Vec3;
  angVel: Vec3;
  throttle: number;
  steer: number;
}

export interface SampledState {
  position: Vec3;
  rotation: Quat;
  linVel: Vec3;
  throttle: number;
}

/** Signed b - a on a clock that wraps at `period`, in [-period/2, period/2). */
export function wrapDelta(a: number, b: number, period: number): number {
  const d = (b - a) % period;
  if (d >= period / 2) return d - period;
  if (d < -period / 2) return d + period;
  return d;
}

const MAX_ENTRIES = 32;

/**
 * Recent states of one remote boat, sampled a little in the past (§8 snapshot
 * interpolation). Times are on the shared world clock, which wraps, so all
 * comparisons go through wrapDelta.
 */
export class InterpolationBuffer {
  private readonly entries: TimedState[] = [];

  constructor(private readonly period: number) {}

  get size(): number {
    return this.entries.length;
  }

  get newest(): TimedState | undefined {
    return this.entries[this.entries.length - 1];
  }

  /** Out-of-order states are slotted in by time; duplicates and very old ones are dropped. */
  push(s: TimedState): void {
    const e = this.entries;
    let i = e.length;
    while (i > 0) {
      const prev = e[i - 1];
      if (!prev) break;
      const d = wrapDelta(prev.t, s.t, this.period);
      if (d > 0) break;
      if (d === 0) return;
      i--;
    }
    e.splice(i, 0, s);
    if (e.length > MAX_ENTRIES) e.shift();
  }

  /**
   * State at time t: blended between the two states around it, held at the
   * oldest before the buffer starts, and coasted on velocity (for at most
   * maxExtrapolation seconds) past the newest.
   */
  sample(t: number, maxExtrapolation: number): SampledState | undefined {
    const e = this.entries;
    const first = e[0];
    const last = e[e.length - 1];
    if (!first || !last) return undefined;

    const sinceLast = wrapDelta(last.t, t, this.period);
    if (sinceLast >= 0) {
      const dt = Math.min(sinceLast, Math.max(0, maxExtrapolation));
      return {
        position: add(last.position, scale(last.linVel, dt)),
        rotation: last.rotation,
        linVel: last.linVel,
        throttle: last.throttle,
      };
    }
    if (wrapDelta(first.t, t, this.period) <= 0) return pick(first);

    for (let i = e.length - 1; i > 0; i--) {
      const a = e[i - 1];
      const b = e[i];
      if (!a || !b) continue;
      const intoA = wrapDelta(a.t, t, this.period);
      if (intoA < 0) continue;
      const span = wrapDelta(a.t, b.t, this.period);
      const f = span > 0 ? Math.min(1, intoA / span) : 1;
      return {
        position: lerp3(a.position, b.position, f),
        rotation: slerp(a.rotation, b.rotation, f),
        linVel: lerp3(a.linVel, b.linVel, f),
        throttle: a.throttle + (b.throttle - a.throttle) * f,
      };
    }
    return pick(last);
  }

  /** Forget states older than `t - keep`, always keeping two to blend between. */
  prune(t: number, keep: number): void {
    const e = this.entries;
    while (e.length > 2) {
      const second = e[1];
      if (!second || wrapDelta(second.t, t, this.period) <= keep) break;
      e.shift();
    }
  }
}

function pick(s: TimedState): SampledState {
  return { position: s.position, rotation: s.rotation, linVel: s.linVel, throttle: s.throttle };
}
