-- STEP 4 of 4: run AFTER seed.sql.
-- Kyle's patient profile. Watch sessions sent as p-kyle are rejected until this row exists.
insert into public.patients (id, name, weak_side, stroke_date)
values ('p-kyle', 'Kyle Price', 'left', current_date - 60)
on conflict (id) do nothing;
