/**
 * Online data source: reads are table SELECTs (anon, RLS demo read), writes are the SECURITY DEFINER RPCs in
 * supabase/migrations/0001_init.sql. Ingest RPCs (submit_session, submit_watch_daily, register_replay) take the
 * body itself; the others take p_… named arguments.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Alert,
  ApprovePlanBody,
  CameraAnalysis,
  ExerciseResult,
  Patient,
  Plan,
  ReplayFile,
  SavePlanBody,
  SessionUploadBody,
  WatchDaily,
  WatchDailyUpload,
  WatchSession,
  WeeklySummary,
} from '../../types';
import { ApiError, notFound } from '../errors';
import { replayKeysBySession } from '../derive';
import type { DataSource, NewAlert, NewPlan, ReplayRow, RuleResults, SessionRow, Snapshot } from '../source';
import {
  WATCH_SESSION_COLUMNS,
  alertFromRow,
  normAlert,
  normPatient,
  normPlan,
  normReplay,
  normResult,
  normSession,
  normSummary,
  normWatchDaily,
  patientFromRow,
  planFromRow,
  replayFromRow,
  resultFromRow,
  sessionFromRow,
  summaryFromRow,
  toApiError,
  watchDailyFromRow,
  watchSessionFromRow,
} from './mappers';
import { getSupabase } from './client';

type Json = Record<string, unknown>;
type Result<T> = PromiseLike<{ data: T | null; error: unknown }>;

const SUMMARY_TIMEOUT_MS = 15_000;

async function q<T>(p: Result<T>): Promise<T> {
  let res: { data: T | null; error: unknown };
  try {
    res = await p;
  } catch (e) {
    throw toApiError(e);
  }
  if (res.error) throw toApiError(res.error);
  return res.data as T;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(`${what} timed out after ${ms / 1000} s`, 0, 'network')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const omitUndefined = (o: Json) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** watch_sessions rows with this session-id prefix hold camera Analyze results, not watch rounds. */
const CAMERA_PREFIX = 'camera-';

/** Watch rounds within this gap of each other count as one session. */
const WATCH_GROUP_GAP_MS = 30 * 60_000;

/**
 * Turn watch_sessions rows (one row = one arm, one exercise) into session + result rows so watch workouts
 * appear in the Sessions list, charts and the doctor dashboard like camera sessions do.
 * Rounds are grouped by appSessionId, else by time (≤ 30 min apart). Rounds that overlap a camera session
 * are skipped (the camera session already covers them).
 */
