/**
 * Pure geometry for the 3D replay (CONVERGENCE_PLAN §10 WP6). No three.js here, so it stays out of
 * the three chunk and is cheap to unit-test.
 *
 * Replay frames are MediaPipe world coordinates (metres, x = patient's left, y DOWN, z toward the
 * camera negative). The scene is y-up with the camera on +z, not mirrored: a patient facing the
 * camera shows their left arm on the viewer's right, as a clinician sitting opposite would see it.
 */
import type { BodySide, Exercise, ReplayFile, Side } from '../../types';
import { REPLAY_JOINTS } from '../../types';

export type Vec3 = [number, number, number];

type JointName = (typeof REPLAY_JOINTS)[number];
export const JOINT: Record<JointName, number> = Object.fromEntries(REPLAY_JOINTS.map((j, i) => [j, i])) as Record<JointName, number>;

export const JOINT_COUNT = REPLAY_JOINTS.length;

/** Bones as index pairs into REPLAY_JOINTS. Nose → mid-shoulder is drawn separately (no such joint). */
export const BONES: readonly (readonly [number, number])[] = [
  [1, 2],
  [1, 3],
  [3, 5],
  [2, 4],
  [4, 6],
  [1, 7],
  [2, 8],
  [7, 8],
  [7, 9],
  [9, 11],
  [8, 10],
  [10, 12],
];

/** Joints whose position belongs to the given body side's arm (shoulder, elbow, wrist). */
export function armJoints(side: BodySide): number[] {
  return side === 'left' ? [JOINT.left_shoulder, JOINT.left_elbow, JOINT.left_wrist] : [JOINT.right_shoulder, JOINT.right_elbow, JOINT.right_wrist];
}

/** MediaPipe world → scene (y up, camera on +z). */
export function toScene([x, y, z]: Vec3): Vec3 {
  return [x, -y, -z];
}

const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Scene-space mid-hip of frame 0: subtract it from every point so the figure stands on the origin. */
export function sceneOrigin(replay: Pick<ReplayFile, 'frames'>): Vec3 {
  const f = replay.frames[0];
  if (!f) return [0, 0, 0];
  return toScene(mid(f[JOINT.left_hip], f[JOINT.right_hip]));
}

/**
 * One frame in scene space, centred on `origin`. Returns JOINT_COUNT + 1 points: the 13 joints, then
 * the mid-shoulder (index JOINT_COUNT) for the nose → neck bone.
 */
export function scenePoints(frame: Vec3[], origin: Vec3): Vec3[] {
  const pts = frame.map((p) => sub(toScene(p), origin));
  pts.push(mid(pts[JOINT.left_shoulder], pts[JOINT.right_shoulder]));
  return pts;
}

/** Index of the mid-shoulder point appended by scenePoints. */
export const MID_SHOULDER = JOINT_COUNT;

/** Line segments (flat point pairs) for every bone plus nose → mid-shoulder, from scenePoints output. */
export function boneSegments(pts: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const [a, b] of BONES) out.push(pts[a], pts[b]);
  out.push(pts[JOINT.nose], pts[MID_SHOULDER]);
  return out;
}

/** Angle ABC at B, degrees. */
export function angleAt(a: Vec3, b: Vec3, c: Vec3): number {
  return angleBetween(sub(a, b), sub(c, b));
}

export function angleBetween(u: Vec3, v: Vec3): number {
  const nu = Math.hypot(u[0], u[1], u[2]);
  const nv = Math.hypot(v[0], v[1], v[2]);
  if (!nu || !nv) return 0;
  const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/** "Up" in MediaPipe world coordinates (y points down). */
const MP_UP: Vec3 = [0, -1, 0];

export interface FrameAngles {
  /** The exercise angle in degrees, or null when the replay has no joints for it (hand_open). */
  angle: number | null;
  /** Trunk lean from vertical, degrees. */
  lean: number;
}

/**
 * Angles for one frame (MediaPipe coordinates; angles don't change under toScene).
 * arm_raise = angle(hip, shoulder, elbow); forward_reach = angle(shoulder, elbow, wrist);
 * hand_open = null (no finger joints in the replay). Lean = angle(mid-shoulder − mid-hip, up).
 */
export function frameAngles(frame: Vec3[], exercise: Exercise, bodySide: BodySide): FrameAngles {
  const L = bodySide === 'left';
  const shoulder = frame[L ? JOINT.left_shoulder : JOINT.right_shoulder];
  const elbow = frame[L ? JOINT.left_elbow : JOINT.right_elbow];
  const wrist = frame[L ? JOINT.left_wrist : JOINT.right_wrist];
  const hip = frame[L ? JOINT.left_hip : JOINT.right_hip];
  const lean = angleBetween(sub(mid(frame[JOINT.left_shoulder], frame[JOINT.right_shoulder]), mid(frame[JOINT.left_hip], frame[JOINT.right_hip])), MP_UP);
  let angle: number | null = null;
  if (exercise === 'arm_raise') angle = angleAt(hip, shoulder, elbow);
  else if (exercise === 'forward_reach') angle = angleAt(shoulder, elbow, wrist);
  return { angle, lean };
}

/** Which body side moved in a replay of `side`. */
export function bodySideFor(side: Side, weakSide: BodySide): BodySide {
  if (side === 'weak') return weakSide;
  return weakSide === 'left' ? 'right' : 'left';
}

export interface AngleRow {
  frame: number;
  /** Seconds from the start. */
  t: number;
  angle: number | null;
  lean: number;
}

export function angleSeries(replay: ReplayFile, bodySide: BodySide): AngleRow[] {
  return replay.frames.map((f, i) => {
    const a = frameAngles(f, replay.exercise, bodySide);
    return { frame: i, t: i / replay.fps, angle: a.angle === null ? null : round1(a.angle), lean: round1(a.lean) };
  });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Per-frame flag: true within ±pad frames of any warning. */
export function warningMask(frameCount: number, warnings: ReplayFile['warnings'], pad = 3): boolean[] {
  const mask = new Array<boolean>(frameCount).fill(false);
  for (const w of warnings ?? []) {
    for (let i = Math.max(0, w.frame - pad); i <= Math.min(frameCount - 1, w.frame + pad); i++) mask[i] = true;
  }
  return mask;
}

/** Contiguous warning runs [start, end] (inclusive), for scrubber ticks and chart bands. */
export function warningRuns(warnings: ReplayFile['warnings']): { start: number; end: number; types: Set<string> }[] {
  const sorted = [...(warnings ?? [])].sort((a, b) => a.frame - b.frame);
  const runs: { start: number; end: number; types: Set<string> }[] = [];
  for (const w of sorted) {
    const last = runs[runs.length - 1];
    if (last && w.frame <= last.end + 1) {
      last.end = Math.max(last.end, w.frame);
      last.types.add(w.type);
    } else runs.push({ start: w.frame, end: w.frame, types: new Set([w.type]) });
  }
  return runs;
}

/** "12.3 s / 18.0 s" style time for frame i. */
export function formatTime(frame: number, fps: number): string {
  return `${(frame / fps).toFixed(1)} s`;
}
