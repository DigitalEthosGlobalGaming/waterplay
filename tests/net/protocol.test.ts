import { describe, expect, it } from 'vitest';
import { restingBoatState } from '../../src/core/boats/boat.ts';
import {
  cleanName,
  decodeMessage,
  encodeMessage,
  MAX_NAME_LENGTH,
  type NetMessage,
  PROTOCOL_VERSION,
} from '../../src/core/net/protocol.ts';
import { Rng } from '../../src/core/sim/rng.ts';

const boat = {
  ...restingBoatState('peer-x:12', 'speedboat', 1234567.25, -98765.5),
  rotation: { x: 0.1, y: 0.7, z: -0.1, w: 0.7 },
  linVel: { x: 3.5, y: -0.25, z: 11 },
  angVel: { x: 0, y: 0.4, z: 0.01 },
  throttle: 0.75,
  steer: -1,
};

const messages: NetMessage[] = [
  { type: 'hello', name: 'Ana', buildId: 'abc123' },
  {
    type: 'welcome',
    seed: 7,
    worldClock: 1234.5,
    buildId: 'abc123',
    players: [
      { peerId: 'waterplay-K7MQ4X', name: 'Ana' },
      { peerId: 'c-1', name: 'Bo' },
    ],
  },
  { type: 'reject', reason: 'version' },
  { type: 'playerJoined', player: { peerId: 'c-1', name: 'Bo' } },
  { type: 'playerLeft', peerId: 'c-1' },
  { type: 'ping', c: 12.25 },
  { type: 'pong', c: 12.25, worldClock: 3599.9 },
  { type: 'state', seq: 4_000_000_000, t: 3599.983, boats: [boat, { ...boat, id: 'é:2' }] },
  { type: 'state', seq: 1, t: 0, boats: [] },
];

describe('protocol', () => {
  it.each(messages.map((m) => [m.type, m] as const))('round-trips %s', (_type, msg) => {
    const decoded = decodeMessage(encodeMessage(msg));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    if (msg.type !== 'state' || decoded.msg.type !== 'state') {
      expect(decoded.msg).toEqual(msg);
      return;
    }
    // Positions are f64 (absolute world coordinates, §14.8); the rest is f32.
    expect(decoded.msg.seq).toBe(msg.seq);
    expect(decoded.msg.t).toBe(msg.t);
    expect(decoded.msg.boats).toHaveLength(msg.boats.length);
    msg.boats.forEach((b, i) => {
      const d = decoded.msg.type === 'state' ? decoded.msg.boats[i] : undefined;
      expect(d?.id).toBe(b.id);
      expect(d?.position).toEqual(b.position);
      expect(d?.rotation.y).toBeCloseTo(b.rotation.y, 6);
      expect(d?.linVel.z).toBeCloseTo(b.linVel.z, 6);
      expect(d?.throttle).toBeCloseTo(b.throttle, 6);
    });
  });

  it('state messages are compact', () => {
    const bytes = encodeMessage({ type: 'state', seq: 1, t: 1, boats: [boat] });
    expect(bytes.length).toBeLessThan(120);
  });

  it('reports a different protocol version instead of misreading it', () => {
    const bytes = encodeMessage({ type: 'ping', c: 1 });
    bytes[0] = PROTOCOL_VERSION + 1;
    expect(decodeMessage(bytes)).toEqual({
      ok: false,
      reason: 'incompatible',
      version: PROTOCOL_VERSION + 1,
    });
  });

  it('never throws on garbage', () => {
    const rng = new Rng(5);
    const samples: Uint8Array[] = [new Uint8Array(), new Uint8Array([PROTOCOL_VERSION])];
    for (let i = 0; i < 2000; i++) {
      const b = new Uint8Array(rng.int(0, 200)).map(() => rng.int(0, 256));
      if (b.length > 0 && rng.next() < 0.7) b[0] = PROTOCOL_VERSION;
      if (b.length > 1 && rng.next() < 0.7) b[1] = rng.int(1, 9);
      samples.push(b);
    }
    // Truncations of every valid message.
    for (const m of messages) {
      const full = encodeMessage(m);
      for (let n = 0; n < full.length; n++) samples.push(full.subarray(0, n));
    }
    for (const s of samples) {
      const r = decodeMessage(s);
      if (r.ok) expect(r.msg.type).toBeTypeOf('string');
    }
    // Truncated states in particular are rejected.
    const state = encodeMessage({ type: 'state', seq: 1, t: 1, boats: [boat] });
    expect(decodeMessage(state.subarray(0, state.length - 1)).ok).toBe(false);
  });

  it('rejects unknown boat types and non-finite numbers', () => {
    const odd = encodeMessage({
      type: 'state',
      seq: 1,
      t: 1,
      boats: [{ ...boat, boatType: 'kayak' as 'speedboat' }],
    });
    expect(decodeMessage(odd).ok).toBe(false);
    const nan = encodeMessage({ type: 'state', seq: 1, t: Number.NaN, boats: [boat] });
    expect(decodeMessage(nan).ok).toBe(false);
    const json = encodeMessage({ type: 'ping', c: 1 });
    const bad = new Uint8Array([...json.subarray(0, 2), ...new TextEncoder().encode('{"c":"1"}')]);
    expect(decodeMessage(bad).ok).toBe(false);
  });

  it('cleans player names', () => {
    expect(cleanName('  Ana\n\u0000 ')).toBe('Ana');
    expect(cleanName('')).toBe('Sailor');
    expect([...cleanName('🚤'.repeat(40))]).toHaveLength(MAX_NAME_LENGTH);
    const hello = encodeMessage({ type: 'hello', name: 'x'.repeat(100), buildId: 'b' });
    const decoded = decodeMessage(hello);
    expect(decoded.ok && decoded.msg.type === 'hello' && decoded.msg.name.length).toBe(
      MAX_NAME_LENGTH,
    );
  });
});
