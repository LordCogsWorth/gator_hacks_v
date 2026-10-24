/**
 * Shared data shapes for the whole web app (care area + patient area): the one
 * source of truth. Final contract from demo-main/CONVERGENCE_PLAN.md §5.1 (camelCase; the SQL
 * columns are the snake_case equivalents, see §5.2/§5.3). FROZEN after WP0: WP1 may add
 * additively; anything else goes through WP8. The camera contract itself is in camera/types.ts.
 */

// §1 Shared names
export type Exercise = 'arm_raise' | 'forward_reach' | 'hand_open';
/** Which arm a result is for. */
export type Side = 'weak' | 'healthy';
/** The patient's body side ("left" / "right" are the patient's own sides). */
export type BodySide = 'left' | 'right';
/** Which data source the app runs on (src/data/index.ts picks one at startup). */
export type DataMode = 'local' | 'supabase';

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
  /** Best angle in degrees (arm_raise, forward_reach) or mapped hand opening 0–100 % (hand_open). */
  bestValue: number;
  reps: number;
  /** Mean movement duration per rep (leave rest → back to rest), seconds. */
  secPerRep: number;
  /** Speed bursts per rep (≥ 1, Stuti's bursts()); lower = smoother. */
  smoothness: number;
  /** Last 3 rep peaks ÷ first 3 (1 when fewer than 6 reps; 1.0 = no drop). */
  fatigue: number;
  /** Max trunk lean in degrees FROM THE REST BASELINE. */
  trunkLeanMax: number;
  /** Max shoulder hike in metres above rest (arm_raise only, else 0). */
  shoulderHikeMax: number;
  /** % of reps where lean or hike passed the threshold (0–100). */
  compRepPct: number;
  /** forward_reach only: max shoulder→wrist reach, cm. */
  reachCm?: number | null;
  /** hand_open only: smallest hand opening during the round, %. */
  closedMin?: number | null;
}

// §4 ReplayFile: 3D skeleton recording of one exercise + side, built by the patient app.
export type ReplayWarningType = 'lean' | 'shoulder_hike';

export interface ReplayFile {
  fps: 15;
  exercise: Exercise;
  side: Side;
  joints: string[]; // order of joints in every frame (REPLAY_JOINTS)
  /**
   * frames[f][j] = [x, y, z] in metres, MediaPipe world coordinates: hip-centred, x = patient's left,
   * y DOWN, z toward the camera negative. At most 1800 frames.
   */
  frames: [number, number, number][][];
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
  /** YYYY-MM-DD */
  strokeDate: string;
  /** 1..4 */
  phase: number;
  maxRaiseAngle: number;
  /** YYYY-MM-DD */
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
  dismissedBy?: string;
  supersededAt?: string;
  /** Only on plans drafted by the rules engine. */
  kind?: PlanKind;
  reason?: string;
  basedOn?: { sessions: number; avgSymmetry: number | null; avgCompensation: number | null };
}

/** Body for approvePlan(). Everything but approvedBy is optional (overrides on the suggestion). */
export interface ApprovePlanBody {
  approvedBy: string;
  phase?: number;
  exercises?: PlanExercise[];
  sessionsPerWeek?: number;
  nextCheckin?: string;
}

/** Clinician edits the current plan without a suggestion: savePlan() creates a new approved plan. */
export interface SavePlanBody {
  approvedBy: string;
  phase: number;
  exercises: PlanExercise[];
  sessionsPerWeek: number;
  nextCheckin: string;
}

/** getConfig(): rule constants. */
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
  /** Keys of the session's replays: "<sessionId>-<exercise>-<side>" (from session_replays). */
  replays: string[];
  results: ExerciseResult[];
  symmetry: number | null;
  compensation: number | null;
  symmetryByExercise: Record<Exercise, number | null>;
}

/** Body for postSession() (what the patient app uploads). */
export interface SessionUploadBody {
  /** Random UUID made when the session starts; re-sending the same key returns the saved session. */
  clientKey?: string;
  patientId: string;
  startedAt: string | number;
  endedAt: string | number;
  pain?: number | null;
  tiredness?: number | null;
  /** Safety stop: allows 0 results. */
  stopReason?: StopReason | null;
  results: ExerciseResult[];
}

/** Response of postSession(). */
export interface SessionUploadResponse {
  session: Omit<Session, 'results' | 'symmetry' | 'compensation' | 'symmetryByExercise'>;
  results: ExerciseResult[];
  alertsCreated: Alert[];
  planSuggested: Plan | null;
}

/** One replay of a session, without frames (getSessionReplays()). */
export interface ReplaySummary {
  /** `${sessionId}-${exercise}-${side}` */
  key: string;
  exercise: Exercise;
  side: Side;
  fps: number;
  frameCount: number;
  seconds: number;
  warningCount: number;
  uploadedAt: string;
}

/** Response of uploadReplay(). */
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
  /** Apple Walking Steadiness 0–100 (stored, not charted). */
  walkingSteadiness: number | null;
  weakArmActiveMin: number | null;
  useRatio: number | null;
}

/** submitWatchDaily() body: merge semantics — omitted fields keep their previous value. */
export type WatchDailyUpload = { patientId: string; date: string } & Partial<Omit<WatchDaily, 'id' | 'patientId' | 'date'>>;

/** One exercise session recorded by the Apple Watch app (Route B), without its trace. */
export interface WatchSession {
  id: string;
  sessionId: string;
  patientId: string;
  exercise: 'arm_raise' | 'forward_reach';
  arm: BodySide | null;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  targetReps: number | null;
  reps: number | null;
  attempts: number | null;
  bestElevationDeg: number | null;
  completed: boolean | null;
  avgHr: number | null;
  maxHr: number | null;
  minHr: number | null;
  appSessionId: string | null;
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
  /** The open suggested plan, else the approved one. */
  plan: Plan | null;
  approvedPlan: Plan | null;
  openAlerts: Alert[];
}

/** Two-sentence weekly summary for the clinician (pre-generated or from the LLM Edge Function). */
export interface WeeklySummary {
  patientId: string;
  /** YYYY-MM-DD */
  weekStart: string;
  text: string;
  model: string;
  source: 'pregenerated' | 'llm';
  createdAt: string;
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
