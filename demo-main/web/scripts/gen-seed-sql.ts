/**
 * Generates demo-main/supabase/seed.sql from the same deterministic generator the
 * offline LocalSource uses (src/data/seed/generate.ts), so both modes tell the same story.
 *
 *   cd demo-main/web && npm run seed:sql            # today = the local date
 *   SEED_TODAY=2026-10-24 npm run seed:sql          # pretend "today" is another date
 *
 * Every date/time is written RELATIVE to the day seed.sql runs:
 *   dates       -> current_date - N
 *   timestamps  -> current_date - N + time 'HH:MM:SS'   (with `set timezone = 'UTC'`)
 * so re-running seed.sql on demo morning re-centres the whole story on that day.
 * Output depends only on the generator and the date: two runs on the same day are byte-identical.
 *
 * Expects (CONVERGENCE_PLAN §6.4):
 *   generateDemoData(today: Date) -> { patients, plans, sessions, results, watch, watchSessions,
 *                                      replays, summaries, alerts? }
 * with ISO-8601 timestamps (or epoch ms) and YYYY-MM-DD dates computed from `today`.
 * `plans` should already include the rules engine's suggested plans, and `alerts` its alerts.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDemoData } from '../src/data/seed/generate';
import type { Alert, ExerciseResult, Patient, Plan, WatchDaily, WatchSession, WeeklySummary } from '../src/types';

const DAY_MS = 86_400_000;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/seed.sql');
const DEMO_IDS = ['p-maria', 'p-james', 'p-priya'];

// Shapes read here (structural, so small additive changes in WP1's types don't break the emitter).
type SessionLike = { id: string; patientId: string; startedAt: string | number; endedAt: string | number;
  pain: number | null; tiredness: number | null; stopReason: string | null; avgHr: number | null; clientKey?: string | null };
type ReplayLike = { sessionId: string; exercise: string; side: string; path: string; fps?: number; frameCount?: number | null;
  seconds?: number | null; warningCount?: number; uploadedAt?: string | number };
type SeedData = {
  patients: Patient[]; plans: Plan[]; sessions: SessionLike[]; results: ExerciseResult[]; watch: WatchDaily[];
  watchSessions?: WatchSession[]; replays?: ReplayLike[]; summaries?: WeeklySummary[]; alerts?: Alert[];
};

// ---- today -----------------------------------------------------------------------------------
function resolveToday(): { today: Date; todayStr: string } {
  const env = process.env.SEED_TODAY;
  if (env) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(env)) throw new Error(`SEED_TODAY must be YYYY-MM-DD, got ${env}`);
    const [y, m, d] = env.split('-').map(Number);
    return { today: new Date(y, m - 1, d, 12), todayStr: env };
  }
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12); // local noon: same calendar day in UTC
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return { today, todayStr };
}
const { today, todayStr } = resolveToday();
const TODAY_UTC_MS = Date.parse(`${todayStr}T00:00:00Z`);

// ---- SQL literals ---------------------------------------------------------------------------------
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const str = (v: unknown) => (v === null || v === undefined || v === '' ? 'null' : q(String(v)));
function num(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${String(v)}`);
  return String(n);
}
const bool = (v: unknown) => (v === null || v === undefined ? 'null' : v ? 'true' : 'false');
const json = (v: unknown) => (v === null || v === undefined ? 'null' : `${q(JSON.stringify(v))}::jsonb`);

function rel(days: number): string {
  if (days === 0) return 'current_date';
  return days > 0 ? `current_date + ${days}` : `current_date - ${-days}`;
}
/** YYYY-MM-DD -> current_date ± N */
function date(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'null';
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`not a YYYY-MM-DD date: ${s}`);
  return rel(Math.round((Date.parse(`${s}T00:00:00Z`) - TODAY_UTC_MS) / DAY_MS));
}
/** ISO string / epoch ms -> current_date ± N + time 'HH:MM:SS[.mmm]' (UTC) */
function ts(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'null';
  const ms = typeof v === 'number' ? v : Date.parse(String(v));
  if (!Number.isFinite(ms)) throw new Error(`not a timestamp: ${String(v)}`);
  const dayStart = Math.floor(ms / DAY_MS) * DAY_MS;
  const days = Math.round((dayStart - TODAY_UTC_MS) / DAY_MS);
  const tod = new Date(ms).toISOString().slice(11, 23).replace(/\.000$/, '');
  return `${rel(days)} + time '${tod}'`;
}

function insert(table: string, cols: string[], rows: string[][], tail = ''): string {
  if (!rows.length) return `-- (no rows for ${table})\n`;
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map((r) => `  (${r.join(', ')})`).join(',\n');
    out.push(`insert into public.${table} (${cols.join(', ')}) values\n${chunk}${tail};\n`);
  }
  return out.join('\n');
}

