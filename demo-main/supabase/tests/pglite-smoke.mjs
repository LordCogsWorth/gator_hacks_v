#!/usr/bin/env node
// Smoke test for supabase/migrations/0001_init.sql + supabase/seed.sql in PGlite
// (Postgres 16 compiled to WASM, in-process; no Supabase project or Docker needed).
//
// Run:  cd demo-main/web && npm run db:test      (= node ../supabase/tests/pglite-smoke.mjs)
// PGlite is resolved from the current directory, from demo-main/web, or from
// $PGLITE_DIR (a folder whose node_modules has @electric-sql/pglite).
//
// It stubs what Supabase provides (roles anon/authenticated/service_role, the
// storage schema with buckets/objects/foldername(), auth.uid()), applies the
// migration twice (idempotency) and the seed twice, then checks the RPCs.

import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const supabaseDir = resolve(here, '..');
const demoMain = resolve(supabaseDir, '..');

async function loadPGlite() {
  try {
    const m = await import('@electric-sql/pglite');
    return m.PGlite;
  } catch {}
  const dirs = [process.env.PGLITE_DIR, process.cwd(), join(demoMain, 'web')].filter(Boolean);
  for (const dir of dirs) {
    try {
      const req = createRequire(join(resolve(dir), 'noop.js'));
      const entry = req.resolve('@electric-sql/pglite');
      // Prefer the ESM build next to the CJS entry.
      const esm = entry.replace(/index\.cjs$/, 'index.js');
      const m = await import(pathToFileURL(existsSync(esm) ? esm : entry).href);
      const PG = m.PGlite ?? m.default?.PGlite;
      if (PG) return PG;
    } catch {}
  }
  console.error('Could not find @electric-sql/pglite. Run `npm install` in demo-main/web (or set PGLITE_DIR).');
  process.exit(2);
}

const PGlite = await loadPGlite();
const db = new PGlite();

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''}`);
  }
}
async function one(sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows[0];
}
async function val(sql, params = []) {
  const row = await one(sql, params);
  return row ? Object.values(row)[0] : undefined;
}
// Call an RPC as a role (default anon, like the browser / Shortcut / watch).
async function rpc(fn, args, role = 'anon') {
  await db.exec(`set role ${role}`);
  try {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const r = await db.query(`select public.${fn}(${placeholders}) as out`, args);
    return r.rows[0].out;
  } finally {
    await db.exec('reset role');
  }
}
async function rpcErr(fn, args, role = 'anon') {
  try {
    await rpc(fn, args, role);
    return null;
  } catch (e) {
    return { code: e.code, message: e.message };
  }
}
async function asRole(role, sql, params = []) {
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}
async function asRoleErr(role, sql, params = []) {
  try {
    await asRole(role, sql, params);
    return null;
  } catch (e) {
    return { code: e.code, message: e.message };
  }
}
const J = (v) => JSON.stringify(v);

// --- Supabase stubs ----------------------------------------------------------
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  grant usage on schema public to anon, authenticated, service_role;

  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function auth.role() returns text language sql stable as $$ select current_user::text $$;
  grant usage on schema auth to anon, authenticated, service_role;

  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
  );
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text not null, owner uuid, metadata jsonb, created_at timestamptz default now(),
    unique (bucket_id, name)
  );
  create or replace function storage.foldername(name text) returns text[]
    language plpgsql immutable as $$
    declare _parts text[];
    begin
      select string_to_array(name, '/') into _parts;
      return _parts[1:array_length(_parts, 1) - 1];
    end $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
`);

const migration = readFileSync(join(supabaseDir, 'migrations', '0001_init.sql'), 'utf8');
const seed = readFileSync(join(supabaseDir, 'seed.sql'), 'utf8');

console.log('Migration + seed');
let err = null;
try { await db.exec(migration); } catch (e) { err = e; }
ok(!err, 'migration applies', err?.message);
if (err) process.exit(1);
err = null;
try { await db.exec(migration); } catch (e) { err = e; }
ok(!err, 'migration is idempotent (second run)', err?.message);
err = null;
try { await db.exec(seed); } catch (e) { err = e; }
ok(!err, 'seed applies', err?.message);
if (err) process.exit(1);
err = null;
try { await db.exec(seed); } catch (e) { err = e; }
ok(!err, 'seed is re-runnable', err?.message);

