import { describe, expect, it } from 'vitest';
import {
  applyTunableOverrides,
  getTunableOverrides,
  liveTunable,
  onTunablesChanged,
  resetTunableOverrides,
  setTunableOverride,
} from '../../src/data/registry.ts';

describe('liveTunable', () => {
  it('keeps the original object identity across hot swaps', () => {
    const initial: Record<string, unknown> = { speed: 1, removed: true };
    const first = liveTunable('test.identity', initial);
    const second = liveTunable('test.identity', { speed: 2, added: 'yes' });
    expect(second).toBe(first);
    expect(first).toEqual({ speed: 2, added: 'yes' });
  });

  it('notifies listeners on swap, not on first registration', () => {
    const seen: string[] = [];
    const off = onTunablesChanged((k) => seen.push(k));
    liveTunable('test.notify', { a: 1 });
    liveTunable('test.notify', { a: 2 });
    off();
    liveTunable('test.notify', { a: 3 });
    expect(seen).toEqual(['test.notify']);
  });

  it('tracks overrides by path and re-applies them', () => {
    const t = liveTunable('test.override', { boat: { mass: 100, name: 'a' } });
    setTunableOverride('test.override', 'boat.mass', 250);
    expect(t.boat.mass).toBe(250);
    const saved = getTunableOverrides();
    expect(saved['test.override:boat.mass']).toBe(250);

    resetTunableOverrides();
    expect(t.boat.mass).toBe(100);
    expect(getTunableOverrides()).toEqual({});

    const applied = applyTunableOverrides({
      ...saved,
      'test.override:boat.missing': 1,
      'test.override:boat.name': 42,
      'nope:x': 1,
    });
    expect(applied).toEqual(['test.override:boat.mass']);
    expect(t.boat.mass).toBe(250);
  });

  it('drops overrides for a key when its data file hot swaps', () => {
    liveTunable('test.swap', { v: 1 });
    setTunableOverride('test.swap', 'v', 5);
    liveTunable('test.swap', { v: 2 });
    expect(getTunableOverrides()['test.swap:v']).toBeUndefined();
  });
});
