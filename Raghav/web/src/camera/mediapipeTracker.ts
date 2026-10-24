// Real camera tracker: MediaPipe Pose (and Hands during hand_open) on the webcam video.
// Implements CameraTracker (types.ts). Angles come from worldLandmarks (metres, 3D) so they mean the
// same as the fake tracker's numbers, which the app's rep thresholds (patient/data/exercises.ts) were tuned on.
import type { HandLandmarker, HandLandmarkerResult, Landmark, PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { BodySide, Exercise } from '../types';
import { MAIN_JOINTS, type CameraTracker, type Joint3D, type PerSide, type Point2D, type TrackingFrame } from './types';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
// Models are served from public/models/ (no 9 MB download per visit); the Google CDN is the fallback.
const POSE_MODEL = {
  local: 'models/pose_landmarker_full.task',
  cdn: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};
const HAND_MODEL = {
  local: 'models/hand_landmarker.task',
  cdn: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
};
const LOAD_TIMEOUT_MS = 10_000;
// requestAnimationFrame can run at 120 Hz and a live stream's currentTime moves every tick, so cap detection at ~30 fps.
const MIN_FRAME_MS = 30;
const SMOOTH_FRAMES = 5;
const MIN_VISIBILITY = 0.5;

// Hand opening = average fingertip-to-wrist distance ÷ palm (wrist to middle knuckle). About 0.9 for a fist and
// 1.75 for a flat open hand; mapped to 0..100 % so a fist reads ~25 and an open hand ~90, like the fake tracker.
const FIST_RATIO = 0.9;
const OPEN_RATIO = 1.75;
const FINGERTIPS = [4, 8, 12, 16, 20];

// MediaPipe Pose indices, already the patient's own sides.
const POSE = {
  shoulder: { left: 11, right: 12 },
  elbow: { left: 13, right: 14 },
  wrist: { left: 15, right: 16 },
  hip: { left: 23, right: 24 },
} as const;
const other = (s: BodySide): BodySide => (s === 'left' ? 'right' : 'left');

export type TrackerStartErrorReason = 'no-camera' | 'model-load' | 'timeout';

/** Thrown by start() when the real tracker can't run, so camera/index.ts can fall back to the fake one. */
export class TrackerStartError extends Error {
  constructor(
    readonly reason: TrackerStartErrorReason,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TrackerStartError';
  }
}

type Vec = { x: number; y: number; z: number };
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v: Vec) => Math.hypot(v.x, v.y, v.z);
const dist = (a: Vec, b: Vec) => len(sub(a, b));
const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Angle between two vectors in degrees (null if either has no length). */
function angle(u: Vec, v: Vec): number | null {
  const m = len(u) * len(v);
  if (m < 1e-9) return null;
  return (Math.acos(clamp((u.x * v.x + u.y * v.y + u.z * v.z) / m, -1, 1)) * 180) / Math.PI;
}
const DOWN: Vec = { x: 0, y: 1, z: 0 };
const UP: Vec = { x: 0, y: -1, z: 0 };

/** Load once and share; a failed load is retried on the next call. */
function once<T>(make: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () =>
    (p ??= make().catch((e) => {
      p = null;
      throw e;
    }));
}

async function gpuThenCpu<T>(make: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await make('GPU');
  } catch (e) {
    console.warn('[camera] MediaPipe GPU delegate failed, using CPU', e);
    return make('CPU');
  }
}

const loadVision = once(async () => {
  const mod = await import('@mediapipe/tasks-vision');
  return { mod, fileset: await mod.FilesetResolver.forVisionTasks(WASM_URL) };
});

async function fetchModel(model: { local: string; cdn: string }): Promise<Uint8Array> {
  for (const url of [import.meta.env.BASE_URL + model.local, model.cdn]) {
    try {
      const res = await fetch(url);
      // A missing public file comes back as the app's index.html in dev, not a 404.
      if (res.ok && !res.headers.get('content-type')?.includes('text/html')) return new Uint8Array(await res.arrayBuffer());
    } catch {
      // Try the next source.
    }
  }
  throw new Error(`Could not download ${model.cdn.split('/').pop()}`);
}

const loadPose = once(async () => {
  const [{ mod, fileset }, model] = await Promise.all([loadVision(), fetchModel(POSE_MODEL)]);
  return gpuThenCpu((delegate) =>
    mod.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model.slice(), delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    }),
  );
});

