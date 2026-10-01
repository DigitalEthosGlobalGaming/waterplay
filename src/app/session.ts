import type { BoatState } from '../core/boats/boat.ts';
import type { Quat, Vec3 } from '../core/interfaces/common.ts';
import type { WorldSimState } from '../core/sim/sim.ts';
import { type BoatTypeId, boatTypes } from '../data/boats.ts';
import type { ActiveDevice } from '../input/actions.ts';
import type { CameraState } from '../render/camera.ts';

/**
 * Session snapshot (§13.4.3). Same machinery as save games and the late-join
 * Welcome message. Every milestone extends this; bump SCHEMA_VERSION when the
 * shape changes and add a migration below (or make sure best-effort restore copes).
 */
export const SESSION_SCHEMA_VERSION = 2;

export type NetRole = 'host' | 'client' | 'offline';

export interface SessionState {
  net: {
    role: NetRole;
    sessionCode: string;
    localPeerId: string;
  };
  /** Owned by this instance. Always restored locally. */
  local: {
    /** Boats this instance owns. Absolute world coordinates. */
    boats: BoatState[];
    camera: CameraState;
    input: { activeDevice: ActiveDevice };
    devFlags: Record<string, unknown>;
    /** lil-gui edits not yet pasted into src/data (§13.4.6). */
    tuningOverrides: Record<string, unknown>;
  };
  /** Host only. The authoritative shared world. */
  world?: WorldSimState;
}

export interface SessionMeta {
  buildId: string;
  instance: string;
  savedAt: number;
}

export interface SessionSnapshot extends SessionMeta, SessionState {
  schemaVersion: number;
}

/** Partial on purpose: a best-effort restore may only recover some sections. */
export interface RestoredSession {
  meta: Partial<SessionMeta> & { schemaVersion?: number };
  net?: SessionState['net'];
  local: Partial<SessionState['local']>;
  world?: WorldSimState;
  /** Human-readable notes on anything dropped. Empty means a full restore. */
  warnings: string[];
}

export function serializeSession(state: SessionState, meta: SessionMeta): string {
  const snapshot: SessionSnapshot = { schemaVersion: SESSION_SCHEMA_VERSION, ...meta, ...state };
  return JSON.stringify(snapshot);
}

/** Never throws (§13.4.4). Worst case returns an empty restore with warnings. */
export function restoreSession(json: string): RestoredSession {
  const out: RestoredSession = { meta: {}, local: {}, warnings: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    out.warnings.push('snapshot is not valid JSON; starting fresh');
    return out;
  }
  if (!isRecord(raw)) {
    out.warnings.push('snapshot is not an object; starting fresh');
    return out;
  }

  let doc: Record<string, unknown> = raw;
  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : undefined;
  out.meta.schemaVersion = version;
  if (version !== SESSION_SCHEMA_VERSION) {
    const migrated = migrate(doc, version);
    if (migrated) {
      doc = migrated;
    } else {
      out.warnings.push(
        `schemaVersion ${String(version)} != ${SESSION_SCHEMA_VERSION}; best-effort restore`,
      );
    }
  }

  if (typeof doc.buildId === 'string') out.meta.buildId = doc.buildId;
  if (typeof doc.instance === 'string') out.meta.instance = doc.instance;
  if (typeof doc.savedAt === 'number') out.meta.savedAt = doc.savedAt;

  section(out, 'net', () => {
    const n = doc.net;
    if (
      isRecord(n) &&
      (n.role === 'host' || n.role === 'client' || n.role === 'offline') &&
      typeof n.sessionCode === 'string' &&
      typeof n.localPeerId === 'string'
    ) {
      out.net = { role: n.role, sessionCode: n.sessionCode, localPeerId: n.localPeerId };
      return true;
    }
    return false;
  });

  const local = isRecord(doc.local) ? doc.local : {};
  section(out, 'local.camera', () => {
    const c = local.camera;
    if (isRecord(c) && isFiniteNumber(c.yaw) && isFiniteNumber(c.pitch)) {
      out.local.camera = { yaw: c.yaw, pitch: c.pitch };
      return true;
    }
    return false;
  });
  section(out, 'local.input', () => {
    const i = local.input;
    if (isRecord(i) && (i.activeDevice === 'kbm' || i.activeDevice === 'gamepad')) {
      out.local.input = { activeDevice: i.activeDevice };
      return true;
    }
    return false;
  });
  section(out, 'local.devFlags', () => {
    if (isRecord(local.devFlags)) {
      out.local.devFlags = { ...local.devFlags };
      return true;
    }
    return false;
  });

  section(out, 'local.boats', () => {
    if (!Array.isArray(local.boats)) return false;
    const boats: BoatState[] = [];
    for (const b of local.boats) {
      const parsed = parseBoat(b);
      if (parsed) boats.push(parsed);
      else out.warnings.push('dropped a boat that did not parse');
    }
    out.local.boats = boats;
    return true;
  });
  section(out, 'local.tuningOverrides', () => {
    if (isRecord(local.tuningOverrides)) {
      out.local.tuningOverrides = { ...local.tuningOverrides };
      return true;
    }
    return false;
  });

  if (doc.world !== undefined) {
    section(out, 'world', () => {
      const w = doc.world;
      if (
        isRecord(w) &&
        isFiniteNumber(w.seed) &&
        isFiniteNumber(w.tick) &&
        isFiniteNumber(w.worldClock) &&
        isFiniteNumber(w.rngState)
      ) {
        out.world = { seed: w.seed, tick: w.tick, worldClock: w.worldClock, rngState: w.rngState };
        return true;
      }
      return false;
    });
  }

  return out;
}

/**
 * Upgrades old snapshots to the current schema, one version at a time.
 * Returns null when there's no migration path (best-effort restore follows).
 */
function migrate(
  raw: Record<string, unknown>,
  from: number | undefined,
): Record<string, unknown> | null {
  let current = raw;
  let version = from;
  while (version !== SESSION_SCHEMA_VERSION) {
    if (version === 1) {
      // v2 added owned boats and tuning overrides; v1 had neither.
      const local = isRecord(current.local) ? current.local : {};
      current = { ...current, local: { ...local, boats: [], tuningOverrides: {} } };
      version = 2;
    } else {
      return null;
    }
  }
  return current;
}

function parseBoat(b: unknown): BoatState | null {
  if (!isRecord(b)) return null;
  const { id, boatType, position, rotation, linVel, angVel, throttle, steer } = b;
  if (typeof id !== 'string' || typeof boatType !== 'string' || !(boatType in boatTypes))
    return null;
  if (!isVec3(position) || !isQuat(rotation) || !isVec3(linVel) || !isVec3(angVel)) return null;
  if (!isFiniteNumber(throttle) || !isFiniteNumber(steer)) return null;
  return {
    id,
    boatType: boatType as BoatTypeId,
    position: pickVec3(position),
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    linVel: pickVec3(linVel),
    angVel: pickVec3(angVel),
    throttle,
    steer,
  };
}

function isVec3(v: unknown): v is Vec3 {
  return isRecord(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z);
}

function isQuat(v: unknown): v is Quat {
  return isRecord(v) && isVec3(v) && isFiniteNumber(v.w);
}

function pickVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function section(out: RestoredSession, name: string, parse: () => boolean): void {
  try {
    if (!parse()) out.warnings.push(`dropped ${name}`);
  } catch (e) {
    out.warnings.push(`dropped ${name}: ${String(e)}`);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