const snapshotSql = `select (select count(*) from public.plans)::int plans, (select count(*) from public.plans where status='suggested')::int suggested,
  (select count(*) from public.alerts where not acknowledged)::int open_alerts, (select count(*) from public.sessions)::int sessions,
  (select count(*) from public.watch_daily)::int watch`;
const seedSnapshot = await one(snapshotSql);

// Suggested plan for a patient: the seeded one, or one created through apply_rule_results.
async function ensureSuggested(pid, phase) {
  const id = await val(`select id from public.plans where patient_id=$1 and status='suggested'`, [pid]);
  if (id) return id;
  const nc = await val(`select (current_date + 7)::text`);
  const r = await rpc('apply_rule_results', [pid, '[]', JSON.stringify({ patientId: pid, phase: phase ?? 2, sessionsPerWeek: 5, nextCheckin: nc,
    exercises: [{ exercise: 'arm_raise', reps: 10, target: 100 }], kind: 'plateau', reason: 'test' })]);
  return r.planSuggested.id;
}

// --- Static checks -------------------------------------------------------------
console.log('Schema');
const tables = (await db.query(`select tablename from pg_tables where schemaname='public' order by 1`)).rows.map((r) => r.tablename);
const expected = ['alerts', 'exercise_results', 'patient_summaries', 'patients', 'plans', 'session_replays', 'sessions', 'watch_daily', 'watch_sessions'];
ok(J(tables) === J(expected), '9 public tables', tables);
const noRls = await val(`select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
ok(noRls === 0, 'RLS enabled on every table', noRls);
const unpinned = (await db.query(`select n.nspname||'.'||p.proname as f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).rows.map((r) => r.f);
ok(unpinned.length === 0, 'every public/private function pins search_path', unpinned);
const notDefiner = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and not p.prosecdef`)).rows.map((r) => r.proname);
ok(notDefiner.length === 0, 'every public RPC is SECURITY DEFINER', notDefiner);
const bucket = await one(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='replays'`);
ok(bucket && bucket.public === true && Number(bucket.file_size_limit) === 2097152, 'replays bucket (public, 2 MB)', bucket);

console.log('Seed');
ok((await asRole('anon', `select count(*)::int n from public.patients`)).rows[0].n === 3, 'anon reads 3 demo patients');
const approvedPer = (await db.query(`select patient_id, count(*)::int n from public.plans where status='approved' group by 1 order by 1`)).rows;
ok(approvedPer.length === 3 && approvedPer.every((r) => r.n === 1), 'one approved plan per patient', approvedPer);
ok((await val(`select count(*)::int from public.sessions where started_at::date >= current_date`)) === 0, 'no seeded session today');
const jamesAlerts = (await db.query(`select type from public.alerts where patient_id='p-james' and not acknowledged order by 1`)).rows.map((r) => r.type);
ok(jamesAlerts.includes('plateau') && jamesAlerts.includes('adherence'), 'James has open plateau + adherence alerts', jamesAlerts);
ok((await val(`select count(*)::int from public.sessions where avg_hr is null`)) === 0, 'every seeded session has avgHr');
ok((await val(`select count(*)::int from public.session_replays where path like 'synth:%'`)) > 0, 'seeded synth: replays exist');

// --- Grants ------------------------------------------------------------------------
console.log('Grants');
let e = await asRoleErr('anon', `insert into public.patients (id, name, weak_side, stroke_date) values ('p-x','X','left',current_date)`);
ok(e && /permission denied/.test(e.message), 'anon cannot insert into tables directly', e);
e = await asRoleErr('anon', `update public.alerts set acknowledged = true`);
ok(e && /permission denied/.test(e.message), 'anon cannot update tables directly', e);
e = await rpcErr('upsert_summary', ['p-maria', '2026-01-05', 'x', 'm']);
ok(e && /permission denied/.test(e.message), 'anon cannot call upsert_summary', e);
e = await asRoleErr('anon', `select private.num('{"a":1}'::jsonb, 'a')`);
ok(e && /permission denied/.test(e.message), 'anon cannot call private helpers', e);
let r0 = null;
try { r0 = await rpc('upsert_summary', ['p-maria', '2026-01-05', 'Two sentences.', 'gemma-test'], 'service_role'); } catch (x) { r0 = x; }
ok(!(r0 instanceof Error), 'service_role can call upsert_summary', r0?.message);
ok((await val(`select source from public.patient_summaries where patient_id='p-maria' and week_start='2026-01-05'`)) === 'llm', 'upsert_summary stores source=llm');

