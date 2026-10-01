import type { WaterParams } from '../../data/water.ts';

/**
 * The shared water function (§6.1). This is the TypeScript half; the GLSL half
 * is src/render/water/water.vert.glsl. Both evaluate exactly this:
 *
 *   theta_i  = k_i * dot(dir_i, p0) - phase_i
 *   offset   = sum_i  dir_i * horiz_i * cos(theta_i)        (horizontal, xz)
 *   height   = sum_i  amplitude_i * sin(theta_i)
 *
 * where p0 is the undisplaced grid point. Wave constants and phases are computed
 * here (in float64) and handed to the shader as uniforms, so the GPU never does
 * the precision-sensitive `omega * t`.
 *
 * Changing this file? Change the shader and update tests/unit/water.test.ts.
 */

export const MAX_WAVES = 6;

export interface WaveConstants {
  dirX: number;
  dirZ: number;
  /** Wavenumber, 2π / wavelength. */
  k: number;
  amplitude: number;
  /** Horizontal displacement amplitude (sharpness / k). */
  horiz: number;
  /** Angular frequency, quantised so every wave repeats exactly over the loop period. */
  omega: number;
}

/**
 * Turn tunable wave params into evaluation constants. Frequencies are snapped so
 * `omega * loopPeriod` is a whole number of turns, which keeps the surface
 * continuous when the world clock wraps.
 */
export function waveConstants(
  params: WaterParams,
  gravity: number,
  loopPeriod: number,
): WaveConstants[] {
  const waves = params.waves.slice(0, MAX_WAVES);
  const totalSharpness = waves.reduce((s, w) => s + Math.max(0, w.sharpness), 0);
  // Keep the sum below 1 so the horizontal map stays invertible (no looping crests).
  const sharpnessScale = totalSharpness > 0.95 ? 0.95 / totalSharpness : 1;
  return waves.map((w) => {
    const k = (2 * Math.PI) / Math.max(0.1, w.wavelength);
    const omegaRaw = Math.sqrt(gravity * k) * w.speedScale;
    const turns = Math.max(1, Math.round((omegaRaw * loopPeriod) / (2 * Math.PI)));
    const dir = (w.directionDeg * Math.PI) / 180;
    return {
      dirX: Math.sin(dir),
      dirZ: Math.cos(dir),
      k,
      amplitude: w.amplitude * params.amplitudeScale,
      horiz: ((Math.max(0, w.sharpness) * sharpnessScale) / k) * params.amplitudeScale,
      omega: (2 * Math.PI * turns) / loopPeriod,
    };
  });
}

const TAU = 2 * Math.PI;

/** omega * t wrapped into [0, 2π). Same values go to the shader. */
export function wavePhases(waves: readonly WaveConstants[], t: number): number[] {
  return waves.map((w) => {
    const p = (w.omega * t) % TAU;
    return p < 0 ? p + TAU : p;
  });
}

export interface WaterSampler {
  /** Surface height at world (x, z). */
  height(x: number, z: number): number;
  /** Where grid point (x0, z0) ends up; mirrors the vertex shader. */
  displace(x0: number, z0: number): { x: number; y: number; z: number };
}

/** Newton iterations to invert the horizontal displacement (invertible since sharpness < 1). */
const INVERT_ITERATIONS = 4;

export function createWaterSampler(waves: readonly WaveConstants[], t: number): WaterSampler {
  const phases = wavePhases(waves, t);
  const n = waves.length;

  const displace = (x0: number, z0: number) => {
    let x = x0;
    let y = 0;
    let z = z0;
    for (let i = 0; i < n; i++) {
      const w = waves[i] as WaveConstants;
      const theta = w.k * (w.dirX * x0 + w.dirZ * z0) - (phases[i] as number);
      const c = Math.cos(theta);
      x += w.dirX * w.horiz * c;
      z += w.dirZ * w.horiz * c;
      y += w.amplitude * Math.sin(theta);
    }
    return { x, y, z };
  };

  const height = (x: number, z: number) => {
    // Find the grid point p0 whose displaced position lands on (x, z), then take its height.
    let x0 = x;
    let z0 = z;
    for (let iter = 0; iter < INVERT_ITERATIONS; iter++) {
      // Residual and Jacobian of p0 -> displaced xz.
      let rx = x0 - x;
      let rz = z0 - z;
      let jxx = 1;
      let jxz = 0;
      let jzz = 1;
      for (let i = 0; i < n; i++) {
        const w = waves[i] as WaveConstants;
        const theta = w.k * (w.dirX * x0 + w.dirZ * z0) - (phases[i] as number);
        const c = Math.cos(theta);
        const s = w.horiz * w.k * Math.sin(theta);
        rx += w.dirX * w.horiz * c;
        rz += w.dirZ * w.horiz * c;
        jxx -= s * w.dirX * w.dirX;
        jxz -= s * w.dirX * w.dirZ;
        jzz -= s * w.dirZ * w.dirZ;
      }
      const det = jxx * jzz - jxz * jxz;
      x0 -= (jzz * rx - jxz * rz) / det;
      z0 -= (jxx * rz - jxz * rx) / det;
    }
    return displace(x0, z0).y;
  };

  return { height, displace };
}

/** A flat, still sea. Handy for tests. */
export const CALM_WATER: WaterSampler = {
  height: () => 0,
  displace: (x, z) => ({ x, y: 0, z }),
};
