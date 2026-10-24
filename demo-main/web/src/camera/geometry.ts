// Small 3D vector helpers shared by the trackers and the session engine (rest baseline, compensation).
// Axes are MediaPipe world coordinates: metres, hip-centred, x toward the patient's left, y down, z toward the camera negative.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const UP: Vec3 = { x: 0, y: -1, z: 0 };
export const DOWN: Vec3 = { x: 0, y: 1, z: 0 };

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
export const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
export const mid = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);
export const deg = (rad: number) => (rad * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;

/** Unit vector in the same direction, or null if `v` has no length. */
export function normalize(v: Vec3): Vec3 | null {
  const l = len(v);
  return l < 1e-9 ? null : scale(v, 1 / l);
}

/** Angle between two vectors in degrees (null if either has no length). */
export function angleDeg(u: Vec3, v: Vec3): number | null {
  const m = len(u) * len(v);
  if (m < 1e-9) return null;
  return deg(Math.acos(clamp(dot(u, v) / m, -1, 1)));
}

/** Rotate `v` by `degrees` about `axis` (right-hand rule, Rodrigues' formula). */
export function rotate(v: Vec3, axis: Vec3, degrees: number): Vec3 {
  const k = normalize(axis);
  if (!k) return v;
  const a = rad(degrees);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}