// --- submit_session -------------------------------------------------------------------
console.log('submit_session');
const result = (exercise, side, bestValue) => ({
  exercise, side, bestValue, reps: 8, secPerRep: 3.2, smoothness: 1.4, fatigue: 0.95,
  trunkLeanMax: 6, shoulderHikeMax: 0.02, compRepPct: 12,
});
const now = new Date();
const startedAt = new Date(now.getTime() - 12 * 60000).toISOString();
const endedAt = now.toISOString();
const body = {
  clientKey: 'ck-smoke-1', patientId: 'p-james', startedAt, endedAt, pain: 2, tiredness: 2,
  results: [result('arm_raise', 'healthy', 160), { ...result('arm_raise', 'weak', 92), reachCm: null }, result('hand_open', 'weak', 50)],
};
const s1 = await rpc('submit_session', [J(body)]);
ok(s1?.session?.id?.startsWith('sess-') && s1.results.length === 3, 'submit_session inserts session + results', s1);
ok(s1?.session?.patientId === 'p-james' && Array.isArray(s1.session.replays), 'returns camelCase SessionRow', s1?.session);
ok(typeof s1?.results?.[0]?.id === 'string' && s1.results[0].sessionId === s1.session.id, 'ExerciseResult.id is a string', s1?.results?.[0]);
const s2 = await rpc('submit_session', [J(body)]);
ok(s2.session.id === s1.session.id && s2.duplicate === true, 'submit_session is idempotent on clientKey', s2);
ok((await val(`select count(*)::int from public.exercise_results where session_id=$1`, [s1.session.id])) === 3, 'no duplicate results after retry');
e = await rpcErr('submit_session', [J({ ...body, clientKey: 'ck-smoke-2', patientId: 'p-nobody' })]);
ok(e?.code === 'PT404', 'submit_session unknown patient -> PT404', e);
e = await rpcErr('submit_session', [J({ ...body, clientKey: 'ck-smoke-3', results: [{ ...result('arm_raise', 'weak', 90), bestValue: 'NaN' }] })]);
ok(e?.code === 'PT400', 'submit_session rejects NaN bestValue', e);
e = await rpcErr('submit_session', [J({ ...body, clientKey: 'ck-smoke-4', results: [result('arm_raise', 'weak', 90), result('arm_raise', 'weak', 91)] })]);
ok(e?.code === 'PT400' && /duplicate/.test(e.message), 'submit_session rejects duplicate exercise+side', e);
e = await rpcErr('submit_session', [J({ ...body, clientKey: 'ck-smoke-5', results: [] })]);
ok(e?.code === 'PT400', 'submit_session needs >= 1 result without stopReason', e);
const stopped = await rpc('submit_session', [J({ ...body, clientKey: 'ck-smoke-6', pain: 8, stopReason: 'pain', results: [] })]);
ok(stopped.session.stopReason === 'pain' && stopped.results.length === 0, 'safety stop with 0 results is accepted', stopped);
e = await rpcErr('submit_session', [J({ ...body, clientKey: 'ck-smoke-7', startedAt: 'yesterday' })]);
ok(e?.code === 'PT400', 'submit_session rejects non-ISO time', e);
const epochBody = await rpc('submit_session', [J({ ...body, clientKey: 'ck-smoke-8', startedAt: now.getTime() - 60000, endedAt: now.getTime() })]);
ok(!!epochBody.session.id, 'submit_session accepts epoch-ms times', epochBody);

// --- register_replay + storage policy ------------------------------------------------------
console.log('register_replay + storage');
const rep = await rpc('register_replay', [J({ sessionId: s1.session.id, exercise: 'arm_raise', side: 'weak',
  path: `${s1.session.id}/arm_raise-weak.json`, fps: 15, frameCount: 300, seconds: 20, warningCount: 2 })]);
