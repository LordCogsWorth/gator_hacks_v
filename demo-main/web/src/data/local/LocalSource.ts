/**
 * Offline data source: the in-browser database (local/db.ts) + IndexedDB replays. Write semantics mirror the
 * SQL RPCs in supabase/migrations/0001_init.sql (same validation, transitions and ApiError codes).
 */
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
import { conflict, notFound } from '../errors';
import { replayKey, replayKeysBySession } from '../derive';
import type { DataSource, NewAlert, NewPlan, ReplayRow, RuleResults, SessionRow, Snapshot } from '../source';
import {
  assertValid,
  localDate,
  mergeWatchDaily,
  validateApproval,
  validateDismissedBy,
  validateNextCheckin,
  validateSavePlan,
  validateSession,
  validateWatchDaily,
} from '../validate';
import {
  nextId,
  readDb,
  reseedNow,
  resetDb,
  subscribe,
  writeDb,
  type DbState,
  type StoredSession,
  type StoredWatch,
} from './db';
import { getReplayFile, putReplayFile } from './replayStore';

const OVERLAP_MS = 5 * 60_000;

function toSessionRow(s: StoredSession, keys: Map<string, string[]>): SessionRow {
  return {
    id: s.id,
    patientId: s.patientId,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    pain: s.pain,
    tiredness: s.tiredness,
    stopReason: s.stopReason ?? null,
    avgHr: s.avgHr,
    replays: keys.get(s.id) ?? [],
  };
}

function toWatchDaily(w: StoredWatch): WatchDaily {
  const { updatedAt: _updatedAt, ...row } = w;
  return row;
}

function requirePatient(db: DbState, id: string): Patient {
  const p = db.patients.find((x) => x.id === id);
  if (!p) throw notFound('Unknown patient');
  return p;
}

function snapshotOf(db: DbState, patient: Patient): Snapshot {
  const sessions = db.sessions.filter((s) => s.patientId === patient.id);
  const ids = new Set(sessions.map((s) => s.id));
  const replays = db.replays.filter((r) => ids.has(r.sessionId));
  const keys = replayKeysBySession(replays);
  return {
    patient,
    sessions: sessions.map((s) => toSessionRow(s, keys)).sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    results: db.results.filter((r) => r.sessionId && ids.has(r.sessionId)),
    replays,
    watch: db.watch
      .filter((w) => w.patientId === patient.id)
      .map(toWatchDaily)
      .sort((a, b) => a.date.localeCompare(b.date)),
    alerts: db.alerts.filter((a) => a.patientId === patient.id),
    plans: db.plans.filter((p) => p.patientId === patient.id),
  };
}

function sessionResult(db: DbState, s: StoredSession) {
  const keys = replayKeysBySession(db.replays.filter((r) => r.sessionId === s.id));
  return { session: toSessionRow(s, keys), results: db.results.filter((r) => r.sessionId === s.id) };
}

function findPlan(db: DbState, id: string): Plan {
  const plan = db.plans.find((p) => p.id === id);
  if (!plan) throw notFound('Unknown plan');
  return plan;
}

function supersedeApproved(db: DbState, patientId: string, at: string) {
  for (const p of db.plans) {
    if (p.patientId === patientId && p.status === 'approved') {
      p.status = 'superseded';
      p.supersededAt = at;
    }
  }
}

const earliest = (iso: string | undefined, now: string) => (iso && iso < now ? new Date(iso).toISOString() : now);

export class LocalSource implements DataSource {
  readonly mode = 'local' as const;

  async loadSnapshot(patientId: string): Promise<Snapshot> {
    const db = readDb();
    return snapshotOf(db, requirePatient(db, patientId));
  }

  async loadAllSnapshots(): Promise<Snapshot[]> {
    const db = readDb();
    return db.patients.map((p) => snapshotOf(db, p));
  }

  async listWatchSessions(patientId: string): Promise<WatchSession[]> {
    return readDb()
      .watchSessions.filter((w) => w.patientId === patientId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 50);
  }

