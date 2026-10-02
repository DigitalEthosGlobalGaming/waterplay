import { describe, expect, it } from 'vitest';
import { boatStats, statBars } from '../../src/core/boats/stats.ts';
import { BOAT_TYPE_IDS, boatTypeOr, boatTypes } from '../../src/data/boats.ts';
import { models } from '../../src/data/models.ts';

describe('boat lineup data', () => {
  it('every boat has a model, a name and a description', () => {
    expect(Object.keys(boatTypes).sort()).toEqual([...BOAT_TYPE_IDS].sort());
    for (const id of BOAT_TYPE_IDS) {
      const t = boatTypes[id];
      expect(models[t.model]).toBeTruthy();
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.handling.buoyancyPoints).toHaveLength(8);
    }
  });

  it('narrows stored or received ids to a known boat', () => {
    expect(boatTypeOr('tug')).toBe('tug');
    expect(boatTypeOr('submarine')).toBe('speedboat');
    expect(boatTypeOr('toString')).toBe('speedboat');
    expect(boatTypeOr(null)).toBe('speedboat');
    expect(boatTypeOr(7, 'racer')).toBe('racer');
  });
});

describe('boat stats', () => {
  it('top speed solves thrust = quadratic + linear drag', () => {
    const s = boatStats(boatTypes.speedboat);
    const h = boatTypes.speedboat.handling;
    const drag = h.dragForward * s.topSpeed ** 2 + h.dragForwardLinear * s.topSpeed;
    expect(drag).toBeCloseTo(h.maxThrust, 6);
  });

  it('bars compare against the best in the lineup', () => {
    const fastest = Math.max(...BOAT_TYPE_IDS.map((id) => statBars(id).topSpeed));
    expect(fastest).toBe(1);
    expect(statBars('racer').topSpeed).toBe(1);
    expect(statBars('tug').weight).toBe(1);
    expect(statBars('fishing').cargo).toBe(1);
    for (const id of BOAT_TYPE_IDS) {
      for (const v of Object.values(statBars(id))) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the boats have different strengths', () => {
    const tug = statBars('tug');
    const racer = statBars('racer');
    expect(racer.topSpeed).toBeGreaterThan(tug.topSpeed);
    expect(racer.turning).toBeGreaterThan(tug.turning);
    expect(tug.weight).toBeGreaterThan(racer.weight);
    expect(tug.cargo).toBeGreaterThan(racer.cargo);
  });
});