const loadHand = once(async () => {
  const [{ mod, fileset }, model] = await Promise.all([loadVision(), fetchModel(HAND_MODEL)]);
  return gpuThenCpu((delegate) =>
    mod.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model.slice(), delegate },
      runningMode: 'VIDEO',
      numHands: 2,
    }),
  );
});

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => reject(new TrackerStartError('timeout', `MediaPipe models did not load within ${ms / 1000} s`)), ms);
    p.then(
      (v) => {
        window.clearTimeout(id);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(id);
        reject(e);
      },
    );
  });
}

/** Moving average of the last SMOOTH_FRAMES values per key. A null input gives null (the joint isn't seen now). */
class Smoother {
  private bufs = new Map<string, (number | null)[]>();

  push(key: string, v: number | null): number | null {
    let buf = this.bufs.get(key);
    if (!buf) this.bufs.set(key, (buf = []));
    buf.push(v);
    if (buf.length > SMOOTH_FRAMES) buf.shift();
    if (v === null) return null;
    let sum = 0;
    let n = 0;
    for (const x of buf) {
      if (x === null) continue;
      sum += x;
      n++;
    }
    return sum / n;
  }

  clear() {
    this.bufs.clear();
  }
}

/** Hand opening per side (0..100 %) from hand world landmarks. */
function handOpenings(res: HandLandmarkerResult | null): PerSide<number | null> {
  const out: PerSide<number | null> = { left: null, right: null };
  if (!res) return out;
  const best: PerSide<number> = { left: -1, right: -1 };
  res.worldLandmarks.forEach((w, i) => {
    const cat = res.handedness[i]?.[0];
    if (!cat || w.length < 21) return;
    // MediaPipe labels handedness as if the image were mirrored; our video isn't, so "Left" is the patient's right hand.
    const side: BodySide = cat.categoryName === 'Left' ? 'right' : 'left';
    if (cat.score <= best[side]) return;
    const palm = dist(w[0], w[9]);
    if (palm < 1e-4) return;
    const ratio = FINGERTIPS.reduce((a, tip) => a + dist(w[0], w[tip]), 0) / FINGERTIPS.length / palm;
    best[side] = cat.score;
    out[side] = clamp(((ratio - FIST_RATIO) / (OPEN_RATIO - FIST_RATIO)) * 100, 0, 100);
  });
  return out;
}

