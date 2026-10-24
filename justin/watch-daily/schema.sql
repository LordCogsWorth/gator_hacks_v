-- Watch daily data (contract §6) on Supabase.
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to run again.
--
-- The iPhone Shortcut posts the contract JSON as-is to
--   POST https://<project>.supabase.co/rest/v1/rpc/submit_watch_daily
-- using the anon key. The anon key can only call that function; it cannot
-- read the table. Only signed-in users (clinicians) can read.

create table if not exists watch_daily (
  id bigint generated always as identity primary key,
  patient_id text not null,
  date date not null,
  steps numeric,
  exercise_min numeric,
  stand_hr numeric,
  resting_hr numeric,
  bp_sys numeric,
  bp_dia numeric,
  falls numeric,
  walking_steadiness numeric,  -- iPhone Walking Steadiness %, a fall-risk score
  weak_arm_active_min numeric,
  use_ratio numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, date)
);

-- Bring tables made by an earlier version of this file up to date.
alter table watch_daily
  drop column if exists hrv,
  drop column if exists sleep_hr,
  drop column if exists irregular_rhythm,
  drop column if exists afib_burden,
  add column if not exists walking_steadiness numeric;

alter table watch_daily enable row level security;

-- Newer Supabase projects don't grant table access by default, so grant it here.
-- Signed-in users get read access only (the policy below still applies); anon gets nothing.
grant select on watch_daily to authenticated;
revoke all on watch_daily from anon;

-- No anon policies: anon can't read or write the table directly.
drop policy if exists "signed-in read" on watch_daily;
create policy "signed-in read" on watch_daily for select to authenticated using (true);

-- Shortcuts sometimes sends numbers as text ("1,234") or blanks.
create or replace function watch_daily_num(b jsonb, key text) returns numeric
language plpgsql immutable as $$
declare
  v text := nullif(trim(replace(b->>key, ',', '')), '');
begin
  if v is null then return null; end if;
  return v::numeric;
exception when others then
  raise exception '% must be a number (got "%")', key, b->>key;
end;
$$;

-- For readings that can't really be 0 (heart rate, blood pressure, walking steadiness):
-- Shortcuts sends 0 when there's no data (e.g. no watch worn), so store 0 as "no data".
create or replace function watch_daily_reading(b jsonb, key text) returns numeric
language sql immutable as $$
  select nullif(watch_daily_num(b, key), 0);
$$;

-- Percentages (walking steadiness): Health may give 0.85 or 85 for 85%; store as 0–100.
create or replace function watch_daily_pct(b jsonb, key text) returns numeric
language sql immutable as $$
  select case when v > 0 and v <= 1 then v * 100 else v end
  from (select watch_daily_num(b, key) as v) s;
$$;

-- Single unnamed jsonb parameter: PostgREST passes the whole request body.
-- Unknown fields (e.g. hrv, sleepHr, irregularRhythm from an older Shortcut) are ignored.
create or replace function submit_watch_daily(jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b jsonb := $1;
  pid text := nullif(trim(b->>'patientId'), '');
  d text := trim(b->>'date');
  r watch_daily;
begin
  if pid is null then raise exception 'patientId is required'; end if;
  if d is null or d !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'date must be YYYY-MM-DD (got "%")', b->>'date'; end if;

  -- Posting the same patientId + date again replaces that day.
  insert into watch_daily as w (
    patient_id, date, steps, exercise_min, stand_hr, resting_hr, bp_sys, bp_dia, falls,
    walking_steadiness, weak_arm_active_min, use_ratio
  ) values (
    pid, d::date,
    watch_daily_num(b, 'steps'), watch_daily_num(b, 'exerciseMin'), watch_daily_num(b, 'standHr'),
    watch_daily_reading(b, 'restingHr'), watch_daily_reading(b, 'bpSys'), watch_daily_reading(b, 'bpDia'),
    watch_daily_num(b, 'falls'), nullif(watch_daily_pct(b, 'walkingSteadiness'), 0),
    watch_daily_num(b, 'weakArmActiveMin'), watch_daily_num(b, 'useRatio')
  )
  on conflict (patient_id, date) do update set
    steps = excluded.steps, exercise_min = excluded.exercise_min, stand_hr = excluded.stand_hr,
    resting_hr = excluded.resting_hr, bp_sys = excluded.bp_sys, bp_dia = excluded.bp_dia,
    falls = excluded.falls, walking_steadiness = excluded.walking_steadiness,
    weak_arm_active_min = excluded.weak_arm_active_min, use_ratio = excluded.use_ratio,
    updated_at = now()
  returning * into r;

  return jsonb_build_object('ok', true, 'patientId', r.patient_id, 'date', r.date, 'updatedAt', r.updated_at);
end;
$$;

revoke all on function submit_watch_daily(jsonb) from public;
grant execute on function submit_watch_daily(jsonb) to anon, authenticated;

-- Live updates for pages that watch the table.
do $$
begin
  alter publication supabase_realtime add table watch_daily;
exception when duplicate_object then null;
end $$;
