/**
 * Camera module contract — copied exactly from Raghav/docs/CONTRACTS.md §1–4.
 * Stuti owns this contract; if it changes there, change it here too.
 */

// §1 Shared names
export type Exercise = 'arm_raise' | 'forward_reach' | 'hand_open';
export type Side = 'weak' | 'healthy';
export type BodySide = 'left' | 'right';

// §2 Camera module
export interface LiveFrame {
  // emitted about 15 times per second
  value: number; // angle in degrees, or hand opening %
  reps: number; // reps counted so far
  warning?: 'lean' | 'shoulder_hike' | 'not_visible';
}

export interface ExerciseControl {
  stop(): ExerciseResult; // ends the exercise and returns the summary
  replay(): ReplayFile; // skeleton recording of this exercise
}

export type StartExercise = (
  video: HTMLVideoElement,
  exercise: Exercise,
  side: Side,
  onFrame: (frame: LiveFrame) => void
) => ExerciseControl;

// §3 ExerciseResult (one per exercise, per arm)
export interface ExerciseResult {
  exercise: Exercise;
  side: Side;
  bestValue: number; // best angle (degrees) or hand opening (%)
  reps: number;
  secPerRep: number;
  smoothness: number; // speed bursts per rep; lower = smoother
  fatigue: number; // last 3 reps avg / first 3 reps avg (1.0 = no drop)
  trunkLeanMax: number; // degrees from vertical
  shoulderHikeMax: number; // weak shoulder height above healthy shoulder, in metres
  compRepPct: number; // % of reps where lean or hike passed the threshold (0–100)
}

// §4 ReplayFile (3D skeleton recording)
export type ReplayWarningType = 'lean' | 'shoulder_hike';

export interface ReplayFile {
  fps: 15;
  exercise: Exercise;
  side: Side;
  joints: string[]; // order of joints in every frame (REPLAY_JOINTS)
  frames: [number, number, number][][]; // frames[f][j] = [x, y, z] in metres, hip-centred
  warnings?: { frame: number; type: ReplayWarningType }[];
}

/** Joint order in every ReplayFile frame (MediaPipe Pose index in the comment). */
export const REPLAY_JOINTS = [
  'nose', // 0
  'left_shoulder', // 11
  'right_shoulder', // 12
  'left_elbow', // 13
  'right_elbow', // 14
  'left_wrist', // 15
  'right_wrist', // 16
  'left_hip', // 23
  'right_hip', // 24
  'left_knee', // 25
  'right_knee', // 26
  'left_ankle', // 27
  'right_ankle', // 28
] as const;

export type ReplayJoint = (typeof REPLAY_JOINTS)[number];
