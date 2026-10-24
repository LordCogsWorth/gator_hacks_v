import type { AlertType, ApiConfig, Exercise, PlanExercise } from '../types';

export const EXERCISES: Exercise[] = ['arm_raise', 'forward_reach', 'hand_open'];

/** After an alert is acknowledged, the same type stays quiet this long unless newer triggering data arrives. */
export const ALERT_COOLDOWN_HOURS = 72;

/** Alert types driven by Apple Watch rows; every other type is driven by sessions. */
export const WATCH_ALERT_TYPES: AlertType[] = ['heart-rate', 'blood-pressure', 'fall'];

/** Symmetry % the weak arm should reach before moving on. */
export const PHASE_TARGETS: Record<number, number> = { 1: 50, 2: 65, 3: 80, 4: 90 };
export const MAX_PHASE = 4;

/** Upper bound for a plan target: degrees for the arm exercises, % for hand_open. */
export const TARGET_CEILING: Record<Exercise, number> = { arm_raise: 180, forward_reach: 180, hand_open: 100 };
/** Matches the DB check on plan exercises (reps 1..200). */
export const MAX_PLAN_REPS = 200;

export const DEFAULT_EXERCISES: PlanExercise[] = [
  { exercise: 'arm_raise', reps: 10, target: 90 },
  { exercise: 'forward_reach', reps: 10, target: 140 },
  { exercise: 'hand_open', reps: 12, target: 70 },
];
export const DEFAULT_SESSIONS_PER_WEEK = 5;

export const EXERCISE_NAMES: Record<Exercise, string> = {
  arm_raise: 'arm raise',
  forward_reach: 'forward reach',
  hand_open: 'hand open',
};

/** Rule thresholds. */
export const PLATEAU_DAYS = 14;
export const PLATEAU_MIN_SESSIONS = 4;
export const PLATEAU_RANGE = 5;
export const SETBACK_DROP = 10;
export const SETBACK_BASELINE_SESSIONS = 3;
export const COMPENSATION_ALERT_PCT = 50;
export const MISSED_DAYS_ALERT = 3;
export const PAIN_ALERT = 7;
export const RESTING_HR_RISE = 10;
export const NEXT_PHASE_MAX_COMPENSATION = 20;

export const API_CONFIG: ApiConfig = {
  phaseTargets: Object.fromEntries(Object.entries(PHASE_TARGETS).map(([k, v]) => [k, v])),
  maxPhase: MAX_PHASE,
  exercises: [...EXERCISES],
  alertCooldownHours: ALERT_COOLDOWN_HOURS,
};