ok(rep.key === `${s1.session.id}-arm_raise-weak` && rep.frameCount === 300 && rep.path.endsWith('.json'), 'register_replay returns ReplaySummary', rep);
const rep2 = await rpc('register_replay', [J({ sessionId: s1.session.id, exercise: 'arm_raise', side: 'weak',
  path: `${s1.session.id}/arm_raise-weak.json`, fps: 15, frameCount: 310, seconds: 21, warningCount: 1 })]);
ok(rep2.frameCount === 310 && (await val(`select count(*)::int from public.session_replays where session_id=$1`, [s1.session.id])) === 1, 'register_replay upserts');
e = await rpcErr('register_replay', [J({ sessionId: s1.session.id, exercise: 'arm_raise', side: 'weak', path: 'other/arm_raise-weak.json' })]);
ok(e?.code === 'PT400', 'register_replay rejects a path outside the session folder', e);
const s1row = await rpc('submit_session', [J(body)]);
ok(J(s1row.session.replays) === J([`${s1.session.id}-arm_raise-weak`]), 'Session.replays lists replay keys', s1row.session.replays);
e = await asRoleErr('anon', `insert into storage.objects (bucket_id, name) values ('replays', $1)`, [`${s1.session.id}/arm_raise-weak.json`]);
ok(e === null, 'anon may upload into a recent session folder', e);
e = await asRoleErr('anon', `insert into storage.objects (bucket_id, name) values ('replays', 'sess-nope/arm_raise-weak.json')`);
ok(e && /row-level security/.test(e.message), 'anon may not upload into an unknown folder', e);
e = await asRoleErr('anon', `insert into storage.objects (bucket_id, name) values ('replays', 'sess-maria-05/arm_raise-weak.json')`);
ok(e && /row-level security/.test(e.message), 'anon may not upload into an old seeded session folder', e);

// --- submit_watch_daily ------------------------------------------------------------------------
console.log('submit_watch_daily');
const d = await rpc('submit_watch_daily', [J({ patientId: 'p-maria', date: '2026-01-10', steps: '1,234', restingHr: 70 })]);
ok(d.ok === true && d.patientId === 'p-maria' && d.date === '2026-01-10' && d.updatedAt && d.steps === 1234, 'submit_watch_daily inserts (string number with comma)', d);
const d2 = await rpc('submit_watch_daily', [J({ patientId: 'p-maria', date: '2026-01-10', bpSys: 130, restingHr: 0, walkingSteadiness: 0.85 })]);
ok(d2.steps === 1234 && d2.restingHr === 70 && d2.bpSys === 130 && d2.walkingSteadiness === 85,
  'watch merge keeps old values (omitted and 0 readings)', d2);
ok(typeof d2.id === 'string' && 'useRatio' in d2 && 'hrv' in d2, 'returns WatchDaily shape', d2);
e = await rpcErr('submit_watch_daily', [J({ patientId: 'p-nobody', date: '2026-01-10', steps: 10 })]);
ok(e?.code === 'PT404' && /Unknown patient/.test(e.message), 'unknown patient -> PT404', e);
e = await rpcErr('submit_watch_daily', [J({ patientId: 'p-maria', date: '2026-01-11', restingHr: 'NaN' })]);
ok(e?.code === 'PT400' && /must be a number/.test(e.message), 'NaN is rejected', e);
e = await rpcErr('submit_watch_daily', [J({ patientId: 'p-maria', date: '2026-01-11', steps: 'Infinity' })]);
ok(e?.code === 'PT400', 'Infinity is rejected', e);
e = await rpcErr('submit_watch_daily', [J({ patientId: 'p-maria', date: '2026-02-30', steps: 1 })]);
ok(e?.code === 'PT400' && /real YYYY-MM-DD/.test(e.message), 'impossible date -> friendly error', e);
e = await rpcErr('submit_watch_daily', [J({ patientId: 'p-maria', date: '2026-01-11', bpSys: 99999 })]);
ok(e?.code === '23514', 'out-of-range value -> CHECK violation', e);
e = await rpcErr('submit_watch_daily', [J({ patientId: 'p-maria', date: '2999-01-01', steps: 1 })]);
ok(e?.code === 'PT400', 'future date rejected', e);

