/**
 * Deterministic synthetic replays for seeded sessions (CONVERGENCE_PLAN §6.5, WP6 owns).
 *
 * Seeded `session_replays` rows carry a self-describing `synth:` path instead of a Storage object,
 * so both data sources can rebuild the same ReplayFile in the browser with no network:
 *
 *   synth:v1;seed=james-lean;ex=arm_raise;side=weak;ws=left;peak=95;reps=5;lean=3,5;hike=
 *
 * `synthPath(params)` writes a path, `parseSynthPath(path)` reads it back (null if not a synth path),
 * `synthReplay(params)` generates the file. Signatures are frozen.
 *
 * The generated patient sits facing the camera (MediaPipe world coordinates, metres: hips centred on
 * the origin, x = patient's left, y DOWN, z toward the camera negative), thighs forward, shins down.
 * Each rep is a cosine profile of 3.2 s. `peakDeg` is the measured peak of the exercise angle that
 * the replay viewer shows: angle(hip, shoulder, elbow) for arm_raise, the elbow angle for
 * forward_reach; for hand_open (no finger joints) it only scales a small wrist movement.
 */
import type { BodySide, Exercise, ReplayFile, Side } from '../../types';
import { REPLAY_JOINTS } from '../../types';

export interface SynthParams {
  seed: string;
  exercise: Exercise;
  side: Side;
  weakSide: BodySide;
  peakDeg: number;
  reps?: number;
  /** 1-based rep numbers where the trunk leans 15° sideways at the peak. */
  leanReps?: number[];
  /** 1-based rep numbers where the active shoulder hikes at the peak. */
  hikeReps?: number[];
}

const PREFIX = 'synth:v1;';

export function synthPath(p: SynthParams): string {
  const list = (xs?: number[]) => (xs && xs.length ? xs.join(',') : '');
  return (
    `${PREFIX}seed=${p.seed};ex=${p.exercise};side=${p.side};ws=${p.weakSide};peak=${Math.round(p.peakDeg)}` +
    `;reps=${p.reps ?? 5};lean=${list(p.leanReps)};hike=${list(p.hikeReps)}`
  );
}

export function parseSynthPath(path: string): SynthParams | null {
  if (!path.startsWith(PREFIX)) return null;
  const kv = new Map<string, string>();
  for (const part of path.slice(PREFIX.length).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) kv.set(part.slice(0, i), part.slice(i + 1));
  }
  const ex = kv.get('ex');
  const side = kv.get('side');
  const ws = kv.get('ws');
  const peak = Number(kv.get('peak'));
  if (ex !== 'arm_raise' && ex !== 'forward_reach' && ex !== 'hand_open') return null;
  if (side !== 'weak' && side !== 'healthy') return null;
  if (ws !== 'left' && ws !== 'right') return null;
  if (!Number.isFinite(peak)) return null;
  const nums = (s?: string) =>
    s ? s.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  const reps = Number(kv.get('reps'));
  return {
    seed: kv.get('seed') || 'synth',
    exercise: ex,
    side,
    weakSide: ws,
    peakDeg: peak,
    reps: Number.isInteger(reps) && reps > 0 ? reps : 5,
    leanReps: nums(kv.get('lean')),
    hikeReps: nums(kv.get('hike')),
  };
}

// ---- generator ----

type V3 = [number, number, number];

const FPS = 15;
const REP_FRAMES = Math.round(3.2 * FPS);
const REST_FRAMES = FPS;
const MAX_FRAMES = 600;
const MAX_REPS = Math.floor((MAX_FRAMES - 2 * REST_FRAMES) / REP_FRAMES);

const LEAN_PEAK_DEG = 15;
const LEAN_WARN_DEG = 12;
const HIKE_PEAK_M = 0.05;
const HIKE_WARN_M = 0.03;
const NOISE_M = 0.0015;

const UPPER_ARM_M = 0.28;
const FOREARM_M = 0.26;
const REST_RAISE_DEG = 12;
const REST_ELBOW_DEG = 90;
const REST_FLEX_DEG = 10;
const REACH_FLEX_DEG = 70;
/** Arm raise moves in the scapular plane: 30° forward of pure sideways. */
const RAISE_PLANE_DEG = 30;
/** Forward reach drifts 10° out to the side. */
const REACH_PLANE_DEG = 10;

