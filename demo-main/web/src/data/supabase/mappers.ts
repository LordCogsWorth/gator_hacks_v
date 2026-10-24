/**
 * Supabase ⇄ TS mapping (CONVERGENCE_PLAN §5.3). Table SELECTs are snake_case (`*FromRow`); RPC results are
 * already camelCase (the SQL `private.*_json` builders) and only need normalising (`norm*`).
 * Every timestamp goes through `iso()`: Postgres answers `…+00:00`, the rules engine compares ISO strings.
 */
import type {
  Alert,
  AlertType,
  BodySide,
  Exercise,
  ExerciseResult,
  Patient,
  Plan,
  PlanExercise,
  PlanKind,
  PlanStatus,
  Side,
  StopReason,
  WatchDaily,
  WatchSession,
  WeeklySummary,
} from '../../types';
import { ApiError, type ApiErrorCode } from '../errors';
import type { ReplayRow, SessionRow } from '../source';

type Json = Record<string, unknown>;

export function iso(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}
const isoOpt = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : iso(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const strOpt = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
/** Postgres `date` → YYYY-MM-DD. */
const day = (v: unknown): string => (v === null || v === undefined ? '' : String(v).slice(0, 10));

function exercises(v: unknown): PlanExercise[] {
  return Array.isArray(v)
    ? v.map((e: Json) => ({ exercise: e.exercise as Exercise, reps: Number(e.reps), target: Number(e.target) }))
    : [];
}

function basedOn(v: unknown): Plan['basedOn'] {
  if (!v || typeof v !== 'object') return undefined;
  const b = v as Json;
  return { sessions: Number(b.sessions ?? 0), avgSymmetry: num(b.avgSymmetry), avgCompensation: num(b.avgCompensation) };
}

function plan(p: {
  id: unknown; patientId: unknown; phase: unknown; exercises: unknown; sessionsPerWeek: unknown; status: unknown;
  approvedBy: unknown; nextCheckin: unknown; createdAt: unknown; approvedAt?: unknown; dismissedAt?: unknown;
  dismissedBy?: unknown; supersededAt?: unknown; kind?: unknown; reason?: unknown; basedOn?: unknown;
}): Plan {
  const out: Plan = {
    id: String(p.id),
    patientId: String(p.patientId),
    phase: Number(p.phase),
    exercises: exercises(p.exercises),
    sessionsPerWeek: Number(p.sessionsPerWeek),
    status: p.status as PlanStatus,
    approvedBy: str(p.approvedBy),
    nextCheckin: day(p.nextCheckin),
    createdAt: iso(p.createdAt),
  };
  const opt = {
    approvedAt: isoOpt(p.approvedAt),
    dismissedAt: isoOpt(p.dismissedAt),
    dismissedBy: strOpt(p.dismissedBy),
    supersededAt: isoOpt(p.supersededAt),
    kind: strOpt(p.kind) as PlanKind | undefined,
    reason: strOpt(p.reason),
    basedOn: basedOn(p.basedOn),
  };
  for (const [k, v] of Object.entries(opt)) if (v !== undefined) (out as unknown as Json)[k] = v;
  return out;
}

// ---- table rows (snake_case) ----

export function patientFromRow(r: Json): Patient {
  return {
    id: String(r.id),
    name: String(r.name),
    weakSide: r.weak_side as BodySide,
    strokeDate: day(r.stroke_date),
    phase: Number(r.phase),
    maxRaiseAngle: Number(r.max_raise_angle),
    nextCheckin: day(r.next_checkin),
    bpLimitSys: Number(r.bp_limit_sys),
  };
}

export function planFromRow(r: Json): Plan {
  return plan({
    id: r.id, patientId: r.patient_id, phase: r.phase, exercises: r.exercises, sessionsPerWeek: r.sessions_per_week,
    status: r.status, approvedBy: r.approved_by, nextCheckin: r.next_checkin, createdAt: r.created_at,
    approvedAt: r.approved_at, dismissedAt: r.dismissed_at, dismissedBy: r.dismissed_by, supersededAt: r.superseded_at,
    kind: r.kind, reason: r.reason, basedOn: r.based_on,
  });
}

export function sessionFromRow(r: Json, replayKeys: string[] = []): SessionRow {
  return {
    id: String(r.id),
    patientId: String(r.patient_id),
    startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at),
    pain: num(r.pain),
    tiredness: num(r.tiredness),
    stopReason: (str(r.stop_reason) as StopReason | null) ?? null,
    avgHr: num(r.avg_hr),
    replays: replayKeys,
  };
}

