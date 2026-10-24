// The only place the screens get or save data. Today it uses fake data + localStorage;
// later these functions switch to Supabase and the screens don't change.
import { fakePatient, fakePlan, fakeResults, fakeSessions } from './data/fake';
import type { ExerciseId, ExerciseResult, Patient, Plan, Session } from './types';
import type { Joint3D } from './camera/types';

const SESSIONS_KEY = 'rehabtrack.sessions';
const RESULTS_KEY = 'rehabtrack.results';
const REPLAY_KEY = (id: string) => `rehabtrack.replay.${id}`;

function readLocal<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function getPatient(): Patient {
  return fakePatient;
}

export function getCurrentPlan(): Plan {
  return fakePlan;
}

export function getSessions(): Session[] {
  return [...fakeSessions, ...readLocal<Session>(SESSIONS_KEY)].sort((a, b) => a.started_at.localeCompare(b.started_at));
}

export function getResults(): ExerciseResult[] {
  return [...fakeResults, ...readLocal<ExerciseResult>(RESULTS_KEY)];
}

export async function saveSession(session: Session, results: ExerciseResult[], replay: Joint3D[][]): Promise<void> {
  writeLocal(SESSIONS_KEY, [...readLocal<Session>(SESSIONS_KEY), session]);
  writeLocal(RESULTS_KEY, [...readLocal<ExerciseResult>(RESULTS_KEY), ...results]);
  // Replay can be large; it goes to Supabase Storage later. Locally, skip it if it doesn't fit.
  if (replay.length) writeLocal(REPLAY_KEY(session.id), replay);
}

/** Weak arm best ÷ healthy arm best × 100 for one exercise in one session. */
export function symmetryFor(results: ExerciseResult[], sessionId: string, exercise: ExerciseId): number | null {
  const healthy = results.find((r) => r.session_id === sessionId && r.exercise === exercise && r.side === 'healthy');
  const weak = results.find((r) => r.session_id === sessionId && r.exercise === exercise && r.side === 'weak');
  if (!healthy || !weak || healthy.best_value <= 0) return null;
  return Math.round((weak.best_value / healthy.best_value) * 100);
}

/** Days in a row with a session, counting back from today (or yesterday if not done yet today). */
export function streakDays(sessions: Session[]): number {
  const days = new Set(sessions.map((s) => new Date(s.started_at).toDateString()));
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
