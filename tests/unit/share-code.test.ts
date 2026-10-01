import { describe, expect, it } from 'vitest';
import {
  formatShareCode,
  generateShareCode,
  normalizeShareCode,
  SHARE_CODE_ALPHABET,
} from '../../src/core/net/share-code.ts';
import { Rng } from '../../src/core/sim/rng.ts';

describe('share codes', () => {
  it('alphabet has no ambiguous characters', () => {
    for (const c of '01OIL') expect(SHARE_CODE_ALPHABET).not.toContain(c);
  });

  it('generates valid 6-character codes', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const code = generateShareCode(rng);
      expect(code).toHaveLength(6);
      expect(normalizeShareCode(code)).toBe(code);
    }
  });

  it('formats and normalises', () => {
    expect(formatShareCode('K7MQ4X')).toBe('K7M-Q4X');
    expect(normalizeShareCode(' k7m-q4x ')).toBe('K7MQ4X');
  });

  it('rejects invalid input', () => {
    expect(normalizeShareCode('K7MQ4')).toBeNull();
    expect(normalizeShareCode('K7MQ4O')).toBeNull();
    expect(normalizeShareCode('')).toBeNull();
  });
});