export function resultFromRow(r: Json): ExerciseResult {
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    exercise: r.exercise as Exercise,
    side: r.side as Side,
    bestValue: Number(r.best_value),
    reps: Number(r.reps),
    secPerRep: Number(r.sec_per_rep),
    smoothness: Number(r.smoothness),
    fatigue: Number(r.fatigue),
    trunkLeanMax: Number(r.trunk_lean_max),
    shoulderHikeMax: Number(r.shoulder_hike_max),
    compRepPct: Number(r.comp_rep_pct),
    reachCm: num(r.reach_cm),
    closedMin: num(r.closed_min),
  };
}

export function replayFromRow(r: Json): ReplayRow {
  return {
    sessionId: String(r.session_id),
    exercise: r.exercise as Exercise,
    side: r.side as Side,
    path: String(r.path),
    fps: Number(r.fps ?? 15),
    frameCount: Number(r.frame_count ?? 0),
    seconds: Number(r.seconds ?? 0),
    warningCount: Number(r.warning_count ?? 0),
    uploadedAt: iso(r.uploaded_at),
  };
}

export function watchDailyFromRow(r: Json): WatchDaily {
  return {
    id: String(r.id),
    patientId: String(r.patient_id),
    date: day(r.date),
    steps: num(r.steps),
    exerciseMin: num(r.exercise_min),
    standHr: num(r.stand_hr),
    restingHr: num(r.resting_hr),
    hrv: num(r.hrv),
    sleepHr: num(r.sleep_hr),
    bpSys: num(r.bp_sys),
    bpDia: num(r.bp_dia),
    falls: num(r.falls),
    walkingSteadiness: num(r.walking_steadiness),
    weakArmActiveMin: num(r.weak_arm_active_min),
    useRatio: num(r.use_ratio),
  };
}

/** Columns read for watch sessions (never the trace or rep log). */
export const WATCH_SESSION_COLUMNS =
  'id, session_id, patient_id, exercise, arm, started_at, ended_at, duration_sec, target_reps, reps, attempts, ' +
  'best_elevation_deg, completed, avg_hr, max_hr, min_hr, app_session_id';

export function watchSessionFromRow(r: Json): WatchSession {
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    patientId: String(r.patient_id),
    exercise: r.exercise as WatchSession['exercise'],
    arm: (str(r.arm) as BodySide | null) ?? null,
    startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at),
    durationSec: Number(r.duration_sec ?? 0),
    targetReps: num(r.target_reps),
    reps: num(r.reps),
    attempts: num(r.attempts),
    bestElevationDeg: num(r.best_elevation_deg),
    completed: r.completed === null || r.completed === undefined ? null : Boolean(r.completed),
    avgHr: num(r.avg_hr),
    maxHr: num(r.max_hr),
    minHr: num(r.min_hr),
    appSessionId: str(r.app_session_id),
  };
}

export function alertFromRow(r: Json): Alert {
  const a: Alert = {
    id: String(r.id),
    patientId: String(r.patient_id),
    type: r.type as AlertType,
    detail: String(r.detail),
    createdAt: iso(r.created_at),
    acknowledged: Boolean(r.acknowledged),
  };
  const ackAt = isoOpt(r.acknowledged_at);
  if (ackAt) a.acknowledgedAt = ackAt;
  return a;
}

export function summaryFromRow(r: Json): WeeklySummary {
  return {
    patientId: String(r.patient_id),
    weekStart: day(r.week_start),
    text: String(r.text),
    model: String(r.model ?? ''),
    source: (r.source as WeeklySummary['source']) ?? 'pregenerated',
    createdAt: iso(r.created_at),
  };
}

// ---- RPC results (camelCase) ----

export function normPlan(j: Json): Plan {
  return plan(j as Parameters<typeof plan>[0]);
}

export function normAlert(j: Json): Alert {
  const a: Alert = {
    id: String(j.id),
    patientId: String(j.patientId),
    type: j.type as AlertType,
    detail: String(j.detail),
    createdAt: iso(j.createdAt),
    acknowledged: Boolean(j.acknowledged),
  };
  const ackAt = isoOpt(j.acknowledgedAt);
  if (ackAt) a.acknowledgedAt = ackAt;
  return a;
}

