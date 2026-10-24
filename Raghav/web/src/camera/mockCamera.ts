/**
 * Mock with the exact contract signature. Stuti's real module should be a drop-in replacement.
 *
 * startExercise(video, exercise, side, onFrame) matches Raghav/docs/CONTRACTS.md §2.
 * The optional 5th `options` argument is mock-only (the real module ignores it):
 *   symmetryPct     weak-side peak = healthy peak × symmetryPct / 100   (default 70)
 *   compensationPct ≈ % of weak-side reps with a lean / shoulder_hike   (default 10)
 *   speed           demo time multiplier; 1 = real pace (~3 s per rep) (default 1)
 *   weakSide        body side that moves for side 'weak' in the replay  (default 'left')
 *
 * What it does:
 *   - Emits a LiveFrame ~15×/s: a sine wave from 0 to a per-rep peak, one rep per cycle
 *     (arm_raise peaks ~160°, forward_reach ~150°, hand_open ~90% on the healthy side).
 *   - stop() returns an ExerciseResult with all 8 numbers finite and in range.
 *     secPerRep is reported at real pace even when `speed` > 1, so dashboard data stays realistic.
 *   - replay() returns a ReplayFile (15 fps, 13 joints in contract order) built from the
 *     same frames that were emitted, with warnings[] on the frames that carried a warning.
 *     Axes follow MediaPipe worldLandmarks: metres, hip-centred, x toward the subject's left,
 *     y down, z negative toward the camera.
 *   - If the camera is available, shows the real webcam in `video` so it looks live.
 *     The numbers are always simulated. No camera (denied, http on LAN) → values still flow.
 */

import type { BodySide, Exercise, ExerciseResult, ReplayFile, ReplayWarningType, Side } from '../types';
import { REPLAY_JOINTS } from '../types';

// The old startExercise contract, kept only for this legacy mock.
export interface LiveFrame {
  value: number;
  reps: number;
  warning?: 'lean' | 'shoulder_hike' | 'not_visible';
}

export interface ExerciseControl {
  stop(): ExerciseResult;
  replay(): ReplayFile;
}

type StartExercise = (
  video: HTMLVideoElement,
  exercise: Exercise,
  side: Side,
  onFrame: (frame: LiveFrame) => void
) => ExerciseControl;

export interface MockCameraOptions {
  symmetryPct?: number;
  compensationPct?: number;
  speed?: number;
  weakSide?: BodySide;
}

const FPS = 15;
const MAX_REPLAY_FRAMES = FPS * 120; // the API accepts at most 120 s per replay

/** Healthy-arm peak per exercise (degrees, or % for hand_open). */
const HEALTHY_PEAK: Record<Exercise, number> = {
  arm_raise: 160,
  forward_reach: 150,
  hand_open: 90,
};

/** Real-pace seconds per rep; the weak arm is slower. */
const SEC_PER_REP: Record<Side, number> = { healthy: 3, weak: 4.2 };

/** Peak drop by the 10th rep (feeds `fatigue`). */
const FATIGUE_DROP: Record<Side, number> = { healthy: 0.02, weak: 0.08 };

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const rad = (deg: number) => (deg * Math.PI) / 180;

interface Rep {
  peak: number;
  warning: ReplayWarningType | null;
  lean: number; // degrees from vertical
  hike: number; // metres
}

// ---------------------------------------------------------------------------
// Webcam (cosmetic only). One stream is shared across exercises so the
// camera light doesn't flicker between them; call releaseCamera() when done.
// ---------------------------------------------------------------------------

let streamPromise: Promise<MediaStream | null> | null = null;

