/** The data source contract behind api.ts (CONVERGENCE_PLAN §6.2). LocalSource and SupabaseSource implement it. */
import type {
  Alert,
  ApprovePlanBody,
  CameraAnalysis,
  DataMode,
  Exercise,
  ExerciseResult,
  Patient,
  Plan,
  ReplayFile,
  SavePlanBody,
  Session,
  SessionUploadBody,
  Side,
  WatchDaily,
  WatchDailyUpload,
  WatchSession,
  WeeklySummary,
} from '../types';

export type SessionRow = Omit<Session, 'results' | 'symmetry' | 'compensation' | 'symmetryByExercise'>;

export interface ReplayRow {
  sessionId: string;
  exercise: Exercise;
  side: Side;
  /** `<sessionId>/<exercise>-<side>.json` (uploaded) or `synth:v1;…` (generated in the browser). */
  path: string;
  fps: number;
  frameCount: number;
  seconds: number;
  warningCount: number;
  uploadedAt: string;
}

export interface Snapshot {
  patient: Patient;
  sessions: SessionRow[];
  results: ExerciseResult[];
  replays: ReplayRow[];
  watch: WatchDaily[];
  /** All alerts, including acknowledged ones. */
  alerts: Alert[];
  plans: Plan[];
}

export type NewAlert = Omit<Alert, 'id' | 'acknowledged' | 'acknowledgedAt'>;
export type NewPlan = Omit<Plan, 'id' | 'status' | 'approvedBy' | 'approvedAt' | 'dismissedAt' | 'dismissedBy' | 'supersededAt'>;

export interface RuleResults {
  alertsCreated: Alert[];
  planSuggested: Plan | null;
}

export interface DataSource {
  readonly mode: DataMode;
  /** Throws ApiError not_found for an unknown patient. */
  loadSnapshot(patientId: string): Promise<Snapshot>;
  loadAllSnapshots(): Promise<Snapshot[]>;
  /** Newest first, max 50, no trace. */
  listWatchSessions(patientId: string): Promise<WatchSession[]>;
  /** Camera Analyze results (online only; optional). */
  listCameraAnalyses?(patientId: string): Promise<CameraAnalysis[]>;
  saveCameraAnalysis?(a: Omit<CameraAnalysis, 'id'>): Promise<void>;
  /** Idempotent on clientKey. */
  insertSession(body: SessionUploadBody): Promise<{ session: SessionRow; results: ExerciseResult[] }>;
  putReplay(sessionId: string, replay: ReplayFile, summary: Omit<ReplayRow, 'path' | 'uploadedAt'>): Promise<ReplayRow>;
  listReplays(sessionId: string): Promise<ReplayRow[]>;
  /** Uploaded replays only: api.ts handles 'synth:' paths before calling. */
  readReplay(row: ReplayRow): Promise<ReplayFile>;
  /** Inserts only what isn't already open (one open alert per type, one suggested plan). */
  applyRuleResults(patientId: string, alerts: NewAlert[], plan: NewPlan | null): Promise<RuleResults>;
  ackAlert(id: string): Promise<Alert>;
  approvePlan(id: string, body: ApprovePlanBody): Promise<Plan>;
  dismissPlan(id: string, by?: string): Promise<Plan>;
  savePlan(patientId: string, body: SavePlanBody): Promise<Plan>;
  setNextCheckin(patientId: string, date: string): Promise<Patient>;
  submitWatchDaily(body: WatchDailyUpload): Promise<WatchDaily>;
  getWeeklySummary(patientId: string): Promise<WeeklySummary | null>;
  refreshWeeklySummary?(patientId: string): Promise<WeeklySummary>;
  reset?(): Promise<void>;
  /** local: BroadcastChannel + same tab; supabase: same tab only. */
  subscribe(cb: () => void): () => void;
}