export function normPatient(j: Json): Patient {
  return {
    id: String(j.id),
    name: String(j.name),
    weakSide: j.weakSide as BodySide,
    strokeDate: day(j.strokeDate),
    phase: Number(j.phase),
    maxRaiseAngle: Number(j.maxRaiseAngle),
    nextCheckin: day(j.nextCheckin),
    bpLimitSys: Number(j.bpLimitSys),
  };
}

export function normSession(j: Json): SessionRow {
  return {
    id: String(j.id),
    patientId: String(j.patientId),
    startedAt: iso(j.startedAt),
    endedAt: iso(j.endedAt),
    pain: num(j.pain),
    tiredness: num(j.tiredness),
    stopReason: (str(j.stopReason) as StopReason | null) ?? null,
    avgHr: num(j.avgHr),
    replays: Array.isArray(j.replays) ? j.replays.map(String) : [],
  };
}

export function normResult(j: Json): ExerciseResult {
  return {
    id: String(j.id),
    sessionId: String(j.sessionId),
    exercise: j.exercise as Exercise,
    side: j.side as Side,
    bestValue: Number(j.bestValue),
    reps: Number(j.reps),
    secPerRep: Number(j.secPerRep),
    smoothness: Number(j.smoothness),
    fatigue: Number(j.fatigue),
    trunkLeanMax: Number(j.trunkLeanMax),
    shoulderHikeMax: Number(j.shoulderHikeMax),
    compRepPct: Number(j.compRepPct),
    reachCm: num(j.reachCm),
    closedMin: num(j.closedMin),
  };
}

export function normReplay(j: Json): ReplayRow {
  return {
    sessionId: String(j.sessionId),
    exercise: j.exercise as Exercise,
    side: j.side as Side,
    path: String(j.path),
    fps: Number(j.fps ?? 15),
    frameCount: Number(j.frameCount ?? 0),
    seconds: Number(j.seconds ?? 0),
    warningCount: Number(j.warningCount ?? 0),
    uploadedAt: iso(j.uploadedAt),
  };
}

/** submit_watch_daily answers WatchDaily + {ok, updatedAt}: keep the WatchDaily fields only. */
export function normWatchDaily(j: Json): WatchDaily {
  return {
    id: String(j.id),
    patientId: String(j.patientId),
    date: day(j.date),
    steps: num(j.steps),
    exerciseMin: num(j.exerciseMin),
    standHr: num(j.standHr),
    restingHr: num(j.restingHr),
    hrv: num(j.hrv),
    sleepHr: num(j.sleepHr),
    bpSys: num(j.bpSys),
    bpDia: num(j.bpDia),
    falls: num(j.falls),
    walkingSteadiness: num(j.walkingSteadiness),
    weakArmActiveMin: num(j.weakArmActiveMin),
    useRatio: num(j.useRatio),
  };
}

export function normSummary(j: Json): WeeklySummary {
  return {
    patientId: String(j.patientId),
    weekStart: day(j.weekStart),
    text: String(j.text),
    model: String(j.model ?? ''),
    source: (j.source as WeeklySummary['source']) ?? 'llm',
    createdAt: iso(j.createdAt),
  };
}

// ---- errors ----

const CODE_MAP: Record<string, [number, ApiErrorCode]> = {
  PT400: [400, 'invalid'],
  '23514': [400, 'invalid'],
  '22P02': [400, 'invalid'],
  '22007': [400, 'invalid'],
  '22008': [400, 'invalid'],
  PT404: [404, 'not_found'],
  '23503': [404, 'not_found'],
  PT409: [409, 'conflict'],
  '23505': [409, 'conflict'],
};

/** PostgREST / supabase-js error (SQLSTATE in `code`) → ApiError. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const err = (e ?? {}) as { code?: unknown; message?: unknown; details?: unknown; name?: unknown; status?: unknown };
  const message = typeof err.message === 'string' && err.message ? err.message : 'Request failed';
  const code = typeof err.code === 'string' ? err.code : '';
  const mapped = CODE_MAP[code];
  if (mapped) return new ApiError(message, mapped[0], mapped[1]);
  if (err.name === 'AbortError' || /fetch|network|timed out|timeout/i.test(message)) {
    return new ApiError(message, 0, 'network');
  }
  return new ApiError(message, 500, 'network');
}
