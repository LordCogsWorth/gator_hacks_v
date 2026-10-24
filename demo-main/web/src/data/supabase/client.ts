/** Lazy supabase-js client from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (the library loads only in Supabase mode). */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function supabaseConfig(): SupabaseConfig | null {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  return url && anonKey ? { url, anonKey } : null;
}

let clientPromise: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  if (!clientPromise) {
    const cfg = supabaseConfig();
    if (!cfg) return Promise.reject(new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set'));
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) =>
        createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
      )
      .catch((e) => {
        clientPromise = null;
        throw e;
      });
  }
  return clientPromise;
}
