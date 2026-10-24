/** Shared data shapes — keep in sync with Raghav/docs/CONTRACTS.md and the API. */

import type { BodySide, Exercise, ExerciseResult as CameraExerciseResult, Side } from './camera/types';

// Camera-contract names live in camera/types.ts (CONTRACTS.md §1–4); re-exported here.
export type { BodySide, Exercise, ReplayFile, Side } from './camera/types';

export type PlanStatus = 'suggested' | 'approved' | 'superseded' | 'dismissed';
export type PlanKind = 'phase-up' | 'plateau' | 'compensation';
export type Trend = 'up' | 'down' | 'flat' | 'none';

export type AlertType =
  | 'plateau'
  | 'setback'
  | 'compensation'
  | 'adherence'
  | 'pain'
  | 'heart-rate'
  | 'blood-pressure'
  | 'fall';

export interface Patient {
  id: string;
  name: string;
  weakSide: BodySide;
  strokeDate: string;
  phase: number;
  maxRaiseAngle: number;
  nextCheckin: string;
  bpLimitSys: number;
}

export interface PatientSummary extends Patient {
  latestSymmetry: number | null;
  trend: Trend;
  trendDelta: number;
  openAlertCount: number;
  openAlertTypes: AlertType[];
  sessionsThisWeek: number;
  sessionsPerWeek: number | null;
  flagged: boolean;
}

export interface PlanExercise {
  exercise: Exercise;
  reps: number;
  target: number;
}

export interface Plan {
  id: string;
  patientId: string;
  phase: number;
  exercises: PlanExercise[];
  sessionsPerWeek: number;
  status: PlanStatus;
  approvedBy: string | null;
  nextCheckin: string;
  createdAt: string;
  approvedAt?: string;
  dismissedAt?: string;
  supersededAt?: string;
  /** Only on plans drafted by the rules engine. */
  kind?: PlanKind;
  reason?: string;
  basedOn?: { sessions: number; avgSymmetry: number | null; avgCompensation: number | null };
}

/** Body for POST /plans/:id/approve. Everything but approvedBy is optional. */
export interface ApprovePlanBody {
  approvedBy: string;
  exercises?: PlanExercise[];
  sessionsPerWeek?: number;
  nextCheckin?: string;
}

/** GET /config */
export interface ApiConfig {
  phaseTargets: Record<string, number>;
  maxPhase: number;
  exercises: Exercise[];
  alertCooldownHours: number;
}

/** An ExerciseResult as the API returns it (ids filled in once saved). */
export interface ExerciseResult extends CameraExerciseResult {
  id?: string;
  sessionId?: string;
}

export interface Session {
  id: string;
  patientId: string;
  startedAt: string;
  endedAt: string;
  pain: number | null;
  tiredness: number | null;
  avgHr: number | null;
  /** Legacy placeholder, always null. Uploaded replays are listed in `replays`. */
  replayFile: unknown | null;
  /** Keys of uploaded replays: "<sessionId>-<exercise>-<side>". */
  replays: string[];
  results: ExerciseResult[];
  symmetry: number | null;
  compensation: number | null;
  symmetryByExercise: Record<Exercise, number | null>;
}

/** Body for POST /sessions (what the patient app uploads). */
export interface SessionUploadBody {
  patientId: string;
  startedAt: string | number;
  endedAt: string | number;
  pain?: number | null;
  tiredness?: number | null;
  results: CameraExerciseResult[];
}

/** Response of POST /sessions. */
export interface SessionUploadResponse {
  session: Omit<Session, 'results' | 'symmetry' | 'compensation' | 'symmetryByExercise'>;
  results: ExerciseResult[];
  alertsCreated: Alert[];
  planSuggested: Plan | null;
}

/** One row of GET /sessions/:id/replays (no frames). */
export interface ReplaySummary {
  key: string;
  exercise: Exercise;
  side: Side;
  fps: number;
  frameCount: number;
  seconds: number;
  warningCount: number;
  uploadedAt: string;
}

/** Response of POST /sessions/:id/replay. */
export interface ReplayUploadResponse {
  sessionId: string;
  replays: string[];
  replay: ReplaySummary;
}

export interface WatchDaily {
  id: string;
  patientId: string;
  date: string;
  steps: number | null;
  exerciseMin: number | null;
  standHr: number | null;
  restingHr: number | null;
  hrv: number | null;
  sleepHr: number | null;
  bpSys: number | null;
  bpDia: number | null;
  falls: number | null;
  weakArmActiveMin: number | null;
  useRatio: number | null;
}

export interface Alert {
  id: string;
  patientId: string;
  type: AlertType;
  detail: string;
  createdAt: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
}

export interface PatientDetailResponse {
  patient: Patient;
  plan: Plan | null;
  approvedPlan: Plan | null;
  openAlerts: Alert[];
}

export const EXERCISE_LABELS: Record<Exercise, string> = {
  arm_raise: 'Arm raise',
  forward_reach: 'Forward reach',
  hand_open: 'Hand open',
};

export const PLAN_KIND_LABELS: Record<PlanKind, string> = {
  'phase-up': 'Ready for next phase',
  plateau: 'Plateau — shift emphasis',
  compensation: 'Compensating — focus on form',
};

/** Unit shown after a plan target. */
export const TARGET_UNITS: Record<Exercise, string> = {
  arm_raise: '°',
  forward_reach: '°',
  hand_open: '%',
};

export const ALERT_LABELS: Record<AlertType, string> = {
  plateau: 'Plateau',
  setback: 'Setback',
  compensation: 'Compensation',
  adherence: 'Adherence',
  pain: 'Pain',
  'heart-rate': 'Heart rate',
  'blood-pressure': 'Blood pressure',
  fall: 'Fall',
};