  async insertSession(body: SessionUploadBody): Promise<{ session: SessionRow; results: ExerciseResult[] }> {
    const v = assertValid(validateSession(body), 'Invalid session');
    return writeDb(
      (db) => {
        requirePatient(db, v.patientId);
        if (v.clientKey) {
          const existing = db.sessions.find((s) => s.clientKey === v.clientKey);
          if (existing) {
            if (existing.patientId !== v.patientId) throw conflict('clientKey belongs to another patient');
            return { ...sessionResult(db, existing), duplicate: true };
          }
        }
        // The watch may have uploaded first: take its heart rate from overlapping watch sessions.
        const t0 = Date.parse(v.startedAt) - OVERLAP_MS;
        const t1 = Date.parse(v.endedAt) + OVERLAP_MS;
        const hrs = db.watchSessions
          .filter(
            (w) =>
              w.patientId === v.patientId &&
              w.avgHr != null &&
              w.avgHr >= 30 &&
              w.avgHr <= 220 &&
              Date.parse(w.startedAt) <= t1 &&
              Date.parse(w.endedAt) >= t0,
          )
          .map((w) => w.avgHr as number);
        const session: StoredSession = {
          id: nextId(db, 'sess'),
          patientId: v.patientId,
          clientKey: v.clientKey,
          startedAt: v.startedAt,
          endedAt: v.endedAt,
          pain: v.pain,
          tiredness: v.tiredness,
          stopReason: v.stopReason,
          avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
          replays: [],
          createdAt: new Date().toISOString(),
        };
        db.sessions.push(session);
        for (const r of v.results) db.results.push({ ...r, id: String(++db.seq), sessionId: session.id });
        return { ...sessionResult(db, session), duplicate: false };
      },
      (r) => !r.duplicate,
    ).then(({ session, results }) => ({ session, results }));
  }

  async putReplay(sessionId: string, replay: ReplayFile, summary: Omit<ReplayRow, 'path' | 'uploadedAt'>): Promise<ReplayRow> {
    if (!readDb().sessions.some((s) => s.id === sessionId)) throw notFound('Unknown session');
    const key = replayKey(sessionId, summary.exercise, summary.side);
    await putReplayFile(key, replay);
    return writeDb((db) => {
      if (!db.sessions.some((s) => s.id === sessionId)) throw notFound('Unknown session');
      const row: ReplayRow = {
        ...summary,
        sessionId,
        path: `${sessionId}/${summary.exercise}-${summary.side}.json`,
        uploadedAt: new Date().toISOString(),
      };
      const i = db.replays.findIndex((r) => r.sessionId === sessionId && r.exercise === row.exercise && r.side === row.side);
      if (i >= 0) db.replays[i] = row;
      else db.replays.push(row);
      return row;
    });
  }

