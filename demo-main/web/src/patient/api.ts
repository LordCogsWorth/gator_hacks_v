// The patient app's data layer, built on the shared API facade (../api.ts).
import { getPatient, getPatientSessions, postSession, uploadReplay } from '../api';
import { symmetryForExercise } from '../rules/engine';
import type { Exercise, ExerciseResult, Patient, Plan, ReplayFile, Session, SessionUploadResponse, StopReason } from '../types';

export interface PatientSnapshot {
  patient: Patient;
  /** Today's approved plan; null when the care team hasn't approved one yet. */
  plan: Plan | null;
  /** Every session, oldest first. */
  sessions: Session[];
}

export async function loadPatientSnapshot(patientId: string): Promise<PatientSnapshot> {
  const [detail, sessions] = await Promise.all([getPatient(patientId), getPatientSessions(patientId)]);
  return { patient: detail.patient, plan: detail.approvedPlan ?? null, sessions };
}

export interface SaveInput {
  /** Idempotency key: retrying with the same key returns the already-saved session. */
  clientKey?: string;
  patientId: string;
  startedAt: string;
  endedAt: string;
  pain: number | null;
  tiredness: number | null;
  /** Set for a safety stop; then results may be empty. */
  stopReason?: StopReason;
  results: ExerciseResult[];
  replays: ReplayFile[];
}

export interface SaveOutcome {
  response: SessionUploadResponse;
  replaysSent: number;
  replaysTotal: number;
}

/** Save the session, then one replay per round. Rejects only if the session itself fails. */
export async function saveSession(input: SaveInput): Promise<SaveOutcome> {
  const response = await postSession({
    clientKey: input.clientKey,
    patientId: input.patientId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    pain: input.pain,
    tiredness: input.tiredness,
    stopReason: input.stopReason ?? null,
    results: input.results,
  });
  // Replays are extra: the session is already saved even if one fails.
  let replaysSent = 0;
  for (const replay of input.replays) {
    try {
      await uploadReplay(response.session.id, replay);
      replaysSent++;
    } catch (e) {
      console.warn(`Replay ${replay.exercise}/${replay.side} not sent:`, e);
    }
  }
  return { response, replaysSent, replaysTotal: input.replays.length };
}

/** Weak arm best ÷ healthy arm best × 100 for one exercise, rounded for display. */
export function symmetryFor(results: ExerciseResult[], exercise: Exercise): number | null {
  const value = symmetryForExercise(results, exercise);
  return value == null ? null : Math.round(value);
}

export interface SessionSummary {
  session: Session;
  /** 1 = the patient's first session. */
  number: number;
  symmetry: Partial<Record<Exercise, number>>;
  /** Mean symmetry across the exercises done that session; null if none were finished (e.g. a safety stop). */
  average: number | null;
}

/** Every session, oldest first, with its symmetry % per exercise (from the API's computed values). */
export function summarize(sessions: Session[]): SessionSummary[] {
  return sessions.map((session, i) => {
    const symmetry: Partial<Record<Exercise, number>> = {};
    for (const [ex, v] of Object.entries(session.symmetryByExercise ?? {}) as [Exercise, number | null][]) {
      if (v != null) symmetry[ex] = Math.round(v);
    }
    const average = session.symmetry != null ? Math.round(session.symmetry) : null;
    return { session, number: i + 1, symmetry, average };
  });
}

/** About a week (6+ days) before now: the comparison point for "up from X% last week". */
export const WEEK_AGO_MS = 6 * 86_400_000;

/** The latest session at least 6 days old that has a symmetry for `exercise` (or overall when omitted). */
export function weekAgoSummary(summaries: SessionSummary[], exercise?: Exercise): SessionSummary | undefined {
  return [...summaries]
    .reverse()
    .find(
      (s) =>
        Date.now() - new Date(s.session.startedAt).getTime() >= WEEK_AGO_MS &&
        (exercise ? s.symmetry[exercise] !== undefined : s.average !== null),
    );
}

/** Days in a row with a session, counting back from today (or yesterday if not done yet today). */
export function streakDays(sessions: Session[]): number {
  const days = new Set(sessions.map((s) => new Date(s.startedAt).toDateString()));
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(d.toDateString())) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function daysUntil(isoDate: string): number {
  const target = new Date(isoDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export const firstName = (name: string) => name.split(/\s+/)[0] || name;
