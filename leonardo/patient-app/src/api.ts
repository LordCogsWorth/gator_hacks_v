// The only place the screens get or save data. Today it uses fake data + localStorage;
// later these functions switch to Supabase and the screens don't change.
import { useEffect, useState } from 'react';
import { fakeLinks, fakeMessages, fakePatient, fakePhysicians, fakePlan, fakeResults, fakeSessions } from './data/fake';
import type { ExerciseId, ExerciseResult, Message, Patient, Physician, PhysicianLink, Plan, Session } from './types';
import type { Joint3D } from './camera/types';

const SESSIONS_KEY = 'rehabtrack.sessions';
const RESULTS_KEY = 'rehabtrack.results';
const REPLAY_KEY = (id: string) => `rehabtrack.replay.${id}`;
const PROFILE_KEY = 'rehabtrack.profile';
const LINKS_KEY = 'rehabtrack.links';
const MESSAGES_KEY = 'rehabtrack.messages';

// Screens that show editable data (name, physicians, messages) re-render when it changes.
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
export function useDataChanges() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
}

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
  try {
    return { ...fakePatient, ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') };
  } catch {
    return fakePatient;
  }
}

export function updateProfile(profile: Pick<Patient, 'name' | 'phone' | 'gender'>) {
  writeLocal(PROFILE_KEY, profile);
  changed();
}

// --- Physicians: the patient sends a request; the physician accepts it on the care dashboard. ---

export function getPhysician(id: string): Physician | undefined {
  return fakePhysicians.find((p) => p.id === id);
}

export function findPhysicianByEmail(email: string): Physician | undefined {
  const e = email.trim().toLowerCase();
  return fakePhysicians.find((p) => p.email.toLowerCase() === e);
}

export function getLinks(): PhysicianLink[] {
  const local = readLocal<PhysicianLink & { removed?: boolean }>(LINKS_KEY);
  const ids = new Set(local.map((l) => l.physician_id));
  return [...fakeLinks.filter((l) => !ids.has(l.physician_id)), ...local].filter((l) => !('removed' in l && l.removed));
}

export function requestPhysician(physicianId: string) {
  const others = readLocal<PhysicianLink>(LINKS_KEY).filter((l) => l.physician_id !== physicianId);
  writeLocal(LINKS_KEY, [...others, { physician_id: physicianId, status: 'pending', requested_at: new Date().toISOString() }]);
  changed();
}

export function removePhysician(physicianId: string) {
  const others = readLocal<PhysicianLink>(LINKS_KEY).filter((l) => l.physician_id !== physicianId);
  writeLocal(LINKS_KEY, [...others, { physician_id: physicianId, status: 'pending', requested_at: '', removed: true }]);
  changed();
}

// --- Messages with connected physicians ---

export function getMessages(physicianId: string): Message[] {
  return [...fakeMessages, ...readLocal<Message>(MESSAGES_KEY)]
    .filter((m) => m.physician_id === physicianId)
    .sort((a, b) => a.sent_at.localeCompare(b.sent_at));
}

function addMessage(m: Omit<Message, 'id' | 'sent_at'>) {
  const msg: Message = { ...m, id: crypto.randomUUID?.() ?? String(Date.now()), sent_at: new Date().toISOString() };
  writeLocal(MESSAGES_KEY, [...readLocal<Message>(MESSAGES_KEY), msg]);
  changed();
}

export function sendMessage(physicianId: string, text: string) {
  addMessage({ physician_id: physicianId, from: 'patient', text });
  // Demo only: until the care dashboard can reply, the physician sends a short automatic answer.
  window.setTimeout(() => {
    addMessage({ physician_id: physicianId, from: 'physician', text: "Thanks for your message. I'll take a look and get back to you today." });
  }, 2500);
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

export interface SessionSummary {
  session: Session;
  /** 1 = the patient's first session. */
  number: number;
  symmetry: Partial<Record<ExerciseId, number>>;
  /** Mean symmetry across the exercises done that session; null if none were finished. */
  average: number | null;
  results: ExerciseResult[];
}

/** Every session, oldest first, with its symmetry % per exercise. */
export function getSessionSummaries(): SessionSummary[] {
  const results = getResults();
  return getSessions().map((session, i) => {
    const mine = results.filter((r) => r.session_id === session.id);
    const symmetry: Partial<Record<ExerciseId, number>> = {};
    for (const ex of new Set(mine.map((r) => r.exercise))) {
      const s = symmetryFor(mine, session.id, ex);
      if (s !== null) symmetry[ex] = s;
    }
    const vals = Object.values(symmetry);
    const average = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    return { session, number: i + 1, symmetry, average, results: mine };
  });
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