  async listReplays(sessionId: string): Promise<ReplayRow[]> {
    return readDb()
      .replays.filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.exercise.localeCompare(b.exercise) || a.side.localeCompare(b.side));
  }

  async readReplay(row: ReplayRow): Promise<ReplayFile> {
    const file = await getReplayFile(replayKey(row.sessionId, row.exercise, row.side));
    if (!file) throw notFound('Replay not found');
    return file;
  }

  async applyRuleResults(patientId: string, alerts: NewAlert[], plan: NewPlan | null): Promise<RuleResults> {
    if (alerts.length === 0 && !plan) {
      requirePatient(readDb(), patientId);
      return { alertsCreated: [], planSuggested: null };
    }
    return writeDb(
      (db) => {
        requirePatient(db, patientId);
        const now = new Date().toISOString();
        const alertsCreated: Alert[] = [];
        for (const a of alerts) {
          if (db.alerts.some((x) => x.patientId === patientId && x.type === a.type && !x.acknowledged)) continue;
          const alert: Alert = {
            id: nextId(db, 'al'),
            patientId,
            type: a.type,
            detail: a.detail.slice(0, 500),
            createdAt: earliest(a.createdAt, now),
            acknowledged: false,
          };
          db.alerts.push(alert);
          alertsCreated.push(alert);
        }
        let planSuggested: Plan | null = null;
        if (plan && !db.plans.some((p) => p.patientId === patientId && p.status === 'suggested')) {
          const clean = assertValid(
            validateSavePlan({ ...plan, approvedBy: 'rules' }),
            'Invalid plan suggestion',
          );
          planSuggested = {
            id: nextId(db, 'plan'),
            patientId,
            phase: clean.phase,
            exercises: clean.exercises,
            sessionsPerWeek: clean.sessionsPerWeek,
            status: 'suggested',
            approvedBy: null,
            nextCheckin: clean.nextCheckin,
            createdAt: earliest(plan.createdAt, now),
            ...(plan.kind ? { kind: plan.kind } : {}),
            ...(plan.reason ? { reason: plan.reason.slice(0, 500) } : {}),
            ...(plan.basedOn ? { basedOn: plan.basedOn } : {}),
          };
          db.plans.push(planSuggested);
        }
        return { alertsCreated, planSuggested };
      },
      (r) => r.alertsCreated.length > 0 || r.planSuggested !== null,
    );
  }

  async ackAlert(id: string): Promise<Alert> {
    return writeDb((db) => {
      const alert = db.alerts.find((a) => a.id === id);
      if (!alert) throw notFound('Unknown alert');
      alert.acknowledged = true;
      alert.acknowledgedAt ??= new Date().toISOString();
      return { ...alert };
    });
  }

  async approvePlan(id: string, body: ApprovePlanBody): Promise<Plan> {
    const v = assertValid(validateApproval(body), 'Invalid plan approval');
    return writeDb((db) => {
      const plan = findPlan(db, id);
      if (plan.status !== 'suggested') throw conflict(`Plan is ${plan.status}, not suggested`);
      const now = new Date().toISOString();
      supersedeApproved(db, plan.patientId, now);
      plan.status = 'approved';
      plan.approvedAt = now;
      plan.approvedBy = v.approvedBy;
      if (v.phase !== undefined) plan.phase = v.phase;
      if (v.exercises !== undefined) plan.exercises = v.exercises;
      if (v.sessionsPerWeek !== undefined) plan.sessionsPerWeek = v.sessionsPerWeek;
      if (v.nextCheckin !== undefined) plan.nextCheckin = v.nextCheckin;
      const patient = db.patients.find((p) => p.id === plan.patientId);
      if (patient) {
        patient.phase = plan.phase;
        patient.nextCheckin = plan.nextCheckin;
      }
      return { ...plan };
    });
  }

  async dismissPlan(id: string, by?: string): Promise<Plan> {
    const who = assertValid(validateDismissedBy(by ?? null), 'Invalid dismissal');
    return writeDb((db) => {
      const plan = findPlan(db, id);
      if (plan.status !== 'suggested') throw conflict(`Plan is ${plan.status}, not suggested`);
      plan.status = 'dismissed';
      plan.dismissedAt = new Date().toISOString();
      if (who) plan.dismissedBy = who;
      else delete plan.dismissedBy;
      return { ...plan };
    });
  }

  async savePlan(patientId: string, body: SavePlanBody): Promise<Plan> {
    const v = assertValid(validateSavePlan(body), 'Invalid plan');
    return writeDb((db) => {
      const patient = requirePatient(db, patientId);
      const now = new Date().toISOString();
      supersedeApproved(db, patientId, now);
      for (const p of db.plans) {
        if (p.patientId === patientId && p.status === 'suggested') {
          p.status = 'dismissed';
          p.dismissedAt = now;
          p.dismissedBy = v.approvedBy;
        }
      }
      const plan: Plan = {
        id: nextId(db, 'plan'),
        patientId,
        phase: v.phase,
        exercises: v.exercises,
        sessionsPerWeek: v.sessionsPerWeek,
        status: 'approved',
        approvedBy: v.approvedBy,
        approvedAt: now,
        nextCheckin: v.nextCheckin,
        createdAt: now,
      };
      db.plans.push(plan);
      patient.phase = v.phase;
      patient.nextCheckin = v.nextCheckin;
      return { ...plan };
    });
  }

  async setNextCheckin(patientId: string, date: string): Promise<Patient> {
    return writeDb((db) => {
      const patient = requirePatient(db, patientId);
      const d = assertValid(validateNextCheckin(date, localDate()), 'Invalid check-in date');
      patient.nextCheckin = d;
      for (const p of db.plans) if (p.patientId === patientId && p.status === 'approved') p.nextCheckin = d;
      return { ...patient };
    });
  }

  async submitWatchDaily(body: WatchDailyUpload): Promise<WatchDaily> {
    const v = assertValid(validateWatchDaily(body), 'Invalid watch daily data');
    return writeDb((db) => {
      requirePatient(db, v.patientId);
      const i = db.watch.findIndex((w) => w.patientId === v.patientId && w.date === v.date);
      const prev = i >= 0 ? db.watch[i] : undefined;
      const row: StoredWatch = {
        ...mergeWatchDaily(prev, prev?.id ?? String(++db.seq), v.patientId, v.date, v.fields),
        updatedAt: new Date().toISOString(),
      };
      if (i >= 0) db.watch[i] = row;
      else db.watch.push(row);
      return toWatchDaily(row);
    });
  }

  async getWeeklySummary(patientId: string): Promise<WeeklySummary | null> {
    return (
      readDb()
        .summaries.filter((s) => s.patientId === patientId)
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  reset(): Promise<void> {
    return resetDb();
  }

  subscribe(cb: () => void): () => void {
    return subscribe(cb);
  }
}

/** `?reset=1` in the URL re-seeds once, then drops the parameter so a reload doesn't reset again. */
export function handleResetParam(): boolean {
  if (typeof window === 'undefined') return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get('reset') !== '1') return false;
  url.searchParams.delete('reset');
  window.history.replaceState(window.history.state, '', url.toString());
  reseedNow();
  return true;
}
