# RehabTrack (demo-main): team and agent workflow

## Project

RehabTrack helps stroke patients recover arm function at home: webcam exercise sessions, Apple Watch data, and a
care-team dashboard. The loop: patient data → rules engine drafts a suggestion → clinician approves or edits → the
patient sees the new plan. The app suggests; clinicians approve every plan change. Never write "diagnosis" in the UI
or in generated text.

`demo-main/` is the single source of truth. `CONVERGENCE_PLAN.md` explains how it was built from the old per-person
folders; `docs/CONTRACTS.md` is the contract reference.

## Read first

- `README.md`: run offline / online, tests
- `docs/CONTRACTS.md`: types, `api.ts`, data sources, SQL RPCs, camera, watch payloads
- `docs/DEMO.md`: the 3-minute click path and the pre-demo checklist
- `web/src/api.ts`: the only data entry point for UI code
- `web/src/rules/engine.ts`: alerts and plan suggestions
- `supabase/migrations/0001_init.sql`: schema, RPCs, RLS, storage

## Ownership (one owner per folder; ask before editing someone else's)

| Area | Paths |
|---|---|
| Data layer, rules, seed | `web/src/data/**`, `web/src/rules/**`, `web/src/api.ts`, `web/src/usePolling.ts`, `web/src/patient/api.ts` |
| Supabase, Shortcut, tools | `supabase/**`, `docs/SHORTCUT.md`, `tools/**`, `web/scripts/gen-seed-sql.ts` |
| Watch app | `watch/**` |
| Camera + session engine | `web/src/camera/**`, `web/src/patient/session/{repCounter,baseline,compensation}.ts`, `web/src/patient/data/exercises.ts`, `web/src/patient/screens/SessionRun.tsx`, `web/src/patient/components/CameraView.tsx` |
| Patient UI | the rest of `web/src/patient/**` |
| Care UI | `web/src/care/**` except `care/replay/**` |
| 3D replay | `web/src/care/replay/**`, `web/src/data/seed/replaySynth.ts` |
| Shared / frozen (integrator only) | `web/package.json`, `web/src/types.ts`, `web/src/App.tsx`, `web/src/ui/**`, `web/src/Brand.tsx`, configs, docs |

Rules:
- Work only inside your owned paths. If you need a change in a shared file, put it under "Requests" in your report.
- No new dependencies without the team.
- `npm run build` and `npm test` stay green at the end of every task (`npm run db:test` too if you touched SQL).
- Contract changes are additive and update `docs/CONTRACTS.md` in the same commit.
- Work on a branch touching `demo-main/**` only; never push to `main` without the team.

## Report template (end every task with this)

```text
## Report
- Agent + task:
- Commits: (hash: message)
- Files changed: (path: one line what/why)
- Verification: (each command or browser check → result)
- Deviations: (or "none")
- Known issues:
- Requests: (shared-file changes, other owners)
- Suggested next step:
```

## Current state (after WP0–WP8, 2026-10-24)

**Done**
- One Vite app: `/`, `/patient/*`, `/care/*`, lazy `/care/patients/:id/sessions/:sid` replay
- Design system (`web/src/ui/**`), local WASM + bundled fonts
- Data layer: LocalSource (default) + SupabaseSource; rules engine with setback/adherence fixes; generated `supabase/seed.sql`
- Supabase migration + 11 RPCs + Edge Function stub + watch app port (Swift not compiled)
- Camera: rest baseline, vector lean, hike allowance, hysteresis reps, setup gate, Demo motion badge
- Patient UI rethemed; care dashboard sections; 3D replay (r3f)
- Docs: `CONTRACTS.md`, `DEMO.md`, `SHORTCUT.md`, `README.md`, this file

**Verification:** `npm test` 167 pass; `npm run build` green; `npm run db:test` 88 pass. See `docs/DEMO.md` for the full checklist (some browser items deferred to dress rehearsal).

**Not done / out of scope:** auth and login, Supabase Realtime, passive weak-arm-use counting on the watch (seeded
data only), the accuracy pipeline (pitch slide only). Deleting old teammate folders (`Raghav/`, `Kyle/`, …) waits for
the team (§13).

**Builder reports:** `demo-main/.reports/WP0.md` … `WP8.md`.
