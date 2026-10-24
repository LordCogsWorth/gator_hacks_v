/**
 * Replay JSON for LocalSource, in IndexedDB (idb-keyval store 'rehabtrack-replays', key `${sid}-${ex}-${side}`).
 * Falls back to memory where IndexedDB is missing (tests, some private modes).
 */
import { clear, createStore, del, entries, get, set, type UseStore } from 'idb-keyval';
import type { ReplayFile } from '../../types';

interface Stored {
  savedAt: number;
  replay: ReplayFile;
}

const memory = new Map<string, Stored>();
let store: UseStore | null | undefined;

function idb(): UseStore | null {
  if (store === undefined) {
    store = typeof indexedDB === 'undefined' ? null : createStore('rehabtrack-replays', 'replays');
  }
  return store;
}

function isQuotaError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'QuotaExceededError' || /quota/i.test(e.message));
}

/** Delete the oldest half of the stored replays (seeded replays are synthetic and never stored). */
async function evictOldest(s: UseStore): Promise<void> {
  const all = (await entries<string, Stored>(s)).sort((a, b) => (a[1]?.savedAt ?? 0) - (b[1]?.savedAt ?? 0));
  for (const [key] of all.slice(0, Math.max(1, Math.floor(all.length / 2)))) await del(key, s);
}

export async function putReplayFile(key: string, replay: ReplayFile): Promise<void> {
  const value: Stored = { savedAt: Date.now(), replay };
  const s = idb();
  if (!s) {
    memory.set(key, value);
    return;
  }
  try {
    await set(key, value, s);
  } catch (e) {
    if (!isQuotaError(e)) throw e;
    await evictOldest(s);
    await set(key, value, s);
  }
}

export async function getReplayFile(key: string): Promise<ReplayFile | null> {
  const s = idb();
  const v = s ? await get<Stored>(key, s) : memory.get(key);
  return v?.replay ?? null;
}

export async function clearReplayFiles(): Promise<void> {
  memory.clear();
  const s = idb();
  if (s) await clear(s);
}
