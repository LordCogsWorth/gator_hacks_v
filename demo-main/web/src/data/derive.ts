/** Read-side derivations (port of the Raghav/api/router.js helpers): list summaries, detail, enriched sessions. */
import type { Alert, Exercise, PatientDetailResponse, PatientSummary, Plan, ReplaySummary, Session, Trend } from '../types';
import { avgCompensation, avgSymmetry, currentApprovedPlan, localDayStart, symmetryForExercise } from '../rules/engine';
import { EXERCISES } from '../rules/constants';
import type { ReplayRow, Snapshot } from './source';

export function replayKey(sessionId: string, exercise: Exercise, side: string): string {
  return `${sessionId}-${exercise}-${side}`;
}

/** Replay keys per session, ordered like the SQL (exercise, then side). */
export function replayKeysBySession(replays: ReplayRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of [...replays].sort((a, b) => a.exercise.localeCompare(b.exercise) || a.side.localeCompare(b.side))) {
    const key = replayKey(r.sessionId, r.exercise, r.side);
    const list = map.get(r.sessionId);
    if (list) list.push(key);
    else map.set(r.sessionId, [key]);
  }
  return map;
}

export function replaySummary(row: ReplayRow): ReplaySummary {
  return {
    key: replayKey(row.sessionId, row.exercise, row.side),
    exercise: row.exercise,
    side: row.side,
    fps: row.fps,
    frameCount: row.frameCount,
    seconds: row.seconds,
    warningCount: row.warningCount,
    uploadedAt: row.uploadedAt,
  };
}

/** Monday 00:00 (local) of the week `now` falls in. */
export function startOfWeek(now = new Date()): Date {
  const d = localDayStart(now);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

export function openAlerts(alerts: Alert[], patientId: string): Alert[] {
  return alerts
    .filter((a) => a.patientId === patientId && !a.acknowledged)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The open suggestion (for the detail view), else the approved plan. */
export function currentPlanAny(plans: Plan[], patientId: string): Plan | null {
  const suggested = plans
    .filter((p) => p.patientId === patientId && p.status === 'suggested')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return suggested ?? currentApprovedPlan(plans, patientId);
}

/** Sessions oldest first with results, symmetry, compensation, per-exercise symmetry and replay keys. */
export function enrichSessions(s: Snapshot): Session[] {
  const keys = replayKeysBySession(s.replays);
  const bySession = new Map<string, Snapshot['results']>();
  for (const r of s.results) {
    if (!r.sessionId) continue;
    const list = bySession.get(r.sessionId);
    if (list) list.push(r);
    else bySession.set(r.sessionId, [r]);
  }
  return s.sessions
    .filter((x) => x.patientId === s.patient.id)
    .slice()
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
    .map((row) => {
      const results = bySession.get(row.id) ?? [];
      return {
        ...row,
        stopReason: row.stopReason ?? null,
        replays: keys.get(row.id) ?? [],
        results,
        symmetry: avgSymmetry(results),
        compensation: avgCompensation(results),
        symmetryByExercise: Object.fromEntries(EXERCISES.map((ex) => [ex, symmetryForExercise(results, ex)])) as Record<
          Exercise,
          number | null
        >,
      };
    });
}

/** Latest scored symmetry and the trend vs the previous scored session (safety stops are skipped). */
export function latestSymmetrySummary(sessions: Session[]): { latestSymmetry: number | null; trend: Trend; trendDelta: number } {
  const scored = sessions.map((s) => s.symmetry).filter((v): v is number => v != null);
  if (scored.length === 0) return { latestSymmetry: null, trend: 'none', trendDelta: 0 };
  const last = scored[scored.length - 1];
  if (scored.length === 1) return { latestSymmetry: last, trend: 'none', trendDelta: 0 };
  const delta = last - scored[scored.length - 2];
  const trend: Trend = delta >= 2 ? 'up' : delta <= -2 ? 'down' : 'flat';
  return { latestSymmetry: last, trend, trendDelta: delta };
}

export function patientSummary(s: Snapshot, now = new Date()): PatientSummary {
  const sessions = enrichSessions(s);
  const { latestSymmetry, trend, trendDelta } = latestSymmetrySummary(sessions);
  const open = openAlerts(s.alerts, s.patient.id);
  const plan = currentApprovedPlan(s.plans, s.patient.id);
  const weekStart = startOfWeek(now).getTime();
  return {
    ...s.patient,
    latestSymmetry: latestSymmetry != null ? Math.round(latestSymmetry) : null,
    trend,
    trendDelta: Math.round(trendDelta * 10) / 10,
    openAlertCount: open.length,
    openAlertTypes: [...new Set(open.map((a) => a.type))],
    sessionsThisWeek: sessions.filter((x) => Date.parse(x.startedAt) >= weekStart).length,
    sessionsPerWeek: plan ? plan.sessionsPerWeek : null,
    flagged: open.length > 0,
  };
}

/** Flagged patients first, then by name. */
export function sortSummaries(list: PatientSummary[]): PatientSummary[] {
  return [...list].sort((a, b) => (a.flagged !== b.flagged ? (a.flagged ? -1 : 1) : a.name.localeCompare(b.name)));
}

export function patientDetail(s: Snapshot): PatientDetailResponse {
  return {
    patient: s.patient,
    plan: currentPlanAny(s.plans, s.patient.id),
    approvedPlan: currentApprovedPlan(s.plans, s.patient.id),
    openAlerts: openAlerts(s.alerts, s.patient.id),
  };
}
