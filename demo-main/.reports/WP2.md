# WP2 report: Supabase backend + ingest (Shortcut, watch, Edge Function)

Status: **done, uncommitted** (no branch, no commit, per coordinator override). No SQL was run against any remote
database. Only owned paths were touched.

## Files

| File | Status | Notes |
|---|---|---|
| `supabase/migrations/0001_init.sql` | new | helpers, 9 tables, JSON builders, 11 RPCs, RLS, grants, storage bucket + policies. Idempotent |
| `supabase/seed.sql` | new, **hand-written placeholder** | 3 patients, approved + suggested plans, 20 days of sessions/results, 21 days of watch_daily, 6 Maria watch_sessions, alerts, synth replays, summaries; relative dates. **Run `cd demo-main/web && npm run seed:sql` after WP1's `generate.ts` lands to replace it** |
| `supabase/tests/pglite-smoke.mjs` | new | 88 assertions in PGlite with stub roles/storage/auth |
| `supabase/functions/weekly-summary/index.ts` | new | Deno Edge Function (Gemma) |
| `supabase/config.toml` | new | minimal CLI config (placeholder project_id) |
| `supabase/README.md` | new | SQL-editor + CLI paths, secrets, deploy, access model, test, regenerate seed |
| `web/scripts/gen-seed-sql.ts` | new | `generateDemoData(today)` → `../supabase/seed.sql`, relative dates, deterministic |
| `docs/SHORTCUT.md` | new | from `justin/watch-daily/README.md`; endpoint `rpc/submit_watch_daily`; merge semantics; ranges |
| `tools/watch-check.html` | new | from `justin/watch-daily/check.html`: no sign-in, anon read, polling (no realtime), test rows go to a real patient |
| `watch/**` | copied from `Kyle/watch-app` (no `.xcodeproj`) + edited | see Watch section |

## Schema summary

