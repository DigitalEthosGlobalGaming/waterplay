import { type BoatTypeId, boatTypes } from '../../data/boats.ts';
import type { BoatState } from '../boats/boat.ts';

/**
 * Wire format (§8). Every message starts with [protocolVersion u8][type u8].
 * Boat state is binary (sent 20×/s); everything else is small JSON.
 *
 * Bump PROTOCOL_VERSION on any change to the bytes below. Peers on different
 * versions can't decode each other, so the version byte is checked before
 * anything else and mismatches are reported instead of misread.
 */
export const PROTOCOL_VERSION = 1;

const TYPE = {
  hello: 1,
  welcome: 2,
  reject: 3,
  playerJoined: 4,
  playerLeft: 5,
  ping: 6,
  pong: 7,
  state: 8,
} as const;

type TypeName = keyof typeof TYPE;
const TYPE_NAMES = new Map<number, TypeName>(
  Object.entries(TYPE).map(([k, v]) => [v, k as TypeName]),
);

export const MAX_NAME_LENGTH = 24;

export interface PlayerInfo {
  peerId: string;
  name: string;
}

export type NetMessage =
  /** Client → host, first thing after connecting. */
  | { type: 'hello'; name: string; buildId: string }
  /** Host → new client. `players` includes the host. */
  | { type: 'welcome'; seed: number; worldClock: number; buildId: string; players: PlayerInfo[] }
  | { type: 'reject'; reason: string }
  /** Host → everyone else when someone joins or renames. */
  | { type: 'playerJoined'; player: PlayerInfo }
  | { type: 'playerLeft'; peerId: string }
  /** `c` is the client's own elapsed time, echoed back for the round trip. */
  | { type: 'ping'; c: number }
  | { type: 'pong'; c: number; worldClock: number }
  /** Boats the sender owns. `t` is the sender's world clock. Absolute world coordinates (§14.8). */
  | { type: 'state'; seq: number; t: number; boats: BoatState[] };

export type DecodeResult =
  | { ok: true; msg: NetMessage }
  | { ok: false; reason: 'incompatible'; version: number }
  | { ok: false; reason: 'malformed' };

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeMessage(msg: NetMessage): Uint8Array {
  if (msg.type === 'state') return encodeState(msg);
  const { type, ...body } = msg;
  const json = encoder.encode(JSON.stringify(body));
  const out = new Uint8Array(2 + json.length);
  out[0] = PROTOCOL_VERSION;
  out[1] = TYPE[type];
  out.set(json, 2);
  return out;
}

/** Never throws: anything unexpected comes back as malformed. */
export function decodeMessage(data: Uint8Array): DecodeResult {
  if (data.length < 2) return MALFORMED;
  const version = data[0] ?? 0;
  if (version !== PROTOCOL_VERSION) return { ok: false, reason: 'incompatible', version };
  const type = TYPE_NAMES.get(data[1] ?? 0);
  if (!type) return MALFORMED;
  try {
    const msg = type === 'state' ? decodeState(data) : decodeJson(type, data.subarray(2));
    return msg ? { ok: true, msg } : MALFORMED;
  } catch {
    return MALFORMED;
  }
}

const MALFORMED: DecodeResult = { ok: false, reason: 'malformed' };

function decodeJson(type: Exclude<TypeName, 'state'>, bytes: Uint8Array): NetMessage | null {
  const b: unknown = JSON.parse(decoder.decode(bytes));
  if (!isRecord(b)) return null;
  switch (type) {
    case 'hello':
      return isString(b.name) && isString(b.buildId)
        ? { type, name: cleanName(b.name), buildId: b.buildId }
        : null;
    case 'welcome': {
      if (!isNum(b.seed) || !isNum(b.worldClock) || !isString(b.buildId)) return null;
      if (!Array.isArray(b.players)) return null;
      const players = b.players.map(parsePlayer);
      if (players.some((p) => p === null)) return null;
      return {
        type,
        seed: b.seed,
        worldClock: b.worldClock,
        buildId: b.buildId,
        players: players as PlayerInfo[],
      };
    }
    case 'reject':
      return isString(b.reason) ? { type, reason: b.reason } : null;
    case 'playerJoined': {
      const player = parsePlayer(b.player);
      return player ? { type, player } : null;
    }
    case 'playerLeft':
      return isString(b.peerId) ? { type, peerId: b.peerId } : null;
    case 'ping':
      return isNum(b.c) ? { type, c: b.c } : null;
    case 'pong':
      return isNum(b.c) && isNum(b.worldClock) ? { type, c: b.c, worldClock: b.worldClock } : null;
  }
}

