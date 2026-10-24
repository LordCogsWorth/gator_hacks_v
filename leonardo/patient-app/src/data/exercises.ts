import type { ExerciseId } from '../types';
import type { TrackingFrame } from '../camera/types';
import type { Side } from '../types';

export interface ExerciseInfo {
  id: ExerciseId;
  title: string;
  /** Spoken + shown before the exercise starts. */
  instruction: string;
  /** What the avatar coach explains before the exercise, one short step at a time. */
  steps: string[];
  /** Where the camera / chair should be. */
  cameraSetup: string;
  unit: '°' | '%';
  /** Top of the bar. */
  scaleMax: number;
  /** A rep starts when the value goes above `upAt` and ends when it drops below `restAt`. */
  restAt: number;
  upAt: number;
  /** Pull the number for this exercise out of a camera frame. */
  read: (f: TrackingFrame, side: Side) => number | null;
}

export const EXERCISES: Record<ExerciseId, ExerciseInfo> = {
  arm_raise: {
    id: 'arm_raise',
    title: 'Arm raise to the side',
    instruction: 'Lift your arm out to the side as high as is comfortable, then lower it slowly.',
    steps: [
      'Sit up tall with your back against the chair.',
      'Lift your arm out to the side, thumb pointing up.',
      'Go as high as is comfortable. Stop if it hurts.',
      'Lower it slowly. That is one rep.',
    ],
    cameraSetup: 'Face the camera. Sit about 2 metres away with the camera at chest height.',
    unit: '°',
    scaleMax: 180,
    restAt: 30,
    upAt: 50,
    read: (f, s) => f.shoulderAngle[s],
  },
  forward_reach: {
    id: 'forward_reach',
    title: 'Forward reach',
    instruction: 'Reach straight forward and straighten your elbow as much as you can, then bring it back.',
    steps: [
      'Sit tall with your feet flat on the floor.',
      'Reach straight forward, like reaching for a cup.',
      'Straighten your elbow as much as you can.',
      'Bring your hand back to your lap. That is one rep.',
    ],
    cameraSetup: 'Turn your chair sideways so your weak side faces the camera.',
    unit: '°',
    scaleMax: 180,
    restAt: 105,
    upAt: 125,
    read: (f, s) => f.elbowAngle[s],
  },
  hand_open: {
    id: 'hand_open',
    title: 'Hand open and close',
    instruction: 'Open your hand as wide as you can, then make a gentle fist.',
    steps: [
      'Rest your arm and face your palm to the camera.',
      'Spread your fingers as wide as you can.',
      'Close them into a gentle fist.',
      'Open again. Each open hand is one rep.',
    ],
    cameraSetup: 'Hold your palm toward the camera, about 50 centimetres away.',
    unit: '%',
    scaleMax: 100,
    restAt: 40,
    upAt: 55,
    read: (f, s) => f.handOpening[s],
  },
};

export const TRUNK_LEAN_LIMIT_DEG = 10;
export const SHOULDER_HIKE_LIMIT = 0.08;
