-- STEP 1 of 4: run BEFORE migrations/0001_init.sql.
-- Removes Justin's early test tables (test rows only); 0001_init.sql recreates them linked to patients.
drop table if exists public.watch_sessions cascade;
drop table if exists public.watch_daily cascade;
