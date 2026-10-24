// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: weekly-summary (Deno).
// Ported from stuti/server/public/gemma-server.mjs (gemma() + guardrails).
//
// POST {patientId} -> reads the last 14 days with the service-role client, asks Gemma
// for two plain sentences for the therapist, stores them with rpc upsert_summary,
// and returns the WeeklySummary row (camelCase, web/src/types.ts).
//
// Secrets / env:
//   GOOGLE_API_KEY            required (Google AI Studio key)   supabase secrets set GOOGLE_API_KEY=...
//   GEMMA_MODEL               optional, default gemma-4-26b-a4b-it (must start with "gemma")
//   ALLOWED_ORIGIN            optional, comma-separated app origins for CORS (default: no CORS header)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by Supabase automatically
//
// Deploy: supabase functions deploy weekly-summary

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const API_MODEL = Deno.env.get('GEMMA_MODEL') || 'gemma-4-26b-a4b-it';
const FALLBACKS = ['gemma-4-31b-it'];
const MIN_SECONDS_BETWEEN_CALLS = 60; // cheap protection for the API quota
const DAY_MS = 86_400_000;

type Json = Record<string, unknown>;

function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGIN') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('Origin') || '';
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function reply(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

const round = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Monday of the current UTC week, YYYY-MM-DD. */
function weekStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Instructions go in the user message because Gemma models do not reliably accept a system role.
const prompt = (data: Json) => `You are helping a physiotherapist review two weeks of stroke-rehabilitation home exercise data.
All numbers below were measured by software. Do not recalculate or invent numbers, and do not diagnose.
symmetryPct = weak arm as % of the healthy arm (average of arm raise, forward reach, hand opening).
compensationPct = % of weak-arm reps with trunk lean or shoulder hiking.
Two plain sentences for a therapist: symmetry and compensation trend, adherence, any watch or alert concern.
Use only the numbers given. Do not diagnose. Do not suggest plan changes. Plain text only, no lists, under 70 words.
Data (JSON):
${JSON.stringify(data)}`;

async function gemma(text: string): Promise<{ text: string; model: string }> {
  const key = Deno.env.get('GOOGLE_API_KEY');
  if (!key) throw new Error('GOOGLE_API_KEY is not set (supabase secrets set GOOGLE_API_KEY=...)');
  const models = [API_MODEL, ...FALLBACKS.filter((m) => m !== API_MODEL)];
  if (!models.every((m) => /^gemma/i.test(m))) throw new Error('Model name must be a Gemma model');
  let lastErr: Error | null = null;
  for (const model of models) {
    // One retry on 429/5xx, then fall back to the next Gemma model.
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }] }),
      });
      if (r.ok) {
        const parts = (await r.json()).candidates?.[0]?.content?.parts ?? [];
        const out = parts.filter((p: Json) => !p.thought).map((p: Json) => (p.text as string) ?? '').join('').trim();
        if (out) return { text: out, model };
        lastErr = new Error(`Gemma returned no text on ${model}`);
        break;
      }
      lastErr = new Error(`Gemma API ${r.status} on ${model}: ${(await r.text()).slice(0, 150)}`);
      console.warn(lastErr.message);
      if (![429, 500, 502, 503, 504].includes(r.status)) break; // other errors will not fix themselves
      await new Promise((ok) => setTimeout(ok, 2000));
    }
  }
  throw lastErr ?? new Error('Gemma call failed');
}

