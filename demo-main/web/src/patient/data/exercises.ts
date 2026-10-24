import { clamp } from '../../camera/geometry';
import type { TrackingFrame } from '../../camera/types';
import type { BodySide, Exercise } from '../../types';
import type { Thresholds } from '../session/repCounter';

const other = (s: BodySide): BodySide => (s === 'left' ? 'right' : 'left');

export interface ExerciseInfo {
  id: Exercise;
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
  /** Pull the number for this exercise out of a camera frame. */
  read: (f: TrackingFrame, side: BodySide) => number | null;
  /** Setup gate: the camera sees what this exercise needs (for `setupHoldMs` in a row). */
  inView: (f: TrackingFrame, side: BodySide) => boolean;
  setupHoldMs: number;
  /** Shown while the setup gate waits. */
  setupWaiting: string;
}

export const EXERCISES: Record<Exercise, ExerciseInfo> = {
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
    read: (f, s) => f.shoulderAngle[s],
    inView: (f, s) => f.visible.shoulders[s] && f.visible.shoulders[other(s)] && f.visible.elbows[s] && f.visible.wrists[s],
    setupHoldMs: 1000,
    setupWaiting: 'Waiting to see both shoulders and your arm…',
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
    read: (f, s) => f.elbowAngle[s],
    inView: (f, s) => f.visible.shoulders[s] && f.visible.elbows[s] && f.visible.wrists[s],
    setupHoldMs: 1000,
    setupWaiting: 'Waiting to see your shoulder, elbow and wrist…',
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
    read: (f, s) => f.handOpening[s],
    inView: (f, s) => f.handOpening[s] !== null,
    setupHoldMs: 500,
    setupWaiting: 'Waiting to see your hand…',
  },
};

/**
 * Rep thresholds (CONVERGENCE_PLAN §7.5): a rep opens above `restAt`, counts once it reaches `upAt`.
 * `v0` is the resting reading from the rest baseline; null = no baseline (fixed defaults).
 * Hand opening isn't baseline-relative: the resting hand isn't a fist.
 */
export function thresholds(ex: Exercise, v0: number | null): Thresholds {
  switch (ex) {
    case 'arm_raise': {
      if (v0 === null) return { restAt: 30, upAt: 55 };
      const restAt = clamp(v0 + 15, 25, 45);
      return { restAt, upAt: Math.max(restAt + 25, 55) };
    }
    case 'forward_reach': {
      if (v0 === null) return { restAt: 130, upAt: 145 };
      const restAt = clamp(v0 + 8, 110, 140);
      return { restAt, upAt: clamp(Math.max(v0 + 22, 140), restAt + 12, 165) };
    }
    case 'hand_open':
      return { restAt: 35, upAt: 55 };
  }
}
