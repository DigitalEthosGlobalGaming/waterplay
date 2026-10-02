import type { WakeParams } from '../../data/water.ts';
import { wrapDelta } from '../net/interpolation.ts';
import type { WaterSampler } from './gerstner.ts';

/** Shader has the same cap (MAX_WAKES in water.vert.glsl). */
export const MAX_WAKE_EMITTERS = 256;

/** Beyond this many widths from its crest a ring adds nothing worth computing (e^-8). */
const CUTOFF_WIDTHS = 4;

export interface WakeEmitter {
  /** The boat that dropped it. Boats don't feel their own wake. */
  owner: string;
  x: number;
  z: number;
  /** World clock when dropped. */
  t0: number;
  amplitude: number;
}

/** Anything that leaves a wake: a boat (local or remote) with its horizontal velocity. */
export interface WakeSource {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/**
 * Height of one wake ring at distance d from where it was dropped, `age`
 * seconds later. A Ricker ("Mexican hat") profile: a crest with a trough
 * either side, expanding at ringSpeed and fading over its lifetime.
 *
 * MUST match wakeHeight() in src/render/water/water.vert.glsl.
 */
export function wakeRingHeight(d: number, age: number, amplitude: number, p: WakeParams): number {
  if (age <= 0 || age >= p.lifetime) return 0;
  const r = p.ringSpeed * age;
  const s = (d - r) / p.width;
  if (Math.abs(s) > CUTOFF_WIDTHS) return 0;
  const life = 1 - age / p.lifetime;
  const env = (life * life * smoothstep(0, p.fadeIn, age)) / Math.sqrt(1 + r / p.spreadRadius);
  const s2 = s * s;
  return amplitude * env * (1 - s2) * Math.exp(-0.5 * s2);
}

/**
 * Ring height for a boat going `speed` m/s. Slow boats drop rings closer
 * together and overlapping rings add up, so each one is scaled by its spacing:
 * the wake gets taller with speed, not with how densely it was sampled.
 */
export function wakeAmplitude(speed: number, p: WakeParams): number {
  const base = Math.min(p.maxAmplitude, Math.max(0, speed - p.minSpeed) * p.amplitudePerSpeed);
  const spacing = speed * p.dropInterval;
  return base * Math.min(1, spacing / Math.max(0.01, p.width));
}

/**
 * Every live wake emitter (§6.2). Derived each step from boat positions,
 * local and replicated, so every peer grows the same wakes without sending
 * any. Transient: it's rebuilt within a lifetime after a restore.
 */
export class WakeField {
  readonly emitters: WakeEmitter[] = [];
  private readonly lastDrop = new Map<string, number>();

  constructor(private readonly params: () => WakeParams) {}

  /** Drop new emitters for moving sources and forget expired ones. */
  update(t: number, period: number, sources: readonly WakeSource[]): void {
    const p = this.params();
    const e = this.emitters;
    // Ages can go briefly negative when a client's clock is nudged back; keep those.
    for (let i = e.length - 1; i >= 0; i--) {
      const age = wrapDelta((e[i] as WakeEmitter).t0, t, period);
      if (age >= p.lifetime || age < -1) e.splice(i, 1);
    }

    const present = new Set<string>();
    for (const s of sources) {
      present.add(s.id);
      const speed = Math.hypot(s.vx, s.vz);
      if (speed < p.minSpeed) continue;
      const last = this.lastDrop.get(s.id);
      if (last !== undefined) {
        const since = wrapDelta(last, t, period);
        if (since >= 0 && since < p.dropInterval) continue;
      }
      this.lastDrop.set(s.id, t);
      e.push({ owner: s.id, x: s.x, z: s.z, t0: t, amplitude: wakeAmplitude(speed, p) });
    }
    for (const id of this.lastDrop.keys()) if (!present.has(id)) this.lastDrop.delete(id);
    if (e.length > MAX_WAKE_EMITTERS) e.splice(0, e.length - MAX_WAKE_EMITTERS);
  }

  /** Sum of every ring at (x, z), optionally ignoring one owner's. */
  height(x: number, z: number, t: number, period: number, exclude?: string): number {
    const p = this.params();
    let h = 0;
    for (const w of this.emitters) {
      if (w.owner === exclude) continue;
      const age = wrapDelta(w.t0, t, period);
      h += wakeRingHeight(Math.hypot(x - w.x, z - w.z), age, w.amplitude, p);
    }
    return h;
  }

  /** The sea as one boat feels it: waves plus everyone else's wakes. */
  sampler(base: WaterSampler, t: number, period: number, exclude: string): WaterSampler {
    if (this.emitters.length === 0) return base;
    return {
      height: (x, z) => base.height(x, z) + this.height(x, z, t, period, exclude),
      displace: base.displace,
    };
  }

  clear(): void {
    this.emitters.length = 0;
    this.lastDrop.clear();
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