// Compact, number-only view of the last 14 days for the prompt.
function compact(patient: any, plan: any, sessions: any[], results: any[], watch: any[], alerts: any[]): Json {
  const bySession = new Map<string, any[]>();
  for (const r of results) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);
  const sessionRows = sessions.map((s) => {
    const rs = bySession.get(s.id) ?? [];
    const sym: number[] = [];
    for (const ex of ['arm_raise', 'forward_reach', 'hand_open']) {
      const w = rs.find((r) => r.exercise === ex && r.side === 'weak');
      const h = rs.find((r) => r.exercise === ex && r.side === 'healthy');
      if (w && h && Number(h.best_value) > 0) sym.push((Number(w.best_value) / Number(h.best_value)) * 100);
    }
    const comp = rs.filter((r) => r.side === 'weak').map((r) => Number(r.comp_rep_pct));
    return {
      date: String(s.started_at).slice(0, 10),
      symmetryPct: round(mean(sym)),
      compensationPct: round(mean(comp)),
      pain: s.pain,
      stoppedEarly: s.stop_reason ?? undefined,
    };
  });
  const series = (key: string) => watch.filter((w) => w[key] != null).map((w) => Number(w[key]));
  const firstLast = (key: string) => {
    const xs = series(key);
    return xs.length ? { first: round(xs[0], 2), last: round(xs[xs.length - 1], 2) } : null;
  };
  const rhr = series('resting_hr');
  return {
    patient: { firstName: String(patient.name).split(' ')[0], weakSide: patient.weak_side, phase: patient.phase },
    plannedSessionsPerWeek: plan?.sessions_per_week ?? null,
    sessionsLast14Days: sessionRows.length,
    sessions: sessionRows,
    watch: {
      days: watch.length,
      restingHr: rhr.length ? { avg: round(mean(rhr)), latest: rhr[rhr.length - 1] } : null,
      weakArmActiveMin: firstLast('weak_arm_active_min'),
      useRatio: firstLast('use_ratio'),
      latestBpSys: series('bp_sys').at(-1) ?? null,
      bpLimitSys: patient.bp_limit_sys,
      falls: series('falls').reduce((a, b) => a + b, 0),
    },
    openAlerts: alerts.map((a) => a.type),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply(req, 405, { error: 'POST only' });

  let patientId = '';
  try {
    const body = await req.json();
    patientId = typeof body?.patientId === 'string' ? body.patientId.trim() : '';
  } catch {
    return reply(req, 400, { error: 'body must be JSON {patientId}' });
  }
  if (!/^[a-z0-9-]{1,64}$/.test(patientId)) return reply(req, 400, { error: 'patientId is required' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const ws = weekStart();
  const toSummary = (row: Json) => ({
    patientId: row.patient_id, weekStart: row.week_start, text: row.text, model: row.model,
    source: row.source, createdAt: row.created_at,
  });

  try {
    const { data: patient, error: pErr } = await db.from('patients').select('*').eq('id', patientId).maybeSingle();
    if (pErr) throw pErr;
    if (!patient) return reply(req, 404, { error: 'Unknown patient' });

    // Throttle: reuse an LLM summary written in the last minute.
    const { data: existing } = await db.from('patient_summaries').select('*')
      .eq('patient_id', patientId).eq('week_start', ws).maybeSingle();
    if (existing?.source === 'llm' && Date.now() - Date.parse(existing.created_at) < MIN_SECONDS_BETWEEN_CALLS * 1000) {
      return reply(req, 200, toSummary(existing));
    }

    const since = new Date(Date.now() - 14 * DAY_MS);
    const [sessions, watch, alerts, plan] = await Promise.all([
      db.from('sessions').select('id, started_at, pain, stop_reason').eq('patient_id', patientId)
        .gte('started_at', since.toISOString()).order('started_at'),
      db.from('watch_daily').select('date, resting_hr, bp_sys, falls, weak_arm_active_min, use_ratio')
        .eq('patient_id', patientId).gte('date', since.toISOString().slice(0, 10)).order('date'),
      db.from('alerts').select('type').eq('patient_id', patientId).eq('acknowledged', false),
      db.from('plans').select('sessions_per_week').eq('patient_id', patientId).eq('status', 'approved').maybeSingle(),
    ]);
    for (const r of [sessions, watch, alerts, plan]) if (r.error) throw r.error;
    const ids = (sessions.data ?? []).map((s) => s.id);
    const results = ids.length
      ? await db.from('exercise_results').select('session_id, exercise, side, best_value, comp_rep_pct').in('session_id', ids)
      : { data: [], error: null };
    if (results.error) throw results.error;

    const data = compact(patient, plan.data, sessions.data ?? [], results.data ?? [], watch.data ?? [], alerts.data ?? []);
    const out = await gemma(prompt(data));
    const text = out.text.replace(/\s+/g, ' ').slice(0, 1200);

    const { error: uErr } = await db.rpc('upsert_summary', {
      p_patient_id: patientId, p_week_start: ws, p_text: text, p_model: out.model,
    });
    if (uErr) throw uErr;
    const { data: row, error: rErr } = await db.from('patient_summaries').select('*')
      .eq('patient_id', patientId).eq('week_start', ws).single();
    if (rErr) throw rErr;
    console.log(`weekly-summary ${patientId} answered by ${out.model}`);
    return reply(req, 200, toSummary(row));
  } catch (err) {
    const message = err instanceof Error ? err.message : String((err as Json)?.message ?? err);
    console.error('weekly-summary failed:', message);
    return reply(req, 502, { error: message });
  }
});