// --- submit_watch_session (body exactly as watch/MobilityWatch/WatchModel.swift builds it) -----
console.log('submit_watch_session');
const wsStart = new Date(now.getTime() - 11 * 60000).toISOString();
const watchBody = {
  sessionId: '8F14E45F-CEEA-4E7A-9B1C-2D3E4F5A6B7C', patientId: 'p-james', exercise: 'side_raise', arm: 'right',
  startedAt: wsStart, endedAt: endedAt, targetReps: 10, reps: 8, attempts: 11, bestElevationDeg: 104.5,
  avgHr: 92, maxHr: 118, minHr: 76,
  trace: { hz: 5, elevationDeg: [3.1, 8.4, 22.0], directionDeg: [85.0, 86.2, 84.9], heartRate: [90, null, 91] },
  repLog: [{ atSec: 12.4, peakDeg: 95.2, directionDeg: 82.4, counted: true }],
};
// Cross-check: every key the Swift upload sends is one the RPC reads.
const swiftPath = join(demoMain, 'watch', 'MobilityWatch', 'WatchModel.swift');
if (existsSync(swiftPath)) {
  const swift = readFileSync(swiftPath, 'utf8');
  const fn = swift.slice(swift.indexOf('func uploadSession'), swift.indexOf('func retryPending'));
  const keys = [...fn.matchAll(/"([a-zA-Z]+)":/g)].map((m) => m[1]).concat([...fn.matchAll(/body\["([a-zA-Z]+)"\]/g)].map((m) => m[1]));
  const known = new Set(['sessionId', 'patientId', 'exercise', 'arm', 'startedAt', 'endedAt', 'targetReps', 'reps', 'attempts',
    'bestElevationDeg', 'completed', 'avgHr', 'maxHr', 'minHr', 'trace', 'repLog', 'appSessionId', 'hz', 'elevationDeg', 'directionDeg', 'heartRate']);
  const unknown = [...new Set(keys)].filter((k) => !known.has(k));
  ok(keys.length >= 10 && unknown.length === 0, 'WatchModel.swift upload keys match the RPC contract', { keys: [...new Set(keys)], unknown });
} else {
  ok(false, 'watch/MobilityWatch/WatchModel.swift exists');
}
const w1 = await rpc('submit_watch_session', [J(watchBody)]);
ok(w1.ok === true && w1.sessionId === watchBody.sessionId && w1.patientId === 'p-james', 'submit_watch_session accepts the watch body', w1);
ok((await val(`select exercise from public.watch_sessions where session_id=$1`, [watchBody.sessionId])) === 'arm_raise', 'side_raise is stored as arm_raise');
ok((await val(`select completed from public.watch_sessions where session_id=$1`, [watchBody.sessionId])) === false, 'completed derived from reps < targetReps');
ok(w1.sessionsUpdated >= 1 && Number(await val(`select avg_hr from public.sessions where id=$1`, [s1.session.id])) === 92,
  'watch HR back-fills overlapping camera session avg_hr', w1);
const w2 = await rpc('submit_watch_session', [J({ ...watchBody, reps: 10 })]);
ok(w2.ok && (await val(`select count(*)::int from public.watch_sessions where session_id=$1`, [watchBody.sessionId])) === 1 &&
  (await val(`select reps from public.watch_sessions where session_id=$1`, [watchBody.sessionId])) === 10, 'resending a sessionId replaces the row');
e = await rpcErr('submit_watch_session', [J({ ...watchBody, patientId: 'p-maria' })]);
ok(e?.code === 'PT409', 'sessionId cannot move to another patient -> PT409', e);
e = await rpcErr('submit_watch_session', [J({ ...watchBody, sessionId: 'x-2', patientId: 'p-nobody' })]);
ok(e?.code === 'PT404', 'watch session unknown patient -> PT404', e);
e = await rpcErr('submit_watch_session', [J({ ...watchBody, sessionId: 'x-3', exercise: 'hand_open' })]);
ok(e?.code === 'PT400', 'watch session rejects unknown exercise', e);
e = await rpcErr('submit_watch_session', [J({ ...watchBody, sessionId: 'x-4', bestElevationDeg: 'NaN' })]);
ok(e?.code === 'PT400', 'watch session rejects NaN', e);

