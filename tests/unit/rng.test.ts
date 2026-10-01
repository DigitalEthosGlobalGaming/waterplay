import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/sim/rng.ts';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('resumes exactly from saved state', () => {
    const a = new Rng(7);
    for (let i = 0; i < 10; i++) a.next();
    const b = Rng.fromState(a.state);
    for (let i = 0; i < 100; i++) expect(b.next()).toBe(a.next());
  });

  it('stays in range', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(3, 6);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThan(6);
    }
  });

  it('pick throws on empty input', () => {
    expect(() => new Rng(1).pick([])).toThrow();
  });
});