**Tables** (all `public`, RLS on, `created_at` everywhere, FKs `on delete cascade` to `patients`):
`patients`, `plans` (partial unique: one `suggested`, one `approved` per patient), `sessions` (`client_key` unique,
duration < 3 h), `exercise_results` (identity id, `unique(session_id, exercise, side)`, range CHECKs per §5.2),
`session_replays` (pk session/exercise/side; path `<sid>/<ex>-<side>.json` or `synth:…`), `watch_daily`
(`unique(patient_id,date)`, `date <= current_date+1`, range CHECKs, keeps `hrv`/`sleep_hr`, adds `walking_steadiness`),
`watch_sessions` (Justin's columns + FK, length ≤ 64 ids, HR 25..240, `rep_log` ≤ 200 items, `trace` ≤ 2 MB),
`alerts` (partial unique `(patient_id,type) where not acknowledged`), `patient_summaries` (pk patient/week_start).

**Helpers** in schema `private` (EXECUTE revoked from public/anon/authenticated, `search_path=''`):
`num` (commas, NaN/Infinity rejected), `strict_num`, `reading` (0 → null), `pct`, `ts` (ISO prefix or epoch ms),
`date` (friendly "must be a real YYYY-MM-DD"), `txt`, `int_in`, `clean_exercises`, `require_patient`, and row→camelCase
JSON builders `patient_json`, `plan_json`, `alert_json`, `result_json`, `session_json`, `replay_json`, `watch_daily_json`.

**RPCs** (all `security definer set search_path = ''`, schema-qualified; granted to anon, authenticated, service_role
unless noted). "Raw body" = single UNNAMED `jsonb` parameter, so PostgREST passes the whole request body.

| RPC | Call (supabase-js) | Returns |
|---|---|---|
| `submit_watch_daily(jsonb)` raw body | `rpc('submit_watch_daily', {patientId, date, steps?, exerciseMin?, standHr?, restingHr?, hrv?, sleepHr?, bpSys?, bpDia?, falls?, walkingSteadiness?, weakArmActiveMin?, useRatio?})` | `{ok:true, id:string, patientId, date, steps, exerciseMin, standHr, restingHr, hrv, sleepHr, bpSys, bpDia, falls, walkingSteadiness, weakArmActiveMin, useRatio, updatedAt}` (WatchDaily superset). **Merge**: null/omitted/blank (and 0 for restingHr, hrv, bpSys, bpDia, walkingSteadiness) keep old value |
| `submit_watch_session(jsonb)` raw body | §5.4 Route B body (`side_raise` aliased) | `{ok, sessionId, patientId, updatedAt, sessionsUpdated}`; PT409 if the sessionId belongs to another patient; back-fills `sessions.avg_hr` (±5 min overlap, only where null) |
| `submit_session(jsonb)` raw body | `rpc('submit_session', SessionUploadBody)` (clientKey optional; times ISO or epoch ms) | `{session: SessionRow, results: ExerciseResult[]}`; same clientKey → existing rows + `duplicate:true`. Also takes avgHr from an overlapping watch session if the body has none |
| `register_replay(jsonb)` raw body | `rpc('register_replay', {sessionId, exercise, side, path, fps, frameCount, seconds, warningCount})` | `{key, sessionId, exercise, side, path, fps, frameCount, seconds, warningCount, uploadedAt}` (ReplaySummary ∪ ReplayRow). Upsert |
| `apply_rule_results(p_patient_id text, p_alerts jsonb default '[]', p_plan jsonb default null)` | `rpc('apply_rule_results', {p_patient_id, p_alerts: NewAlert[], p_plan: NewPlan \| null})` | `{alertsCreated: Alert[], planSuggested: Plan \| null}` (only inserted rows; `on conflict do nothing`) |
| `ack_alert(p_alert_id text)` | `rpc('ack_alert', {p_alert_id})` | Alert; PT404 |
| `approve_plan(p_plan_id text, p_approved_by text, p_overrides jsonb default '{}')` | `rpc('approve_plan', {p_plan_id, p_approved_by, p_overrides: {phase?, exercises?, sessionsPerWeek?, nextCheckin?}})` | Plan; PT404 / PT409 (not suggested) / PT400; supersedes old approved; **always** mirrors phase + next_checkin to patient |
| `dismiss_plan(p_plan_id text, p_dismissed_by text default null)` | `rpc('dismiss_plan', {p_plan_id, p_dismissed_by})` | Plan; PT409 unless suggested |
| `save_plan(p_patient_id text, p_plan jsonb, p_approved_by text default null)` | `rpc('save_plan', {p_patient_id, p_plan: SavePlanBody, p_approved_by})` | Plan; new approved, old superseded, open suggestion dismissed (`dismissed_by = approvedBy`), mirrors patient |
| `set_next_checkin(p_patient_id text, p_date date)` | `rpc('set_next_checkin', {p_patient_id, p_date: 'YYYY-MM-DD'})` | Patient; PT400 outside today..today+180; also updates the approved plan |
| `upsert_summary(p_patient_id, p_week_start date, p_text, p_model) returns void` | **service_role only** (Edge Function) | stores `source='llm'` |

Errors: `PT400` (friendly message), `PT404` (`Unknown patient` / `Unknown plan` / `Unknown alert` / `Unknown session`),
`PT409`; raw `23514` for out-of-range CHECKs.

**Policies/grants:** `demo_read` (`for select to anon, authenticated using (true)`, commented "DEMO ONLY — fake data;
replace with auth before real patients.") on all 9 tables; `revoke all` on tables from anon/authenticated then
`grant select`; `grant all` to service_role. No realtime publication.

**Storage:** bucket `replays` (public, 2 MB, `application/json`). Policies on `storage.objects` for anon/authenticated:
`replays_insert` and `replays_update` only when `(storage.foldername(name))[1]` is a session created in the last day;
`replays_select` (bucket_id = 'replays') because an upsert upload needs SELECT.

**Edge Function `weekly-summary`:** POST `{patientId}` → service-role reads of the last 14 days → compact JSON
(per-session symmetry/compensation/pain, adherence, watch RHR/arm-use/BP/falls, open alert types) → Gemma via
`generativelanguage.googleapis.com` with `x-goog-api-key` from `GOOGLE_API_KEY`, `GEMMA_MODEL` + Stuti's fallback,
one retry on 429/5xx → `upsert_summary` → returns `WeeklySummary` camelCase. CORS only for origins in `ALLOWED_ORIGIN`.
60 s throttle (returns the stored LLM summary). Prompt per plan (no diagnosis, no plan changes, only given numbers).

## Tests

```
cd demo-main/web && npm run db:test      # exit 0: "88 passed, 0 failed"
```
(Also run from the scratch PGlite dir before WP0's install; same result.) Covers: migration applies twice; seed applies
twice and a re-run restores the same counts; 9 tables; RLS everywhere; every public/private function pins
`search_path`; every public RPC is SECURITY DEFINER; bucket config; anon can read but not insert/update; anon cannot call
`upsert_summary` or `private.*`; service_role can. `submit_session` idempotent on clientKey (no duplicate results),
unknown patient → PT404, NaN/duplicate/empty results/non-ISO rejected, safety stop with 0 results accepted, epoch ms
accepted; `register_replay` upsert + path guard + `Session.replays`; storage folder policy (recent session ok, unknown
and old seeded folders refused); watch daily insert, comma numbers, **merge keeps old values**, 0-as-missing,
walking steadiness 0.85→85, unknown patient → PT404, NaN/Infinity/impossible date/future date/out-of-range rejected;
watch session: **the keys in `watch/MobilityWatch/WatchModel.swift` `uploadSession` are parsed and checked against the
RPC contract**, Justin's body accepted, `side_raise`→`arm_raise`, completed derived, HR back-fill onto the camera
session, resend replaces, PT409 on patient change, PT404, bad exercise, NaN; `apply_rule_results` duplicate open alert
ignored, new type created then deduped, second suggestion ignored, unknown type rejected; ack + reopen; `approve_plan`
overrides, supersede, **phase + check-in mirrored**, PT409/PT404/PT400, default-arg approve mirrors; `dismiss_plan`
PT409 + success; `save_plan` new approved / **dismisses suggestion** / supersedes / mirrors / validates;
`set_next_checkin` happy path, plan updated, past date PT400, PT404.

`gen-seed-sql.ts` was exercised in a scratch copy against a **mock** `generate.ts` (WP1's doesn't exist yet): output
loads in PGlite, all RPC tests pass on it, and **two runs are byte-identical** (`cmp`). Real determinism depends on
WP1's generator being deterministic.

Security greps: `grep -rn "eyJhbGci\|AIza" demo-main` → only `CONVERGENCE_PLAN.md:966` (the plan quoting the pattern);
none in WP2 files. Placeholders only (`YOUR-SUPABASE-ANON-KEY`, `YOUR-PROJECT-REF`). Justin's `eyJhbGciOi...`
input placeholder was replaced.

## Watch (§10.1 checklist)

- [x] Copied `Kyle/watch-app` → `demo-main/watch`, excluding `MobilityWatch.xcodeproj`.
- [x] `Config.example.xcconfig`: `SUPABASE_URL = https:/$()/YOUR-PROJECT-REF.supabase.co`, `SUPABASE_ANON_KEY`,
      `PATIENT_ID = p-james`, `DEVELOPMENT_TEAM =`, `BUNDLE_PREFIX = com.example`.
- [x] `project.yml`: `configFiles {Debug, Release: Config.xcconfig}`, `DEVELOPMENT_TEAM: $(DEVELOPMENT_TEAM)`,
      `PRODUCT_BUNDLE_IDENTIFIER: $(BUNDLE_PREFIX).RehabTrackWatch`, removed `NSAllowsArbitraryLoads`,
      `NSAllowsLocalNetworking`, `NSLocalNetworkUsageDescription`, display name RehabTrack, bundleIdPrefix com.example,
      Info keys SupabaseURL/SupabaseAnonKey/PatientID.
- [x] `Info.plist`: same removals; `SupabaseURL = $(SUPABASE_URL)`, `SupabaseAnonKey = $(SUPABASE_ANON_KEY)`,
      `PatientID = $(PATIENT_ID)`; display name RehabTrack (`plutil -lint` OK). xcconfig `https:/$()/` noted.
- [x] `Config.swift` (new): `enum Config { static let supabaseURL: URL?; static let anonKey: String; static let patientId: String; static var isConfigured }`
      from `Bundle.main.infoDictionary`; unresolved `$(…)` or missing → empty → upload skipped.
- [x] `WatchModel.swift`: deleted `SERVER_URL`, `WATCH_SOURCE`, `PromptsResponse`, `SessionStartResponse`, `sessionId`,
      `buffer`, `flushTimer`, `pollTimer`, `lastSeq`, `startPolling()`, `poll()`, `notify(_:)`, `flush()`, `post(_:_:)`.
      Added `cloudSessionId`, `hrValues`, `traceElev`, `traceDir`, `traceHr`, `tick`, `retrying`, `pendingKey`;
      `begin()` sets `cloudSessionId = UUID().uuidString` and resets trace/HR; `record(_:)` now appends every 5th sample
      (25→5 Hz) and counts `samplesSent`; `stopSession()` calls `uploadSession(endedAt:)` if `arm.calibrated`;
      new `uploadSession(endedAt:)` (Justin's body + Config), `send(_:) async -> Int` (POST
      `rest/v1/rpc/submit_watch_session`, `apikey` + `Authorization: Bearer`), `retryable(_:)`, `enqueue(_:)`
      (UserDefaults `pendingUploads`, newest 20), `retryPending()`. `serverOK` now means "last upload succeeded".
      Kept `Prompt` + `pendingPrompt` (ContentView still references them; never set now).
- [x] `MobilityWatchApp.swift`: `startPolling()` → `retryPending()` at launch; `retryPending()` in `applicationDidBecomeActive`.
- [x] `Reminders.swift`: "Stand up and do 10 arm raises to the side." → "Sit tall and do 10 arm raises." (+ comment).
- [x] `ContentView.swift`: "Dashboard connected"/"Dashboard offline" → "Synced"/"Not synced yet".
- [x] `README.md` rewritten (xcconfig, Supabase, no LAN server, offline queue, curl test). `.gitignore`: `Config.xcconfig`, `*.xcodeproj/`, `xcuserdata/`, `build/`, `DerivedData/`.
- [ ] **Not compiled.** `xcodegen` is absent (not installed, per override) and only Command Line Tools exist (no Xcode, no
      watchOS SDK). Done instead: `xcrun swiftc -parse` on every Swift file (all OK); `swiftc -typecheck` of `Config.swift`
      plus the new upload/retry code extracted into a stub harness on the macOS SDK (OK); the upload body keys are
      checked against the RPC in the PGlite test. **Kyle: build in Xcode** (`cp Config.example.xcconfig Config.xcconfig`,
      fill in, `xcodegen && open MobilityWatch.xcodeproj`).
- Diff size: 223 changed Swift lines (109 removed, 114 added incl. the 17-line `Config.swift`); ArmTracker, Exercise,
  FigureView, Theme untouched.

## Deviations from the plan

1. Ingest RPCs (`submit_watch_daily`, `submit_watch_session`, `submit_session`, `register_replay`) take one **unnamed**
   `jsonb` parameter, not `body jsonb`: that is what makes PostgREST pass the raw body (Shortcut/watch post the contract
   JSON as-is). supabase-js `rpc(name, body)` works the same way.
2. Return shapes are supersets: `submit_watch_daily` returns the full WatchDaily plus `ok/updatedAt`;
   `register_replay` returns ReplaySummary + `sessionId` + `path`; `submit_watch_session` adds `sessionsUpdated`;
   `submit_session` adds `duplicate: true` on an idempotent hit.
3. `submit_session` also fills `avg_hr` from an overlapping watch session (the reverse of the watch back-fill), and
   accepts epoch-ms times like `validateSession`.
4. Storage: extra `replays_select` policy (needed for `upload(..., {upsert: true})`).
5. Tables: `revoke all` (not only insert/update/delete/truncate) from anon/authenticated, then `grant select`.
6. Defaults: `apply_rule_results` `p_alerts default '[]'`, `p_plan default null`; `save_plan` `p_approved_by default null`
   (falls back to `p_plan.approvedBy`). `apply_rule_results` clamps a future `createdAt` to `now()`.
7. `Config.supabaseURL` is `URL?` (not `URL`) so a missing value can't crash.
8. Watch: a 4xx answer is not retried (it never succeeds); `retryPending()` also runs at launch. `.gitignore` ignores the
   whole generated `.xcodeproj`.
9. Edge Function adds a 60 s throttle; `config.toml` keeps `verify_jwt = true`.
10. `tools/watch-check.html` test buttons post for the selected patient (default `p-maria`) because unknown ids are
    now rejected (Justin used `p-test`).
11. Swift diff is 223 lines vs the ≤200 target, mostly deletions.

## Known issues / risks

- Migration never applied to real Supabase. PGlite stubs `storage`, `auth` and the roles; PostgREST behaviour (unnamed
  param, `PTxyz` → HTTP status) is standard but not exercised here.
- Edge Function not executed (no Deno, no key); syntax-checked with Node type stripping only.
- Swift not compiled (above).
- Open RPCs: anyone with the anon key can approve/dismiss/save plans and submit data for existing demo ids. Demo-only;
  rotate the anon key after the event. Supabase Security Advisor will flag the always-true read policies and
  anon-executable SECURITY DEFINER functions: expected for this demo.
- Strict DB ranges (`smoothness ≤ 50`, `fatigue ≤ 5`, `trunk_lean_max ≤ 90`, `shoulder_hike_max ≤ 0.5`,
  `best_value ≤ 180`, `sec_per_rep ≤ 120`, `reach_cm ≤ 150`, `avg_hr 30..220`) reject a whole session upload in
  Supabase mode if the camera produces an outlier. WP1's `validate.ts` must apply the same ranges (or clamp).
- `seed.sql` is the hand-written placeholder until regenerated. Its stories approximate `seed.js` (James plateau +
  adherence + falling arm use, Priya compensation + RHR + BP, Maria phase-up + 6 watch sessions).
- The watch's dashboard prompt banner (`pendingPrompt`) is dead UI now that polling is gone.

## Requests

### For WP1 (SupabaseSource, mappers, seed)
- Call exactly the RPCs and argument names in the RPC table above. Key points:
  - `insertSession` → `rpc('submit_session', body)` (pass the SessionUploadBody object itself, not `{body}`).
  - `putReplay` → `storage.from('replays').upload(`${sessionId}/${exercise}-${side}.json`, blob, {upsert: true, contentType: 'application/json'})`
    then `rpc('register_replay', {sessionId, exercise, side, path: `${sessionId}/${exercise}-${side}.json`, fps, frameCount, seconds, warningCount})`.
    `readReplay` → `storage.from('replays').getPublicUrl(row.path)`.
  - `applyRuleResults` → `rpc('apply_rule_results', {p_patient_id, p_alerts, p_plan})`.
  - `ackAlert` → `rpc('ack_alert', {p_alert_id})`; `approvePlan(id, body)` → `rpc('approve_plan', {p_plan_id: id, p_approved_by: body.approvedBy, p_overrides: {phase, exercises, sessionsPerWeek, nextCheckin}})`
    (omit undefined keys); `dismissPlan` → `rpc('dismiss_plan', {p_plan_id, p_dismissed_by})`;
    `savePlan(pid, body)` → `rpc('save_plan', {p_patient_id: pid, p_plan: body, p_approved_by: body.approvedBy})`;
    `setNextCheckin` → `rpc('set_next_checkin', {p_patient_id, p_date})`; `submitWatchDaily` → `rpc('submit_watch_daily', body)`
    (response is already a WatchDaily with string `id`; strip `ok`/`updatedAt` if you want the exact type).
  - `refreshWeeklySummary` → `functions.invoke('weekly-summary', {body: {patientId}})` → WeeklySummary.
  - `getWeeklySummary` → `from('patient_summaries').select('*').eq('patient_id', id).order('week_start', {ascending: false}).order('created_at', {ascending: false}).limit(1)`.
  - `listWatchSessions` → select all columns **except `trace`, `rep_log`** from `watch_sessions`, newest first, limit 50;
    `WatchSession.id = String(id)`, `sessionId = session_id`, `durationSec = duration_sec`.
- RPC results are already camelCase (from the `private.*_json` builders) and match `types.ts`; only table SELECTs need
  the snake→camel mappers. `ExerciseResult.id`/`WatchDaily.id` are strings in RPC output.
- Normalise every timestamp in mappers with `new Date(x).toISOString()`: Postgres returns `…+00:00`, and the rules
  engine compares ISO strings.
- Error mapping (supabase-js `error.code` is the SQLSTATE): `PT400` → `invalid`/400, `PT404` → `not_found`/404,
  `PT409` → `conflict`/409, `23514`/`22P02`/`22007`/`22008` → `invalid`/400, `23505` → `conflict`/409,
  `23503` → `not_found`/404.
- Mirror the DB CHECK ranges in `validate.ts` (see Known issues), plus `pain 0..10`, `tiredness 1..5`, plan
  `exercises` 1–6 unique items with whole `reps` 1..200 and `0 < target ≤ 180`, `sessionsPerWeek 1..14`, `phase 1..4`.
- Seed generator contract used by `web/scripts/gen-seed-sql.ts`:
  `export function generateDemoData(today: Date, rng?): { patients: Patient[]; plans: Plan[] /* approved + rules-engine suggestions */;
  sessions: SessionRow[]; results: ExerciseResult[] /* with sessionId */; watch: WatchDaily[]; watchSessions: WatchSession[];
  replays: ReplayRow[] /* uploadedAt optional */; summaries: WeeklySummary[]; alerts: Alert[] }`.
  Timestamps as ISO strings (or epoch ms) computed from `today`, dates as `YYYY-MM-DD`, only ids `p-maria`/`p-james`/`p-priya`,
  nothing at or after today's midnight (UTC) for sessions, `weekStart` = a Monday. Please include **`alerts`** (the
  plan lists it implicitly via "runs evaluate"). Then run `npm run seed:sql` and `npm run db:test` (the test asserts
  James has open plateau + adherence alerts, one approved plan per patient, every session has avgHr, synth replays exist).
- Synth replay paths: the placeholder seed uses `synth:james-lean`, `synth:priya-hike`, `synth:<name>-<exercise>-<side>`;
  the generated seed will use whatever WP1/WP6 produce.

### For WP8
- `docs/CONTRACTS.md`: copy the RPC table, the raw-body note, error codes and the storage path rule from this report /
  `supabase/README.md`; link `docs/SHORTCUT.md` and `watch/README.md`.
- After WP1 lands: `cd demo-main/web && npm run seed:sql && npm run db:test`, commit the regenerated `supabase/seed.sql`.
- Root `.gitignore` (§13): `demo-main/watch/Config.xcconfig`, `demo-main/watch/*.xcodeproj/`, `supabase/.temp/`
  (watch/.gitignore already covers the watch entries locally).
- If the Supabase project only has new `sb_publishable_…` keys, deploy the function with `--no-verify-jwt`.
- Ask Kyle to build `demo-main/watch` in Xcode before H32 and run one session against the project.
- Optionally remove the WP0 `.gitkeep` files in `supabase/`, `tools/`, `watch/` (folders are populated now).
