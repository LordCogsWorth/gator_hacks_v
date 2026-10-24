-- =============================================================================
-- RehabTrack (Ctrl+Alt+Heal) - Supabase schema, RPCs, RLS, storage.
-- CONVERGENCE_PLAN.md §5.2. Folds in justin/watch-daily + justin/watch-sessions
-- (with fixes: merge semantics, FK to patients, range checks, NaN rejection,
-- pinned search_path) and Raghav/api's data model.
--
-- Apply: Supabase -> SQL Editor -> paste this whole file -> Run (then seed.sql),
-- or `supabase db push`. Safe to run more than once.
--
-- Access model (DEMO ONLY, fake data):
--   * anon/authenticated may SELECT every table (public demo read).
--   * No direct INSERT/UPDATE/DELETE. Every write goes through the
--     SECURITY DEFINER RPCs below, which validate input.
--   * upsert_summary is service_role only (Edge Function weekly-summary).
-- Replace the demo_read policies with real auth before any real patient data.
--
-- Errors: PT400 invalid input, PT404 not found, PT409 conflict
-- (PostgREST maps PTxyz to HTTP status xyz). CHECK (23514) and unique
-- (23505) violations surface raw and are mapped client-side.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- 0. Helpers (schema private; not reachable through PostgREST)
-- -----------------------------------------------------------------------------

-- Number from a JSON body. Accepts JSON numbers and numeric strings, including
-- Shortcut-style "1,234". Blank/missing -> null. NaN/Infinity -> friendly error.
create or replace function private.num(b jsonb, key text) returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(trim(replace(b->>key, ',', '')), '');
  n numeric;
begin
  if v is null then return null; end if;
  if jsonb_typeof(b->key) not in ('number', 'string') then
    raise exception using errcode = 'PT400', message = format('%s must be a number', key);
  end if;
  begin
    n := v::numeric;
  exception when others then
    raise exception using errcode = 'PT400', message = format('%s must be a number (got "%s")', key, b->>key);
  end;
  if n = 'NaN'::numeric or n = 'Infinity'::numeric or n = '-Infinity'::numeric then
    raise exception using errcode = 'PT400', message = format('%s must be a number', key);
  end if;
  return n;
end;
$$;

-- Strict number: must be a JSON number (not a string). Used for app payloads
-- (ExerciseResult), mirroring validate.js isFiniteNumber.
create or replace function private.strict_num(b jsonb, key text, required boolean default true) returns numeric
language plpgsql immutable set search_path = '' as $$
begin
  if b->key is null or jsonb_typeof(b->key) = 'null' then
    if required then
      raise exception using errcode = 'PT400', message = format('%s must be a finite number', key);
    end if;
    return null;
  end if;
  if jsonb_typeof(b->key) <> 'number' then
    raise exception using errcode = 'PT400', message = format('%s must be a finite number', key);
  end if;
  return (b->>key)::numeric;
end;
$$;

-- Readings that can't really be 0 (heart rate, blood pressure): the Shortcut
-- sends 0 when there is no reading, so 0 means "no data".
create or replace function private.reading(b jsonb, key text) returns numeric
language sql immutable set search_path = '' as $$
  select nullif(private.num(b, key), 0);
$$;

-- Percent (walking steadiness): Health may give 0.85 or 85 for 85 %. Store 0-100.
create or replace function private.pct(b jsonb, key text) returns numeric
language sql immutable set search_path = '' as $$
  select case when v > 0 and v <= 1 then v * 100 else v end
  from (select private.num(b, key) as v) s;
$$;

-- Timestamp: ISO-8601 with a time (rejects words like 'yesterday') or epoch
-- milliseconds (2000..2100, catches epoch seconds sent by mistake).
create or replace function private.ts(b jsonb, key text) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  v text := nullif(trim(b->>key), '');
  ms numeric;
begin
  if v is null then
    raise exception using errcode = 'PT400', message = format('%s is required', key);
  end if;
  if jsonb_typeof(b->key) = 'number' then
    ms := (b->>key)::numeric;
    if ms < 946684800000 or ms > 4102444800000 then
      raise exception using errcode = 'PT400', message = format('%s must be an ISO-8601 time or epoch milliseconds', key);
    end if;
    return to_timestamp(ms / 1000.0);
  end if;
  if v !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then
    raise exception using errcode = 'PT400', message = format('%s must be an ISO-8601 time (got "%s")', key, v);
  end if;
  begin
    return v::timestamptz;
  exception when others then
    raise exception using errcode = 'PT400', message = format('%s must be an ISO-8601 time (got "%s")', key, v);
  end;
end;
$$;

-- Date: YYYY-MM-DD and a real calendar day ("2026-02-30" -> friendly error).
create or replace function private.date(b jsonb, key text) returns date
language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(trim(b->>key), '');
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode = 'PT400', message = format('%s must be YYYY-MM-DD (got "%s")', key, coalesce(b->>key, ''));
  end if;
  begin
    return v::date;
  exception when others then
    raise exception using errcode = 'PT400', message = format('%s must be a real YYYY-MM-DD', key);
  end;
end;
$$;

-- Optional short text: trimmed, blank -> null, length-capped.
create or replace function private.txt(b jsonb, key text, max_len int default 80) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(trim(b->>key), '');
begin
  if v is not null and length(v) > max_len then
    raise exception using errcode = 'PT400', message = format('%s must be at most %s characters', key, max_len);
  end if;
  return v;
end;
$$;

-- Whole number in [lo, hi] (optional unless required).
create or replace function private.int_in(b jsonb, key text, lo int, hi int, required boolean default false) returns int
language plpgsql immutable set search_path = '' as $$
declare
  n numeric := private.num(b, key);
begin
  if n is null then
    if required then
      raise exception using errcode = 'PT400', message = format('%s is required (whole number %s to %s)', key, lo, hi);
    end if;
    return null;
  end if;
  if n <> trunc(n) or n < lo or n > hi then
    raise exception using errcode = 'PT400', message = format('%s must be a whole number from %s to %s', key, lo, hi);
  end if;
  return n::int;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