// --- apply_rule_results ---------------------------------------------------------------------------
console.log('apply_rule_results');
const plateau = { patientId: 'p-james', type: 'plateau', detail: 'Symmetry flat.', createdAt: now.toISOString() };
const ar1 = await rpc('apply_rule_results', ['p-james', J([plateau]), null]);
ok(J(ar1.alertsCreated) === '[]' && ar1.planSuggested === null, 'a second open alert of the same type is ignored', ar1);
const pain = { patientId: 'p-maria', type: 'pain', detail: 'Patient reported pain 8/10.', createdAt: now.toISOString() };
const ar2 = await rpc('apply_rule_results', ['p-maria', J([pain]), null]);
ok(ar2.alertsCreated.length === 1 && ar2.alertsCreated[0].type === 'pain' && ar2.alertsCreated[0].acknowledged === false, 'new alert type is created', ar2);
const ar3 = await rpc('apply_rule_results', ['p-maria', J([pain]), null]);
ok(ar3.alertsCreated.length === 0, 'same alert again is deduped by the DB', ar3);
const newPlan = { patientId: 'p-maria', phase: 3, exercises: [{ exercise: 'arm_raise', reps: 10, target: 110 }], sessionsPerWeek: 5,
  nextCheckin: '2030-01-01', createdAt: now.toISOString(), kind: 'phase-up', reason: 'r', basedOn: { sessions: 3, avgSymmetry: 70, avgCompensation: 10 } };
await ensureSuggested('p-maria', 3);
const ar4 = await rpc('apply_rule_results', ['p-maria', '[]', J(newPlan)]);
ok(ar4.planSuggested === null, 'a second suggested plan is ignored (one open suggestion)', ar4);
e = await rpcErr('apply_rule_results', ['p-maria', J([{ type: 'diagnosis', detail: 'x' }]), null]);
ok(e?.code === 'PT400', 'unknown alert type rejected', e);

// --- ack_alert ---------------------------------------------------------------------------------------
console.log('ack_alert');
const acked = await rpc('ack_alert', [ar2.alertsCreated[0].id]);
ok(acked.acknowledged === true && !!acked.acknowledgedAt, 'ack_alert acknowledges', acked);
const ar5 = await rpc('apply_rule_results', ['p-maria', J([pain]), null]);
ok(ar5.alertsCreated.length === 1, 'after acknowledging, a new alert of that type may open', ar5);
e = await rpcErr('ack_alert', ['al-nope']);
ok(e?.code === 'PT404', 'ack_alert unknown -> PT404', e);

// --- approve_plan --------------------------------------------------------------------------------------
console.log('approve_plan');
const jamesSuggested = await ensureSuggested('p-james', 3);
const jamesApprovedBefore = await val(`select id from public.plans where patient_id='p-james' and status='approved'`);
const checkin = await val(`select (current_date + 5)::text`);
const ap = await rpc('approve_plan', [jamesSuggested, 'Dr. Chen', J({ phase: 3, nextCheckin: checkin })]);
ok(ap.status === 'approved' && ap.approvedBy === 'Dr. Chen' && ap.phase === 3 && !!ap.approvedAt, 'approve_plan approves with overrides', ap);
ok((await val(`select status from public.plans where id=$1`, [jamesApprovedBefore])) === 'superseded' &&
   (await val(`select superseded_at is not null from public.plans where id=$1`, [jamesApprovedBefore])) === true, 'approve_plan supersedes the old approved plan');
const jp = await one(`select phase, next_checkin::text nc from public.patients where id='p-james'`);
ok(jp.phase === 3 && jp.nc === checkin, 'approve_plan mirrors phase + next check-in onto the patient', jp);
ok((await val(`select count(*)::int from public.plans where patient_id='p-james' and status='approved'`)) === 1, 'still exactly one approved plan');
e = await rpcErr('approve_plan', [jamesSuggested, 'Dr. Chen', '{}']);
ok(e?.code === 'PT409', 'approving a non-suggested plan -> PT409', e);
e = await rpcErr('approve_plan', ['plan-nope', 'Dr. Chen', '{}']);
ok(e?.code === 'PT404', 'approve unknown plan -> PT404', e);
e = await rpcErr('approve_plan', [await ensureSuggested('p-maria', 3), '', '{}']);
ok(e?.code === 'PT400', 'approve without approvedBy -> PT400', e);
// Approve with NO overrides still mirrors (router.js:522 bug fix).
const mariaSugg = await ensureSuggested('p-maria', 3);
const mariaSuggPhase = await val(`select phase from public.plans where id=$1`, [mariaSugg]);
await rpc('approve_plan', [mariaSugg, 'Dr. Chen']);
ok((await val(`select phase from public.patients where id='p-maria'`)) === mariaSuggPhase, 'approve without overrides (default arg) mirrors phase');

