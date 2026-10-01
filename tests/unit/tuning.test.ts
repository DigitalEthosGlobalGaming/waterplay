import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkTunable, MIN_MASS, safeMass } from '../../src/data/tuning-limits.ts';
import { debounce } from '../../src/dev/debounce.ts';
import { localStorageStore } from '../../src/dev/session-store.ts';

describe('tuning limits', () => {
  it.each([0, -5, 0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects mass %f', (m) => {
    expect(checkTunable('mass', m)).not.toBeNull();
  });

  it('accepts sensible values and leaves unknown props alone', () => {
    expect(checkTunable('mass', 1200)).toBeNull();
    expect(checkTunable('mass', MIN_MASS)).toBeNull();
    expect(checkTunable('steepnessOfSomething', -3)).toBeNull();
    expect(checkTunable('skyColour', '#000000')).toBeNull();
  });

  it('rejects zero where zero would divide or freeze things', () => {
    expect(checkTunable('wavelength', 0)).not.toBeNull();
    expect(checkTunable('throttleResponse', 0)).not.toBeNull();
    expect(checkTunable('dragSideways', 0)).toBeNull();
  });

  it('safeMass never returns an unusable mass', () => {
    expect(safeMass(0)).toBe(MIN_MASS);
    expect(safeMass(-10)).toBe(MIN_MASS);
    expect(safeMass(Number.NaN)).toBe(MIN_MASS);
    expect(safeMass(800)).toBe(800);
  });
});

describe('debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once with the latest value after things settle', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const d = debounce<number>(250, (v) => seen.push(v));
    d(1);
    vi.advanceTimersByTime(100);
    d(12);
    vi.advanceTimersByTime(100);
    d(1200);
    expect(d.pending).toBe(true);
    vi.advanceTimersByTime(249);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([1200]);
    expect(d.pending).toBe(false);
  });

  it('cancel drops the pending call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(50, fn);
    d('x');
    d.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('localStorage session store', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clear() removes every waterplay key and nothing else', () => {
    const data = new Map<string, string>([
      ['waterplay.devSession.web', '{}'],
      ['waterplay.devSession.other', '{}'],
      ['someone-elses-key', 'keep'],
    ]);
    const fake = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
      removeItem: (k: string) => data.delete(k),
    };
    // Object.keys(localStorage) lists stored keys in browsers; mimic that.
    vi.stubGlobal(
      'localStorage',
      new Proxy(fake, {
        ownKeys: () => [...data.keys()],
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
      }),
    );
    const store = localStorageStore('web');
    store.clear();
    expect([...data.keys()]).toEqual(['someone-elses-key']);
    expect(store.load()).toBeNull();
  });
});