function showWebcam(video: HTMLVideoElement | null | undefined) {
  if (!video || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
  if (!streamPromise) {
    streamPromise = navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .catch(() => null);
  }
  void streamPromise.then((stream) => {
    if (!stream || video.srcObject === stream) return;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.play().catch(() => {
      /* autoplay blocked: the values still flow */
    });
  });
}

/** Stop the shared webcam stream (mock-only helper; not part of the contract). */
export function releaseCamera() {
  const pending = streamPromise;
  streamPromise = null;
  void pending?.then((stream) => stream?.getTracks().forEach((t) => t.stop()));
}

// ---------------------------------------------------------------------------
// Skeleton for the replay
// ---------------------------------------------------------------------------

type Vec = [number, number, number];

const UPPER_ARM = 0.29;
const FOREARM = 0.26;

const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Unit vector in the sagittal plane: 0° = straight down, 90° = toward the camera. */
const sagittal = (deg: number): Vec => [0, Math.cos(rad(deg)), -Math.sin(rad(deg))];

/** Upper-arm and forearm directions of the exercising arm for a given live value. */
function armDirections(exercise: Exercise, value: number, sign: number): [Vec, Vec] {
  if (exercise === 'arm_raise') {
    // Straight arm lifted out to the side: 0° hangs down, 90° horizontal.
    const dir: Vec = [sign * Math.sin(rad(value)), Math.cos(rad(value)), 0];
    return [dir, dir];
  }
  if (exercise === 'forward_reach') {
    // Elbow straightens from fully bent to nearly straight while the shoulder lifts forward.
    const flexion = 30 + 50 * (value / 150);
    const elbowBend = 180 - (30 + value); // 0 = straight
    return [sagittal(flexion), sagittal(flexion + elbowBend)];
  }
  // hand_open: forearm resting forward on a table; the wrist barely moves.
  return [sagittal(20), sagittal(110 + value / 30)];
}

/**
 * One frame of 13 joints (contract order). `lean` tilts the trunk away from the
 * moving arm; `hike` lifts the moving shoulder.
 */
function pose(exercise: Exercise, moving: BodySide, value: number, lean: number, hike: number): Vec[] {
  const sign = moving === 'left' ? 1 : -1;
  const shoulder = (s: BodySide): Vec => {
    const x = s === 'left' ? 0.18 : -0.18;
    return [x, -0.48 - (s === moving ? hike : 0), 0];
  };
  const hanging = (s: BodySide): [Vec, Vec, Vec] => {
    const sh = shoulder(s);
    const down: Vec = [0, 1, 0];
    return [sh, add(sh, down, UPPER_ARM), add(sh, down, UPPER_ARM + FOREARM)];
  };
  const [upper, fore] = armDirections(exercise, value, sign);
  const ms = shoulder(moving);
  const movingArm: [Vec, Vec, Vec] = [ms, add(ms, upper, UPPER_ARM), add(add(ms, upper, UPPER_ARM), fore, FOREARM)];
  const arm = (s: BodySide) => (s === moving ? movingArm : hanging(s));
  const [ls, le, lw] = arm('left');
  const [rs, re, rw] = arm('right');

  // Lateral trunk lean: rotate everything above the hips about the hip centre.
  const a = rad(-sign * lean);
  const tilt = ([x, y, z]: Vec): Vec => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];

  const nose: Vec = [0, -0.66, -0.06];
  const upperBody = [nose, ls, rs, le, re, lw, rw].map(tilt);
  const lowerBody: Vec[] = [
    [0.1, 0, 0], // left_hip
    [-0.1, 0, 0], // right_hip
    [0.11, 0.02, -0.42], // left_knee (seated: thigh points at the camera)
    [-0.11, 0.02, -0.42],
    [0.11, 0.45, -0.45], // left_ankle
    [-0.11, 0.45, -0.45],
  ];
  return [...upperBody, ...lowerBody].map(([x, y, z]) => [round(x, 4), round(y, 4), round(z, 4)] as Vec);
}

// ---------------------------------------------------------------------------
// Contract entry point
// ---------------------------------------------------------------------------