export function createMediapipeTracker(): CameraTracker {
  const listeners = new Set<(f: TrackingFrame) => void>();
  const smooth = new Smoother();
  let pose: PoseLandmarker | null = null;
  let hand: HandLandmarker | null = null;
  let handLoading = false;
  let video: HTMLVideoElement | null = null;
  let raf: number | undefined;
  let run = 0; // bumped by start/stop so a start() that is still loading models can tell it was cancelled
  let lastVideoTime = -1;
  let lastDetect = 0;
  let warnedDetect = false;
  let exercise: Exercise = 'arm_raise';
  let activeSide: BodySide = 'right';

  function ensureHand() {
    if (hand || handLoading) return;
    handLoading = true;
    loadHand()
      .then((h) => (hand = h))
      .catch((e) => console.warn('[camera] Hand model failed to load; hand opening stays empty', e))
      .finally(() => (handLoading = false));
  }

  function process(res: PoseLandmarkerResult, hands: HandLandmarkerResult | null, t: number): TrackingFrame {
    const lm = res.landmarks[0] ?? null;
    const wl = res.worldLandmarks[0] ?? null;
    const found = lm !== null && wl !== null;

    // Visibility per pose index, averaged like every other number.
    const vis = new Map<number, number>();
    for (const i of MAIN_JOINTS) vis.set(i, smooth.push(`vis${i}`, found ? lm[i].visibility : 0) ?? 0);
    const ok = (i: number) => (vis.get(i) ?? 0) >= MIN_VISIBILITY;
    const W = (i: number): Landmark => wl![i];
    const perSide = <T,>(fn: (s: BodySide) => T): PerSide<T> => ({ left: fn('left'), right: fn('right') });

    const shoulderAngle = perSide((s) => {
      const sh = POSE.shoulder[s];
      const el = POSE.elbow[s];
      if (!found || !ok(sh) || !ok(el)) return null;
      // Trunk line = shoulder → same-side hip; if the hip is hidden (e.g. by a table), straight down.
      const trunk = ok(POSE.hip[s]) ? sub(W(POSE.hip[s]), W(sh)) : DOWN;
      return angle(trunk, sub(W(el), W(sh)));
    });

    const elbowAngle = perSide((s) => {
      const [sh, el, wr] = [POSE.shoulder[s], POSE.elbow[s], POSE.wrist[s]];
      if (!found || !ok(sh) || !ok(el) || !ok(wr)) return null;
      return angle(sub(W(sh), W(el)), sub(W(wr), W(el)));
    });

    // Shoulder–hip line from vertical: both sides' midpoints, else one side seen side-on (active side first).
    let trunkLeanDeg: number | null = null;
    if (found) {
      const pair = (s: BodySide) => (ok(POSE.shoulder[s]) && ok(POSE.hip[s]) ? [W(POSE.shoulder[s]), W(POSE.hip[s])] : null);
      const a = pair(activeSide);
      const b = pair(other(activeSide));
      const line = a && b ? [mid(a[0], b[0]), mid(a[1], b[1])] : (a ?? b);
      if (line) trunkLeanDeg = angle(sub(line[0], line[1]), UP);
    }

    let shoulderHike: number | null = null;
    if (found && ok(POSE.shoulder.left) && ok(POSE.shoulder.right)) {
      const act = W(POSE.shoulder[activeSide]);
      const oth = W(POSE.shoulder[other(activeSide)]);
      const width = dist(act, oth);
      if (width > 1e-4) shoulderHike = (oth.y - act.y) / width; // y is down: a raised shoulder has a smaller y
    }

    const opening = handOpenings(hands);
    const s = (key: string, v: number | null) => smooth.push(key, v);
    // Pushed every frame (null when no body is found) so old positions roll out of the window during a gap.
    const j2 = MAIN_JOINTS.map((i) => ({
      x: s(`2x${i}`, found ? lm[i].x : null) ?? 0,
      y: s(`2y${i}`, found ? lm[i].y : null) ?? 0,
      visibility: vis.get(i) ?? 0,
    }));
    const j3 = MAIN_JOINTS.map((i) => ({
      x: s(`3x${i}`, found ? wl[i].x : null) ?? 0,
      y: s(`3y${i}`, found ? wl[i].y : null) ?? 0,
      z: s(`3z${i}`, found ? wl[i].z : null) ?? 0,
      visibility: vis.get(i) ?? 0,
    }));
    const joints2d: Point2D[] | null = found ? j2 : null;
    const joints3d: Joint3D[] | null = found ? j3 : null;

    return {
      t,
      visible: {
        shoulders: perSide((side) => ok(POSE.shoulder[side])),
        elbows: perSide((side) => ok(POSE.elbow[side])),
        wrists: perSide((side) => ok(POSE.wrist[side])),
      },
      shoulderAngle: perSide((side) => s(`sa.${side}`, shoulderAngle[side])),
      elbowAngle: perSide((side) => s(`ea.${side}`, elbowAngle[side])),
      handOpening: perSide((side) => s(`ho.${side}`, opening[side])),
      trunkLeanDeg: s('lean', trunkLeanDeg),
      shoulderHike: s('hike', shoulderHike),
      joints2d,
      joints3d,
    };
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    const t = performance.now();
    if (!video || !pose || video.readyState < 2 || video.currentTime === lastVideoTime || t - lastDetect < MIN_FRAME_MS) return;
    lastVideoTime = video.currentTime;
    lastDetect = t;
    let frame: TrackingFrame;
    try {
      const res = pose.detectForVideo(video, t);
      const hands = exercise === 'hand_open' && hand ? hand.detectForVideo(video, t) : null;
      frame = process(res, hands, t);
    } catch (e) {
      if (!warnedDetect) console.warn('[camera] MediaPipe detection failed', e);
      warnedDetect = true;
      return;
    }
    listeners.forEach((l) => l(frame));
  }

  function stopLoop() {
    if (raf !== undefined) cancelAnimationFrame(raf);
    raf = undefined;
    video = null;
  }

  return {
    async start(v) {
      const id = ++run;
      stopLoop();
      if (!v.srcObject) throw new TrackerStartError('no-camera', 'No camera stream on the video element');
      try {
        pose = await withTimeout(loadPose(), LOAD_TIMEOUT_MS);
      } catch (e) {
        throw e instanceof TrackerStartError ? e : new TrackerStartError('model-load', `MediaPipe models failed to load: ${e}`, e);
      }
      if (id !== run) return; // stop() was called while the models loaded
      video = v;
      lastVideoTime = -1;
      smooth.clear();
      if (exercise === 'hand_open') ensureHand();
      raf = requestAnimationFrame(loop);
    },
    stop() {
      run++;
      stopLoop();
    },
    configure(o) {
      exercise = o.exercise;
      activeSide = o.activeSide;
      smooth.clear();
      if (exercise === 'hand_open' && video) ensureHand();
    },
    onFrame(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
