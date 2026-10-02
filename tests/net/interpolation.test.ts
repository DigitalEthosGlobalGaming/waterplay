import { describe, expect, it } from 'vitest';
import {
  InterpolationBuffer,
  type TimedState,
  wrapDelta,
} from '../../src/core/net/interpolation.ts';

const PERIOD = 3600;

function at(t: number, x: number, vx = 10): TimedState {
  return {
    t,
    position: { x, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    linVel: { x: vx, y: 0, z: 0 },
    angVel: { x: 0, y: 0, z: 0 },
    throttle: 1,
    steer: 0,
  };
}

describe('wrapDelta', () => {
  it('takes the short way round the loop', () => {
    expect(wrapDelta(10, 12, PERIOD)).toBe(2);
    expect(wrapDelta(12, 10, PERIOD)).toBe(-2);
    expect(wrapDelta(3599, 1, PERIOD)).toBeCloseTo(2);
    expect(wrapDelta(1, 3599, PERIOD)).toBeCloseTo(-2);
  });
});

describe('InterpolationBuffer', () => {
  it('blends between the states either side', () => {
    const b = new InterpolationBuffer(PERIOD);
    b.push(at(1, 0));
    b.push(at(1.1, 1));
    expect(b.sample(1.05, 0.25)?.position.x).toBeCloseTo(0.5);
  });

  it('slots late arrivals in by time and ignores duplicates', () => {
    const b = new InterpolationBuffer(PERIOD);
    b.push(at(1, 0));
    b.push(at(1.2, 2));
    b.push(at(1.1, 1));
    b.push(at(1.1, 99));
    expect(b.size).toBe(3);
    expect(b.sample(1.15, 0.25)?.position.x).toBeCloseTo(1.5);
  });

  it('coasts past the newest state, but only so far', () => {
    const b = new InterpolationBuffer(PERIOD);
    b.push(at(1, 0));
    b.push(at(1.1, 1));
    expect(b.sample(1.2, 0.25)?.position.x).toBeCloseTo(2);
    expect(b.sample(5, 0.25)?.position.x).toBeCloseTo(1 + 10 * 0.25);
  });

  it('holds the oldest state before the buffer starts', () => {
    const b = new InterpolationBuffer(PERIOD);
    b.push(at(1, 3));
    b.push(at(1.1, 4));
    expect(b.sample(0.5, 0.25)?.position.x).toBe(3);
  });

  it('works across the world clock wrap', () => {
    const b = new InterpolationBuffer(PERIOD);
    b.push(at(3599.95, 0));
    b.push(at(0.05, 1));
    expect(b.sample(0, 0.25)?.position.x).toBeCloseTo(0.5);
    expect(b.sample(3599.97, 0.25)?.position.x).toBeCloseTo(0.2);
  });

  it('prunes old states but keeps two', () => {
    const b = new InterpolationBuffer(PERIOD);
    for (let i = 0; i < 10; i++) b.push(at(i * 0.1, i));
    b.prune(0.95, 0.2);
    expect(b.size).toBeLessThan(5);
    expect(b.sample(0.85, 0.25)?.position.x).toBeCloseTo(8.5);
    b.prune(100, 0.2);
    expect(b.size).toBe(2);
  });
});