create table if not exists public.patients (
  id              text primary key check (id ~ '^[a-z0-9-]{1,64}$'),
  name            text not null check (length(name) between 1 and 80),
  weak_side       text not null check (weak_side in ('left', 'right')),
  stroke_date     date not null,
  phase           int not null default 1 check (phase between 1 and 4),
  max_raise_angle numeric not null default 120 check (max_raise_angle between 30 and 180),
  bp_limit_sys    numeric not null default 140 check (bp_limit_sys between 90 and 220),
  next_checkin    date not null default (current_date + 14),
  created_at      timestamptz not null default now()
);

create table if not exists public.plans (
  id                text primary key default ('plan-' || replace(gen_random_uuid()::text, '-', '')),
  patient_id        text not null references public.patients (id) on delete cascade,
  phase             int not null check (phase between 1 and 4),
  exercises         jsonb not null check (jsonb_typeof(exercises) = 'array' and jsonb_array_length(exercises) between 1 and 6),
  sessions_per_week int not null check (sessions_per_week between 1 and 14),
  status            text not null check (status in ('suggested', 'approved', 'superseded', 'dismissed')),
  approved_by       text check (length(approved_by) <= 80),
  next_checkin      date not null,
  approved_at       timestamptz,
  superseded_at     timestamptz,
  dismissed_at      timestamptz,
  dismissed_by      text check (length(dismissed_by) <= 80),
  kind              text check (kind in ('phase-up', 'plateau', 'compensation')),
  reason            text check (length(reason) <= 500),
  based_on          jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists plans_patient on public.plans (patient_id, created_at desc);
-- At most one open suggestion and one approved plan per patient.
create unique index if not exists plans_one_suggested on public.plans (patient_id) where status = 'suggested';
create unique index if not exists plans_one_approved on public.plans (patient_id) where status = 'approved';

create table if not exists public.sessions (
  id          text primary key default ('sess-' || replace(gen_random_uuid()::text, '-', '')),
  patient_id  text not null references public.patients (id) on delete cascade,
  client_key  text unique check (length(client_key) <= 64),
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  pain        smallint check (pain between 0 and 10),
  tiredness   smallint check (tiredness between 1 and 5),
  stop_reason text check (stop_reason in ('pain', 'dizziness', 'other')),
  avg_hr      numeric check (avg_hr between 30 and 220),
  created_at  timestamptz not null default now(),
  check (ended_at >= started_at and ended_at - started_at < interval '3 hours')
);
create index if not exists sessions_patient_time on public.sessions (patient_id, started_at desc);

create table if not exists public.exercise_results (
  id                bigint generated always as identity primary key,
  session_id        text not null references public.sessions (id) on delete cascade,
  exercise          text not null check (exercise in ('arm_raise', 'forward_reach', 'hand_open')),
  side              text not null check (side in ('weak', 'healthy')),
  best_value        numeric not null check (best_value between 0 and 180),
  reps              int not null check (reps between 0 and 200),
  sec_per_rep       numeric not null check (sec_per_rep between 0 and 120),
  smoothness        numeric not null check (smoothness between 0 and 50),
  fatigue           numeric not null check (fatigue between 0 and 5),
  trunk_lean_max    numeric not null check (trunk_lean_max between 0 and 90),
  shoulder_hike_max numeric not null check (shoulder_hike_max between 0 and 0.5),
  comp_rep_pct      numeric not null check (comp_rep_pct between 0 and 100),
  reach_cm          numeric check (reach_cm between 0 and 150),
  closed_min        numeric check (closed_min between 0 and 100),
  created_at        timestamptz not null default now(),
  unique (session_id, exercise, side)
);

create table if not exists public.session_replays (
  session_id    text not null references public.sessions (id) on delete cascade,
  exercise      text not null check (exercise in ('arm_raise', 'forward_reach', 'hand_open')),
  side          text not null check (side in ('weak', 'healthy')),
  path          text not null check (length(path) between 1 and 200), -- '<sid>/<ex>-<side>.json' or 'synth:<seed>'
  fps           int not null default 15,
  frame_count   int check (frame_count between 1 and 1800),
  seconds       numeric check (seconds between 0 and 600),
  warning_count int not null default 0 check (warning_count >= 0),
  uploaded_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  primary key (session_id, exercise, side)
);

create table if not exists public.watch_daily (
  id                  bigint generated always as identity primary key,
  patient_id          text not null references public.patients (id) on delete cascade,
  date                date not null check (date <= current_date + 1),
  steps               numeric check (steps between 0 and 100000),
  exercise_min        numeric check (exercise_min between 0 and 1440),
  stand_hr            numeric check (stand_hr between 0 and 24),
  resting_hr          numeric check (resting_hr between 25 and 220),
  hrv                 numeric check (hrv between 0 and 300),
  sleep_hr            numeric check (sleep_hr between 0 and 24),
  bp_sys              numeric check (bp_sys between 50 and 260),
  bp_dia              numeric check (bp_dia between 30 and 160),
  falls               numeric check (falls between 0 and 50),
  walking_steadiness  numeric check (walking_steadiness between 0 and 100),
  weak_arm_active_min numeric check (weak_arm_active_min between 0 and 1440),
  use_ratio           numeric check (use_ratio between 0 and 3),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (patient_id, date)
);

create table if not exists public.watch_sessions (
  id                 bigint generated always as identity primary key,
  session_id         text not null unique check (length(session_id) <= 64),   -- made by the watch (UUID)
  patient_id         text not null references public.patients (id) on delete cascade,
  exercise           text not null check (exercise in ('arm_raise', 'forward_reach')),
  arm                text check (arm in ('left', 'right')),                    -- wrist the watch is on
  started_at         timestamptz not null,
  ended_at           timestamptz not null,
  duration_sec       numeric generated always as (extract(epoch from ended_at - started_at)) stored,
  target_reps        int check (target_reps between 0 and 1000),
  reps               int check (reps between 0 and 1000),
  attempts           int check (attempts between 0 and 1000),
  best_elevation_deg numeric check (best_elevation_deg between 0 and 180),
  completed          boolean,
  avg_hr             numeric check (avg_hr between 25 and 240),
  max_hr             numeric check (max_hr between 25 and 240),
  min_hr             numeric check (min_hr between 25 and 240),
  rep_log            jsonb check (rep_log is null or (jsonb_typeof(rep_log) = 'array' and jsonb_array_length(rep_log) <= 200)),
  trace              jsonb check (trace is null or pg_column_size(trace) <= 2097152),
  app_session_id     text check (length(app_session_id) <= 64),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index if not exists watch_sessions_patient_time on public.watch_sessions (patient_id, started_at desc);

create table if not exists public.alerts (
  id              text primary key default ('al-' || replace(gen_random_uuid()::text, '-', '')),
  patient_id      text not null references public.patients (id) on delete cascade,
  type            text not null check (type in ('plateau', 'setback', 'compensation', 'adherence', 'pain',
                                                'safety-stop', 'heart-rate', 'blood-pressure', 'fall')),
  detail          text not null check (length(detail) <= 500),
  acknowledged    boolean not null default false,
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists alerts_patient on public.alerts (patient_id, created_at desc);
-- One open alert per patient and type: concurrent rule runs yield one row.
create unique index if not exists alerts_one_open on public.alerts (patient_id, type) where not acknowledged;

create table if not exists public.patient_summaries (
  patient_id text not null references public.patients (id) on delete cascade,
  week_start date not null,
  text       text not null check (length(text) <= 1200),
  model      text check (length(model) <= 80),
  source     text not null default 'pregenerated' check (source in ('pregenerated', 'llm')),
  created_at timestamptz not null default now(),
  primary key (patient_id, week_start)
);

-- -----------------------------------------------------------------------------
-- 2. Row -> camelCase JSON (matches web/src/types.ts)
-- -----------------------------------------------------------------------------

create or replace function private.patient_json(p public.patients) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'weakSide', p.weak_side, 'strokeDate', p.stroke_date,
    'phase', p.phase, 'maxRaiseAngle', p.max_raise_angle, 'nextCheckin', p.next_checkin,
    'bpLimitSys', p.bp_limit_sys);
$$;

create or replace function private.plan_json(p public.plans) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
      'id', p.id, 'patientId', p.patient_id, 'phase', p.phase, 'exercises', p.exercises,
      'sessionsPerWeek', p.sessions_per_week, 'status', p.status, 'approvedBy', p.approved_by,
      'nextCheckin', p.next_checkin, 'createdAt', p.created_at)
    || jsonb_strip_nulls(jsonb_build_object(
      'approvedAt', p.approved_at, 'dismissedAt', p.dismissed_at, 'dismissedBy', p.dismissed_by,
      'supersededAt', p.superseded_at, 'kind', p.kind, 'reason', p.reason, 'basedOn', p.based_on));
$$;

create or replace function private.alert_json(a public.alerts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
      'id', a.id, 'patientId', a.patient_id, 'type', a.type, 'detail', a.detail,
      'createdAt', a.created_at, 'acknowledged', a.acknowledged)
    || jsonb_strip_nulls(jsonb_build_object('acknowledgedAt', a.acknowledged_at));
$$;

create or replace function private.result_json(r public.exercise_results) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id::text, 'sessionId', r.session_id, 'exercise', r.exercise, 'side', r.side,
    'bestValue', r.best_value, 'reps', r.reps, 'secPerRep', r.sec_per_rep, 'smoothness', r.smoothness,
    'fatigue', r.fatigue, 'trunkLeanMax', r.trunk_lean_max, 'shoulderHikeMax', r.shoulder_hike_max,
    'compRepPct', r.comp_rep_pct, 'reachCm', r.reach_cm, 'closedMin', r.closed_min);
