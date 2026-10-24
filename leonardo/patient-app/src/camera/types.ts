// The contract between the patient app and Stuti's camera module.
// The patient app only talks to a CameraTracker. Stuti's MediaPipe code implements it;
// fakeTracker.ts implements it with made-up motion so the screens can be built first.
import type { ExerciseId, Side } from '../types';

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

/** Estimated 3D joint position in metres (MediaPipe world landmarks). */
export interface Joint3D {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/**
 * The 13 joints saved for the 3D replay, in this order (MediaPipe pose indices in brackets):
 * nose(0), shoulders L/R(11,12), elbows L/R(13,14), wrists L/R(15,16),
 * hips L/R(23,24), knees L/R(25,26), ankles L/R(27,28).
 */
export const MAIN_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;

/** One processed camera frame. Every number is already averaged over the last 5 frames, and
 *  any value from a joint with confidence below 0.5 is null. "left"/"right" are the patient's sides. */
export interface TrackingFrame {
  /** performance.now() in ms. */
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
  /** Shoulder–hip line angle from vertical, degrees. */
  trunkLeanDeg: number | null;
  /** How much the active shoulder is raised above the other, as a fraction of shoulder width. */
  shoulderHike: number | null;
  /** MAIN_JOINTS in image space, for drawing the skeleton on the video. */
  joints2d: Point2D[] | null;
  /** MAIN_JOINTS in metres, for the care team's 3D replay. */
  joints3d: Joint3D[] | null;
}

export interface CameraTracker {
  /** Begin tracking the given (already playing) video element. */
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  /** Which exercise and which arm is being done right now (e.g. to switch on the hand model). */
  configure(opts: { exercise: ExerciseId; activeSide: Side }): void;
  /** Called for every processed frame. Returns an unsubscribe function. */
  onFrame(cb: (frame: TrackingFrame) => void): () => void;
}