const DOWN: V3 = [0, 1, 0];
const UP: V3 = [0, -1, 0];
const FORWARD: V3 = [0, 0, -1];

const HIP_L: V3 = [0.1, 0, 0];
const HIP_R: V3 = [-0.1, 0, 0];
const KNEE_L: V3 = [0.11, -0.02, -0.42];
const KNEE_R: V3 = [-0.11, -0.02, -0.42];
const ANKLE_L: V3 = [0.12, 0.4, -0.45];
const ANKLE_R: V3 = [-0.12, 0.4, -0.45];
const SHOULDER_L: V3 = [0.18, -0.5, 0];
const SHOULDER_R: V3 = [-0.18, -0.5, 0];
const NOSE: V3 = [0, -0.68, -0.08];

const RAD = Math.PI / 180;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => scale(a, 1 / (norm(a) || 1));
const angleDeg = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b) || 1)))) / RAD;
/** Unit vector at `deg` from `a` toward `b` (a ⟂ b, both unit). */
const inPlane = (a: V3, b: V3, deg: number): V3 => add(scale(a, Math.cos(deg * RAD)), scale(b, Math.sin(deg * RAD)));
/** Rotate about the z axis through the origin (mid-hip); positive tips "up" toward +x. */
const rotZ = (p: V3, deg: number): V3 => {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
};

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Arm {
  elbow: V3;
  wrist: V3;
}

/** Straight-ish arm raised in the scapular plane so that angle(hip, shoulder, elbow) = targetDeg. */
function raiseArm(shoulder: V3, hip: V3, lateral: V3, targetDeg: number): Arm {
  const out = unit(inPlane(lateral, FORWARD, RAISE_PLANE_DEG));
  const toHip = sub(hip, shoulder);
  let lo = 0;
  let hi = 180;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (angleDeg(toHip, inPlane(DOWN, out, mid)) < targetDeg) lo = mid;
    else hi = mid;
  }
  const elev = (lo + hi) / 2;
  const elbow = add(shoulder, scale(inPlane(DOWN, out, elev), UPPER_ARM_M));
  const wrist = add(elbow, scale(inPlane(DOWN, out, elev + 10), FOREARM_M));
  return { elbow, wrist };
}

/** Arm in a near-sagittal plane: upper arm `flexDeg` forward of hanging, interior elbow angle `elbowDeg`. */
function reachArm(shoulder: V3, lateral: V3, flexDeg: number, elbowDeg: number): Arm {
  const fwd = unit(inPlane(FORWARD, lateral, REACH_PLANE_DEG));
  const elbow = add(shoulder, scale(inPlane(DOWN, fwd, flexDeg), UPPER_ARM_M));
  const wrist = add(elbow, scale(inPlane(DOWN, fwd, flexDeg + 180 - elbowDeg), FOREARM_M));
  return { elbow, wrist };
}

function restArm(exercise: Exercise, shoulder: V3, hip: V3, lateral: V3): Arm {
  return exercise === 'arm_raise'
    ? raiseArm(shoulder, hip, lateral, REST_RAISE_DEG)
    : reachArm(shoulder, lateral, REST_FLEX_DEG, REST_ELBOW_DEG);
}

