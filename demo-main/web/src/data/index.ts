/**
 * Picks the data source once per page load (CONVERGENCE_PLAN §3 "Choosing the mode"):
 *   1. `?data=local|supabase` in the URL (remembered for the tab in sessionStorage 'rehabtrack.data');
 *   2. else VITE_DATA_SOURCE = local | supabase | auto (default auto);
 *   3. auto = Supabase when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are both set, else local.
 * There is no silent fallback: in Supabase mode the UI runs `healthCheck()` and offers `switchToOfflineData()`.
 */
import type { DataMode } from '../types';
import type { DataSource } from './source';
import { LocalSource, handleResetParam } from './local/LocalSource';
import { SupabaseSource } from './supabase/SupabaseSource';
import { supabaseConfig } from './supabase/client';

export const DATA_MODE_KEY = 'rehabtrack.data';
export const HEALTH_TIMEOUT_MS = 4000;

export interface HealthResult {
  ok: boolean;
  mode: DataMode;
  /** Why the probe failed (Supabase mode only). */
  error?: string;
}

const isMode = (v: unknown): v is DataMode => v === 'local' || v === 'supabase';

function readSession(): string | null {
  try {
    return sessionStorage.getItem(DATA_MODE_KEY);
  } catch {
    return null;
  }
}
function writeSession(mode: DataMode): void {
  try {
    sessionStorage.setItem(DATA_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** The mode this page should use (pure apart from reading the URL, sessionStorage and env). */
export function resolveDataMode(): DataMode {
  const configured = supabaseConfig() !== null;
  let wanted: DataMode | null = null;
  if (typeof window !== 'undefined') {
    const param = new URLSearchParams(window.location.search).get('data');
    if (isMode(param)) {
      writeSession(param);
      wanted = param;
    } else {
      const stored = readSession();
      if (isMode(stored)) wanted = stored;
    }
  }
  if (!wanted) {
    const env = (import.meta.env.VITE_DATA_SOURCE ?? 'auto').trim();
    wanted = isMode(env) ? env : configured ? 'supabase' : 'local';
  }
  if (wanted === 'supabase' && !configured) {
    console.warn('[rehabtrack] Supabase mode requested but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set; using offline demo data.');
    return 'local';
  }
  return wanted;
}

let current: DataSource | null = null;

/** The singleton data source for this page. */
export function getSource(): DataSource {
  if (!current) {
    const mode = resolveDataMode();
    if (mode === 'local') handleResetParam();
    current = mode === 'supabase' ? new SupabaseSource() : new LocalSource();
  }
  return current;
}

/** Tests only: swap the singleton (null = choose again on next use). */
export function setSourceForTests(source: DataSource | null): void {
  current = source;
}

export function dataMode(): DataMode {
  return getSource().mode;
}

/** Called after any data change (this tab; other tabs too in local mode). Returns an unsubscribe. */
export function onDataChange(cb: () => void): () => void {
  return getSource().subscribe(cb);
}

/** Local: always ok. Supabase: `select id from patients limit 1` with a 4 s timeout. */
export async function healthCheck(timeoutMs = HEALTH_TIMEOUT_MS): Promise<HealthResult> {
  const source = getSource();
  if (source instanceof SupabaseSource) return { mode: 'supabase', ...(await source.health(timeoutMs)) };
  return { ok: true, mode: source.mode };
}

/** The current URL switched to offline demo data (`?data=local`). */
export function offlineDataUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set('data', 'local');
  return url.toString();
}

/** Reload this page on offline demo data (the "Use offline demo data" button). */
export function switchToOfflineData(): void {
  writeSession('local');
  window.location.assign(offlineDataUrl());
}