$$;

-- SessionRow (Session without results/symmetry/compensation/symmetryByExercise).
create or replace function private.session_json(s public.sessions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'patientId', s.patient_id, 'startedAt', s.started_at, 'endedAt', s.ended_at,
    'pain', s.pain, 'tiredness', s.tiredness, 'stopReason', s.stop_reason, 'avgHr', s.avg_hr,
    'replays', coalesce((
      select jsonb_agg(r.session_id || '-' || r.exercise || '-' || r.side order by r.exercise, r.side)
      from public.session_replays r where r.session_id = s.id), '[]'::jsonb));
$$;

-- ReplaySummary + ReplayRow fields (sessionId, path) in one object.
create or replace function private.replay_json(r public.session_replays) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'key', r.session_id || '-' || r.exercise || '-' || r.side, 'sessionId', r.session_id,
    'exercise', r.exercise, 'side', r.side, 'path', r.path, 'fps', r.fps,
    'frameCount', r.frame_count, 'seconds', r.seconds, 'warningCount', r.warning_count,
    'uploadedAt', r.uploaded_at);
$$;

create or replace function private.watch_daily_json(w public.watch_daily) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', w.id::text, 'patientId', w.patient_id, 'date', w.date, 'steps', w.steps,
    'exerciseMin', w.exercise_min, 'standHr', w.stand_hr, 'restingHr', w.resting_hr, 'hrv', w.hrv,
    'sleepHr', w.sleep_hr, 'bpSys', w.bp_sys, 'bpDia', w.bp_dia, 'falls', w.falls,
    'walkingSteadiness', w.walking_steadiness, 'weakArmActiveMin', w.weak_arm_active_min,
    'useRatio', w.use_ratio, 'updatedAt', w.updated_at);
$$;