function parsePlayer(p: unknown): PlayerInfo | null {
  return isRecord(p) && isString(p.peerId) && isString(p.name)
    ? { peerId: p.peerId, name: cleanName(p.name) }
    : null;
}

/** Trim, drop control characters and cap the length. Falls back to "Sailor". */
export function cleanName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...cleaned].slice(0, MAX_NAME_LENGTH).join('') || 'Sailor';
}

// --- Binary boat state -------------------------------------------------------

/** pos f64×3, rot f32×4, linVel f32×3, angVel f32×3, throttle f32, steer f32. */
const BOAT_FIXED_BYTES = 3 * 8 + 4 * 4 + 3 * 4 + 3 * 4 + 4 + 4;
const MAX_STRING_BYTES = 255;
const MAX_BOATS = 255;

function encodeState(msg: Extract<NetMessage, { type: 'state' }>): Uint8Array {
  const boats = msg.boats.slice(0, MAX_BOATS);
  const strings = boats.map((b) => [shortBytes(b.id), shortBytes(b.boatType)] as const);
  let size = 2 + 4 + 8 + 1;
  for (const [id, type] of strings) size += 1 + id.length + 1 + type.length + BOAT_FIXED_BYTES;

  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let o = 0;
  v.setUint8(o++, PROTOCOL_VERSION);
  v.setUint8(o++, TYPE.state);
  v.setUint32(o, msg.seq >>> 0, true);
  o += 4;
  v.setFloat64(o, msg.t, true);
  o += 8;
  v.setUint8(o++, boats.length);
  boats.forEach((b, i) => {
    const [id, type] = strings[i] ?? [new Uint8Array(), new Uint8Array()];
    for (const s of [id, type]) {
      v.setUint8(o++, s.length);
      out.set(s, o);
      o += s.length;
    }
    for (const n of [b.position.x, b.position.y, b.position.z]) {
      v.setFloat64(o, n, true);
      o += 8;
    }
    const r = b.rotation;
    const f32 = [r.x, r.y, r.z, r.w, b.linVel.x, b.linVel.y, b.linVel.z];
    f32.push(b.angVel.x, b.angVel.y, b.angVel.z, b.throttle, b.steer);
    for (const n of f32) {
      v.setFloat32(o, n, true);
      o += 4;
    }
  });
  return out;
}

function decodeState(data: Uint8Array): NetMessage | null {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 2;
  const need = (n: number) => {
    if (o + n > data.length) throw new RangeError('short state message');
  };
  need(4 + 8 + 1);
  const seq = v.getUint32(o, true);
  o += 4;
  const t = v.getFloat64(o, true);
  o += 8;
  const count = v.getUint8(o++);
  const str = () => {
    need(1);
    const len = v.getUint8(o++);
    need(len);
    const s = decoder.decode(data.subarray(o, o + len));
    o += len;
    return s;
  };
  const f64 = () => {
    const n = v.getFloat64(o, true);
    o += 8;
    return n;
  };
  const f32 = () => {
    const n = v.getFloat32(o, true);
    o += 4;
    return n;
  };

  const boats: BoatState[] = [];
  for (let i = 0; i < count; i++) {
    const id = str();
    const boatType = str();
    need(BOAT_FIXED_BYTES);
    const position = { x: f64(), y: f64(), z: f64() };
    const rotation = { x: f32(), y: f32(), z: f32(), w: f32() };
    const linVel = { x: f32(), y: f32(), z: f32() };
    const angVel = { x: f32(), y: f32(), z: f32() };
    const throttle = f32();
    const steer = f32();
    if (!isBoatType(boatType)) return null;
    const numbers = [position, rotation, linVel, angVel].flatMap((o) => Object.values(o));
    if (![t, throttle, steer, ...numbers].every(Number.isFinite)) return null;
    boats.push({ id, boatType, position, rotation, linVel, angVel, throttle, steer });
  }
  if (o !== data.length) return null;
  return { type: 'state', seq, t, boats };
}

function shortBytes(s: string): Uint8Array {
  const b = encoder.encode(s);
  if (b.length > MAX_STRING_BYTES) throw new RangeError(`"${s.slice(0, 20)}…" is too long to send`);
  return b;
}

function isBoatType(s: string): s is BoatTypeId {
  return Object.hasOwn(boatTypes, s);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
