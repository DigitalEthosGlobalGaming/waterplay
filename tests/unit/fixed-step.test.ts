import { describe, expect, it } from 'vitest';
import { FixedStepAccumulator } from '../../src/core/sim/fixed-step.ts';

const config = { dt: 1 / 60, maxStepsPerFrame: 5 };

describe('FixedStepAccumulator', () => {
  it('runs one step per 60 Hz frame', () => {
    const acc = new FixedStepAccumulator(() => config);
    let total = 0;
    for (let i = 0; i < 60; i++) total += acc.advance(1 / 60).steps;
    expect(total).toBe(60);
  });

  it('carries remainders across frames and reports alpha', () => {
    const acc = new FixedStepAccumulator(() => config);
    expect(acc.advance(0.5 / 60)).toEqual({ steps: 0, alpha: 0.5 });
    const r = acc.advance(1 / 60);
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeCloseTo(0.5);
  });

  it('clamps catch-up and drops the backlog', () => {
    const acc = new FixedStepAccumulator(() => config);
    expect(acc.advance(1).steps).toBe(5);
    expect(acc.advance(0).steps).toBe(0);
  });

  it('ignores negative frame times', () => {
    const acc = new FixedStepAccumulator(() => config);
    expect(acc.advance(-1).steps).toBe(0);
  });
});
