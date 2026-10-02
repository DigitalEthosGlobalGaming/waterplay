import { describe, expect, it } from 'vitest';
import { CALM_WATER } from '../../src/core/water/gerstner.ts';
import {
  MAX_WAKE_EMITTERS,
  WakeField,
  wakeAmplitude,
  wakeRingHeight,
} from '../../src/core/water/wakes.ts';
import type { WakeParams } from '../../src/data/water.ts';

/** Fixed params so tuning data/water.ts never breaks the golden values. */
const P: WakeParams = {
  dropInterval: 0.15,
  minSpeed: 2,
  lifetime: 7,
  ringSpeed: 4,
  width: 2.4,
  amplitudePerSpeed: 0.02,
  maxAmplitude: 0.3,
  spreadRadius: 6,
  fadeIn: 0.4,
};
const LOOP = 3600;

describe('wake ring', () => {
  // If these change, wakeHeight() in src/render/water/water.vert.glsl must change identically.
  it.each([
    [0, 0.2, 0.2, 0.07453545733551084],
    [4, 1, 0.2, 0.11381828609262618],
    [6, 1, 0.2, 0.024575679289355064],
    [10, 2.5, 0.25, 0.06326807052469305],
    [3, 3, 0.25, -0.0005441222829142714],
    [20, 6.5, 0.3, -0.00015288147595551475],
  ])('golden value at d=%f age=%f amp=%f', (d, age, amp, expected) => {
    expect(wakeRingHeight(d, age, amp, P)).toBeCloseTo(expected, 12);
  });

  it('is zero before it is dropped, after it expires and far from the crest', () => {
    expect(wakeRingHeight(0, 0, 0.3, P)).toBe(0);
    expect(wakeRingHeight(0, -1, 0.3, P)).toBe(0);
    expect(wakeRingHeight(28, 7, 0.3, P)).toBe(0);
    expect(wakeRingHeight(100, 2, 0.3, P)).toBe(0);
  });

  it('crests at the expanding radius and loses height as it spreads', () => {
    const crest = (age: number) => wakeRingHeight(P.ringSpeed * age, age, 0.3, P);
    expect(crest(1)).toBeGreaterThan(wakeRingHeight(P.ringSpeed * 1 + 1, 1, 0.3, P));
    expect(crest(1)).toBeGreaterThan(crest(3));
    expect(crest(3)).toBeGreaterThan(crest(6));
  });

  it('grows with boat speed, up to a cap', () => {
    expect(wakeAmplitude(1, P)).toBe(0);
    // Rings 1.5 m apart overlap, so each is scaled by 1.5 / 2.4.
    expect(wakeAmplitude(10, P)).toBeCloseTo(0.16 * (1.5 / 2.4));
    expect(wakeAmplitude(40, P)).toBe(P.maxAmplitude);
  });

  it('a slow boat makes a smaller wake than a fast one, however densely it is sampled', () => {
    const peakAt = (speed: number) => {
      const f = new WakeField(() => P);
      for (let i = 0; i < 180; i++) {
        f.update(i / 60, LOOP, [{ id: 'a', x: 0, z: (i * speed) / 60, vx: 0, vz: speed }]);
      }
      let peak = 0;
      for (let x = -20; x <= 20; x += 0.5)
        for (let z = -10; z <= 3 * speed; z += 0.5) peak = Math.max(peak, f.height(x, z, 3, LOOP));
      return peak;
    };
    expect(peakAt(4)).toBeLessThan(peakAt(15));
    expect(peakAt(15)).toBeLessThan(2 * P.maxAmplitude);
  });
});

describe('WakeField', () => {
  const moving = (id: string, x = 0) => ({ id, x, z: 0, vx: 0, vz: 10 });

  it('drops emitters at the interval while a boat moves, none while it idles', () => {
    const f = new WakeField(() => P);
    for (let i = 0; i < 60; i++) f.update(i / 60, LOOP, [moving('a'), { ...moving('b'), vz: 1 }]);
    const fromA = f.emitters.filter((e) => e.owner === 'a').length;
    expect(fromA).toBeGreaterThanOrEqual(6);
    expect(fromA).toBeLessThanOrEqual(7);
    expect(f.emitters.some((e) => e.owner === 'b')).toBe(false);
  });

  it('expires old emitters and caps the total', () => {
    const f = new WakeField(() => P);
    const many = Array.from({ length: 300 }, (_, i) => moving(`boat${i}`, i * 10));
    f.update(0, LOOP, many);
    expect(f.emitters.length).toBe(MAX_WAKE_EMITTERS);
    f.update(P.lifetime + 0.01, LOOP, []);
    expect(f.emitters).toEqual([]);
  });

  it('works across the world clock wrap', () => {
    const f = new WakeField(() => P);
    f.update(LOOP - 0.5, LOOP, [moving('a')]);
    f.update(0.5, LOOP, []);
    expect(f.emitters).toHaveLength(1);
    expect(f.height(4, 0, 0.5, LOOP)).toBeCloseTo(wakeRingHeight(4, 1, wakeAmplitude(10, P), P));
  });

  it("a boat doesn't feel its own wake", () => {
    const f = new WakeField(() => P);
    f.update(0, LOOP, [moving('a')]);
    const t = 1;
    expect(f.height(4, 0, t, LOOP, 'a')).toBe(0);
    expect(f.height(4, 0, t, LOOP, 'b')).toBeGreaterThan(0.05);
    const sea = f.sampler(CALM_WATER, t, LOOP, 'b');
    expect(sea.height(4, 0)).toBeCloseTo(f.height(4, 0, t, LOOP));
  });
});