// ---- generate -------------------------------------------------------------------------------------
const data = generateDemoData(today) as unknown as SeedData;
for (const k of ['patients', 'plans', 'sessions', 'results', 'watch'] as const) {
  if (!Array.isArray(data[k])) throw new Error(`generateDemoData() result is missing "${k}"`);
}
const unknownPatients = data.patients.map((p) => p.id).filter((id) => !DEMO_IDS.includes(id));
if (unknownPatients.length) {
  // seed.sql only deletes the demo ids before inserting; others would collide on re-run.
  throw new Error(`Seed has patients outside ${DEMO_IDS.join(', ')}: ${unknownPatients.join(', ')}`);
}
const startsToday = (v: string | number) => (typeof v === 'number' ? v : Date.parse(v)) >= TODAY_UTC_MS;
const sessionsToday = data.sessions.filter((s) => startsToday(s.startedAt));
if (sessionsToday.length) console.warn(`warning: ${sessionsToday.length} seeded session(s) start today or later (today should stay empty)`);

const parts: string[] = [];
parts.push(`-- =============================================================================
-- RehabTrack demo seed. GENERATED by web/scripts/gen-seed-sql.ts from
-- web/src/data/seed/generate.ts. Do not edit by hand: run \`npm run seed:sql\` in demo-main/web.
--
-- All dates are relative to the day this file runs (current_date - N), and today is left
-- empty for the live session. Apply after migrations/0001_init.sql. Safe to re-run: it deletes
-- and re-creates the demo patients (cascade). Re-run it on the morning of the demo.
-- =============================================================================

set timezone = 'UTC';

delete from public.patients where id in (${DEMO_IDS.map(q).join(', ')});
`);

parts.push('-- Patients');
parts.push(insert('patients',
  ['id', 'name', 'weak_side', 'stroke_date', 'phase', 'max_raise_angle', 'next_checkin', 'bp_limit_sys'],
  data.patients.map((p) => [str(p.id), str(p.name), str(p.weakSide), date(p.strokeDate), num(p.phase),
    num(p.maxRaiseAngle), date(p.nextCheckin), num(p.bpLimitSys)])));

// Stable order (oldest first) so the output is byte-identical between runs.
const plans = [...data.plans].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
parts.push('-- Plans (approved, plus the rules engine\'s suggestions)');
parts.push(insert('plans',
  ['id', 'patient_id', 'phase', 'exercises', 'sessions_per_week', 'status', 'approved_by', 'next_checkin', 'approved_at',
    'superseded_at', 'dismissed_at', 'dismissed_by', 'kind', 'reason', 'based_on', 'created_at'],
  plans.map((p) => [str(p.id), str(p.patientId), num(p.phase),
    json(p.exercises.map((e) => ({ exercise: e.exercise, reps: e.reps, target: e.target }))),
    num(p.sessionsPerWeek), str(p.status), str(p.approvedBy), date(p.nextCheckin), ts(p.approvedAt), ts(p.supersededAt),
    ts(p.dismissedAt), str(p.dismissedBy), str(p.kind), str(p.reason), json(p.basedOn ?? null), ts(p.createdAt)])));

const sessions = [...data.sessions].sort((a, b) => String(a.patientId).localeCompare(String(b.patientId)) || a.id.localeCompare(b.id));
parts.push('-- Sessions');
parts.push(insert('sessions',
  ['id', 'patient_id', 'client_key', 'started_at', 'ended_at', 'pain', 'tiredness', 'stop_reason', 'avg_hr', 'created_at'],
  sessions.map((s) => [str(s.id), str(s.patientId), str(s.clientKey ?? null), ts(s.startedAt), ts(s.endedAt), num(s.pain),
    num(s.tiredness), str(s.stopReason), num(s.avgHr), ts(s.endedAt)])));

const sessionOrder = new Map(sessions.map((s, i) => [s.id, i]));
const results = [...data.results].sort((a, b) =>
  (sessionOrder.get(a.sessionId ?? '') ?? 0) - (sessionOrder.get(b.sessionId ?? '') ?? 0)
  || a.exercise.localeCompare(b.exercise) || a.side.localeCompare(b.side));
parts.push('-- Exercise results');
parts.push(insert('exercise_results',
  ['session_id', 'exercise', 'side', 'best_value', 'reps', 'sec_per_rep', 'smoothness', 'fatigue', 'trunk_lean_max',
    'shoulder_hike_max', 'comp_rep_pct', 'reach_cm', 'closed_min'],
  results.map((r) => {
    if (!r.sessionId) throw new Error('ExerciseResult without sessionId');
    return [str(r.sessionId), str(r.exercise), str(r.side), num(r.bestValue), num(r.reps), num(r.secPerRep),
      num(r.smoothness), num(r.fatigue), num(r.trunkLeanMax), num(r.shoulderHikeMax), num(r.compRepPct),
      num(r.reachCm ?? null), num(r.closedMin ?? null)];
  })));

