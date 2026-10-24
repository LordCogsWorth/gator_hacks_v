/** Shared data shapes — keep in sync with Raghav/docs/CONTRACTS.md and the API. */

export type Exercise = 'arm_raise' | 'forward_reach' | 'hand_open';
export type Side = 'weak' | 'healthy';
export type BodySide = 'left' | 'right';
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

export interface ExerciseResult {
  id?: string;
  sessionId?: string;
  exercise: Exercise;
  side: Side;
  bestValue: number;
  reps: number;
  secPerRep: number;
  smoothness: number;
  fatigue: number;
  trunkLeanMax: number;
  shoulderHikeMax: number;
  compRepPct: number;
}

export interface Session {
  id: string;
  patientId: string;
  startedAt: string;
  endedAt: string;
  pain: number | null;
  tiredness: number | null;
  avgHr: number | null;
  replayFile: unknown | null;
  results: ExerciseResult[];
  symmetry: number | null;
  compensation: number | null;
  symmetryByExercise: Record<Exercise, number | null>;
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
