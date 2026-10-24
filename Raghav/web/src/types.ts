/**
 * Shared data shapes for the whole web app (care area + patient area): the one
 * source of truth. Field names match the API (camelCase) and
 * Raghav/docs/CONTRACTS.md. The camera contract itself is in camera/types.ts.
 */

// §1 Shared names
export type Exercise = 'arm_raise' | 'forward_reach' | 'hand_open';
/** Which arm a result is for. */
export type Side = 'weak' | 'healthy';
/** The patient's body side ("left" / "right" are the patient's own sides). */
export type BodySide = 'left' | 'right';

/**
 * §3 ExerciseResult: one per exercise per arm. The patient app builds it from
 * camera frames (patient/session/repCounter.ts); `id` / `sessionId` are filled
 * in by the API once saved.
 */
export interface ExerciseResult {
  id?: string;
  sessionId?: string;
  exercise: Exercise;
  side: Side;
  bestValue: number; // best angle (degrees) or hand opening (%)
  reps: number;
  secPerRep: number;
  smoothness: number; // speed bursts per rep; lower = smoother
  fatigue: number; // last 3 reps avg / first 3 reps avg (1.0 = no drop)
  trunkLeanMax: number; // degrees from vertical
  shoulderHikeMax: number; // active shoulder height above the other shoulder, in metres
  compRepPct: number; // % of reps where lean or hike passed the threshold (0–100)
}

// §4 ReplayFile: 3D skeleton recording of one exercise + side, built by the patient app.
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

/** Why a session was ended early (POST /sessions stopReason). */
export type StopReason = 'pain' | 'dizziness' | 'other';

export type PlanStatus = 'suggested' | 'approved' | 'superseded' | 'dismissed';
export type PlanKind = 'phase-up' | 'plateau' | 'compensation';
export type Trend = 'up' | 'down' | 'flat' | 'none';

export type AlertType =
  | 'plateau'
  | 'setback'
  | 'compensation'
  | 'adherence'
  | 'pain'
  | 'safety-stop'
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

export interface Session {
  id: string;
  patientId: string;
  startedAt: string;
  endedAt: string;
  pain: number | null;
  tiredness: number | null;
  /** Set when the patient ended the session early (safety stop); results may then be empty. */
  stopReason: StopReason | null;
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
  /** Safety stop: allows 0 results. */
  stopReason?: StopReason | null;
  results: ExerciseResult[];
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
  'safety-stop': 'Safety stop',
  'heart-rate': 'Heart rate',
  'blood-pressure': 'Blood pressure',
  fall: 'Fall',
};