-- Validate + normalise a PlanExercise[] (keeps only exercise/reps/target).
create or replace function private.clean_exercises(v jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  e jsonb;
  out jsonb := '[]'::jsonb;
  i int := 0;
  seen text[] := '{}';
begin
  if v is null or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 6 then
    raise exception using errcode = 'PT400', message = 'exercises must be an array of 1 to 6 items';
  end if;
  for e in select * from jsonb_array_elements(v) loop
    if jsonb_typeof(e) <> 'object' or coalesce(e->>'exercise', '') not in ('arm_raise', 'forward_reach', 'hand_open') then
      raise exception using errcode = 'PT400', message = format('exercises[%s].exercise must be arm_raise, forward_reach or hand_open', i);
    end if;
    if (e->>'exercise') = any (seen) then
      raise exception using errcode = 'PT400', message = format('exercises[%s] duplicates %s', i, e->>'exercise');
    end if;
    seen := seen || (e->>'exercise');
    if jsonb_typeof(e->'reps') <> 'number' or (e->>'reps')::numeric <> trunc((e->>'reps')::numeric)
       or (e->>'reps')::numeric not between 1 and 200 then
      raise exception using errcode = 'PT400', message = format('exercises[%s].reps must be a whole number from 1 to 200', i);
    end if;
    if jsonb_typeof(e->'target') <> 'number' or (e->>'target')::numeric <= 0 or (e->>'target')::numeric > 180 then
      raise exception using errcode = 'PT400', message = format('exercises[%s].target must be a number above 0 and at most 180', i);
    end if;
    out := out || jsonb_build_array(jsonb_build_object(
      'exercise', e->>'exercise', 'reps', (e->>'reps')::int, 'target', (e->>'target')::numeric));
    i := i + 1;
  end loop;
  return out;
end;
$$;

create or replace function private.require_patient(p_id text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_id is null or not exists (select 1 from public.patients where id = p_id) then
    raise exception using errcode = 'PT404', message = 'Unknown patient';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Write RPCs (SECURITY DEFINER, search_path pinned to '')
--    Ingest RPCs take ONE UNNAMED jsonb parameter so PostgREST passes the raw
--    request body (the iPhone Shortcut and the watch post the contract JSON as-is).
-- -----------------------------------------------------------------------------

-- Route A: iPhone Shortcut daily health row. MERGE semantics: a field that is
-- omitted, null, blank (or 0 for readings) keeps its previous value.
create or replace function public.submit_watch_daily(jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b   jsonb := $1;
  pid text;
  d   date;
  r   public.watch_daily;
begin
  if b is null or jsonb_typeof(b) <> 'object' then
    raise exception using errcode = 'PT400', message = 'body must be a JSON object';
  end if;
  pid := nullif(trim(b->>'patientId'), '');
  if pid is null then raise exception using errcode = 'PT400', message = 'patientId is required'; end if;
  perform private.require_patient(pid);
  d := private.date(b, 'date');
  if d > current_date + 1 then
    raise exception using errcode = 'PT400', message = format('date %s is in the future', d);
  end if;

  insert into public.watch_daily as w (
    patient_id, date, steps, exercise_min, stand_hr, resting_hr, hrv, sleep_hr, bp_sys, bp_dia, falls,
    walking_steadiness, weak_arm_active_min, use_ratio
  ) values (
    pid, d,
    private.num(b, 'steps'), private.num(b, 'exerciseMin'), private.num(b, 'standHr'),
    private.reading(b, 'restingHr'), private.reading(b, 'hrv'), private.num(b, 'sleepHr'),
    private.reading(b, 'bpSys'), private.reading(b, 'bpDia'), private.num(b, 'falls'),
    nullif(private.pct(b, 'walkingSteadiness'), 0),
    private.num(b, 'weakArmActiveMin'), private.num(b, 'useRatio')
  )
  on conflict (patient_id, date) do update set
    steps               = coalesce(excluded.steps, w.steps),
    exercise_min        = coalesce(excluded.exercise_min, w.exercise_min),
    stand_hr            = coalesce(excluded.stand_hr, w.stand_hr),
    resting_hr          = coalesce(excluded.resting_hr, w.resting_hr),
    hrv                 = coalesce(excluded.hrv, w.hrv),
    sleep_hr            = coalesce(excluded.sleep_hr, w.sleep_hr),
    bp_sys              = coalesce(excluded.bp_sys, w.bp_sys),
    bp_dia              = coalesce(excluded.bp_dia, w.bp_dia),
    falls               = coalesce(excluded.falls, w.falls),
    walking_steadiness  = coalesce(excluded.walking_steadiness, w.walking_steadiness),
    weak_arm_active_min = coalesce(excluded.weak_arm_active_min, w.weak_arm_active_min),
    use_ratio           = coalesce(excluded.use_ratio, w.use_ratio),
    updated_at          = now()
  returning * into r;

  -- WatchDaily (camelCase) plus Justin's {ok, patientId, date, updatedAt}.
  return jsonb_build_object('ok', true) || private.watch_daily_json(r);
end;
$$;

-- Route B: one summary per watch exercise session. Idempotent on sessionId;
-- a sessionId can never move to another patient. Back-fills sessions.avg_hr
-- for camera sessions that overlap in time (±5 min).
create or replace function public.submit_watch_session(jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b    jsonb := $1;
  sid  text;
  pid  text;
  ex   text;
  side text;
  t0   timestamptz;
  t1   timestamptz;
  tr   jsonb;
  rl   jsonb;
  done boolean;
  n_up int := 0;
  r    public.watch_sessions;
begin
  if b is null or jsonb_typeof(b) <> 'object' then
    raise exception using errcode = 'PT400', message = 'body must be a JSON object';
  end if;
  sid := private.txt(b, 'sessionId', 64);
  pid := nullif(trim(b->>'patientId'), '');
  ex := lower(trim(coalesce(b->>'exercise', '')));
  side := nullif(lower(trim(coalesce(b->>'arm', ''))), '');
  tr := b->'trace';
  rl := b->'repLog';
  if sid is null then raise exception using errcode = 'PT400', message = 'sessionId is required'; end if;
  if pid is null then raise exception using errcode = 'PT400', message = 'patientId is required'; end if;
  perform private.require_patient(pid);
  if ex = 'side_raise' then ex := 'arm_raise'; end if;  -- watch app name -> contract name
  if ex not in ('arm_raise', 'forward_reach') then
    raise exception using errcode = 'PT400', message = format('exercise must be arm_raise or forward_reach (got "%s")', b->>'exercise');
  end if;
  if side is not null and side not in ('left', 'right') then
    raise exception using errcode = 'PT400', message = 'arm must be left or right';
  end if;
  t0 := private.ts(b, 'startedAt');
  t1 := private.ts(b, 'endedAt');
  if t1 < t0 then raise exception using errcode = 'PT400', message = 'endedAt is before startedAt'; end if;
  if tr is not null and jsonb_typeof(tr) = 'null' then tr := null; end if;
  if rl is not null and jsonb_typeof(rl) = 'null' then rl := null; end if;
  if tr is not null and jsonb_typeof(tr) <> 'object' then
    raise exception using errcode = 'PT400', message = 'trace must be an object';
  end if;
  if rl is not null and (jsonb_typeof(rl) <> 'array' or jsonb_array_length(rl) > 200) then
    raise exception using errcode = 'PT400', message = 'repLog must be an array of at most 200 items';
  end if;
  -- Note: PostgREST has already parsed the body by now; this only caps what is stored.
  if octet_length(coalesce(tr, '{}'::jsonb)::text) > 2000000 then
    raise exception using errcode = 'PT400', message = 'trace is too large (max ~2 MB)';
  end if;
  done := case jsonb_typeof(b->'completed') when 'boolean' then (b->>'completed')::boolean else null end;

  insert into public.watch_sessions as w (
    session_id, patient_id, exercise, arm, started_at, ended_at, target_reps, reps, attempts,
    best_elevation_deg, completed, avg_hr, max_hr, min_hr, rep_log, trace, app_session_id
  ) values (
    sid, pid, ex, side, t0, t1,
    private.int_in(b, 'targetReps', 0, 1000), private.int_in(b, 'reps', 0, 1000), private.int_in(b, 'attempts', 0, 1000),
    private.num(b, 'bestElevationDeg'),
    coalesce(done, private.num(b, 'reps') >= private.num(b, 'targetReps')),
    private.reading(b, 'avgHr'), private.reading(b, 'maxHr'), private.reading(b, 'minHr'),
    rl, tr, private.txt(b, 'appSessionId', 64)
  )
  on conflict (session_id) do update set
    exercise = excluded.exercise, arm = excluded.arm,
    started_at = excluded.started_at, ended_at = excluded.ended_at,
    target_reps = excluded.target_reps, reps = excluded.reps, attempts = excluded.attempts,
    best_elevation_deg = excluded.best_elevation_deg, completed = excluded.completed,
    avg_hr = excluded.avg_hr, max_hr = excluded.max_hr, min_hr = excluded.min_hr,
    rep_log = excluded.rep_log, trace = excluded.trace, app_session_id = excluded.app_session_id,
    updated_at = now()
  where w.patient_id = excluded.patient_id
  returning * into r;

  if not found then
    raise exception using errcode = 'PT409', message = 'sessionId belongs to another patient';
  end if;

  -- Fill in heart rate on overlapping camera sessions that have none yet.
  if r.avg_hr between 30 and 220 then
    update public.sessions s
       set avg_hr = round(r.avg_hr)
     where s.patient_id = pid
       and s.avg_hr is null
       and tstzrange(s.started_at, s.ended_at, '[]') && tstzrange(t0 - interval '5 minutes', t1 + interval '5 minutes', '[]');
    get diagnostics n_up = row_count;
  end if;

  return jsonb_build_object('ok', true, 'sessionId', r.session_id, 'patientId', r.patient_id,
                            'updatedAt', r.updated_at, 'sessionsUpdated', n_up);
end;
$$;

-- Camera session + results in one transaction. Body = SessionUploadBody.
-- Idempotent on clientKey: re-sending returns the existing session.
create or replace function public.submit_session(jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      jsonb := $1;
  pid    text;
  ck     text;
  t0     timestamptz;
  t1     timestamptz;
  stop   text;
  res    jsonb;
  e      jsonb;
  i      int := 0;
  seen   text[] := '{}';
  hr     numeric;
  s      public.sessions;
  f      text;
begin
  if b is null or jsonb_typeof(b) <> 'object' then
    raise exception using errcode = 'PT400', message = 'body must be a JSON object';
  end if;
  pid := nullif(trim(b->>'patientId'), '');
  if pid is null then raise exception using errcode = 'PT400', message = 'patientId is required'; end if;
  perform private.require_patient(pid);
  ck := private.txt(b, 'clientKey', 64);

  -- Idempotency: same clientKey -> same session, nothing new written.
  if ck is not null then
    select * into s from public.sessions where client_key = ck;
    if found then
      if s.patient_id <> pid then
        raise exception using errcode = 'PT409', message = 'clientKey belongs to another patient';
      end if;
      return jsonb_build_object(
        'session', private.session_json(s),
        'results', coalesce((select jsonb_agg(private.result_json(r) order by r.id)
                             from public.exercise_results r where r.session_id = s.id), '[]'::jsonb),
        'duplicate', true);
    end if;
  end if;

  t0 := private.ts(b, 'startedAt');
  t1 := private.ts(b, 'endedAt');
  if t1 < t0 then raise exception using errcode = 'PT400', message = 'endedAt is before startedAt'; end if;
  if b->'stopReason' is not null and jsonb_typeof(b->'stopReason') <> 'null' then
    stop := b->>'stopReason';
    if stop not in ('pain', 'dizziness', 'other') then
      raise exception using errcode = 'PT400', message = 'stopReason must be one of pain, dizziness, other';
    end if;
  end if;

  res := b->'results';
  if res is null or jsonb_typeof(res) <> 'array'
     or jsonb_array_length(res) > 6
     or jsonb_array_length(res) < (case when stop is null then 1 else 0 end) then
    raise exception using errcode = 'PT400',
      message = 'results must be an array of 1 to 6 exercise results (0 to 6 when stopReason is given)';
  end if;
  for e in select * from jsonb_array_elements(res) loop
    if jsonb_typeof(e) <> 'object' then
      raise exception using errcode = 'PT400', message = format('results[%s] must be an object', i);
    end if;
    if coalesce(e->>'exercise', '') not in ('arm_raise', 'forward_reach', 'hand_open') then
      raise exception using errcode = 'PT400', message = format('results[%s].exercise must be one of arm_raise, forward_reach, hand_open', i);
    end if;
    if coalesce(e->>'side', '') not in ('weak', 'healthy') then
      raise exception using errcode = 'PT400', message = format('results[%s].side must be one of weak, healthy', i);
    end if;
    foreach f in array array['bestValue', 'reps', 'secPerRep', 'smoothness', 'fatigue', 'trunkLeanMax', 'shoulderHikeMax', 'compRepPct'] loop
      if e->f is null or jsonb_typeof(e->f) <> 'number' then
        raise exception using errcode = 'PT400', message = format('results[%s].%s must be a finite number', i, f);
      end if;
    end loop;
    if (e->>'exercise') || '/' || (e->>'side') = any (seen) then
      raise exception using errcode = 'PT400', message = format('results[%s] duplicate %s/%s result', i, e->>'exercise', e->>'side');
    end if;
    seen := seen || ((e->>'exercise') || '/' || (e->>'side'));
    i := i + 1;
  end loop;

  hr := private.num(b, 'avgHr');
  if hr is null then
    -- The watch may have uploaded first: take its heart rate.
    select round(avg(w.avg_hr)) into hr
      from public.watch_sessions w
     where w.patient_id = pid and w.avg_hr between 30 and 220
       and tstzrange(w.started_at, w.ended_at, '[]') && tstzrange(t0 - interval '5 minutes', t1 + interval '5 minutes', '[]');
  end if;

  insert into public.sessions (patient_id, client_key, started_at, ended_at, pain, tiredness, stop_reason, avg_hr)
  values (pid, ck, t0, t1,
          private.int_in(b, 'pain', 0, 10), private.int_in(b, 'tiredness', 1, 5), stop, hr)
  on conflict (client_key) do nothing
  returning * into s;

  if not found then
    -- Lost a race with an identical retry: return the winner.
    return public.submit_session(b);
  end if;

  insert into public.exercise_results (session_id, exercise, side, best_value, reps, sec_per_rep, smoothness,
                                       fatigue, trunk_lean_max, shoulder_hike_max, comp_rep_pct, reach_cm, closed_min)
  select s.id, x->>'exercise', x->>'side',
         private.strict_num(x, 'bestValue'), round(private.strict_num(x, 'reps'))::int, private.strict_num(x, 'secPerRep'),
         private.strict_num(x, 'smoothness'), private.strict_num(x, 'fatigue'), private.strict_num(x, 'trunkLeanMax'),
         private.strict_num(x, 'shoulderHikeMax'), private.strict_num(x, 'compRepPct'),
         private.strict_num(x, 'reachCm', false), private.strict_num(x, 'closedMin', false)
    from jsonb_array_elements(res) as x;

  return jsonb_build_object(
    'session', private.session_json(s),
    'results', coalesce((select jsonb_agg(private.result_json(r) order by r.id)
                         from public.exercise_results r where r.session_id = s.id), '[]'::jsonb));
end;
$$;

-- Index row for an uploaded (Storage) or synthetic replay. Upsert.
-- Body: {sessionId, exercise, side, path, fps, frameCount, seconds, warningCount}
create or replace function public.register_replay(jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b    jsonb := $1;
  sid  text;
  ex   text;
  sd   text;
  pth  text;
  r    public.session_replays;
begin
  if b is null or jsonb_typeof(b) <> 'object' then
    raise exception using errcode = 'PT400', message = 'body must be a JSON object';
  end if;
  sid := nullif(trim(b->>'sessionId'), '');
  ex := b->>'exercise';
  sd := b->>'side';
  pth := private.txt(b, 'path', 200);
  if sid is null or not exists (select 1 from public.sessions where id = sid) then
    raise exception using errcode = 'PT404', message = 'Unknown session';
  end if;
  if coalesce(ex, '') not in ('arm_raise', 'forward_reach', 'hand_open') then
    raise exception using errcode = 'PT400', message = 'exercise must be one of arm_raise, forward_reach, hand_open';
  end if;
  if coalesce(sd, '') not in ('weak', 'healthy') then
    raise exception using errcode = 'PT400', message = 'side must be one of weak, healthy';
  end if;
  if pth is null then
    pth := sid || '/' || ex || '-' || sd || '.json';
  end if;
  if pth not like 'synth:%' and pth not like sid || '/%' then
    raise exception using errcode = 'PT400', message = 'path must be "<sessionId>/<exercise>-<side>.json" or "synth:..."';
  end if;

  insert into public.session_replays as x (session_id, exercise, side, path, fps, frame_count, seconds, warning_count, uploaded_at)
  values (sid, ex, sd, pth,
          coalesce(private.int_in(b, 'fps', 1, 120), 15),
          private.int_in(b, 'frameCount', 1, 1800),
          private.num(b, 'seconds'),
          coalesce(private.int_in(b, 'warningCount', 0, 100000), 0),
          now())
  on conflict (session_id, exercise, side) do update set
    path = excluded.path, fps = excluded.fps, frame_count = excluded.frame_count,
    seconds = excluded.seconds, warning_count = excluded.warning_count, uploaded_at = now()
  returning * into r;

  return private.replay_json(r);
end;
$$;

-- Writes the rules engine's output. Alerts and the plan are inserted with
-- ON CONFLICT DO NOTHING (partial unique indexes), so racing windows yield one
-- row. p_alerts: NewAlert[] = [{type, detail, createdAt?, patientId?}]
-- p_plan: NewPlan | null = {phase, exercises, sessionsPerWeek, nextCheckin, createdAt?, kind?, reason?, basedOn?}
-- Returns {alertsCreated: Alert[], planSuggested: Plan|null} (only rows actually inserted).
create or replace function public.apply_rule_results(p_patient_id text, p_alerts jsonb default '[]', p_plan jsonb default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a        jsonb;
  created  jsonb := '[]'::jsonb;
  al       public.alerts;
  pl       public.plans;
  plan_out jsonb := null;
  at_ts    timestamptz;
begin
  perform private.require_patient(p_patient_id);
  if p_alerts is not null and jsonb_typeof(p_alerts) not in ('array', 'null') then
    raise exception using errcode = 'PT400', message = 'p_alerts must be an array';
  end if;

  if p_alerts is not null and jsonb_typeof(p_alerts) = 'array' then
    for a in select * from jsonb_array_elements(p_alerts) loop
      if coalesce(a->>'patientId', p_patient_id) <> p_patient_id then
        raise exception using errcode = 'PT400', message = 'alert patientId does not match p_patient_id';
      end if;
      if coalesce(a->>'type', '') not in ('plateau', 'setback', 'compensation', 'adherence', 'pain',
                                          'safety-stop', 'heart-rate', 'blood-pressure', 'fall') then
        raise exception using errcode = 'PT400', message = format('unknown alert type "%s"', a->>'type');
      end if;
      if nullif(trim(a->>'detail'), '') is null then
        raise exception using errcode = 'PT400', message = 'alert detail is required';
      end if;
      at_ts := case when nullif(a->>'createdAt', '') is null then now() else private.ts(a, 'createdAt') end;
      insert into public.alerts (patient_id, type, detail, created_at)
      values (p_patient_id, a->>'type', left(a->>'detail', 500), least(at_ts, now()))
      on conflict (patient_id, type) where not acknowledged do nothing
      returning * into al;
      if found then created := created || jsonb_build_array(private.alert_json(al)); end if;
    end loop;
  end if;

  if p_plan is not null and jsonb_typeof(p_plan) = 'object' then
    if coalesce(p_plan->>'patientId', p_patient_id) <> p_patient_id then
      raise exception using errcode = 'PT400', message = 'plan patientId does not match p_patient_id';
    end if;
    if p_plan->>'kind' is not null and p_plan->>'kind' not in ('phase-up', 'plateau', 'compensation') then
      raise exception using errcode = 'PT400', message = 'kind must be phase-up, plateau or compensation';
    end if;
    insert into public.plans (patient_id, phase, exercises, sessions_per_week, status, next_checkin,
                              kind, reason, based_on, created_at)
    values (p_patient_id,
            private.int_in(p_plan, 'phase', 1, 4, true),
            private.clean_exercises(p_plan->'exercises'),
            private.int_in(p_plan, 'sessionsPerWeek', 1, 14, true),
            'suggested',
            private.date(p_plan, 'nextCheckin'),
            p_plan->>'kind',
            left(p_plan->>'reason', 500),
            case when jsonb_typeof(p_plan->'basedOn') = 'object' then p_plan->'basedOn' end,
            case when nullif(p_plan->>'createdAt', '') is null then now() else least(private.ts(p_plan, 'createdAt'), now()) end)
    on conflict (patient_id) where status = 'suggested' do nothing
    returning * into pl;
    if found then plan_out := private.plan_json(pl); end if;
  end if;

  return jsonb_build_object('alertsCreated', created, 'planSuggested', plan_out);
end;
$$;

create or replace function public.ack_alert(p_alert_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  al public.alerts;
begin
  update public.alerts
     set acknowledged = true, acknowledged_at = coalesce(acknowledged_at, now())
   where id = p_alert_id
  returning * into al;
  if not found then
    raise exception using errcode = 'PT404', message = 'Unknown alert';
  end if;
  return private.alert_json(al);
end;
$$;

-- Approve a suggested plan (optionally edited). Atomic: supersedes the old
-- approved plan and ALWAYS mirrors phase + next check-in onto the patient.
-- p_overrides: {phase?, exercises?, sessionsPerWeek?, nextCheckin?}
create or replace function public.approve_plan(p_plan_id text, p_approved_by text, p_overrides jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pl  public.plans;
  o   jsonb := coalesce(p_overrides, '{}'::jsonb);
  who text := nullif(trim(p_approved_by), '');
begin
  if who is null or length(who) > 80 then
    raise exception using errcode = 'PT400', message = 'approvedBy is required (at most 80 characters)';
  end if;
  if jsonb_typeof(o) <> 'object' then
    raise exception using errcode = 'PT400', message = 'p_overrides must be an object';
  end if;
  select * into pl from public.plans where id = p_plan_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Unknown plan'; end if;
  if pl.status <> 'suggested' then
    raise exception using errcode = 'PT409', message = format('Plan is %s, not suggested', pl.status);
  end if;
  -- Serialise plan changes per patient.
  perform 1 from public.patients where id = pl.patient_id for update;

  update public.plans
     set status = 'superseded', superseded_at = now()
   where patient_id = pl.patient_id and status = 'approved';

  update public.plans set
    status = 'approved',
    approved_at = now(),
    approved_by = who,
    phase = coalesce(private.int_in(o, 'phase', 1, 4), phase),
    exercises = case when o ? 'exercises' and jsonb_typeof(o->'exercises') <> 'null'
                     then private.clean_exercises(o->'exercises') else exercises end,
    sessions_per_week = coalesce(private.int_in(o, 'sessionsPerWeek', 1, 14), sessions_per_week),
    next_checkin = case when nullif(o->>'nextCheckin', '') is not null
                        then private.date(o, 'nextCheckin') else next_checkin end
  where id = pl.id
  returning * into pl;

  update public.patients set phase = pl.phase, next_checkin = pl.next_checkin where id = pl.patient_id;

  return private.plan_json(pl);
end;
$$;

create or replace function public.dismiss_plan(p_plan_id text, p_dismissed_by text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pl public.plans;
begin
  if p_dismissed_by is not null and length(p_dismissed_by) > 80 then
    raise exception using errcode = 'PT400', message = 'dismissedBy must be at most 80 characters';
  end if;
  select * into pl from public.plans where id = p_plan_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Unknown plan'; end if;
  if pl.status <> 'suggested' then
    raise exception using errcode = 'PT409', message = format('Plan is %s, not suggested', pl.status);
  end if;
  update public.plans
     set status = 'dismissed', dismissed_at = now(), dismissed_by = nullif(trim(p_dismissed_by), '')
   where id = pl.id
  returning * into pl;
  return private.plan_json(pl);
end;
$$;

-- Clinician edits the plan without a suggestion. Inserts a new approved plan,
-- supersedes the old one, dismisses any open suggestion, mirrors phase and
-- check-in onto the patient. p_plan = SavePlanBody
-- {phase, exercises, sessionsPerWeek, nextCheckin, approvedBy?}.
create or replace function public.save_plan(p_patient_id text, p_plan jsonb, p_approved_by text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who  text := coalesce(nullif(trim(p_approved_by), ''), nullif(trim(p_plan->>'approvedBy'), ''));
  ph   int;
  ex   jsonb;
  spw  int;
  nc   date;
  pl   public.plans;
begin
  perform private.require_patient(p_patient_id);
  if who is null or length(who) > 80 then
    raise exception using errcode = 'PT400', message = 'approvedBy is required (at most 80 characters)';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception using errcode = 'PT400', message = 'p_plan must be an object';
  end if;
  ph := private.int_in(p_plan, 'phase', 1, 4, true);
  ex := private.clean_exercises(p_plan->'exercises');
  spw := private.int_in(p_plan, 'sessionsPerWeek', 1, 14, true);
  nc := private.date(p_plan, 'nextCheckin');

  perform 1 from public.patients where id = p_patient_id for update;

  update public.plans
     set status = 'superseded', superseded_at = now()
   where patient_id = p_patient_id and status = 'approved';
  update public.plans
     set status = 'dismissed', dismissed_at = now(), dismissed_by = who
   where patient_id = p_patient_id and status = 'suggested';

  insert into public.plans (patient_id, phase, exercises, sessions_per_week, status, approved_by, approved_at, next_checkin)
  values (p_patient_id, ph, ex, spw, 'approved', who, now(), nc)
  returning * into pl;

  update public.patients set phase = ph, next_checkin = nc where id = p_patient_id;

  return private.plan_json(pl);
end;
$$;

-- Move the next check-in (today .. today+180). Updates the patient and the
-- current approved plan. Returns Patient.
create or replace function public.set_next_checkin(p_patient_id text, p_date date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.patients;
begin
  perform private.require_patient(p_patient_id);
  if p_date is null or p_date < current_date or p_date > current_date + 180 then
    raise exception using errcode = 'PT400', message = 'nextCheckin must be between today and 180 days from now';
  end if;
  update public.patients set next_checkin = p_date where id = p_patient_id returning * into p;
  update public.plans set next_checkin = p_date where patient_id = p_patient_id and status = 'approved';
  return private.patient_json(p);
end;
$$;

-- Edge Function weekly-summary only (service_role).
create or replace function public.upsert_summary(p_patient_id text, p_week_start date, p_text text, p_model text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_patient(p_patient_id);
  if nullif(trim(p_text), '') is null then
    raise exception using errcode = 'PT400', message = 'text is required';
  end if;
  insert into public.patient_summaries (patient_id, week_start, text, model, source, created_at)
  values (p_patient_id, p_week_start, left(trim(p_text), 1200), left(p_model, 80), 'llm', now())
  on conflict (patient_id, week_start) do update set
    text = excluded.text, model = excluded.model, source = 'llm', created_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. RLS + grants (DEMO ONLY - fake data; replace with auth before real patients)
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['patients', 'plans', 'sessions', 'exercise_results', 'session_replays',
                           'watch_daily', 'watch_sessions', 'alerts', 'patient_summaries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists demo_read on public.%I', t);
    -- DEMO ONLY — fake data; replace with auth before real patients.
    execute format('create policy demo_read on public.%I for select to anon, authenticated using (true)', t);
    execute format('comment on policy demo_read on public.%I is %L', t,
                   'DEMO ONLY — fake data; replace with auth before real patients.');
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Helpers: nobody but the owner (the definer RPCs run as the owner).
revoke all on all functions in schema private from public;
revoke all on all functions in schema private from anon, authenticated;

-- RPCs: revoke the default PUBLIC execute, then grant explicitly.
revoke all on function public.submit_watch_daily(jsonb) from public;
revoke all on function public.submit_watch_session(jsonb) from public;
revoke all on function public.submit_session(jsonb) from public;
revoke all on function public.register_replay(jsonb) from public;
revoke all on function public.apply_rule_results(text, jsonb, jsonb) from public;
revoke all on function public.ack_alert(text) from public;
revoke all on function public.approve_plan(text, text, jsonb) from public;
revoke all on function public.dismiss_plan(text, text) from public;
revoke all on function public.save_plan(text, jsonb, text) from public;
revoke all on function public.set_next_checkin(text, date) from public;
revoke all on function public.upsert_summary(text, date, text, text) from public, anon, authenticated;

grant execute on function public.submit_watch_daily(jsonb) to anon, authenticated, service_role;
grant execute on function public.submit_watch_session(jsonb) to anon, authenticated, service_role;
grant execute on function public.submit_session(jsonb) to anon, authenticated, service_role;
grant execute on function public.register_replay(jsonb) to anon, authenticated, service_role;
grant execute on function public.apply_rule_results(text, jsonb, jsonb) to anon, authenticated, service_role;
grant execute on function public.ack_alert(text) to anon, authenticated, service_role;
grant execute on function public.approve_plan(text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.dismiss_plan(text, text) to anon, authenticated, service_role;
grant execute on function public.save_plan(text, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.set_next_checkin(text, date) to anon, authenticated, service_role;
grant execute on function public.upsert_summary(text, date, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Storage: public-read 'replays' bucket, uploads only into a folder named
--    after a session created in the last day. Path: <sessionId>/<exercise>-<side>.json
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('replays', 'replays', true, 2097152, '{application/json}')
on conflict (id) do nothing;

drop policy if exists replays_insert on storage.objects;
create policy replays_insert on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'replays'
    and (storage.foldername(name))[1] in (select id from public.sessions where created_at > now() - interval '1 day')
  );

drop policy if exists replays_update on storage.objects;
create policy replays_update on storage.objects for update to anon, authenticated
  using (
    bucket_id = 'replays'
    and (storage.foldername(name))[1] in (select id from public.sessions where created_at > now() - interval '1 day')
  )
  with check (
    bucket_id = 'replays'
    and (storage.foldername(name))[1] in (select id from public.sessions where created_at > now() - interval '1 day')
  );

-- Upsert (upload with upsert: true) also needs SELECT on the object row.
-- The bucket is public-read anyway (fake data).
drop policy if exists replays_select on storage.objects;
create policy replays_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'replays');

-- Realtime: not used (polling). Do not add tables to supabase_realtime.