export function startExercise(
  video: HTMLVideoElement,
  exercise: Exercise,
  side: Side,
  onFrame: (frame: LiveFrame) => void,
  options: MockCameraOptions = {}
): ExerciseControl {
  showWebcam(video);

  const symmetry = clamp(options.symmetryPct ?? 70, 1, 100);
  const compensation = side === 'weak' ? clamp(options.compensationPct ?? 10, 0, 100) / 100 : 0;
  const speed = clamp(options.speed ?? 1, 0.25, 20);
  const weakSide = options.weakSide ?? 'left';
  const moving: BodySide = side === 'weak' ? weakSide : weakSide === 'left' ? 'right' : 'left';

  const basePeak = HEALTHY_PEAK[exercise] * (side === 'weak' ? symmetry / 100 : 1);
  const secPerRep = SEC_PER_REP[side];

  // Reps are generated on demand so the live wave and the summary agree.
  const reps: Rep[] = [];
  let warningsSoFar = 0;
  const repAt = (i: number): Rep => {
    while (reps.length <= i) {
      const k = reps.length;
      const peak = basePeak * (1 - between(0, 0.02)) * (1 - FATIGUE_DROP[side] * Math.min(k / 9, 1));
      // Spread compensated reps evenly: after n reps, floor(n × pct) have a warning.
      const compensated = Math.floor((k + 1) * compensation) > Math.floor(k * compensation);
      let warning: ReplayWarningType | null = null;
      if (compensated) warning = warningsSoFar++ % 2 === 0 ? 'lean' : 'shoulder_hike';
      const healthy = side === 'healthy';
      reps.push({
        peak,
        warning,
        lean: warning === 'lean' ? between(12, 18) : healthy ? between(1, 4) : between(3, 7),
        hike: warning === 'shoulder_hike' ? between(0.03, 0.05) : healthy ? between(0.003, 0.008) : between(0.006, 0.015),
      });
    }
    return reps[i];
  };

  const frames: [number, number, number][][] = [];
  const warnings: NonNullable<ReplayFile['warnings']> = [];
  const t0 = performance.now();
  let completed = 0;
  let bestPartial = 0; // highest sampled value before the first rep completes
  let result: ExerciseResult | null = null;

  const tick = () => {
    const simSec = ((performance.now() - t0) / 1000) * speed;
    const k = Math.floor(simSec / secPerRep);
    const phase = (simSec % secPerRep) / secPerRep;
    const rep = repAt(k);
    const shape = (1 - Math.cos(2 * Math.PI * phase)) / 2; // 0 → 1 → 0 per rep
    const value = Math.max(0, rep.peak * shape + between(-0.4, 0.4));
    const warning = rep.warning && phase > 0.25 && phase < 0.85 ? rep.warning : undefined;

    completed = k;
    if (k === 0) bestPartial = Math.max(bestPartial, value);

    if (frames.length < MAX_REPLAY_FRAMES) {
      // Compensation ramps in with the lift, so the replay shows it at the top of the rep.
      const lean = rep.lean * shape;
      const hike = rep.hike * shape;
      if (warning) warnings.push({ frame: frames.length, type: warning });
      frames.push(pose(exercise, moving, value, lean, hike));
    }

    const frame: LiveFrame = { value: round(value, 1), reps: k };
    if (warning) frame.warning = warning;
    onFrame(frame);
  };

  tick();
  const timer = window.setInterval(tick, 1000 / FPS);

  return {
    stop() {
      if (result) return result;
      window.clearInterval(timer);

      const done = reps.slice(0, completed);
      const n = done.length;
      const peaks = done.map((r) => r.peak);
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const firstThree = peaks.slice(0, 3);
      const lastThree = peaks.slice(-3);
      const compReps = done.filter((r) => r.warning).length;

      result = {
        exercise,
        side,
        bestValue: round(n > 0 ? Math.max(...peaks) : bestPartial, 1),
        reps: n,
        secPerRep: round(secPerRep * between(0.95, 1.05), 2),
        smoothness: round(
          side === 'healthy' ? between(1.0, 1.4) : 1.2 + 2 * (1 - symmetry / 100) + between(0, 0.4),
          2
        ),
        fatigue: round(n >= 2 ? avg(lastThree) / avg(firstThree) : 1, 2),
        trunkLeanMax: round(n > 0 ? Math.max(...done.map((r) => r.lean)) : 2, 1),
        shoulderHikeMax: round(n > 0 ? Math.max(...done.map((r) => r.hike)) : 0.005, 3),
        compRepPct: round(n > 0 ? (compReps / n) * 100 : 0, 1),
      };
      return result;
    },

    replay(): ReplayFile {
      return {
        fps: FPS,
        exercise,
        side,
        joints: [...REPLAY_JOINTS],
        frames: frames.slice(),
        warnings: warnings.slice(),
      };
    },
  };
}

// Compile-time check: the mock must stay assignable to the contract signature.
const contractCheck: StartExercise = startExercise;
void contractCheck;