/** A deterministic ReplayFile for a seated patient doing `reps` cosine reps with the active arm. */
export function synthReplay(p: SynthParams): ReplayFile {
  const rng = mulberry32(hashSeed(`${p.seed}|${p.exercise}|${p.side}|${p.weakSide}`));
  const reps = Math.max(1, Math.min(MAX_REPS, Math.round(p.reps ?? 5)));
  const leanReps = new Set(p.leanReps ?? []);
  const hikeReps = new Set(p.hikeReps ?? []);
  const activeLeft = (p.side === 'weak') === (p.weakSide === 'left');
  const sgn = activeLeft ? 1 : -1;

  const restElbow = Math.max(30, Math.min(REST_ELBOW_DEG, p.peakDeg - 25));
  const peakDeg = p.exercise === 'arm_raise' ? Math.max(REST_RAISE_DEG + 5, Math.min(178, p.peakDeg)) : Math.max(restElbow + 5, Math.min(178, p.peakDeg));
  const exactRep = reps > 1 ? 1 : 0;
  const repPeaks = Array.from({ length: reps }, (_, r) => (r === exactRep ? peakDeg : peakDeg - rng() * 3));
  const wristAmp = 4 + 8 * Math.max(0, Math.min(1, p.peakDeg / 100));

  const total = REST_FRAMES * 2 + reps * REP_FRAMES;
  const frames: V3[][] = [];
  const warnings: NonNullable<ReplayFile['warnings']> = [];

  for (let f = 0; f < total; f++) {
    const k = f - REST_FRAMES;
    const rep = k >= 0 && k < reps * REP_FRAMES ? Math.floor(k / REP_FRAMES) : -1;
    const prof = rep >= 0 ? (1 - Math.cos((2 * Math.PI * (k - rep * REP_FRAMES)) / REP_FRAMES)) / 2 : 0;
    const repNo = rep + 1;
    const hike = rep >= 0 && hikeReps.has(repNo) ? HIKE_PEAK_M * prof : 0;
    const lean = rep >= 0 && leanReps.has(repNo) ? LEAN_PEAK_DEG * prof : 0;

    // Upper body in the trunk's own frame, then tipped away from the active arm about the mid-hip.
    const shL: V3 = activeLeft ? add(SHOULDER_L, [0, -hike, 0]) : SHOULDER_L;
    const shR: V3 = activeLeft ? SHOULDER_R : add(SHOULDER_R, [0, -hike, 0]);
    const latL: V3 = [1, 0, 0];
    const latR: V3 = [-1, 0, 0];
    let active: Arm;
    const [shA, hipA, latA] = activeLeft ? [shL, HIP_L, latL] : [shR, HIP_R, latR];
    if (p.exercise === 'arm_raise') {
      active = raiseArm(shA, hipA, latA, REST_RAISE_DEG + (repPeaks[Math.max(0, rep)] - REST_RAISE_DEG) * prof);
    } else if (p.exercise === 'forward_reach') {
      active = reachArm(shA, latA, REST_FLEX_DEG + REACH_FLEX_DEG * prof, restElbow + (repPeaks[Math.max(0, rep)] - restElbow) * prof);
    } else {
      active = reachArm(shA, latA, REST_FLEX_DEG, REST_ELBOW_DEG + wristAmp * prof);
    }
    const passive = activeLeft ? restArm(p.exercise, shR, HIP_R, latR) : restArm(p.exercise, shL, HIP_L, latL);
    const armL = activeLeft ? active : passive;
    const armR = activeLeft ? passive : active;

    const tip = (v: V3) => rotZ(v, -sgn * lean);
    const pose: Record<(typeof REPLAY_JOINTS)[number], V3> = {
      nose: tip(NOSE),
      left_shoulder: tip(shL),
      right_shoulder: tip(shR),
      left_elbow: tip(armL.elbow),
      right_elbow: tip(armR.elbow),
      left_wrist: tip(armL.wrist),
      right_wrist: tip(armR.wrist),
      left_hip: HIP_L,
      right_hip: HIP_R,
      left_knee: KNEE_L,
      right_knee: KNEE_R,
      left_ankle: ANKLE_L,
      right_ankle: ANKLE_R,
    };
    const frame = REPLAY_JOINTS.map((j) => pose[j].map((c) => Math.round((c + (rng() - 0.5) * 2 * NOISE_M) * 1e4) / 1e4) as V3);
    frames.push(frame);

    const midShoulder = scale(add(frame[1], frame[2]), 0.5);
    const midHip = scale(add(frame[7], frame[8]), 0.5);
    if (angleDeg(sub(midShoulder, midHip), UP) > LEAN_WARN_DEG) warnings.push({ frame: f, type: 'lean' });
    if (hike > HIKE_WARN_M) warnings.push({ frame: f, type: 'shoulder_hike' });
  }

  return {
    fps: 15,
    exercise: p.exercise,
    side: p.side,
    joints: [...REPLAY_JOINTS],
    frames,
    warnings,
  };
}
