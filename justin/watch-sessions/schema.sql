-- Watch exercise sessions on Supabase (draft; see README.md for the JSON contract).
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to run again.
--
-- The watch app posts one summary per session, when the session ends, to
--   POST https://<project>.supabase.co/rest/v1/rpc/submit_watch_session
-- using the anon key. Same access model as watch_daily: anon can only call the
-- function; only signed-in users (clinicians) can read.

create table if not exists watch_sessions (
  id bigint generated always as identity primary key,
  session_id text not null unique,     -- made by the watch; re-sending the same id replaces the row
  patient_id text not null,
  exercise text not null check (exercise in ('arm_raise', 'forward_reach')),
  arm text check (arm in ('left', 'right')),   -- wrist the watch was on = arm being measured
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_sec numeric generated always as (extract(epoch from ended_at - started_at)) stored,
  target_reps integer,
  reps integer,                        -- reps that counted (high enough, right direction)
  attempts integer,                    -- every lift, counted or not
  best_elevation_deg numeric,          -- highest arm angle: 0 down, 90 shoulder height, 180 overhead
  completed boolean,                   -- reached the rep goal
  avg_hr numeric,
  max_hr numeric,
  min_hr numeric,
  rep_log jsonb,                       -- optional per-rep details
  trace jsonb,                         -- downsampled arm angles and heart rate over time
  app_session_id text,                 -- optional: the patient app's session, if it started this one
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at >= started_at)
);

create index if not exists watch_sessions_patient_time on watch_sessions (patient_id, started_at desc);

alter table watch_sessions enable row level security;

grant select on watch_sessions to authenticated;
revoke all on watch_sessions from anon;

drop policy if exists "signed-in read" on watch_sessions;
create policy "signed-in read" on watch_sessions for select to authenticated using (true);

create or replace function watch_session_num(b jsonb, key text) returns numeric
language plpgsql immutable as $$
declare
  v text := nullif(trim(b->>key), '');
begin
  if v is null then return null; end if;
  return v::numeric;
exception when others then
  raise exception '% must be a number (got "%")', key, b->>key;
end;
$$;

create or replace function watch_session_time(b jsonb, key text) returns timestamptz
language plpgsql stable as $$
begin
  if nullif(trim(b->>key), '') is null then raise exception '% is required', key; end if;
  -- Require ISO-8601 with a time; Postgres would otherwise accept words like 'yesterday'.
  if b->>key !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then
    raise exception '% must be an ISO-8601 time (got "%")', key, b->>key;
  end if;
  return (b->>key)::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception '% must be an ISO-8601 time (got "%")', key, b->>key;
end;
$$;

-- Single unnamed jsonb parameter: PostgREST passes the whole request body.
create or replace function submit_watch_session(jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b jsonb := $1;
  sid text := nullif(trim(b->>'sessionId'), '');
  pid text := nullif(trim(b->>'patientId'), '');
  ex text := lower(trim(coalesce(b->>'exercise', '')));
  side text := nullif(lower(trim(coalesce(b->>'arm', ''))), '');
  t0 timestamptz := watch_session_time(b, 'startedAt');
  t1 timestamptz := watch_session_time(b, 'endedAt');
  tr jsonb := b->'trace';
  r watch_sessions;
begin
  if sid is null then raise exception 'sessionId is required'; end if;
  if pid is null then raise exception 'patientId is required'; end if;
  if ex = 'side_raise' then ex := 'arm_raise'; end if;  -- watch app name → contract name
  if ex not in ('arm_raise', 'forward_reach') then
    raise exception 'exercise must be arm_raise or forward_reach (got "%")', b->>'exercise';
  end if;
  if side is not null and side not in ('left', 'right') then raise exception 'arm must be left or right'; end if;
  if t1 < t0 then raise exception 'endedAt is before startedAt'; end if;
  if tr is not null and jsonb_typeof(tr) <> 'object' then raise exception 'trace must be an object'; end if;
  if b->'repLog' is not null and jsonb_typeof(b->'repLog') <> 'array' then raise exception 'repLog must be an array'; end if;
  if octet_length(coalesce(tr, '{}'::jsonb)::text) > 2000000 then raise exception 'trace is too large (max ~2 MB)'; end if;

  insert into watch_sessions as w (
    session_id, patient_id, exercise, arm, started_at, ended_at, target_reps, reps, attempts,
    best_elevation_deg, completed, avg_hr, max_hr, min_hr, rep_log, trace, app_session_id
  ) values (
    sid, pid, ex, side, t0, t1,
    watch_session_num(b, 'targetReps'), watch_session_num(b, 'reps'), watch_session_num(b, 'attempts'),
    watch_session_num(b, 'bestElevationDeg'),
    coalesce((b->>'completed')::boolean, watch_session_num(b, 'reps') >= watch_session_num(b, 'targetReps')),
    nullif(watch_session_num(b, 'avgHr'), 0), nullif(watch_session_num(b, 'maxHr'), 0), nullif(watch_session_num(b, 'minHr'), 0),
    b->'repLog', tr, nullif(trim(b->>'appSessionId'), '')
  )
  on conflict (session_id) do update set
    patient_id = excluded.patient_id, exercise = excluded.exercise, arm = excluded.arm,
    started_at = excluded.started_at, ended_at = excluded.ended_at,
    target_reps = excluded.target_reps, reps = excluded.reps, attempts = excluded.attempts,
    best_elevation_deg = excluded.best_elevation_deg, completed = excluded.completed,
    avg_hr = excluded.avg_hr, max_hr = excluded.max_hr, min_hr = excluded.min_hr,
    rep_log = excluded.rep_log, trace = excluded.trace, app_session_id = excluded.app_session_id,
    updated_at = now()
  returning * into r;

  return jsonb_build_object('ok', true, 'sessionId', r.session_id, 'patientId', r.patient_id, 'updatedAt', r.updated_at);
end;
$$;

revoke all on function submit_watch_session(jsonb) from public;
grant execute on function submit_watch_session(jsonb) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table watch_sessions;
exception when duplicate_object then null;
end $$;
