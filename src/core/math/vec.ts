import type { Quat, Vec3 } from '../interfaces/common.ts';

/** Small allocation-friendly vector/quaternion helpers. Plain objects, no classes. */

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export const IDENTITY_QUAT: Readonly<Quat> = { x: 0, y: 0, z: 0, w: 1 };

export function conjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Rotate v by unit quaternion q. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Rotation of `angle` radians about the world Y axis. */
export function quatFromYaw(angle: number): Quat {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka: number;
  let kb: number;
  if (cos > 0.9995) {
    ka = 1 - t;
    kb = t;
  } else {
    const theta = Math.acos(cos);
    const sin = Math.sin(theta);
    ka = Math.sin((1 - t) * theta) / sin;
    kb = Math.sin(t * theta) / sin;
  }
  const x = a.x * ka + bx * kb;
  const y = a.y * ka + by * kb;
  const z = a.z * ka + bz * kb;
  const w = a.w * ka + bw * kb;
  const n = Math.hypot(x, y, z, w) || 1;
  return { x: x / n, y: y / n, z: z / n, w: w / n };
}

/** Heading in radians about +Y, where 0 faces +Z and positive turns toward +X. */
export function headingOf(q: Quat): number {
  const f = rotate(q, { x: 0, y: 0, z: 1 });
  return Math.atan2(f.x, f.z);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Piecewise-linear lookup over [x, y] pairs sorted by x; clamps at both ends. */
export function sampleCurve(curve: readonly (readonly [number, number])[], x: number): number {
  const first = curve[0];
  if (!first) return 0;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const b = curve[i];
    const a = curve[i - 1];
    if (!a || !b) break;
    if (x <= b[0]) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1);
  }
  return curve[curve.length - 1]?.[1] ?? 0;
}
