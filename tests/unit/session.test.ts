import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NullPhysicsWorld } from '../../src/adapters/physics/null/null-physics-world.ts';
import {
  restoreSession,
  SESSION_SCHEMA_VERSION,
  type SessionState,
  serializeSession,
} from '../../src/app/session.ts';
import { Sim } from '../../src/core/sim/sim.ts';

function populatedState(): SessionState {
  const sim = new Sim({ physics: new NullPhysicsWorld(), world: { seed: 99 } });
  for (let i = 0; i < 123; i++) sim.step();
  return {
    net: { role: 'host', sessionCode: 'DEV-0001', localPeerId: 'dev-A' },
    local: {
      boats: [
        {
          id: 'dev-A:1',
          boatType: 'speedboat',
          position: { x: 1200.5, y: -0.42, z: -873.25 },
          rotation: { x: 0.01, y: 0.7, z: -0.02, w: 0.7137 },
          linVel: { x: 3.5, y: 0.1, z: -12 },
          angVel: { x: 0, y: -0.6, z: 0.05 },
          throttle: 0.85,
          steer: -0.3,
        },
      ],
      camera: { yaw: 1.25, pitch: 0.4 },
      input: { activeDevice: 'gamepad' },
      devFlags: { seed: '123', debug: 'physics,water' },
      tuningOverrides: { 'boats:speedboat.handling.mass': 1500 },
    },
    world: sim.snapshot(),
  };
}

const meta = { buildId: 'abc', instance: 'A', savedAt: 1700000000000 };

describe('session snapshot', () => {
  it('round-trips exactly', () => {
    const state = populatedState();
    const restored = restoreSession(serializeSession(state, meta));
    expect(restored.warnings).toEqual([]);
    expect(restored.meta).toEqual({ ...meta, schemaVersion: SESSION_SCHEMA_VERSION });
    expect(restored.net).toEqual(state.net);
    expect(restored.local).toEqual(state.local);
    expect(restored.world).toEqual(state.world);
  });

  it('a restored sim continues identically', () => {
    const original = new Sim({ physics: new NullPhysicsWorld(), world: { seed: 5 } });
    for (let i = 0; i < 50; i++) original.step();
    const json = serializeSession({ ...populatedState(), world: original.snapshot() }, meta);
    const world = restoreSession(json).world;
    if (!world) throw new Error('world missing');
    const copy = new Sim({ physics: new NullPhysicsWorld(), world });
    for (let i = 0; i < 50; i++) {
      original.step();
      copy.step();
    }
    expect(copy.snapshot()).toEqual(original.snapshot());
  });

  it.each([
    ['not JSON', '{nope'],
    ['null', 'null'],
    ['an array', '[]'],
    ['an empty object', '{}'],
    ['wrong types', JSON.stringify({ schemaVersion: 1, local: { camera: 'x' }, world: [] })],
  ])('never throws on %s', (_name, json) => {
    const r = restoreSession(json);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('keeps what parses from a mismatched schema (best-effort)', () => {
    const json = JSON.stringify({
      schemaVersion: 0,
      local: { camera: { yaw: 2, pitch: 0.3 }, ui: 'something old' },
    });
    const r = restoreSession(json);
    expect(r.local.camera).toEqual({ yaw: 2, pitch: 0.3 });
    expect(r.warnings.some((w) => w.includes('schemaVersion'))).toBe(true);
  });

  it('drops individual boats that fail to parse but keeps the rest', () => {
    const state = populatedState();
    const raw = JSON.parse(serializeSession(state, meta));
    raw.local.boats.push({ id: 'x', boatType: 'submarine' }, { ...raw.local.boats[0], id: 'b2' });
    const r = restoreSession(JSON.stringify(raw));
    expect(r.local.boats?.map((b) => b.id)).toEqual(['dev-A:1', 'b2']);
    expect(r.warnings).toEqual(['dropped a boat that did not parse']);
  });

  // Old snapshots must keep restoring without throwing (§13.4.8).
  const fixtures = join(import.meta.dirname, '../fixtures/sessions');
  it.each(readdirSync(fixtures))('migrates fixture %s cleanly', (name) => {
    const r = restoreSession(readFileSync(join(fixtures, name), 'utf8'));
    expect(r.warnings).toEqual([]);
    expect(r.local.boats).toEqual([]);
    expect(r.local.camera).toBeDefined();
    expect(r.world).toBeDefined();
  });
});
