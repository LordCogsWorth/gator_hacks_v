/**
 * Online data source: reads are table SELECTs (anon, RLS demo read), writes are the SECURITY DEFINER RPCs in
 * supabase/migrations/0001_init.sql. Ingest RPCs (submit_session, submit_watch_daily, register_replay) take the
 * body itself; the others take p_… named arguments.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Alert,
  ApprovePlanBody,
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
    const [patient, sessions, results, replays, watch, alerts, plans] = await Promise.all([
      q<Json | null>(c.from('patients').select('*').eq('id', patientId).maybeSingle()),
      q<Json[]>(c.from('sessions').select('*').eq('patient_id', patientId).order('started_at')),
      q<Json[]>(
        c.from('exercise_results').select('*, sessions!inner(patient_id)').eq('sessions.patient_id', patientId).order('id'),
      ),
      q<Json[]>(c.from('session_replays').select('*, sessions!inner(patient_id)').eq('sessions.patient_id', patientId)),
      q<Json[]>(c.from('watch_daily').select('*').eq('patient_id', patientId).order('date')),
      q<Json[]>(c.from('alerts').select('*').eq('patient_id', patientId).order('created_at')),
      q<Json[]>(c.from('plans').select('*').eq('patient_id', patientId).order('created_at')),
    ]);
    if (!patient) throw notFound('Unknown patient');
    return this.buildSnapshots([patient], sessions ?? [], results ?? [], replays ?? [], watch ?? [], alerts ?? [], plans ?? [])[0];
  }

  async loadAllSnapshots(): Promise<Snapshot[]> {
    const c = await this.c();
    const [patients, sessions, results, replays, watch, alerts, plans] = await Promise.all([
      q<Json[]>(c.from('patients').select('*').order('name')),
      q<Json[]>(c.from('sessions').select('*').order('started_at')),
      q<Json[]>(c.from('exercise_results').select('*').order('id')),
      q<Json[]>(c.from('session_replays').select('*')),
      q<Json[]>(c.from('watch_daily').select('*').order('date')),
      q<Json[]>(c.from('alerts').select('*').order('created_at')),
      q<Json[]>(c.from('plans').select('*').order('created_at')),
    ]);
    return this.buildSnapshots(patients ?? [], sessions ?? [], results ?? [], replays ?? [], watch ?? [], alerts ?? [], plans ?? []);
  }

  async listWatchSessions(patientId: string): Promise<WatchSession[]> {
    const c = await this.c();
    const rows = await q<Json[]>(
      c.from('watch_sessions')
        .select(WATCH_SESSION_COLUMNS)
        .eq('patient_id', patientId)
        .order('started_at', { ascending: false })
        .limit(50) as unknown as Result<Json[]>,
    );
    return (rows ?? []).map(watchSessionFromRow);
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