export function watchToSessions(
  watchRows: Json[], patients: Json[], cameraSessions: Json[],
): { sessions: Json[]; results: Json[] } {
  const weakSide = new Map(patients.map((p) => [String(p.id), String(p.weak_side ?? '')]));
  const camera = cameraSessions.map((s) => ({
    pid: String(s.patient_id), t0: Date.parse(String(s.started_at)), t1: Date.parse(String(s.ended_at)),
  }));
  const rows = watchRows
    .map(watchSessionFromRow)
    .filter((w) => weakSide.has(w.patientId) && (w.reps ?? 0) > 0)
    .filter((w) => {
      const t0 = Date.parse(w.startedAt), t1 = Date.parse(w.endedAt);
      return !camera.some((c) => c.pid === w.patientId && t0 <= c.t1 && t1 >= c.t0);
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const groups: (typeof rows)[] = [];
  const open = new Map<string, (typeof rows)>();
  for (const w of rows) {
    const key = w.appSessionId ? `${w.patientId}|app|${w.appSessionId}` : `${w.patientId}|time`;
    const g = open.get(key);
    const last = g?.[g.length - 1];
    if (g && (w.appSessionId || Date.parse(w.startedAt) - Date.parse(last!.endedAt) <= WATCH_GROUP_GAP_MS)) {
      g.push(w);
    } else {
      const ng = [w];
      groups.push(ng);
      open.set(key, ng);
    }
  }

  const sessions: Json[] = [];
  const results: Json[] = [];
  for (const g of groups) {
    const id = `watch-${g[0].sessionId}`;
    const hrs = g.map((w) => w.avgHr).filter((v): v is number => v != null);
    sessions.push({
      id,
      patient_id: g[0].patientId,
      started_at: g[0].startedAt,
      ended_at: g.reduce((m, w) => (w.endedAt > m ? w.endedAt : m), g[0].endedAt),
      pain: null,
      tiredness: null,
      stop_reason: null,
      avg_hr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    });
    // Best round per exercise + side.
    const best = new Map<string, (typeof g)[number]>();
    for (const w of g) {
      const side = !w.arm || w.arm === weakSide.get(w.patientId) ? 'weak' : 'healthy';
      const k = `${w.exercise}|${side}`;
      const prev = best.get(k);
      if (!prev || (w.bestElevationDeg ?? 0) > (prev.bestElevationDeg ?? 0)) best.set(k, w);
    }
    for (const [k, w] of best) {
      const [exercise, side] = k.split('|');
      const dur = Math.max(0, (Date.parse(w.endedAt) - Date.parse(w.startedAt)) / 1000);
      results.push({
        id: `${id}-${exercise}-${side}`,
        session_id: id,
        exercise,
        side,
        best_value: w.bestElevationDeg ?? 0,
        reps: w.reps ?? 0,
        sec_per_rep: w.reps ? Math.round((dur / w.reps) * 10) / 10 : 0,
        smoothness: 1,
        fatigue: 1,
        trunk_lean_max: 0,
        shoulder_hike_max: 0,
        comp_rep_pct: 0,
        reach_cm: null,
        closed_min: null,
      });
    }
  }
  return { sessions, results };
}

export class SupabaseSource implements DataSource {
  readonly mode = 'supabase' as const;
  private listeners = new Set<() => void>();

  constructor(private readonly client: () => Promise<SupabaseClient> = getSupabase) {}

  private async c(): Promise<SupabaseClient> {
    try {
      return await this.client();
    } catch (e) {
      throw toApiError(e);
    }
  }

  private async rpc<T = Json>(name: string, args: object): Promise<T> {
    const c = await this.c();
    return q<T>(c.rpc(name, args) as unknown as Result<T>);
  }

  private changed<T>(v: T): T {
    for (const cb of [...this.listeners]) cb();
    return v;
  }

  private buildSnapshots(
    patients: Json[], sessions: Json[], results: Json[], replays: Json[], watch: Json[], alerts: Json[], plans: Json[],
  ): Snapshot[] {
    const replayRows = replays.map(replayFromRow);
    const keys = replayKeysBySession(replayRows);
    const sessionRows = sessions.map((s) => sessionFromRow(s, keys.get(String(s.id)) ?? []));
    const resultRows = results.map(resultFromRow);
    const sessionPatient = new Map(sessionRows.map((s) => [s.id, s.patientId]));
    const watchRows = watch.map(watchDailyFromRow);
    const alertRows = alerts.map(alertFromRow);
    const planRows = plans.map(planFromRow);
    return patients.map(patientFromRow).map((patient) => ({
      patient,
      sessions: sessionRows.filter((s) => s.patientId === patient.id),
      results: resultRows.filter((r) => sessionPatient.get(r.sessionId ?? '') === patient.id),
      replays: replayRows.filter((r) => sessionPatient.get(r.sessionId) === patient.id),
      watch: watchRows.filter((w) => w.patientId === patient.id),
      alerts: alertRows.filter((a) => a.patientId === patient.id),
      plans: planRows.filter((p) => p.patientId === patient.id),
    }));
  }

  async loadSnapshot(patientId: string): Promise<Snapshot> {
    const c = await this.c();
    const [patient, sessions, results, replays, watch, alerts, plans, watchSessions] = await Promise.all([
      q<Json | null>(c.from('patients').select('*').eq('id', patientId).maybeSingle()),
      q<Json[]>(c.from('sessions').select('*').eq('patient_id', patientId).order('started_at')),
      q<Json[]>(
        c.from('exercise_results').select('*, sessions!inner(patient_id)').eq('sessions.patient_id', patientId).order('id'),
      ),
      q<Json[]>(c.from('session_replays').select('*, sessions!inner(patient_id)').eq('sessions.patient_id', patientId)),
      q<Json[]>(c.from('watch_daily').select('*').eq('patient_id', patientId).order('date')),
      q<Json[]>(c.from('alerts').select('*').eq('patient_id', patientId).order('created_at')),
      q<Json[]>(c.from('plans').select('*').eq('patient_id', patientId).order('created_at')),
      this.watchSessionRows(c, patientId),
    ]);
    if (!patient) throw notFound('Unknown patient');
    const w = watchToSessions(watchSessions, [patient], sessions ?? []);
    const allSessions = [...(sessions ?? []), ...w.sessions].sort((a, b) =>
      String(a.started_at).localeCompare(String(b.started_at)),
    );
    return this.buildSnapshots(
      [patient], allSessions, [...(results ?? []), ...w.results], replays ?? [], watch ?? [], alerts ?? [], plans ?? [],
    )[0];
  }

  /** watch_sessions rows (no trace); [] if the table is unavailable so camera data still loads. */
  private async watchSessionRows(c: SupabaseClient, patientId?: string): Promise<Json[]> {
    try {
      let query = c.from('watch_sessions').select(WATCH_SESSION_COLUMNS).not('session_id', 'like', `${CAMERA_PREFIX}%`);
      if (patientId) query = query.eq('patient_id', patientId);
      return (await q<Json[]>(query.order('started_at') as unknown as Result<Json[]>)) ?? [];
    } catch (e) {
      console.warn('watch_sessions not loaded:', e);
      return [];
    }
  }

  async loadAllSnapshots(): Promise<Snapshot[]> {
    const c = await this.c();
    const [patients, sessions, results, replays, watch, alerts, plans, watchSessions] = await Promise.all([
      q<Json[]>(c.from('patients').select('*').order('name')),
      q<Json[]>(c.from('sessions').select('*').order('started_at')),
      q<Json[]>(c.from('exercise_results').select('*').order('id')),
      q<Json[]>(c.from('session_replays').select('*')),
      q<Json[]>(c.from('watch_daily').select('*').order('date')),
      q<Json[]>(c.from('alerts').select('*').order('created_at')),
      q<Json[]>(c.from('plans').select('*').order('created_at')),
      this.watchSessionRows(c),
    ]);
    const w = watchToSessions(watchSessions, patients ?? [], sessions ?? []);
    const allSessions = [...(sessions ?? []), ...w.sessions].sort((a, b) =>
      String(a.started_at).localeCompare(String(b.started_at)),
    );
    return this.buildSnapshots(
      patients ?? [], allSessions, [...(results ?? []), ...w.results], replays ?? [], watch ?? [], alerts ?? [], plans ?? [],
    );
  }

  async listWatchSessions(patientId: string): Promise<WatchSession[]> {
    const c = await this.c();
    const rows = await q<Json[]>(
      c.from('watch_sessions')
        .select(WATCH_SESSION_COLUMNS)
        .eq('patient_id', patientId)
        .not('session_id', 'like', `${CAMERA_PREFIX}%`)
        .order('started_at', { ascending: false })
        .limit(50) as unknown as Result<Json[]>,
    );
    return (rows ?? []).map(watchSessionFromRow);
  }

  /**
   * Camera Analyze results are stored in watch_sessions (same RPC, same anon key, no schema change) with a
   * "camera-" session id; the full report lives in `trace` ({ source: 'camera', analysis }).
   */
  async saveCameraAnalysis(a: Omit<CameraAnalysis, 'id'>): Promise<void> {
    const best = Math.max(a.shoulder.L?.peakDeg ?? 0, a.shoulder.R?.peakDeg ?? 0);
    await this.rpc('submit_watch_session', {
      sessionId: `${CAMERA_PREFIX}${crypto.randomUUID()}`,
      patientId: a.patientId,
      exercise: a.exercise === 'forward_reach' ? 'forward_reach' : 'arm_raise',
      arm: a.arm,
      startedAt: a.createdAt,
      endedAt: a.createdAt,
      bestElevationDeg: best,
      avgHr: a.heartRate,
      completed: true,
      trace: { source: 'camera', analysis: a },
    });
    this.changed(undefined);
  }

  async listCameraAnalyses(patientId: string): Promise<CameraAnalysis[]> {
    const c = await this.c();
    const rows = await q<Json[]>(
      c.from('watch_sessions')
        .select('session_id, patient_id, started_at, trace')
        .eq('patient_id', patientId)
        .like('session_id', `${CAMERA_PREFIX}%`)
        .order('started_at', { ascending: false })
        .limit(50) as unknown as Result<Json[]>,
    );
    return (rows ?? [])
      .map((r) => {
        const a = (r.trace as Json | null)?.analysis as Omit<CameraAnalysis, 'id'> | undefined;
        return a ? { ...a, id: String(r.session_id), patientId: String(r.patient_id), createdAt: String(r.started_at) } : null;
      })
      .filter((a): a is CameraAnalysis => a !== null);
  }

  async insertSession(body: SessionUploadBody): Promise<{ session: SessionRow; results: ExerciseResult[] }> {
    const r = await this.rpc<{ session: Json; results: Json[]; duplicate?: boolean }>('submit_session', body);
    const out = { session: normSession(r.session), results: (r.results ?? []).map(normResult) };
    return r.duplicate ? out : this.changed(out);
  }

  async putReplay(sessionId: string, replay: ReplayFile, summary: Omit<ReplayRow, 'path' | 'uploadedAt'>): Promise<ReplayRow> {
    const c = await this.c();
    const path = `${sessionId}/${summary.exercise}-${summary.side}.json`;
    const blob = new Blob([JSON.stringify(replay)], { type: 'application/json' });
    await q(c.storage.from('replays').upload(path, blob, { upsert: true, contentType: 'application/json' }));
    const row = await this.rpc('register_replay', {
      sessionId,
      exercise: summary.exercise,
      side: summary.side,
      path,
      fps: summary.fps,
      frameCount: summary.frameCount,
      seconds: summary.seconds,
      warningCount: summary.warningCount,
    });
    return this.changed(normReplay(row));
  }

  async listReplays(sessionId: string): Promise<ReplayRow[]> {
    const c = await this.c();
    const rows = await q<Json[]>(c.from('session_replays').select('*').eq('session_id', sessionId));
    return (rows ?? [])
      .map(replayFromRow)
      .sort((a, b) => a.exercise.localeCompare(b.exercise) || a.side.localeCompare(b.side));
  }

  async readReplay(row: ReplayRow): Promise<ReplayFile> {
    const c = await this.c();
    const { publicUrl } = c.storage.from('replays').getPublicUrl(row.path).data;
    let res: Response;
    try {
      res = await fetch(publicUrl);
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : 'Network error', 0, 'network');
    }
    if (res.status === 404 || res.status === 400) throw notFound('Replay not found');
    if (!res.ok) throw new ApiError(`Replay download failed (${res.status})`, res.status);
    return (await res.json()) as ReplayFile;
  }

  async applyRuleResults(patientId: string, alerts: NewAlert[], plan: NewPlan | null): Promise<RuleResults> {
    const r = await this.rpc<{ alertsCreated: Json[]; planSuggested: Json | null }>('apply_rule_results', {
      p_patient_id: patientId,
      p_alerts: alerts,
      p_plan: plan,
    });
    const out = {
      alertsCreated: (r.alertsCreated ?? []).map(normAlert),
      planSuggested: r.planSuggested ? normPlan(r.planSuggested) : null,
    };
    return out.alertsCreated.length || out.planSuggested ? this.changed(out) : out;
  }

  async ackAlert(id: string): Promise<Alert> {
    return this.changed(normAlert(await this.rpc('ack_alert', { p_alert_id: id })));
  }

  async approvePlan(id: string, body: ApprovePlanBody): Promise<Plan> {
    const p_overrides = omitUndefined({
      phase: body.phase,
      exercises: body.exercises,
      sessionsPerWeek: body.sessionsPerWeek,
      nextCheckin: body.nextCheckin,
    });
    const r = await this.rpc('approve_plan', { p_plan_id: id, p_approved_by: body.approvedBy, p_overrides });
    return this.changed(normPlan(r));
  }

  async dismissPlan(id: string, by?: string): Promise<Plan> {
    const r = await this.rpc('dismiss_plan', { p_plan_id: id, p_dismissed_by: by ?? null });
    return this.changed(normPlan(r));
  }

  async savePlan(patientId: string, body: SavePlanBody): Promise<Plan> {
    const r = await this.rpc('save_plan', { p_patient_id: patientId, p_plan: body, p_approved_by: body.approvedBy });
    return this.changed(normPlan(r));
  }

  async setNextCheckin(patientId: string, date: string): Promise<Patient> {
    return this.changed(normPatient(await this.rpc('set_next_checkin', { p_patient_id: patientId, p_date: date })));
  }

  async submitWatchDaily(body: WatchDailyUpload): Promise<WatchDaily> {
    return this.changed(normWatchDaily(await this.rpc('submit_watch_daily', body)));
  }

  async getWeeklySummary(patientId: string): Promise<WeeklySummary | null> {
    const c = await this.c();
    const rows = await q<Json[]>(
      c.from('patient_summaries')
        .select('*')
        .eq('patient_id', patientId)
        .order('week_start', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1),
    );
    return rows?.[0] ? summaryFromRow(rows[0]) : null;
  }

  async refreshWeeklySummary(patientId: string): Promise<WeeklySummary> {
    const c = await this.c();
    const res = await withTimeout(
      Promise.resolve(c.functions.invoke('weekly-summary', { body: { patientId } })),
      SUMMARY_TIMEOUT_MS,
      'Weekly summary',
    );
    if (res.error) throw toApiError(res.error);
    return this.changed(normSummary(res.data as Json));
  }

  /** `select id from patients limit 1` within `timeoutMs`. */
  async health(timeoutMs = 4000): Promise<{ ok: boolean; error?: string }> {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const probe = (async () => {
      const c = await this.c();
      let query = c.from('patients').select('id').limit(1);
      if (ctrl) query = query.abortSignal(ctrl.signal);
      await q(query);
    })();
    try {
      await withTimeout(probe, timeoutMs, 'Supabase');
      return { ok: true };
    } catch (e) {
      ctrl?.abort();
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
