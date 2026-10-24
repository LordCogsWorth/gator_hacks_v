/**
 * The in-browser database behind LocalSource: one JSON document in localStorage['rehabtrack.db.v1'].
 * - Seeded from seed/generate.ts on first load, and re-seeded automatically when the day changes
 *   (the demo story is relative to "today").
 * - Writes run inside navigator.locks 'rehabtrack-db' (re-read, mutate, save), then post {type:'changed'} on
 *   BroadcastChannel('rehabtrack') so every window refetches at once.
 */
import type { Alert, ExerciseResult, Patient, Plan, WatchDaily, WatchSession, WeeklySummary } from '../../types';
import type { ReplayRow, SessionRow } from '../source';
import { generateDemoData } from '../seed/generate';
import { localDate } from '../validate';
import { clearReplayFiles } from './replayStore';

export const DB_KEY = 'rehabtrack.db.v1';
const LOCK_NAME = 'rehabtrack-db';
const CHANNEL_NAME = 'rehabtrack';

export interface StoredSession extends SessionRow {
  clientKey: string | null;
  createdAt: string;
}
export interface StoredWatch extends WatchDaily {
  updatedAt: string;
}

export interface DbState {
  version: 1;
  /** Local date the data was generated for. */
  seededOn: string;
  seq: number;
  patients: Patient[];
  plans: Plan[];
  sessions: StoredSession[];
  results: ExerciseResult[];
  replays: ReplayRow[];
  watch: StoredWatch[];
  watchSessions: WatchSession[];
  alerts: Alert[];
  summaries: WeeklySummary[];
}

export function seedDb(now = new Date()): DbState {
  const d = generateDemoData(now);
  return {
    version: 1,
    seededOn: localDate(now),
    seq: 0,
    patients: d.patients,
    plans: d.plans,
    sessions: d.sessions.map((s) => ({ ...s, clientKey: null, createdAt: s.endedAt })),
    results: d.results,
    replays: d.replays,
    watch: d.watch.map((w) => ({ ...w, updatedAt: `${w.date}T21:00:00.000Z` })),
    watchSessions: d.watchSessions,
    alerts: d.alerts,
    summaries: d.summaries,
  };
}

// localStorage can be missing or throw (private mode, quota): fall back to memory for this tab.
let memoryRaw: string | null = null;
function loadRaw(): string | null {
  try {
    return localStorage.getItem(DB_KEY);
  } catch {
    return memoryRaw;
  }
}
function saveRaw(raw: string): void {
  memoryRaw = raw;
  try {
    localStorage.setItem(DB_KEY, raw);
  } catch (e) {
    console.warn('[rehabtrack] localStorage write failed; keeping data in memory for this tab', e);
  }
}

function isDb(v: unknown, today: string): v is DbState {
  const db = v as DbState | null;
  return !!db && db.version === 1 && db.seededOn === today && Array.isArray(db.patients) && Array.isArray(db.sessions);
}

function reseed(now: Date): DbState {
  const db = seedDb(now);
  saveRaw(JSON.stringify(db));
  void clearReplayFiles().catch(() => {});
  return db;
}

/** The current database (a fresh copy). Re-seeds when missing, unreadable or from another day. */
export function readDb(now = new Date()): DbState {
  const raw = loadRaw();
  const today = localDate(now);
  if (raw) {
    try {
      const db: unknown = JSON.parse(raw);
      if (isDb(db, today)) return db;
    } catch {
      /* re-seed below */
    }
  }
  return reseed(now);
}

async function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.request) return locks.request(LOCK_NAME, () => fn()) as Promise<T>;
  return fn();
}

/**
 * Run `mutate` on a fresh copy inside the lock and save it. If `mutate` throws, nothing is saved.
 * Listeners are notified unless `changed(result)` says nothing changed.
 */
export async function writeDb<T>(mutate: (db: DbState) => T, changed?: (result: T) => boolean): Promise<T> {
  const result = await withLock(() => {
    const db = readDb();
    const r = mutate(db);
    if (!changed || changed(r)) saveRaw(JSON.stringify(db));
    return r;
  });
  if (!changed || changed(result)) notifyChanged();
  return result;
}

/** Re-seed synchronously (for `?reset=1` before the first read); replay files are cleared in the background. */
export function reseedNow(): void {
  reseed(new Date());
  notifyChanged();
}

export async function resetDb(): Promise<void> {
  await withLock(async () => {
    saveRaw(JSON.stringify(seedDb()));
    await clearReplayFiles().catch(() => {});
  });
  notifyChanged();
}

/** Unique id within this database: `<prefix>-<time><seq>`. */
export function nextId(db: DbState, prefix: string): string {
  db.seq += 1;
  return `${prefix}-${Date.now().toString(36)}${db.seq.toString(36)}`;
}

// ---- change notifications ----

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof BroadcastChannel === 'undefined') return (channel = null);
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    // Node (tests): don't keep the process alive.
    (channel as unknown as { unref?: () => void }).unref?.();
    channel.onmessage = (e: MessageEvent) => {
      if (e.data && (e.data as { type?: string }).type === 'changed') emit();
    };
  } catch {
    channel = null;
  }
  return channel;
}

function emit() {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch (e) {
      console.error(e);
    }
  }
}

/** Tell this tab and every other window that the data changed. */
export function notifyChanged(): void {
  emit();
  getChannel()?.postMessage({ type: 'changed' });
}

export function subscribe(cb: () => void): () => void {
  getChannel();
  listeners.add(cb);
  return () => listeners.delete(cb);
}