// --- dismiss_plan ------------------------------------------------------------------------------------------
console.log('dismiss_plan');
e = await rpcErr('dismiss_plan', [jamesSuggested, 'Dr. Chen']);
ok(e?.code === 'PT409', 'dismissing an approved plan -> PT409', e);

// --- save_plan ------------------------------------------------------------------------------------------------
console.log('save_plan');
const priyaSugg = await ensureSuggested('p-priya', 1);
const priyaApproved = await val(`select id from public.plans where patient_id='p-priya' and status='approved'`);
const nc2 = await val(`select (current_date + 10)::text`);
const saved = await rpc('save_plan', ['p-priya', J({ approvedBy: 'Dr. Patel', phase: 2,
  exercises: [{ exercise: 'arm_raise', reps: 9, target: 95 }, { exercise: 'hand_open', reps: 11, target: 60 }], sessionsPerWeek: 4, nextCheckin: nc2 }), 'Dr. Patel']);
ok(saved.status === 'approved' && saved.phase === 2 && saved.exercises.length === 2 && saved.sessionsPerWeek === 4, 'save_plan inserts a new approved plan', saved);
const ds = await one(`select status, dismissed_by from public.plans where id=$1`, [priyaSugg]);
ok(ds.status === 'dismissed' && ds.dismissed_by === 'Dr. Patel', 'save_plan dismisses the open suggestion', ds);
ok((await val(`select status from public.plans where id=$1`, [priyaApproved])) === 'superseded', 'save_plan supersedes the old approved plan');
const pp = await one(`select phase, next_checkin::text nc from public.patients where id='p-priya'`);
ok(pp.phase === 2 && pp.nc === nc2, 'save_plan mirrors phase + check-in', pp);
e = await rpcErr('save_plan', ['p-priya', J({ phase: 2, exercises: [{ exercise: 'arm_raise', reps: 0, target: 95 }], sessionsPerWeek: 4, nextCheckin: nc2 }), 'Dr. Patel']);
ok(e?.code === 'PT400', 'save_plan validates exercises', e);

// --- dismiss on a fresh suggestion ------------------------------------------------------------------------------
const ar6 = await rpc('apply_rule_results', ['p-priya', '[]', J({ ...newPlan, patientId: 'p-priya', phase: 2 })]);
ok(ar6.planSuggested?.status === 'suggested' && ar6.planSuggested.kind === 'phase-up', 'apply_rule_results inserts a plan when none is open', ar6);
const dis = await rpc('dismiss_plan', [ar6.planSuggested.id, 'Dr. Patel']);
ok(dis.status === 'dismissed' && dis.dismissedBy === 'Dr. Patel' && !!dis.dismissedAt, 'dismiss_plan dismisses a suggestion', dis);

// --- set_next_checkin -----------------------------------------------------------------------------------------------
console.log('set_next_checkin');
const nc3 = await val(`select (current_date + 3)::text`);
const pt = await rpc('set_next_checkin', ['p-james', nc3]);
ok(pt.nextCheckin === nc3 && pt.weakSide === 'right' && pt.bpLimitSys === 145, 'set_next_checkin returns Patient', pt);
ok((await val(`select next_checkin::text from public.plans where patient_id='p-james' and status='approved'`)) === nc3, 'set_next_checkin updates the approved plan');
e = await rpcErr('set_next_checkin', ['p-james', '2000-01-01']);
ok(e?.code === 'PT400', 'set_next_checkin rejects past dates', e);
e = await rpcErr('set_next_checkin', ['p-nobody', nc3]);
ok(e?.code === 'PT404', 'set_next_checkin unknown patient -> PT404', e);

// --- Seed re-run resets everything ------------------------------------------------------------------------------------
await db.exec(seed);
const again = await one(snapshotSql);
ok(J(again) === J(seedSnapshot), 'seed re-run restores the demo state', { seedSnapshot, again });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('Failures:\n - ' + failures.join('\n - '));
  process.exit(1);
}
await db.close();