const replays = [...(data.replays ?? [])].sort((a, b) => `${a.sessionId}-${a.exercise}-${a.side}`.localeCompare(`${b.sessionId}-${b.exercise}-${b.side}`));
parts.push('-- Replays (synth: paths are generated in the browser; no Storage objects needed)');
parts.push(insert('session_replays',
  ['session_id', 'exercise', 'side', 'path', 'fps', 'frame_count', 'seconds', 'warning_count', 'uploaded_at'],
  replays.map((r) => [str(r.sessionId), str(r.exercise), str(r.side), str(r.path), num(r.fps ?? 15), num(r.frameCount ?? null),
    num(r.seconds ?? null), num(r.warningCount ?? 0),
    r.uploadedAt != null ? ts(r.uploadedAt) : `(select ended_at from public.sessions where id = ${str(r.sessionId)})`])));

const watch = [...data.watch].sort((a, b) => a.patientId.localeCompare(b.patientId) || a.date.localeCompare(b.date));
parts.push('-- Watch daily (Route A / recorded data)');
parts.push(insert('watch_daily',
  ['patient_id', 'date', 'steps', 'exercise_min', 'stand_hr', 'resting_hr', 'hrv', 'sleep_hr', 'bp_sys', 'bp_dia', 'falls',
    'walking_steadiness', 'weak_arm_active_min', 'use_ratio', 'created_at', 'updated_at'],
  watch.map((w) => {
    const at = `least(${date(w.date)} + time '21:00', now())`;
    return [str(w.patientId), date(w.date), num(w.steps), num(w.exerciseMin), num(w.standHr), num(w.restingHr), num(w.hrv),
      num(w.sleepHr), num(w.bpSys), num(w.bpDia), num(w.falls), num(w.walkingSteadiness ?? null), num(w.weakArmActiveMin),
      num(w.useRatio), at, at];
  })));

const watchSessions = [...(data.watchSessions ?? [])].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
parts.push('-- Watch sessions (Route B)');
parts.push(insert('watch_sessions',
  ['session_id', 'patient_id', 'exercise', 'arm', 'started_at', 'ended_at', 'target_reps', 'reps', 'attempts',
    'best_elevation_deg', 'completed', 'avg_hr', 'max_hr', 'min_hr', 'app_session_id', 'created_at', 'updated_at'],
  watchSessions.map((w) => [str(w.sessionId), str(w.patientId), str(w.exercise), str(w.arm), ts(w.startedAt), ts(w.endedAt),
    num(w.targetReps), num(w.reps), num(w.attempts), num(w.bestElevationDeg), bool(w.completed), num(w.avgHr), num(w.maxHr),
    num(w.minHr), str(w.appSessionId), ts(w.endedAt), ts(w.endedAt)])));

const alerts = [...(data.alerts ?? [])].sort((a, b) => a.patientId.localeCompare(b.patientId) || a.id.localeCompare(b.id));
parts.push('-- Alerts (from the rules engine)');
parts.push(insert('alerts',
  ['id', 'patient_id', 'type', 'detail', 'acknowledged', 'acknowledged_at', 'created_at'],
  alerts.map((a) => [str(a.id), str(a.patientId), str(a.type), str(a.detail), bool(a.acknowledged), ts(a.acknowledgedAt),
    ts(a.createdAt)])));

const summaries = [...(data.summaries ?? [])].sort((a, b) => a.patientId.localeCompare(b.patientId) || a.weekStart.localeCompare(b.weekStart));
parts.push('-- Pre-generated weekly summaries');
parts.push(insert('patient_summaries',
  ['patient_id', 'week_start', 'text', 'model', 'source', 'created_at'],
  summaries.map((s) => [str(s.patientId), date(s.weekStart), str(s.text), str(s.model), str(s.source ?? 'pregenerated'),
    `least(${ts(s.createdAt)}, now())`])));

const sql = parts.join('\n');
writeFileSync(OUT, sql);
console.log(`Wrote ${OUT} (today = ${todayStr}): ${data.patients.length} patients, ${plans.length} plans, ` +
  `${sessions.length} sessions, ${results.length} results, ${replays.length} replays, ${watch.length} watch days, ` +
  `${watchSessions.length} watch sessions, ${alerts.length} alerts, ${summaries.length} summaries.`);
