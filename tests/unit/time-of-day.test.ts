import { describe, expect, it } from 'vitest';
import { cyclicKeyframes, sunDirection, timeOfDay } from '../../src/core/world/time-of-day.ts';

const LOOP = 3600;

describe('time of day', () => {
  it('starts at the offset and advances one day per day length', () => {
    const p = { dayLengthSeconds: 1200, timeOffset: 0.25 };
    expect(timeOfDay(0, p, LOOP)).toBeCloseTo(0.25, 9);
    expect(timeOfDay(300, p, LOOP)).toBeCloseTo(0.5, 9);
    expect(timeOfDay(1200, p, LOOP)).toBeCloseTo(0.25, 9);
  });

  it('is seamless across the world clock wrap, even for awkward day lengths', () => {
    for (const dayLengthSeconds of [1200, 1000, 777, 5000]) {
      const p = { dayLengthSeconds, timeOffset: 0.4 };
      const before = timeOfDay(LOOP - 1e-6, p, LOOP);
      const after = timeOfDay(0, p, LOOP);
      expect(Math.abs(before - after) % 1).toBeLessThan(1e-6);
    }
  });

  it('puts the sun on the eastern horizon at dawn, high at noon, below at midnight', () => {
    const dawn = sunDirection(0.25, 0.45);
    expect(dawn.x).toBeCloseTo(1, 9);
    expect(dawn.y).toBeCloseTo(0, 9);
    expect(sunDirection(0.5, 0.45).y).toBeGreaterThan(0.85);
    expect(sunDirection(0.5, 0.45).z).toBeLessThan(0); // leans south
    expect(sunDirection(0, 0.45).y).toBeLessThan(-0.85);
    expect(sunDirection(0.75, 0.45).x).toBeCloseTo(-1, 9);
  });

  it('finds cyclic keyframe neighbours, wrapping past midnight', () => {
    const times = [0.1, 0.5, 0.8];
    const mid = cyclicKeyframes(times, 0.3);
    expect([mid.from, mid.to]).toEqual([0, 1]);
    expect(mid.f).toBeCloseTo(0.5, 9);
    expect(cyclicKeyframes(times, 0.8)).toEqual({ from: 2, to: 0, f: 0 });
    const late = cyclicKeyframes(times, 0.95);
    expect(late.from).toBe(2);
    expect(late.to).toBe(0);
    expect(late.f).toBeCloseTo(0.5, 9);
    const early = cyclicKeyframes(times, 0.05);
    expect(early.from).toBe(2);
    expect(early.f).toBeCloseTo(0.833333, 5);
  });
});
