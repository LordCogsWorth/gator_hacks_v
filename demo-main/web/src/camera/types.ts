/**
 * Camera module contract (Raghav/docs/CONTRACTS.md §2): the app only talks to a
 * CameraTracker. Stuti's MediaPipe module implements it; fakeTracker.ts implements
 * it with made-up motion. The tracker only reports per-frame measurements; the
 * patient app counts reps and builds ExerciseResult / ReplayFile from the frames.
 */
import type { BodySide, Exercise } from '../types';
import type { Vec3 } from './geometry';

export type { Vec3 } from './geometry';

export interface PerSide<T> {
  left: T;
  right: T;
}

/** Normalised image point: x and y in 0..1 of the (un-mirrored) video frame. */
export interface Point2D {
  x: number;
  y: number;
  visibility: number;
}

/**
 * Estimated 3D joint position in metres (MediaPipe world landmarks): hip-centred,
 * x toward the patient's left, y down, z negative toward the camera.
 */
export interface Joint3D {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/**
 * MediaPipe Pose indices of the 13 joints in joints2d / joints3d, in the same
 * order as REPLAY_JOINTS (types.ts): nose, shoulders L/R, elbows L/R, wrists L/R,
 * hips L/R, knees L/R, ankles L/R.
 */
export const MAIN_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;

/** One processed camera frame. Every number is already averaged over the last 5 frames, and
 *  any value from a joint with confidence below 0.5 is null. "left"/"right" are the patient's sides. */
export interface TrackingFrame {
  /**
   * Frame time in ms: performance.now() for a real tracker. Compare it only with
   * other frame times (the fake tracker's demo speed-up runs a faster clock).
   */
  t: number;
  visible: {
    shoulders: PerSide<boolean>;
    elbows: PerSide<boolean>;
    wrists: PerSide<boolean>;
  };
  /** Degrees between the trunk line and the upper arm. 0 = arm down, 90 = straight out. */
  shoulderAngle: PerSide<number | null>;
  /** Degrees at the elbow. 180 = fully straight. */
  elbowAngle: PerSide<number | null>;
  /** Average fingertip-to-wrist distance ÷ palm size, as 0..100%. Null if the hand isn't found. */
  handOpening: PerSide<number | null>;
  /** Shoulder–hip line angle from vertical, degrees (absolute; the session engine measures lean from rest with trunkVec). */
  trunkLeanDeg: number | null;
  /** How much the active shoulder is raised above the other, as a fraction of shoulder width (absolute). */
  shoulderHike: number | null;
  /**
   * Unit vector from mid-hip to mid-shoulder in world coordinates (upright ≈ {0, −1, 0}, y is down).
   * Falls back to the active side's hip → shoulder, then the other side's.
   */
  trunkVec: Vec3 | null;
  /** Shoulder-to-shoulder distance in metres. */
  shoulderWidthM: number | null;
  /** Shoulder-to-wrist distance in metres, per side. */
  reachM: PerSide<number | null>;
  /** MAIN_JOINTS in image space, for drawing the skeleton on the video. */
  joints2d: Point2D[] | null;
  /** MAIN_JOINTS in metres, for the care team's 3D replay. */
  joints3d: Joint3D[] | null;
}

/**
 * Why the fake tracker is running: `forced` = ?tracker=fake, `demo` = demo mode (?demo=1),
 * otherwise the real tracker failed to start.
 */
export type TrackerFallbackReason = 'forced' | 'demo' | 'no-camera' | 'model-load' | 'timeout';

export interface TrackerStatus {
  mode: 'real' | 'fake';
  reason?: TrackerFallbackReason;
}

export interface TrackerConfig {
  exercise: Exercise;
  activeSide: BodySide;
  /**
   * The patient has been asked to keep the arm at rest (setup, countdown, rest baseline).
   * Only the fake tracker uses it: it holds the arm still, and starts each rep from rest when this turns false.
   */
  resting?: boolean;
}

export interface CameraTracker {
  /** Begin tracking the given (already playing) video element. */
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  /** Which exercise and which arm is being done right now (e.g. to switch on the hand model). */
  configure(opts: TrackerConfig): void;
  /** Called for every processed frame. Returns an unsubscribe function. */
  onFrame(cb: (frame: TrackingFrame) => void): () => void;
  /** Real camera or simulated motion, and why. */
  status(): TrackerStatus;
  /** Start downloading the hand model now, so the first hand_open round has readings. No-op for the fake tracker. */
  preloadHand(): void;
}
