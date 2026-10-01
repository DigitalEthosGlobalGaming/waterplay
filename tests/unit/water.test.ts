import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/sim/rng.ts';
import {
  CALM_WATER,
  createWaterSampler,
  waveConstants,
  wavePhases,
} from '../../src/core/water/gerstner.ts';
import type { WaterParams } from '../../src/data/water.ts';

/** Fixed params so tuning data/water.ts never breaks the golden values. */
const params: WaterParams = {
  amplitudeScale: 1,
  waves: [
    { directionDeg: 20, wavelength: 62, amplitude: 0.55, sharpness: 0.25, speedScale: 1 },
    { directionDeg: -35, wavelength: 31, amplitude: 0.3, sharpness: 0.25, speedScale: 1 },
    { directionDeg: 70, wavelength: 17, amplitude: 0.14, sharpness: 0.2, speedScale: 1 },
  ],
};
const G = 9.81;
const LOOP = 3600;
const waves = waveConstants(params, G, LOOP);

describe('water function', () => {
  // If these change, the shader (src/render/water/water.vert.glsl) must change identically.
  it.each([
    [0, 0, 0, -0.3945213382408152],
    [10, -5, 1.5, -0.38414521791955564],
    [-120.25, 33, 60, 0.07933086702779162],
    [500, 500, 1799.9, -0.4925060637059182],
    [3.3, -7.7, 3599.99, -0.7461766750034835],
  ])('golden value at (%f, %f, t=%f)', (x, z, t, expected) => {
    expect(createWaterSampler(waves, t).height(x, z)).toBeCloseTo(expected, 9);
  });

  it('height() inverts the GPU-style forward displacement', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const t = rng.range(0, LOOP);
      const sampler = createWaterSampler(waves, t);
      const p = sampler.displace(rng.range(-500, 500), rng.range(-500, 500));
      expect(sampler.height(p.x, p.z)).toBeCloseTo(p.y, 5);
    }
  });

  it('is continuous across the world clock wrap', () => {
    const before = createWaterSampler(waves, LOOP - 1e-6);
    const after = createWaterSampler(waves, 0);
    for (const [x, z] of [
      [0, 0],
      [37, -12],
      [-250, 400],
    ] as const) {
      expect(after.height(x, z)).toBeCloseTo(before.height(x, z), 4);
    }
  });

  it('quantises every wave to a whole number of cycles per loop', () => {
    for (const w of waves) {
      const turns = (w.omega * LOOP) / (2 * Math.PI);
      expect(turns).toBeCloseTo(Math.round(turns), 9);
    }
    for (const p of wavePhases(waves, 1234.5)) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(2 * Math.PI);
    }
  });

  it('clamps total sharpness so crests never loop', () => {
    const sharp = waveConstants(
      { amplitudeScale: 1, waves: params.waves.map((w) => ({ ...w, sharpness: 0.9 })) },
      G,
      LOOP,
    );
    const total = sharp.reduce((s, w) => s + w.horiz * w.k, 0);
    expect(total).toBeLessThanOrEqual(0.95 + 1e-9);
  });

  it('amplitudeScale 0 is a flat sea', () => {
    const flat = createWaterSampler(waveConstants({ ...params, amplitudeScale: 0 }, G, LOOP), 42);
    expect(flat.height(12, 34)).toBe(CALM_WATER.height(12, 34));
  });
});
