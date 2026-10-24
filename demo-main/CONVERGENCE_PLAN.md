# CONVERGENCE PLAN: `demo-main/` (RehabTrack Stroke, by team Ctrl+Alt+Heal)

Status: **authoritative**. Written 2026-10-24 by the master convergence agent from five folder assessments and spot-checks of the repo at `3f327a7`.
Audience: the team, and the builder agents who implement the work packages in §10.
Rule: if this plan and an older doc disagree (`Raghav/docs/BRIEF.md`, `Raghav/docs/CONTRACTS.md`, `Raghav/AGENTS.md`, the READMEs), **this plan wins** until `demo-main/docs/CONTRACTS.md` replaces it.

---

## 0. Decisions at a glance

1. **One app.** `demo-main/web` is a port of `Raghav/web`: React 18, Vite 5, TS (strict), Tailwind 3. It has two routes, `/patient` and `/care`, plus a small landing page at `/`. Nothing is rewritten from scratch.
2. **No custom server.** The Express servers (Raghav/api, Kyle/server, stuti/server, Stuti's Gemma proxy) and Render are retired. Their logic is ported to TypeScript inside the web app, or to SQL RPCs in one Supabase migration.
3. **Two interchangeable data sources sit behind `src/api.ts`.** Every existing function signature stays the same, so the UI barely changes.
   - **LocalSource (offline, the default).** An in-browser store seeded by a TS port of `seed.js`. Tables persist in `localStorage`, replays in IndexedDB. Tabs and windows stay in sync through `BroadcastChannel`.
   - **SupabaseSource.** Used when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are both set. It can be forced off at runtime with `?data=local`.
4. **Why offline is in-browser and not "keep Raghav's Express API":**
   - The brief says "no custom server".
   - The app is a static build on Vercel.
   - "Wi-Fi dies → run locally" then means `npm run dev` with zero other processes.
   - Two laptops cannot talk without a network anyway. If Wi-Fi dies, the fallback is one laptop with two windows (patient window on the laptop, care window on the projector), synced instantly by BroadcastChannel. If a phone hotspot exists, Supabase mode works across two laptops.
   - The Express option costs a second process, CORS, LAN-IP mixed-content problems and a JSON store that cannot deploy. It buys nothing the in-browser store does not.
5. **The rules engine is one pure TS function**, `evaluate(snapshot, now)`, ported from `Raghav/api/rules.js` together with its tests.
   - It runs in `api.ts` after every write: session upload, watch upload, approvals.
   - It also runs as a 60 s sweep while `/care` is open, which catches iPhone Shortcut rows that arrived with no client watching.
   - Dedupe happens twice: in code (`hasOpenAlert` / cooldown) and in the DB (partial unique indexes plus `on conflict do nothing`).
6. **Supabase = one migration** (`supabase/migrations/0001_init.sql`) plus a generated `supabase/seed.sql` that uses relative dates.
   - Reads: public read for demo data.
   - Writes: only through validating `SECURITY DEFINER` RPCs with a pinned `search_path`.
   - Approval is atomic through `approve_plan`.
   - Replays go in a `replays` Storage bucket.
7. **Camera fixes:**
   - rest baseline per round (trunk **vector** angle, not `|θ−θ₀|`)
   - 3-frame compensation debounce
   - hike measured for arm raise only, with an above-90° allowance
   - Stuti's `bursts()` smoothness
   - hysteresis rep counter that throws away partial reps
   - forward-reach thresholds set relative to the rest elbow angle
   - exercise-specific setup gate with a Skip button
   - an on-screen badge when the tracker falls back to fake motion
8. **New 3D replay** using `@react-three/fiber@8` + `drei@9` (both work with React 18). It reads the contract `ReplayFile`. Seeded sessions get deterministic synthetic replays (`synth:` paths), so the demo never depends on an upload.
9. **One design system.** CSS-variable tokens in light and dark, mapped into Tailwind, with two densities: `comfortable` for care and `large` for patient. Fonts are bundled through `@fontsource`, and the MediaPipe WASM and models are served locally, so a fully offline demo works.
10. **Watch:** Kyle's Swift app moves to `demo-main/watch/`. It posts one summary per exercise session to `submit_watch_session`. The URL, anon key, patient id and team id move into an xcconfig. The diff is kept minimal because the builders cannot compile Swift.
11. **LLM weekly summary (stretch):** a Supabase Edge Function `weekly-summary` (Gemma, using Stuti's prompt guardrails; the key is a secret). Pre-generated summaries are seeded, so the card always has text.
12. **Cuts:** Messages, Settings/profile/physicians, localDemo, CoachCard, CareTeamCard, Recent sessions, legacy redirects, Kyle's lab page with its muscle "diagnosis", ntfy, Stuti's shell and `weakness.js`, `main/`, `render.yaml`. The word "diagnosis" never appears in the UI.

---

## 1. Executive summary: what each teammate built

**Raghav: `Raghav/api` + `Raghav/docs` + host of `Raghav/web` (care dashboard).** The most finished and best-tested work in the repo.
- A 17-route Express API over an atomic JSON-file store.
- A careful rules engine (`rules.js`, 590 LOC): 9 alert types, a 72 h acknowledge cooldown, and three plan-suggestion kinds (phase-up, plateau, compensation) with plain-language reasons and a safety cap on arm-raise targets.
- Strong validators and **56 passing tests**.
- Its data model already matches the brief's six tables, plus columns the brief forgot and needs: `bpLimitSys`, `endedAt`, `stopReason`, plan `kind/reason/basedOn/approvedAt/dismissedAt`, alert `acknowledgedAt`.
- The care dashboard (`PatientList`, `PatientDetail`, `PlanCards`) is clean, live-polling and nearly complete.
- Weaknesses:
  - The store can't deploy serverless.
  - The docs say "There is no Supabase" (stale).
  - No 3D replay.
  - Plans can only be edited when a suggestion exists.
  - Small rule bugs: adherence returns 99 for a patient with no sessions; setback compares only two sessions; approval doesn't update the phase when there's no check-in date.
- **Verdict: KEEP the logic, ADAPT the plumbing.** Port `rules.js`, `validate.js`, the `router.js` derivations and `seed.js` to TS. DROP Express and `store.js`.

**Lucas: patient app (inside `Raghav/web/src/patient`).** The whole brief patient loop works end to end:
- one-tap start, pain slider and tiredness emojis, camera setup outline, healthy arm then weak arm with a goal line
- a big filling bar, voice rep counting, "Sit back against the chair" warnings
- a summary ("64% of your stronger arm, up from 58%"), safety stop on pain ≥7 or dizziness, and upload of results plus 3D replays at 15 fps
- accessibility is mostly right: 60 px controls, voice on every screen, dark high-contrast theme

Weaknesses:
- About 650 LOC of off-brief extras (Messages with fake replies, Settings with phone and gender fields, physicians by email, CoachCard) push Start below the fold.
- The setup gate can block forever for side-on reach and close-up hand.
- `repCounter` smoothness runs high.
- A separate visual system from care.

**Verdict: KEEP and ADAPT.** This is the patient half of demo-main.

**Kyle: `Kyle/` (`main/` is a byte-identical mirror).** Two very different things:
- **The Swift watch app**, which is genuinely valuable and the only native code the brief wants:
  - gravity-based arm elevation (0–180°) plus a calibrated heading, giving direction (forward vs side)
  - a rep counter with plane checks, an HKWorkout session for live HR, haptics, local reminders, and polished SwiftUI screens
  - its `side_raise` / `forward_reach` match the camera exercises
- **An Express ingest server plus a single-page "mobility lab"** (camera tracking, a 3D muscle model, a muscle "diagnosis", ntfy push). These duplicate Raghav/web's camera work, break "never diagnosis" and "seated, arm-only" (hips, knees, standing exercises), run unauthenticated on Render with a stored-XSS path, and contradict "no custom server".

**Verdict: watch app ADAPT** (move it to `demo-main/watch/` and post to Supabase). **Server, lab page, `render.yaml` and `main/`: DROP.** Optional salvage for the accuracy slide: the `cameraArm()` idea (camera elevation in watch units).

**Stuti: `stuti/` (ArmSense lab + Gemma proxy).** A standalone vanilla-JS lab inside a copy of Kyle's old server. The original ~185 LOC in `rehab.js` is the best CV maths in the repo:
- a **rest baseline** for lean and hike
- a **3-frame compensation debounce**
- **hysteresis reps that discard partial reps**
- a **scale-free `bursts()` smoothness** (peaks above 25% of rep max speed)
- **reach distance** and **hand `closedMin`**

Also:
- The only working Three.js replay viewer.
- A clean Gemma proxy with no hardcoded key and good "do not diagnose / do not invent numbers" guardrails.

Weaknesses:
- The baseline maths is wrong for combined tilts (it subtracts unsigned magnitudes).
- The hip is required on every frame.
- The replay format is non-contract.
- 2.6 MB of simulated JSONL is committed.
- `weakness.js` repeats Kyle's near-diagnosis wording.

**Verdict: ADAPT the algorithms (port them to TS with the fixes in §7), DROP the app shell.** The Gemma proxy becomes an Edge Function.

**Justin: `justin/` (Supabase watch ingest).** The most deployment-ready Supabase work:
- `watch_daily` and `watch_sessions` tables
- `submit_watch_daily` and `submit_watch_session` `SECURITY DEFINER` RPCs that take the team's camelCase JSON and write snake_case columns
- idempotent upserts, friendly validation, 0-as-missing handling for Shortcut quirks, a size cap on the trace
- a first-timer-friendly iPhone Shortcut README and a ready-to-paste Swift upload patch for Kyle

Gaps:
- Upserts **overwrite** where they should merge.
- No FK to patients.
- No range checks (NaN, 99999).
- Helper functions have a mutable `search_path`.
- Read access is authenticated-only, which conflicts with "no login".
- Four of the six brief tables are missing.

**Verdict: KEEP the RPC pattern as the template for every write, ADAPT** with the fixes and fold it into `0001_init.sql`. `check.html` becomes a dev tool.

---

## 2. Gap matrix

| Brief component | Status today | Best source | Action in demo-main |
|---|---|---|---|
| Patient Home (Start, plan, countdown, 911) | Done but cluttered | Raghav/web (Lucas) | ADAPT: Start becomes the hero; drop CoachCard, CareTeam and Recent |
| Check-in (pain, tiredness) | Done | Raghav/web | PORT unchanged (retheme) |
| Camera setup "Ready" | Done; blocks on reach and hand | Raghav/web | ADAPT: exercise-specific gate + Skip after 8 s (WP3) |
| Healthy → weak exercise, bar, voice, goal | Done | Raghav/web | PORT, plus baseline and debounce (WP3) |
| Live lean / hike warnings | Done; false positives | Raghav/web + stuti/rehab.js | ADAPT: rest-relative vector lean, 3-frame debounce (WP3) |
| Rep thresholds on a real camera | Reach never counts; hand marginal | stuti/rehab.js | ADAPT: rest-relative reach, remapped hand (WP3) |
| Smoothness / fatigue / sec-per-rep | Smoothness runs high | stuti/rehab.js `bursts` | ADAPT (WP3) |
| Reach distance | Missing (Stuti has it) | stuti/rehab.js | ADD optional `reachCm`, `closedMin` (WP3) |
| Summary + streak | Done | Raghav/web | PORT |
| Safety stop | Done | Raghav/web | PORT |
| Upload results + replay | Done (Express) | Raghav/web + api | ADAPT to DataSource (WP1) |
| Care patient list | Done | Raghav/web | PORT, retheme (WP5) |
| Care patient detail + charts | Mostly done | Raghav/web | ADAPT: split into sections; add diastolic, exercise min, use ratio, watch sessions, session list (WP5) |
| 3D session replay + angle graph | Missing (data exists) | Stuti viewer idea, contract ReplayFile | NEW r3f viewer (WP6) |
| Plan editor (suggested) | Done | Raghav/web PlanCards | PORT |
| Edit current plan / move check-in / phase | Missing | n/a | NEW `savePlan`, `setNextCheckin` (WP1 + WP5) |
| Rules engine + alerts | Done in Express | Raghav/api/rules.js | PORT to `src/rules/engine.ts` + bug fixes (WP1) |
| Supabase tables (6 brief + extras) | 2 of 7 exist | justin/ + Raghav model | NEW consolidated migration (WP2) |
| Supabase RPCs / RLS / Storage | Watch RPCs only | justin/ | NEW + fixed (WP2) |
| Seed: 3 patients × 3 weeks | Done (JSON) | Raghav/api/seed.js | PORT to TS; emit seed.sql; fix James's arm-use trend; add replays (WP1/WP2/WP6) |
| Offline / "Wi-Fi dies" | Only localhost Express | n/a | NEW LocalSource + local WASM and fonts (WP0/WP1/WP3) |
| iPhone Shortcut → Supabase (Route A) | Done (docs + RPC) | justin/watch-daily | KEEP; merge semantics fix (WP2) |
| Watch app → Supabase (Route B) | Posts to LAN Express | Kyle/watch-app + justin patch | ADAPT (WP2-watch) |
| Recorded watch data (Route C) | Seeded rows | Raghav seed | PORT (WP1) |
| Weak-arm-use minutes (passive) | Not implemented | n/a | OUT OF SCOPE; seeded data only |
| Session avg HR | Always null | justin watch_sessions | NEW: RPC back-fills `sessions.avg_hr` by time overlap; seeded (WP2/WP1) |
| LLM weekly summary | Session-level proxy only | stuti/gemma-server.mjs | NEW Edge Function + pre-generated text (WP2 + WP5) |
| Vercel hosting | Missing | n/a | `vercel.json` SPA rewrite (WP0) |
| Accuracy number (Toronto Rehab) | Not in code | n/a | Pitch only, out of scope here |

---

## 3. Target architecture

```mermaid
flowchart LR
  subgraph Browser["demo-main/web  (one Vite app, static on Vercel or npm run dev)"]
    P["/patient  (camera + MediaPipe + voice)"] --> API
    C["/care  (charts, alerts, plan editor, 3D replay)"] --> API
    API["src/api.ts  (stable signatures)"] --> V["validate.ts"]
    API --> R["rules/engine.ts  evaluate(snapshot, now)"]
    API --> D{"data/index.ts  pick source"}
    D -->|no env / ?data=local| L["LocalSource: localStorage + IndexedDB + BroadcastChannel; seeded by seed/generate.ts"]
    D -->|VITE_SUPABASE_URL + KEY| S["SupabaseSource: supabase-js"]
  end
  S -->|select (anon, RLS read)| PG[("Supabase Postgres")]
  S -->|rpc submit_session / approve_plan / ...| PG
  S -->|upload replays/<sid>/<ex>-<side>.json| ST[("Storage bucket replays")]
  S -->|functions.invoke weekly-summary| EF["Edge Function weekly-summary (Gemma)"]
  EF --> PG
  SC["iPhone Shortcut (Route A)"] -->|rpc submit_watch_daily| PG
  W["Swift watch app (Route B)"] -->|rpc submit_watch_session| PG
```

**Data flow (online, Supabase mode)**
1. The patient finishes a session. `SessionContext.save()` calls `api.postSession(body + clientKey)`.
2. Inside `postSession`: `validateSession` → `source.insertSession` (`rpc submit_session`, idempotent on `client_key`) → `runRules(patientId)` (loads the snapshot, calls `evaluate`, then `rpc apply_rule_results`) → returns `{session, results, alertsCreated, planSuggested}`.
3. Next, `api.uploadReplay` runs once per round. It uploads to Storage `replays/<sessionId>/<exercise>-<side>.json` (upsert), then calls `rpc register_replay`.
4. The care window polls every 5 s through `usePolling` and sees the new session and alerts.
5. A 60 s `useRulesSweep` in `CareLayout` re-evaluates every patient, which catches Shortcut uploads.
6. The clinician approves. `rpc approve_plan` atomically supersedes the old approved plan, approves the new one with any edits, and mirrors `next_checkin` and `phase` onto the patient. The patient Home poll then shows the "New plan from your care team" banner.

**Data flow (offline, LocalSource)**
- Identical calls, but the source reads and writes the in-browser DB inside a `navigator.locks` lock.
- After each write it posts `{type:'changed'}` on `BroadcastChannel('rehabtrack')`.
- Every open window's `usePolling` refetches immediately. Cross-window updates are instant, and the 5 s poll stays as a backstop.

**Choosing the mode**, in `src/data/index.ts`, evaluated once at startup:
1. `?data=local` or `?data=supabase` in the URL. The choice is remembered in `sessionStorage` under `rehabtrack.data`.
2. Otherwise `VITE_DATA_SOURCE` (`local` | `supabase` | `auto`, default `auto`).
3. In `auto` mode: Supabase if both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are non-empty, else local.
4. In Supabase mode the app makes one health probe at startup: `select id from patients limit 1`, 4 s timeout. If it fails, a danger Banner offers "Use offline demo data". That button reloads with `?data=local`. There is **no silent automatic fallback**, because that would let the two windows split onto different sources.
5. A `DataModeBadge` ("Offline demo data" / "Live · Supabase") shows in both headers' footer.

**What runs on the network in offline mode?** Nothing.
- Fonts come from `@fontsource`.
- MediaPipe WASM is copied to `public/mediapipe/wasm` at install time.
- The models are in `public/models`.
- CDN URLs remain only as fallbacks.

---

## 4. Final folder tree of `demo-main/`

Origins: **P** = ported unchanged (retheme only), **A** = adapted from the path given, **N** = new. WP = owner (see §10).

```
demo-main/
├─ CONVERGENCE_PLAN.md                 N  this file (WP-master)
├─ README.md                           N  what it is, run offline/online, demo URLs (WP8)
├─ AGENTS.md                           A  Raghav/AGENTS.md → team/agent workflow for demo-main only (WP8)
├─ CLAUDE.md                           A  "Read and follow AGENTS.md" (WP8)
├─ .gitattributes                      N  *.task binary; *.sql/*.ts text eol=lf (WP0)
├─ docs/
│  ├─ CONTRACTS.md                     A  Raghav/docs/CONTRACTS.md §1–5b rewritten to §5 of this plan (WP8)
│  ├─ DEMO.md                          N  3-min click path + checklist from §11 (WP8)
│  └─ SHORTCUT.md                      A  justin/watch-daily/README.md (Shortcut build steps; endpoint = rpc) (WP2)
├─ supabase/
│  ├─ README.md                        N  how to apply migration + seed in the SQL editor or CLI; secrets (WP2)
│  ├─ config.toml                      N  minimal CLI config (project_id placeholder) (WP2)
│  ├─ migrations/0001_init.sql         A  justin/*/schema.sql + Raghav data model + fixes (§5) (WP2)
│  ├─ seed.sql                         N  GENERATED by web/scripts/gen-seed-sql.ts; relative dates (WP2)
│  ├─ functions/weekly-summary/index.ts A stuti/server/public/gemma-server.mjs gemma() → Deno Edge Function (WP2)
│  └─ tests/pglite-smoke.mjs           N  runs migration+seed+RPC smoke tests in PGlite with stub roles/storage (WP2)
├─ tools/
│  └─ watch-check.html                 A  justin/watch-daily/check.html; anon read, no sign-in; dev only (WP2)
├─ watch/                              A  Kyle/watch-app (Swift, XcodeGen) (WP2-watch)
│  ├─ README.md                        A  rewritten: xcconfig, Supabase, no LAN server
│  ├─ project.yml                      A  team/bundle from xcconfig; no ATS exceptions; display name RehabTrack
│  ├─ Config.example.xcconfig          N  SUPABASE_URL, SUPABASE_ANON_KEY, PATIENT_ID, DEVELOPMENT_TEAM, BUNDLE_PREFIX
│  ├─ .gitignore                       N  Config.xcconfig, *.xcodeproj/xcuserdata, build/
│  └─ MobilityWatch/
│     ├─ Config.swift                  N  reads the 3 keys from Info.plist
│     ├─ WatchModel.swift              A  drop SERVER_URL/ingest/poll; add uploadSession + offline queue
│     ├─ Info.plist                    A  add SupabaseURL/SupabaseAnonKey/PatientID = $(…); remove ATS/local-network keys
│     ├─ MobilityWatch.entitlements    P
│     ├─ ArmTracker.swift              P  (+ optional repLog append, ≤10 lines)
│     ├─ Exercise.swift, FigureView.swift, ContentView.swift, Theme.swift, MobilityWatchApp.swift  P (copy tweaks only)
│     └─ Reminders.swift               A  seated wording ("Stand up…" → "Sit tall and do 10 arm raises")
│     (MobilityWatch.xcodeproj is NOT copied: regenerate with `xcodegen` from project.yml)
└─ web/
   ├─ package.json                     A  name rehabtrack-web; deps/scripts in §10 WP0 (WP0)
   ├─ package-lock.json                N  regenerated (WP0)
   ├─ index.html                       A  pre-paint theme/density script; no Google Fonts link (WP0)
   ├─ vite.config.ts                   A  manualChunks (three, recharts, supabase); vitest config (WP0)
   ├─ tsconfig.json, tsconfig.node.json P (WP0)
   ├─ postcss.config.js                P (WP0)
   ├─ tailwind.config.js               A  colours → CSS vars; minHeight.tap; density font sizes (WP0)
   ├─ vercel.json                      N  SPA rewrite + long cache for /models, /mediapipe (WP0)
   ├─ .env.example                     A  VITE_DATA_SOURCE, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (WP0)
   ├─ .gitignore                       A  + public/mediapipe/ (generated) (WP0)
   ├─ scripts/
   │  ├─ copy-mediapipe-wasm.mjs       N  node_modules/@mediapipe/tasks-vision/wasm → public/mediapipe/wasm (WP0)
   │  └─ gen-seed-sql.ts               N  generate.ts + engine.ts → ../supabase/seed.sql (WP2)
   ├─ public/
   │  ├─ models/pose_landmarker_full.task  P from Raghav/web/public/models (same blob, 0 extra repo bytes) (WP0)
   │  ├─ models/hand_landmarker.task       P (WP0)
   │  └─ demo/replays/*.json           N  OPTIONAL 1–2 real-camera captures (≤120 KB each) (WP6)
   └─ src/
      ├─ main.tsx                      A  imports fonts + ui/tokens.css; BrowserRouter (WP0)
      ├─ App.tsx                       A  final route table, React.lazy areas + replay; no legacy redirects (WP0)
      ├─ Home.tsx                      N  landing: "Patient app" / "Care team" cards, DataModeBadge, Reset (local) (WP0)
      ├─ Brand.tsx                     P  BRAND_NAME "RehabTrack", team line "by Ctrl+Alt+Heal" (WP0)
      ├─ index.css                     A  Tailwind layers + base on tokens; row-flash keyframes (WP0)
      ├─ vite-env.d.ts                 A  env typings (WP0)
      ├─ types.ts                      A  final contract types §5.1 (WP0 writes; WP1 may add additively)
      ├─ api.ts                        A  facade: same signatures + new fns §6.1 (WP0 stub → WP1 real)
      ├─ usePolling.ts                 A  + refetch on onDataChange (WP1)
      ├─ ui/                           N  design system (WP0; frozen afterwards)
      │  ├─ tokens.css                 N  CSS variables light/dark + densities (§8)
      │  ├─ theme.ts                   N  getTheme/setTheme/useTheme, density per area, localStorage
      │  ├─ Button.tsx, Card.tsx, StatTile.tsx, Banner.tsx, Badge.tsx, ChartCard.tsx, chartTheme.ts
      │  ├─ EmergencyBar.tsx           A  Call 911 + warning-signs modal extracted from patient Layout.tsx
      │  ├─ ThemeToggle.tsx, DataModeBadge.tsx, PageHeader.tsx, EmptyState.tsx
      │  └─ index.ts
      ├─ data/                         N  (WP1 unless noted)
      │  ├─ source.ts                  N  DataSource interface + row types (§6.2)
      │  ├─ index.ts                   N  mode selection, singleton `source`, health probe
      │  ├─ errors.ts                  A  ApiError(message, status, code) (from api.ts)
      │  ├─ derive.ts                  A  Raghav/api/router.js helpers + rules helpers: summaries, enrichment
      │  ├─ validate.ts                A  Raghav/api/validate.js (session, replay, approval, watch, savePlan)
      │  ├─ local/LocalSource.ts       N  in-browser implementation
      │  ├─ local/db.ts                N  load/save/migrate `rehabtrack.db.v1`, locks, BroadcastChannel
      │  ├─ local/replayStore.ts       N  idb-keyval wrapper for replay JSON
      │  ├─ supabase/client.ts         N  createClient from env (lazy)
      │  ├─ supabase/SupabaseSource.ts N  supabase-js implementation
      │  ├─ supabase/mappers.ts        N  row↔type mappers per table, PostgREST error → ApiError
      │  ├─ seed/generate.ts           A  Raghav/api/seed.js → pure TS, deterministic PRNG, relative days
      │  ├─ seed/summaries.ts          N  pre-generated weekly summaries for the 3 patients
      │  ├─ seed/replaySynth.ts        N  deterministic synthetic ReplayFile (WP6 owns)
      │  └─ *.test.ts                  N  derive, validate, LocalSource (jsdom), seed invariants
      ├─ rules/                        (WP1)
      │  ├─ constants.ts               A  PHASE_TARGETS, MAX_PHASE, ALERT_COOLDOWN_HOURS, TARGET_CEILING, DEFAULT_EXERCISES…
      │  ├─ engine.ts                  A  Raghav/api/rules.js → evaluate(snapshot, now)
      │  └─ engine.test.ts             A  Raghav/api/rules.test.js → vitest
      ├─ camera/                       (WP3)
      │  ├─ types.ts                   A  + trunkVec, shoulderWidthM, reachM; TrackerStatus
      │  ├─ geometry.ts                N  vec helpers shared with replay (sub, dot, angle, norm)
      │  ├─ index.ts                   A  + status(), preloadHand()
      │  ├─ mediapipeTracker.ts        A  local WASM, new fields, hand ratio remap
      │  └─ fakeTracker.ts             A  emits new fields
      ├─ patient/
      │  ├─ PatientApp.tsx             A  routes after cuts; data-theme via ui/theme (WP4)
      │  ├─ PatientData.tsx            A  error.code instead of string match (WP4)
      │  ├─ api.ts                     A  snapshot helpers; drop duplicate getApprovedPlan (WP1)
      │  ├─ identity.tsx               A  default patient, ?as=, ?pick=1 (WP4)
      │  ├─ demo.tsx                   A  demo panel + Reset data + Simulate watch upload + patient switch (WP4)
      │  ├─ patient.css                A  only pain slider + coach keyframes (WP4)
      │  ├─ components/Layout.tsx      A  2-item nav; uses ui/EmergencyBar, ThemeToggle (WP4)
      │  ├─ components/CameraView.tsx  A  + "Demo motion" badge (WP3)
      │  ├─ components/ExerciseAvatar.tsx P (WP4)
      │  ├─ components/ProgressChart.tsx  A  chartTheme (WP4)
      │  ├─ data/exercises.ts          A  thresholds(), setup joints (WP3)
      │  ├─ session/SessionContext.tsx A  clientKey for idempotent save (WP4)
      │  ├─ session/repCounter.ts      A  hysteresis + bursts (WP3)
      │  ├─ session/baseline.ts        N  RestBaseline (WP3)
      │  ├─ session/compensation.ts    N  lean/hike from rest + debounce (WP3)
      │  ├─ session/*.test.ts          N  repCounter, baseline, compensation (WP3)
      │  ├─ voice/useVoice.ts          P (WP4)
      │  └─ screens/
      │     ├─ Dashboard.tsx           A  hero Start; cuts (WP4)
      │     ├─ CheckIn.tsx, Summary.tsx, SafetyStop.tsx, History.tsx  P/A retheme (WP4)
      │     └─ SessionRun.tsx          A  baseline phase, gate, skip, debounce (WP3)
      └─ care/                         (WP5 unless noted)
         ├─ CareLayout.tsx             A  header, ThemeToggle, DataModeBadge, useRulesSweep
         ├─ PatientList.tsx            A  retheme
         ├─ PatientDetail.tsx          A  composes sections
         ├─ PlanCards.tsx              A  + EditPlan on current plan, phase field
         ├─ sections/AlertsPanel.tsx   N  (split from PatientDetail) + setback quick action
         ├─ sections/CheckinControl.tsx N "Next check-in" + Move (date, −3 days, +7 days)
         ├─ sections/WeeklySummaryCard.tsx N
         ├─ sections/CameraCharts.tsx  N  (split) symmetry/compensation/pain charts
         ├─ sections/WatchCharts.tsx   N  (split + new series)
         ├─ sections/SessionList.tsx   N  last 10 sessions, replay chips → replay route
         ├─ useRulesSweep.ts           N  60 s rules sweep (Supabase mode)
         └─ replay/                    (WP6)
            ├─ ReplayPage.tsx          N  route /care/patients/:id/sessions/:sid
            ├─ SkeletonScene.tsx       N  r3f Canvas, bones, OrbitControls, grid, warning tint
            ├─ ReplayControls.tsx      N  play/pause, speed, scrubber with warning ticks
            ├─ AngleChart.tsx          N  Recharts angle + lean per frame, click to seek
            ├─ replayMath.ts           N  BONES, toScene, per-frame metrics
            └─ replayMath.test.ts      N
```

---

## 5. Data contracts

### 5.1 TypeScript (camelCase): `web/src/types.ts` (final)

Unchanged from `Raghav/web/src/types.ts` unless marked **NEW** or **CHANGED**.

```ts
export type Exercise = 'arm_raise' | 'forward_reach' | 'hand_open';
export type Side = 'weak' | 'healthy';
export type BodySide = 'left' | 'right';
export type StopReason = 'pain' | 'dizziness' | 'other';
export type PlanStatus = 'suggested' | 'approved' | 'superseded' | 'dismissed';
export type PlanKind = 'phase-up' | 'plateau' | 'compensation';
export type Trend = 'up' | 'down' | 'flat' | 'none';
export type AlertType = 'plateau'|'setback'|'compensation'|'adherence'|'pain'|'safety-stop'|'heart-rate'|'blood-pressure'|'fall';
export type DataMode = 'local' | 'supabase';                         // NEW

export interface Patient { id: string; name: string; weakSide: BodySide; strokeDate: string /*YYYY-MM-DD*/;
  phase: number /*1..4*/; maxRaiseAngle: number; nextCheckin: string /*YYYY-MM-DD*/; bpLimitSys: number; }
export interface PatientSummary extends Patient { latestSymmetry: number|null; trend: Trend; trendDelta: number;
  openAlertCount: number; openAlertTypes: AlertType[]; sessionsThisWeek: number; sessionsPerWeek: number|null; flagged: boolean; }

export interface ExerciseResult { id?: string; sessionId?: string; exercise: Exercise; side: Side;
  bestValue: number;      // deg (arm_raise, forward_reach) or mapped 0–100 % (hand_open)
  reps: number; secPerRep: number /* CHANGED meaning: mean movement duration (leave rest → back to rest), s */;
  smoothness: number /* bursts per rep, ≥1, Stuti's bursts() */; fatigue: number /* last3/first3 peaks, 1 if <6 reps */;
  trunkLeanMax: number /* CHANGED: max degrees FROM REST baseline */; shoulderHikeMax: number /* CHANGED: metres above rest, arm_raise only, else 0 */;
  compRepPct: number /*0..100*/; reachCm?: number|null /* NEW forward_reach only */; closedMin?: number|null /* NEW hand_open only, % */; }

export interface ReplayFile { fps: 15; exercise: Exercise; side: Side; joints: string[] /* = REPLAY_JOINTS */;
  frames: [number, number, number][][] /* frames[f][j] = [x,y,z] m, MediaPipe world: hip-centred, x = patient's left, y DOWN, z toward camera negative */;
  warnings?: { frame: number; type: 'lean' | 'shoulder_hike' }[]; }
export const REPLAY_JOINTS = ['nose','left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist',
  'left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle'] as const;   // unchanged, 13 joints, ≤1800 frames
export interface ReplaySummary { key: string /* `${sessionId}-${exercise}-${side}` */; exercise: Exercise; side: Side;
  fps: number; frameCount: number; seconds: number; warningCount: number; uploadedAt: string; }

export interface PlanExercise { exercise: Exercise; reps: number; target: number; }
export interface Plan { id: string; patientId: string; phase: number; exercises: PlanExercise[]; sessionsPerWeek: number;
  status: PlanStatus; approvedBy: string|null; nextCheckin: string; createdAt: string; approvedAt?: string;
  dismissedAt?: string; dismissedBy?: string /*NEW (was in API only)*/; supersededAt?: string;
  kind?: PlanKind; reason?: string; basedOn?: { sessions: number; avgSymmetry: number|null; avgCompensation: number|null }; }
export interface ApprovePlanBody { approvedBy: string; phase?: number /*NEW*/; exercises?: PlanExercise[]; sessionsPerWeek?: number; nextCheckin?: string; }
export interface SavePlanBody { approvedBy: string; phase: number; exercises: PlanExercise[]; sessionsPerWeek: number; nextCheckin: string; } // NEW
export interface ApiConfig { phaseTargets: Record<string, number>; maxPhase: number; exercises: Exercise[]; alertCooldownHours: number; }

export interface Session { id: string; patientId: string; startedAt: string; endedAt: string; pain: number|null; tiredness: number|null;
  stopReason: StopReason|null; avgHr: number|null; replays: string[] /* keys, derived from session_replays */;
  results: ExerciseResult[]; symmetry: number|null; compensation: number|null; symmetryByExercise: Record<Exercise, number|null>; }
  // CHANGED: `replayFile` removed (always null legacy).
export interface SessionUploadBody { clientKey?: string /*NEW uuid, idempotency*/; patientId: string; startedAt: string|number; endedAt: string|number;
  pain?: number|null; tiredness?: number|null; stopReason?: StopReason|null; results: ExerciseResult[]; }
export interface SessionUploadResponse { session: Omit<Session,'results'|'symmetry'|'compensation'|'symmetryByExercise'>;
  results: ExerciseResult[]; alertsCreated: Alert[]; planSuggested: Plan|null; }
export interface ReplayUploadResponse { sessionId: string; replays: string[]; replay: ReplaySummary; }

export interface WatchDaily { id: string; patientId: string; date: string; steps: number|null; exerciseMin: number|null; standHr: number|null;
  restingHr: number|null; hrv: number|null; sleepHr: number|null; bpSys: number|null; bpDia: number|null; falls: number|null;
  walkingSteadiness: number|null /*NEW 0–100*/; weakArmActiveMin: number|null; useRatio: number|null; }
export type WatchDailyUpload = { patientId: string; date: string } & Partial<Omit<WatchDaily,'id'|'patientId'|'date'>>; // NEW (merge semantics)

export interface WatchSession { id: string; sessionId: string; patientId: string; exercise: 'arm_raise'|'forward_reach';  // NEW
  arm: BodySide|null; startedAt: string; endedAt: string; durationSec: number; targetReps: number|null; reps: number|null;
  attempts: number|null; bestElevationDeg: number|null; completed: boolean|null; avgHr: number|null; maxHr: number|null;
  minHr: number|null; appSessionId: string|null; }

export interface Alert { id: string; patientId: string; type: AlertType; detail: string; createdAt: string; acknowledged: boolean; acknowledgedAt?: string; }
export interface PatientDetailResponse { patient: Patient; plan: Plan|null /* open suggested ?? approved */; approvedPlan: Plan|null; openAlerts: Alert[]; }
export interface WeeklySummary { patientId: string; weekStart: string; text: string; model: string; source: 'pregenerated'|'llm'; createdAt: string; } // NEW
// Label maps EXERCISE_LABELS, PLAN_KIND_LABELS, TARGET_UNITS, ALERT_LABELS: unchanged.
```

### 5.2 SQL (snake_case): `supabase/migrations/0001_init.sql`

All ids are `text` so the demo ids (`p-maria`, `sess-…`, `plan-…`, `al-…`) keep working. Defaults: `prefix || replace(gen_random_uuid()::text,'-','')`. Every table has `created_at timestamptz not null default now()`.

| Table | Columns (type, constraint) |
|---|---|
| `patients` | `id text pk check (id ~ '^[a-z0-9-]{1,64}$')`, `name text not null check (length(name) between 1 and 80)`, `weak_side text not null check in ('left','right')`, `stroke_date date not null`, `phase int not null default 1 check 1..4`, `max_raise_angle numeric not null default 120 check 30..180`, `bp_limit_sys numeric not null default 140 check 90..220`, `next_checkin date not null default current_date + 14` |
| `plans` | `id text pk default 'plan-'…`, `patient_id text not null fk patients on delete cascade`, `phase int not null check 1..4`, `exercises jsonb not null check (jsonb_typeof(exercises)='array' and jsonb_array_length(exercises) between 1 and 6)`, `sessions_per_week int not null check 1..14`, `status text not null check in ('suggested','approved','superseded','dismissed')`, `approved_by text check (length ≤ 80)`, `next_checkin date not null`, `approved_at`, `superseded_at`, `dismissed_at timestamptz`, `dismissed_by text check (length ≤ 80)`, `kind text check in ('phase-up','plateau','compensation')`, `reason text check (length ≤ 500)`, `based_on jsonb`. **Indexes:** `unique (patient_id) where status='suggested'`, `unique (patient_id) where status='approved'` |
| `sessions` | `id text pk default 'sess-'…`, `patient_id fk`, `client_key text unique check (length ≤ 64)`, `started_at timestamptz not null`, `ended_at timestamptz not null check (ended_at >= started_at and ended_at - started_at < interval '3 hours')`, `pain smallint check 0..10`, `tiredness smallint check 1..5`, `stop_reason text check in ('pain','dizziness','other')`, `avg_hr numeric check 30..220`. Index `(patient_id, started_at desc)` |
| `exercise_results` | `id bigint generated always as identity pk`, `session_id text not null fk sessions on delete cascade`, `exercise text check in (3)`, `side text check in ('weak','healthy')`, `best_value numeric not null check 0..180`, `reps int not null check 0..200`, `sec_per_rep numeric not null check 0..120`, `smoothness numeric not null check 0..50`, `fatigue numeric not null check 0..5`, `trunk_lean_max numeric not null check 0..90`, `shoulder_hike_max numeric not null check 0..0.5`, `comp_rep_pct numeric not null check 0..100`, `reach_cm numeric check 0..150`, `closed_min numeric check 0..100`, `unique (session_id, exercise, side)` |
| `session_replays` | `session_id text fk cascade`, `exercise`, `side` (checked), `path text not null` (`<sid>/<ex>-<side>.json` or `synth:<seed>`), `fps int not null default 15`, `frame_count int check 1..1800`, `seconds numeric`, `warning_count int not null default 0`, `uploaded_at timestamptz default now()`, `pk (session_id, exercise, side)` |
| `watch_daily` | `id bigint identity pk`, `patient_id fk`, `date date not null check (date <= current_date + 1)`, `steps 0..100000`, `exercise_min 0..1440`, `stand_hr 0..24`, `resting_hr 25..220`, `hrv 0..300`, `sleep_hr 0..24`, `bp_sys 50..260`, `bp_dia 30..160`, `falls 0..50`, `walking_steadiness 0..100`, `weak_arm_active_min 0..1440`, `use_ratio 0..3` (all `numeric`, nullable), `updated_at`, `unique (patient_id, date)` |
| `watch_sessions` | Justin's columns unchanged (`session_id text unique`, `exercise in ('arm_raise','forward_reach')`, `arm in ('left','right')`, `started_at`, `ended_at`, `duration_sec` generated, `target_reps`, `reps`, `attempts`, `best_elevation_deg 0..180`, `completed`, `avg_hr`, `max_hr`, `min_hr` (25..240), `rep_log jsonb check (array length ≤ 200)`, `trace jsonb check (pg_column_size ≤ 2 MB)`, `app_session_id`, `updated_at`), plus `patient_id fk`, length checks ≤ 64 on the text ids, index `(patient_id, started_at desc)` |
| `alerts` | `id text pk default 'al-'…`, `patient_id fk`, `type text check in (9 types)`, `detail text not null check (length ≤ 500)`, `acknowledged bool not null default false`, `acknowledged_at timestamptz`. **Index:** `unique (patient_id, type) where not acknowledged` |
| `patient_summaries` | `patient_id fk`, `week_start date`, `text text not null check (length ≤ 1200)`, `model text`, `source text check in ('pregenerated','llm')`, `pk (patient_id, week_start)` |

The brief's `sessions.replay_file` is **replaced** by `session_replays`, because a session has 6 per-round files.

**Helpers** (from Justin, renamed): `private.num(jsonb,text)`, `private.reading(jsonb,text)`, `private.pct(jsonb,text)`, `private.ts(jsonb,text)`.
- They live in schema `private`, with `set search_path = ''`, and EXECUTE is revoked from `public`, `anon` and `authenticated`.
- `num` rejects `'NaN'` and `'Infinity'` with the friendly error "<key> must be a number".
- `private.date(jsonb,text)` wraps `::date` in an exception block and turns "2026-02-30" into the friendly error "date must be a real YYYY-MM-DD".

**RPCs.** All are `language plpgsql security definer set search_path = ''`, with schema-qualified names. Each takes camelCase input and returns camelCase `jsonb`. All are granted to `anon, authenticated`.

| RPC | Signature | Semantics |
|---|---|---|
| `submit_watch_daily` | `(body jsonb) returns jsonb` | Justin's validation, **merge**: `col = coalesce(excluded.col, w.col)`. Unknown `patientId` → FK error mapped to `PT404 'Unknown patient'`. Returns `{ok, patientId, date, updatedAt}` |
| `submit_watch_session` | `(body jsonb) returns jsonb` | Justin's validation. `on conflict (session_id) do update … where watch_sessions.patient_id = excluded.patient_id`; if nothing updated and the row exists → `PT409 'sessionId belongs to another patient'`. **Then** `update public.sessions set avg_hr = coalesce(avg_hr, v_avg_hr) where patient_id = v_pid and tstzrange(started_at, ended_at) && tstzrange(v_start - interval '5 min', v_end + interval '5 min')`. Returns `{ok, sessionId, patientId, updatedAt}` |
| `submit_session` | `(body jsonb) returns jsonb` | Body = `SessionUploadBody`. Validates as `validateSession` does (1–6 results, or 0–6 with `stopReason`; no duplicate exercise+side). If `clientKey` exists → returns the existing session (idempotent). Inserts session + results in one transaction. Returns `{session, results}` (camelCase) |
| `register_replay` | `(body jsonb) returns jsonb` | `{sessionId, exercise, side, path, fps, frameCount, seconds, warningCount}` → upsert `session_replays`. Returns `ReplaySummary` |
| `apply_rule_results` | `(p_patient_id text, p_alerts jsonb, p_plan jsonb) returns jsonb` | Inserts each alert `on conflict do nothing` (partial unique index) and the plan (status forced to `suggested`, `on conflict do nothing`). Returns `{alertsCreated: Alert[], planSuggested: Plan\|null}` (only rows actually inserted) |
| `ack_alert` | `(p_alert_id text) returns jsonb` | Sets `acknowledged=true`, `acknowledged_at = coalesce(acknowledged_at, now())`. `PT404` if missing |
| `approve_plan` | `(p_plan_id text, p_approved_by text, p_overrides jsonb default '{}') returns jsonb` | `select … for update`. Status must be `suggested` (else `PT409`). Applies overrides (`phase`, `exercises`, `sessionsPerWeek`, `nextCheckin`, validated). Sets the old approved plan to `superseded`/`superseded_at`. Sets this plan to `approved`/`approved_at`/`approved_by`. **Always** updates `patients.phase` and `patients.next_checkin` (fixes the router.js:522 bug). Returns Plan |
| `dismiss_plan` | `(p_plan_id text, p_dismissed_by text default null) returns jsonb` | Only from `suggested` (else `PT409`) |
| `save_plan` | `(p_patient_id text, p_plan jsonb, p_approved_by text) returns jsonb` | Clinician edits without a suggestion: inserts a new `approved` plan, supersedes the old approved plan, sets any open `suggested` plan to `dismissed` (`dismissed_by = approved_by`), and mirrors phase and check-in onto the patient. Returns Plan |
| `set_next_checkin` | `(p_patient_id text, p_date date) returns jsonb` | Date must be between today and today+180. Updates `patients.next_checkin` and the current approved plan's `next_checkin`. Returns Patient |
| `upsert_summary` | `(p_patient_id text, p_week_start date, p_text text, p_model text) returns void` | **Granted to `service_role` only** (Edge Function) |

**Error codes** (PostgREST maps `PTxyz` to HTTP xyz): `PT400` invalid input, `PT404` not found, `PT409` conflict. CHECK violations (`23514`) and unique violations (`23505`) are mapped client-side.

**RLS and grants (demo-safe):**
- `alter table … enable row level security` on all 9 tables.
- `create policy demo_read on <t> for select to anon, authenticated using (true)`. Add a comment: "DEMO ONLY — fake data; replace with auth before real patients."
- `revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;` then `grant select`.
- No direct writes. Every write goes through the RPCs above.

**Storage:**
- `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('replays','replays', true, 2097152, '{application/json}') on conflict do nothing`.
- Policies on `storage.objects` for `anon, authenticated`:
  - `insert`: `bucket_id = 'replays' and (storage.foldername(name))[1] in (select id from public.sessions where created_at > now() - interval '1 day')`.
  - `update`: the same condition, so a re-upload can upsert.
  - Reads are public (bucket `public = true`).

**Realtime:** not used. Polling is enough. Do not add tables to the publication.

### 5.3 Mapping (TS ⇄ SQL)

- Mappers live in `data/supabase/mappers.ts`, one `fromRow` and one `toRow` per table.
- The rule is mechanical camelCase ⇄ snake_case.
- Exceptions:
  - `ExerciseResult.id` and `WatchDaily.id` are `String(bigint)`.
  - `Session.replays` is built from `session_replays` rows as `${session_id}-${exercise}-${side}`.
  - `ReplaySummary.key` uses the same format.
  - `Plan.basedOn` is `based_on` jsonb as-is.
  - `Plan.exercises[].exercise` (**not** the brief's `name`).
  - Nullable SQL → `undefined` for optional fields (`approvedAt`, `kind`, …) and `null` for `| null` fields.

### 5.4 Watch payloads

- **Route A, Shortcut** (`POST /rest/v1/rpc/submit_watch_daily`, headers `apikey` + `Authorization: Bearer <anon>`):
  - Body `{patientId, date, steps?, exerciseMin?, standHr?, restingHr?, hrv?, sleepHr?, bpSys?, bpDia?, falls?, walkingSteadiness?, weakArmActiveMin?, useRatio?}`.
  - Numbers may be strings with commas.
  - 0 means "no reading" for `restingHr`, `bpSys`, `bpDia` and `walkingSteadiness`.
  - Omitted fields keep their previous value.
- **Route B, watch** (`POST /rest/v1/rpc/submit_watch_session`):
  - Body `{sessionId (UUID), patientId, exercise ('side_raise'|'arm_raise'|'forward_reach'), arm ('left'|'right'), startedAt, endedAt (ISO8601), targetReps, reps, attempts, bestElevationDeg, avgHr?, maxHr?, minHr?, trace?: {hz:5, elevationDeg:number[], directionDeg:number[], heartRate:number[]}, repLog?: {atSec, peakDeg, directionDeg, counted}[], appSessionId?}`.

---

## 6. Data layer design (`web/src/data/`, `web/src/api.ts`)

### 6.1 `api.ts`: the UI's only data entry point

The existing signatures are kept exactly, and UI code must not import `data/*` directly. Exceptions: `dataMode()` and `onDataChange()` are re-exported from `api.ts`.

| Function | Signature | Notes |
|---|---|---|
| `getPatients` | `() => Promise<PatientSummary[]>` | `loadAllSnapshots` → `derive.patientSummary`. Order: flagged first, then name |
| `getPatient` | `(id) => Promise<PatientDetailResponse>` | Throws `ApiError(code 'not_found', 404)` |
| `getPatientSessions` | `(id) => Promise<Session[]>` | Oldest first, enriched (`symmetry`, `compensation`, `symmetryByExercise`, `replays`) |
| `getPatientWatch` | `(id) => Promise<WatchDaily[]>` | Sorted by date |
| `getApprovedPlan` | `(id) => Promise<Plan\|null>` | Returns null directly; no error-string matching |
| `postSession` | `(body: SessionUploadBody) => Promise<SessionUploadResponse>` | validate → insert → `runRules` |
| `uploadReplay` | `(sessionId, replay: ReplayFile) => Promise<ReplayUploadResponse>` | validate → `putReplay` |
| `getSessionReplays` | `(sessionId) => Promise<ReplaySummary[]>` | |
| `getSessionReplay` | `(sessionId, exercise, side) => Promise<ReplayFile>` | `synth:` paths → `replaySynth` |
| `acknowledgeAlert` | `(id) => Promise<Alert>` | |
| `approvePlan` | `(id, body: ApprovePlanBody) => Promise<Plan>` | |
| `dismissPlan` | `(id, dismissedBy?) => Promise<Plan>` | |
| `getConfig` | `() => Promise<ApiConfig>` | Built from `rules/constants.ts`, with no I/O |
| `ApiError` | `class (message, status, code: 'not_found'\|'invalid'\|'conflict'\|'network'\|'not_implemented')` | Re-exported from `data/errors.ts` |
| **NEW** `getPatientWatchSessions` | `(id) => Promise<WatchSession[]>` | Newest first, max 50, no trace |
| **NEW** `savePlan` | `(patientId, body: SavePlanBody) => Promise<Plan>` | |
| **NEW** `setNextCheckin` | `(patientId, date: string) => Promise<Patient>` | |
| **NEW** `submitWatchDaily` | `(body: WatchDailyUpload) => Promise<WatchDaily>` | Then `runRules`. Used by the demo panel "Simulate Shortcut upload" |
| **NEW** `getWeeklySummary` | `(id) => Promise<WeeklySummary\|null>` | Latest row |
| **NEW** `refreshWeeklySummary` | `(id) => Promise<WeeklySummary>` | Supabase only (Edge Function, 15 s timeout); throws `not_implemented` locally |
| **NEW** `evaluatePatient` | `(id, now?: Date) => Promise<{alertsCreated: Alert[]; planSuggested: Plan\|null}>` | Used by `useRulesSweep` |
| **NEW** `resetDemoData` | `() => Promise<void>` | Local: reseed. Supabase: throws `not_implemented` (re-run `seed.sql`) |
| **NEW** `dataMode` | `() => DataMode` | |
| **NEW** `onDataChange` | `(cb: () => void) => () => void` | |

Removed: `getOpenAlerts` (unused) and `API_BASE`.

`patient/api.ts` keeps `loadPatientSnapshot`, `saveSession`, `symmetryFor`, `summarize`, `weekAgoSummary`, `WEEK_AGO_MS`, `streakDays`, `daysUntil` and `firstName`. `loadPatientSnapshot` now uses `getPatient().approvedPlan` instead of a second call. `saveSession` passes `clientKey` through.

### 6.2 `DataSource` interface (`data/source.ts`)

```ts
export type SessionRow = Omit<Session, 'results'|'symmetry'|'compensation'|'symmetryByExercise'>;
export interface ReplayRow { sessionId: string; exercise: Exercise; side: Side; path: string; fps: number;
  frameCount: number; seconds: number; warningCount: number; uploadedAt: string; }
export interface Snapshot { patient: Patient; sessions: SessionRow[]; results: ExerciseResult[]; replays: ReplayRow[];
  watch: WatchDaily[]; alerts: Alert[] /* all, incl. acknowledged */; plans: Plan[]; }
export type NewAlert = Omit<Alert, 'id'|'acknowledged'|'acknowledgedAt'>;
export type NewPlan  = Omit<Plan, 'id'|'status'|'approvedBy'|'approvedAt'|'dismissedAt'|'dismissedBy'|'supersededAt'>;
export interface DataSource {
  readonly mode: DataMode;
  loadSnapshot(patientId: string): Promise<Snapshot>;          // ApiError not_found
  loadAllSnapshots(): Promise<Snapshot[]>;
  listWatchSessions(patientId: string): Promise<WatchSession[]>;
  insertSession(body: SessionUploadBody): Promise<{ session: SessionRow; results: ExerciseResult[] }>;
  putReplay(sessionId: string, replay: ReplayFile, summary: Omit<ReplayRow,'path'|'uploadedAt'>): Promise<ReplayRow>;
  listReplays(sessionId: string): Promise<ReplayRow[]>;
  readReplay(row: ReplayRow): Promise<ReplayFile>;              // 'synth:' handled by api.ts before calling
  applyRuleResults(patientId: string, alerts: NewAlert[], plan: NewPlan|null): Promise<{ alertsCreated: Alert[]; planSuggested: Plan|null }>;
  ackAlert(id: string): Promise<Alert>;
  approvePlan(id: string, body: ApprovePlanBody): Promise<Plan>;
  dismissPlan(id: string, by?: string): Promise<Plan>;
  savePlan(patientId: string, body: SavePlanBody): Promise<Plan>;
  setNextCheckin(patientId: string, date: string): Promise<Patient>;
  submitWatchDaily(body: WatchDailyUpload): Promise<WatchDaily>;
  getWeeklySummary(patientId: string): Promise<WeeklySummary|null>;
  refreshWeeklySummary?(patientId: string): Promise<WeeklySummary>;
  reset?(): Promise<void>;
  subscribe(cb: () => void): () => void;                        // local: BroadcastChannel + same-tab; supabase: same-tab only
}
```

**LocalSource:**
- **Storage.** `localStorage['rehabtrack.db.v1']` holds `{version: 1, seededOn: 'YYYY-MM-DD', seq, patients, plans, sessions, results, replays, watch, watchSessions, alerts, summaries}` (~300 KB). Replay JSON goes to IndexedDB through `idb-keyval` (store `rehabtrack-replays`, key `${sid}-${ex}-${side}`).
- **Writes.** Each write runs inside `navigator.locks.request('rehabtrack-db', …)`, re-reads, mutates, saves, then posts `{type:'changed'}` on `BroadcastChannel('rehabtrack')`. If `navigator.locks` is missing, it writes directly.
- **Semantics** match the SQL RPCs exactly:
  - watch merge
  - idempotent `clientKey`
  - one open alert per type
  - one `suggested` and one `approved` plan per patient
  - approve / save / dismiss state transitions with the same `ApiError` codes
- **Seeding** happens on first load. It **auto-reseeds when `seededOn !== today`** (the demo data is relative to "today" and fake). It can also be forced with `?reset=1` or the Demo panel "Reset demo data".
- **Quota.** If a `QuotaExceededError` hits replays, delete the oldest non-seed replays and retry once.

**SupabaseSource:**
- `loadSnapshot` runs 7 parallel selects filtered by `patient_id`. Results are fetched through `sessions!inner` or by `session_id in (…)`.
- `loadAllSnapshots` runs the same selects unfiltered, which is fine for 3 patients.
- Writes call the RPCs from §5.2.
- `putReplay` uploads with `storage.from('replays').upload(path, blob, {upsert: true, contentType: 'application/json'})`, then calls `register_replay`. `readReplay` uses the public URL.
- `refreshWeeklySummary` uses `functions.invoke('weekly-summary', {body: {patientId}})`.
- `subscribe` fires only after this tab's own writes. Polling covers other devices.

### 6.3 Rules engine (`rules/engine.ts`)

```ts
export function evaluate(s: Snapshot, now: Date): { alerts: NewAlert[]; plan: NewPlan | null };
```

- A line-by-line port of `rules.js` helpers: `symmetryForExercise`, `avgSymmetry`, `avgCompensation`, `sessionTimeline`, `recentWithSymmetry`, `isPlateau`, `isSetback`, `missedSessionStreak`, `restingHrSpike`, `hasOpenAlert`, `isCoolingDown`, `shouldSuggestNextPhase`, `suggestPlanChange`, `basedOnSummary`, `clampTarget`, `lastPlanDecisionAt`, `safetyStopDetail`.
- `makeId` is removed (ids come from the source or DB).
- **Fixes:**
  - (a) `missedSessionStreak` returns 0 when the patient has no sessions.
  - (b) `isSetback`: latest scored session vs the **mean of the previous 3 scored sessions**, with a drop of ≥10. The detail text ends "Consider an earlier check-in."
  - (c) Day boundaries use **local** time (the code runs in the browser).
  - (d) The phase mirror lives in `approve_plan`, not here.
- **When it runs:**
  - Inside `api.postSession`, `api.submitWatchDaily`, `api.acknowledgeAlert` (cooldown bookkeeping) and `api.approvePlan`/`savePlan`/`dismissPlan`. The call is `runRules(patientId)` = `loadSnapshot` → `evaluate` → `applyRuleResults`.
  - On `/care` mount and every 60 s in Supabase mode, for every patient (`useRulesSweep`). It skips a patient whose newest `sessions.created_at` or `watch.updated_at` hasn't changed since the last sweep (kept in memory).
- **Dedupe:** in code through `hasOpenAlert` and the cooldown, and in the DB through the partial unique indexes. A race between two windows therefore yields one row, and the loser's insert is ignored.
- **Tests:** port all 56 cases that apply (`rules.test.js` and the rule-related cases from `routes.test.js`). Add new tests for fixes (a) and (b), and for the BP and fall rules that were untested.

### 6.4 Seed (`data/seed/generate.ts`)

- `generateDemoData(today: Date, rng = mulberry32(42)) → {patients, plans, sessions, results, watch, watchSessions, replays, summaries}`.
- Every timestamp is expressed as a **day offset** plus hour, so the SQL emitter can write `current_date - n + time '15:00'`.
- It then runs `evaluate` per patient to create the seeded alerts and suggestions, exactly as `evaluateAll` does today.
- Story changes from `seed.js`:
  - **James:** `weakArmActiveMin` falls 95→58 and `useRatio` 0.55→0.38 over 21 days. His latest arm_raise **weak** replay is `synth:james-lean`, with a lean on reps 3 and 5 and `warnings[]`.
  - **Priya:** the latest session gets synth replays with a shoulder hike.
  - **Maria:** 6 `watch_sessions` rows with best elevation rising 70→95°.
  - Every seeded session has `avgHr` (68–90).
  - **Today stays empty** for the live session.
- Keep `hrv` and `sleepHr` (nullable, not charted).
- `scripts/gen-seed-sql.ts` (WP2) imports this module and writes `supabase/seed.sql`:
  - It starts with `delete from public.patients where id in ('p-maria','p-james','p-priya');` (cascade).
  - Then inserts with relative dates.
  - Seeded replays are `session_replays` rows with `synth:` paths, so no Storage objects are needed.
  - Summaries are inserted as `source = 'pregenerated'`.

### 6.5 Replays

- Upload: in Supabase mode, Storage path `<sessionId>/<exercise>-<side>.json`. In local mode, IndexedDB.
- Validation (port of `validateReplay`): `fps === 15`, exact joint list, 1–1800 frames, finite numbers, warnings in range.
- `readReplay` for a `synth:` path calls `synthReplay(params)` (WP6): deterministic, no network, no storage.

### 6.6 Polling and realtime

- `usePolling(fn, 5000)` stays: pause in hidden tabs, no overlapping ticks.
- It additionally subscribes to `onDataChange` and runs an immediate tick, debounced 150 ms.
- No Supabase Realtime (out of scope).

---

## 7. Camera fixes (WP3): exact algorithms

**7.1 New tracker outputs.** These are additive in `camera/types.ts`. Every value is the 5-frame average and is `null` when visibility < 0.5.
- `trunkVec: {x,y,z} | null`: the unit vector from mid-hip to mid-shoulder in world coordinates. It falls back to the same-side hip→shoulder of the active side, then the other side.
- `shoulderWidthM: number | null`.
- `reachM: PerSide<number|null>`: shoulder→wrist distance in metres.
- `tracker.status(): {mode: 'real'|'fake'; reason?: 'forced'|'demo'|'no-camera'|'model-load'|'timeout'}`.
- `tracker.preloadHand(): void`.
- The existing `trunkLeanDeg` and `shoulderHike` stay, as absolute values used for the fallback.

**7.2 Rest baseline** (`patient/session/baseline.ts`, class `RestBaseline`), once per round:
- Collect frames from the start of the **countdown** phase. The countdown is 3 s; in demo-fast mode it is 1 s and the baseline is accepted immediately from the fake frames.
- Keep a rolling window of the last 15 frames that have a non-null `trunkVec`.
- **Ready** when `n ≥ 15` **and** all of the following hold:
  - `max_i angle(T_i, T̄) < 3°`, where `T̄ = normalize(Σ T_i)`
  - `std(hike_i) < 0.02`
  - `std(value_i) < 4` (value = this exercise's reading)
- Stored: `T0 = T̄`, `hike0 = mean(hike_i)`, `v0 = mean(value_i)`.
- **Timeout:** if not ready 4 s after the countdown starts, accept the current window (`stable = false`).
- If there were no frames with `trunkVec`, use `baseline = null` and fall back (§7.3).
- The voice already says the instruction during the countdown. Add the on-screen text "Rest your arm for a moment…" until ready.

**7.3 Compensation** (`patient/session/compensation.ts`):
- `lean(t) = degrees(acos(clamp(dot(T(t), T0), −1, 1)))`. This is the true angle between the current and resting trunk vectors, which fixes Stuti's `|θ−θ0|` error.
- `hike(t)` is computed **for arm_raise only**:
  - `max(0, shoulderHike(t) − hike0 − allowance(θ))`
  - `allowance(θ) = max(0, θ − 90) × 0.0012`, where θ is the active shoulder angle (0.108 at 180°). This covers the natural scapular rise.
  - For other exercises `hike = 0`.
- Limits: `LEAN_FROM_REST_DEG = 12`, `HIKE_FROM_REST = 0.10` (fraction of shoulder width).
- Fallback when `baseline = null`: absolute `trunkLeanDeg > 15` and absolute `shoulderHike > 0.12`.
- Debounce: `over = lean > limit || hike > limit`; `streak = over ? streak + 1 : 0`; `compensating = streak ≥ 3`.
- Only `compensating` drives the banner and voice (still rate-limited to one per 4 s), replay `warnings[]`, and the rep's comp flag.
- Round metrics:
  - `trunkLeanMax = round(max lean)` over active frames (degrees from rest).
  - `shoulderHikeMax = round3(max hike × (shoulderWidthM ?? 0.36))` in metres.

**7.4 Rep counter** (`repCounter.ts`; the constructor takes `{restAt, upAt}`): Stuti's hysteresis.
- Idle, and `v > restAt` → open a rep `{t0: t, peak: v, speeds: [], comp: false, top: false}`.
- While the rep is open:
  - `speeds.push(|Δv| / Δt_s)`
  - `peak = max(peak, v)`
  - `comp ||= compensating`
  - `top ||= v ≥ upAt`
- `v ≤ restAt` → if `top`, push `{peak, dur: (t − t0)/1000, bursts: bursts(speeds), comp}` and return `true` (the voice counts it). Otherwise discard. Then go idle.
- `bursts(s)`:
  - `s.length < 5` → 1
  - `m_i = (s_{i−1} + s_i + s_{i+1}) / 3` (edges clamped), `M = max m`
  - count `i ∈ [1, n−2]` where `m_i > m_{i−1} && m_i ≥ m_{i+1} && m_i > 0.25·M`
  - return `max(1, count)`
- `stats()`:
  - `bestValue = round(max peak of counted reps)`, or `round(maxSeen)` if 0 reps, so the weak arm still gets a number.
  - `secPerRep = mean(dur)`
  - `smoothness = mean(bursts)` (1 decimal)
  - `fatigue = n ≥ 6 ? last3/first3 : 1`
  - `compRepPct`
  - plus the `reachCm` and `closedMin` extras, passed in by SessionRun.

**7.5 Thresholds** (`exercises.ts`, `thresholds(ex, v0: number | null) → {restAt, upAt}`):

| Exercise | With baseline v0 | Without baseline |
|---|---|---|
| arm_raise (shoulder °) | `restAt = clamp(v0 + 15, 25, 45)`, `upAt = max(restAt + 25, 55)` | 30 / 55 |
| forward_reach (elbow °) | `restAt = clamp(v0 + 8, 110, 140)`, `upAt = clamp(max(v0 + 22, 140), restAt + 12, 165)` | 130 / 145 |
| hand_open (mapped %) | not baseline-relative (the rest pose isn't a fist) | 35 / 55 |

- Hand mapping in the tracker: `FIST_RATIO = 1.0`, `OPEN_RATIO = 1.6`, `pct = clamp((ratio − 1.0) / 0.6 × 100, 0, 100)`.
  - Measured fists of 1.0–1.15 map to 0–25%.
  - Stuti's open hand of ~1.7 maps to 100%.
  - Raghav's open hand at 2 m (1.34) maps to 57% and now counts.
- Worked examples for forward reach: rest 125° → 133 / 147 (peaks of 154–160 count); rest 111° → 119 / 140.
- `closedMin` = min of `handOpening` over active frames. `reachCm = round(max reachM[active] × 100)` over counted reps.

**7.6 Setup gate** (`SessionRun`, phase `setup`), hold for 1 s:
- arm_raise: both shoulders, plus active elbow and wrist.
- forward_reach: active shoulder, elbow and wrist only.
- hand_open: `handOpening[active] !== null` for 0.5 s; the pose is not required.
- A **"Start anyway"** button (≥60 px) appears after 8 s.
- `tracker.preloadHand()` runs when SessionRun mounts, so the first hand_open round isn't null.
- Guard: an empty `plan.exercises` → message + Home button.

**7.7 Fallback honesty.** `CameraView` shows a warning Badge "Demo motion: camera tracking unavailable" whenever `status().mode === 'fake'` and the demo panel is off.

**7.8 Offline WASM.** `WASM_URL` tries `/mediapipe/wasm` first, then jsDelivr. Models load from `/models/…` first, then the Google CDN (unchanged).

**7.9 Real-camera acceptance** (done by a human on a MacBook webcam, recorded in `docs/DEMO.md`):
- Arm raise counts 3/3 with compRepPct ≤ 34 on the healthy arm while sitting still.
- Forward reach counts ≥ 2/3 side-on.
- Hand open counts ≥ 2/3 at about 50 cm.
- A deliberate 20° sideways lean triggers "Sit back against the chair" within 0.5 s.

---

## 8. UI and design system (WP0 builds it; the WPs consume it)

**Fonts:** `@fontsource/ibm-plex-sans` (500, 600, 700) for headings and the brand; `@fontsource/source-sans-3` (400, 600, 700) for body text. Numbers use `font-variant-numeric: tabular-nums`. There is no Google Fonts link.

**Tokens** (`ui/tokens.css`, consumed by Tailwind as `rgb(var(--x) / <alpha-value>)`, stored as RGB triplets):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F1F5F9` | `#0B0F14` | page |
| `--surface` | `#FFFFFF` | `#121821` | cards |
| `--surface-2` | `#F8FAFC` | `#1A2230` | insets, table header, bar track |
| `--border` | `#E2E8F0` | `#2A3443` | |
| `--text` | `#0F172A` | `#F1F5F9` | |
| `--text-muted` | `#475569` (7.6:1) | `#A8B3C2` (≈8:1) | never lighter than this |
| `--primary` | `#0F766E` | `#2DD4BF` | brand teal, primary buttons, bar fill |
| `--primary-ink` | `#FFFFFF` | `#04201D` | text on primary |
| `--primary-hover` | `#115E59` | `#5EEAD4` | |
| `--primary-soft` | `#CCFBF1` | `#0E3B37` | selected rows, chips |
| `--danger` | `#B91C1C` | `#F87171` | 911, stop, setback |
| `--danger-ink` | `#FFFFFF` | `#1F0606` | |
| `--danger-soft` | `#FEE2E2` | `#3B1414` | |
| `--warning` | `#B45309` | `#FBBF24` | compensation, "sit back" banner |
| `--warning-soft` | `#FFEDD5` | `#3A2A0A` | |
| `--success` | `#15803D` | `#4ADE80` | up-trend, saved |
| `--info` | `#0369A1` | `#38BDF8` | info banners, watch series |
| `--focus` | `#0369A1` | `#FDE68A` | 4 px focus ring, 3 px offset |
| `--chart-1` / `--chart-2` / `--chart-3` | `#0F766E` / `#0369A1` / `#B45309` | `#2DD4BF` / `#38BDF8` / `#FBBF24` | the 3 exercises |
| `--chart-grid` | `#E2E8F0` | `#273142` | |
| `--chart-target` | `#B91C1C` | `#F87171` | dashed target / limit lines |
| `--row-flash` | `#FDE68A` | `#5B4A12` | patient-list flash |

**Theme and density:**
- Set `<html data-theme="light|dark" data-density="comfortable|large">` before first paint with an inline script in `index.html`:
  - path `/patient*` → stored `rehabtrack.theme.patient` or `dark`, density `large`
  - otherwise → stored `rehabtrack.theme.care` or `light`, density `comfortable`
- `ui/theme.ts` updates the attributes on route change.
- Density sets the root font size (16 px comfortable, 18 px large) and `--tap` (44 px comfortable, 64 px large).
- Tailwind adds `minHeight.tap: 'var(--tap)'` and `minWidth.tap`.
- This replaces the `html.patient-area` hack.

**Components** (`src/ui`, props are the contract):
- `Button({variant: 'primary'|'secondary'|'danger'|'ghost', size: 'md'|'xl', icon?, loading?, ...button})`: `md` is ≥44 px, `xl` is ≥64 px with text-xl. `asLink` is supported through `to?`.
- `Card({title?, action?, tone?: 'default'|'warning'|'danger', children})`.
- `StatTile({label, value, unit?, delta?: {value: number; goodWhen: 'up'|'down'}, hint?})`. The delta always shows a ▲/▼ glyph plus text (colour is never the only signal).
- `Banner({tone: 'info'|'success'|'warning'|'danger', title, children?, action?})`, with `role="status"`, or `"alert"` for danger.
- `Badge({tone, children})`.
- `ChartCard({title, subtitle?, height?: number, children})` plus `useChartTheme()`, which returns `{grid, axis, text, series: [c1, c2, c3], target, tooltipStyle}` read from the CSS variables and re-read when the theme changes.
- `EmergencyBar()`: a "Call 911" `tel:911` link plus a "Stroke warning signs" button that opens the BE-FAST modal. It is always visible in the patient header.
- `ThemeToggle({area})`, `DataModeBadge()`, `PageHeader({title, subtitle?, actions?})`, `EmptyState({title, children?})`.

**Accessibility rules (enforced in review):**
- Every patient interactive element is ≥ `min-h-tap` (64 px). Care controls are ≥44 px.
- Text contrast is ≥4.5:1, and large numbers ≥3:1. Only token colours are used: no `slate-400` / `neutral-500` literals.
- The focus ring is always visible.
- There is no typing anywhere in the patient path.
- `useSpeakOnMount` runs on every patient screen. The Voice toggle and Theme toggle are in the patient header.
- Motion respects `prefers-reduced-motion`: the coach animations and replay autoplay are off.
- The word "diagnosis" is banned. WP8 runs `grep -ri diagnos web/src` and expects 0 hits.

**Screens after the cuts:**
- `/` **Home**: two `xl` cards ("I'm a patient" → `/patient`, "Care team" → `/care`), the DataModeBadge, and "Reset demo data" (local mode only).
- `/patient` **Home** (`Dashboard`), top to bottom:
  - header: name, Voice, Theme, EmergencyBar
  - the "New plan from your care team" Banner (when the plan's `approvedAt` is newer than the last seen value)
  - the **hero card**: "Today's session", the 3 exercises as chips (reps · goal), and a `Start today's session` xl Button
  - a row of 3 StatTiles: "Next check-in in N days", "Streak N days", "This week X / Y sessions"
  - StatTile "Weak arm vs healthy: 64% (▲ 6 from last week)"
  - ProgressChart
  - Removed: CoachCard, CareTeamCard, Recent sessions.
- `/patient/checkin`: pain slider + tiredness emojis (unchanged).
- `/patient/session`: explain → setup (gate + Start anyway) → countdown (baseline) → active (bar, goal line, reps, warning banner, "I'm done with this arm", "I feel dizzy") → done.
- `/patient/summary`: one line per exercise plus streak and save status.
- `/patient/stop`: safety advice, 911.
- `/patient/sessions`: History.
- **Patient nav:** Home, My sessions. The demo panel (`?demo=1`) floats bottom-left.
- `/care` **Patient list**: flagged first, symmetry + trend glyph, sessions this week / goal, alert badges, next check-in, row flash.
- `/care/patients/:id` **Patient detail**, top to bottom:
  - PageHeader (name, weak side, phase, days since stroke) with `CheckinControl` on the right
  - AlertsPanel (Acknowledge; a setback alert offers "Move check-in to in 3 days")
  - WeeklySummaryCard (labelled "AI draft for clinician review", plus the model and date; "Regenerate" only in Supabase mode)
  - Plan: SuggestedPlanCard (diff + edit + approve/dismiss) **or** CurrentPlanCard with "Edit plan" (an inline editor: phase 1–4, reps, targets, sessions/week, next check-in → `savePlan`)
  - **Camera progress**: symmetry per exercise (phase target line), compensation %, pain/tiredness
  - **Watch trends**: resting HR, BP sys + dia (limit line), steps + exercise minutes, weak-arm active minutes + use ratio (two axes), watch exercise sessions (best elevation° per session)
  - **Sessions**: a table of the last 10 (date, symmetry, compensation, avg HR, stop badge, replay chips "Arm raise · weak" …)
- `/care/patients/:id/sessions/:sid?exercise=arm_raise&side=weak` **Replay**:
  - an exercise tab bar, a side toggle (Healthy | Weak | Both overlaid, with healthy as a 35%-opacity ghost)
  - an r3f canvas (OrbitControls, floor grid, joints as spheres, bones as lines, nose sphere; warning frames ±3 tinted `--danger`)
  - ReplayControls (play/pause, 0.5×/1×, scrubber with red warning ticks, frame time)
  - AngleChart (the exercise angle + trunk lean vs time, a cursor line, click to seek)
  - a back link

---

## 9. DELETE list (nothing below is copied into `demo-main/`)

**`Raghav/`**
- `api/` in full: `router.js`, `store.js`, `dev-server.js`, `simulate-lucas.sh`, `routes.test.js`, `package*.json`, `.gitignore`. The logic is ported (`rules.js` → `rules/engine.ts`, `validate.js` → `data/validate.ts`, `seed.js` → `data/seed/generate.ts`, router helpers → `data/derive.ts`, `rules.test.js` → `engine.test.ts`), and the express plumbing is not needed. `API.md` is superseded by `docs/CONTRACTS.md`. **Keep `Raghav/api` in the repo until WP8 has passed**, because it is the temporary backend for UI work packages (see WP0).
- `docs/BRIEF.md` (stale: "There is no Supabase") and `docs/CONTRACTS.md` (superseded).
- `README.md`, `AGENTS.md`, `CLAUDE.md` (replaced by the demo-main versions).
- `web/src/patient/localDemo.ts`, `screens/Messages.tsx`, `screens/Settings.tsx`: localStorage-only fakes, off-brief, "is this real?" risk, typing for patients.
- In `Dashboard.tsx`: `CoachCard`, `CareTeamCard`, Recent sessions (they bury Start and duplicate the explainer and History).
- `LegacyPatientRedirect` (App.tsx) and `LegacyPatientLink` (PatientApp.tsx): dead URLs.
- `api.ts`: `getOpenAlerts`, `API_BASE`.
- `Session.replayFile`: always null.
- `index.css` light gradient and `patient.css` page-wide rules: replaced by tokens.
- `web/dist`, `tsconfig.tsbuildinfo`, `node_modules`: untracked build output.

**`Kyle/` and `main/`**
- `main/` in full: a byte-identical mirror.
- `Kyle/server/index.js`, `test_smoke.js`, `public/index.html`, `public/app.js`, `package*.json`, `README.md`, `.gitignore`, `server/data/`:
  - a custom server (contradicts the architecture), no auth, stored XSS, ntfy topic exposed, single global session
  - the lab page duplicates the camera work and contains a muscle "diagnosis", hip/knee ROM and standing/lying exercises (out of scope)
  - the simulator writes fake data labelled as a real watch
- `Kyle/watch-app/MobilityWatch.xcodeproj/`: regenerated from `project.yml`.
- `render.yaml` at the repo root: Render is not used.

**`stuti/`**
- `server/index.js`, `test_smoke.js`, `package*.json`, `README.md`: copies of Kyle's old server.
- `server/data/movement_log.jsonl`: 2.6 MB of simulated noise.
- `public/index.html`, `public/app.js`: lab shell. The viewer idea is re-implemented in r3f.
- `public/rehab.js`: algorithms ported to TS (§7). The non-contract replay format and hip-required gate are dropped.
- `public/weakness.js`: muscle "likely affected" wording (diagnosis risk), ntfy.
- `public/armsense.js`: dead code. Hand it to Kyle and Justin as reference only if passive arm use is ever attempted.
- `public/gemma-server.mjs`: re-implemented as the Edge Function. Its port 8081 collides with the old API, and it serves its source publicly.
- `NEW_README.md`: stale.

**`justin/`**
- `watch-daily/schema.sql`, `watch-sessions/schema.sql`: merged into `0001_init.sql` with the fixes.
- `watch-daily/README.md`: becomes `docs/SHORTCUT.md`.
- `watch-sessions/README.md`: the Swift patch is applied in `watch/`.
- `watch-daily/check.html`: becomes `tools/watch-check.html`.

**Root:** `README.md` (one line, replaced in §13), `.gitkeep` files.

---

## 10. Work packages

**Global rules for every builder:**
- Work only inside your owned paths.
- `web/package.json`, `web/src/types.ts`, `web/src/App.tsx`, `web/src/ui/**` and the configs are owned by WP0 and then frozen. If you need a change, write it under "Requests" in your report, and WP8 applies it.
- No new dependencies beyond the WP0 list.
- Keep `npm run build` and `npm test` green at the end of your package.
- Never put "diagnosis" in copy.
- Finish with a report: what changed, how to verify, known issues.
- Commit on a branch `demo-main/<wp-id>`. Do not push to `main` without the team.

### WP0: Scaffold (serial, first, about 1 h). Owner: one agent.

**Owns:** everything in `demo-main/web` at creation time, the `.gitattributes` file, and the files marked WP0 in §4.

**Steps:**
1. `rsync -a --exclude node_modules --exclude dist --exclude tsconfig.tsbuildinfo Raghav/web/ demo-main/web/`.
2. Delete `localDemo.ts`, `Messages.tsx` and `Settings.tsx`. Remove their routes, nav items and imports. Do the **minimal** edits needed to compile (WP4 does the real Dashboard cleanup). Remove the legacy redirects.
3. `package.json`:
   - `name: "rehabtrack-web"`.
   - Add dependencies: `@supabase/supabase-js@^2.45.4`, `three@^0.169.0`, `@react-three/fiber@^8.17.10`, `@react-three/drei@^9.114.0`, `idb-keyval@^6.2.1`, `@fontsource/ibm-plex-sans@^5.1.0`, `@fontsource/source-sans-3@^5.1.0`.
   - Add devDependencies: `vitest@^2.1.4`, `jsdom@^25.0.1`, `@types/three@^0.169.0`, `tsx@^4.19.2`, `@electric-sql/pglite@^0.2.12`.
   - Scripts: `dev`, `dev:lan`, `build` (`tsc -b && vite build`), `preview`, `test` (`vitest run`), `seed:sql` (`tsx scripts/gen-seed-sql.ts`), `db:test` (`node ../supabase/tests/pglite-smoke.mjs`), `postinstall` (`node scripts/copy-mediapipe-wasm.mjs`).
4. `vite.config.ts`: `build.rollupOptions.output.manualChunks = {three: ['three','@react-three/fiber','@react-three/drei'], charts: ['recharts'], supabase: ['@supabase/supabase-js']}` and `test: {environment: 'jsdom'}`.
5. `scripts/copy-mediapipe-wasm.mjs`, and add `public/mediapipe/` to `.gitignore`. Change `WASM_URL` in `mediapipeTracker.ts` to try local first; this is the only camera edit WP0 makes.
6. Design system (§8): `ui/tokens.css`, the Tailwind mapping, `ui/theme.ts`, the pre-paint script, and all `ui/*` components with the props above. Extract `EmergencyBar` from the patient `Layout.tsx`. `index.css` is rebased on tokens. `main.tsx` imports fonts and tokens. `index.html` drops the Google Fonts link.
7. `types.ts` is the final version from §5.1. Fix compile fallout: remove `replayFile` uses, add `walkingSteadiness`.
8. `api.ts` **bridge**:
   - Keep the existing HTTP bodies, pointing at `Raghav/api` (`VITE_API_BASE`).
   - Add every NEW function from §6.1 with its final signature. Stubs: `getPatientWatchSessions` → `[]`, `getWeeklySummary` → `null`, `dataMode` → `'local'`, `onDataChange` → no-op; the rest throw `ApiError(..., 501, 'not_implemented')`.
   - Add `ApiError.code`.
   - Builders run `cd Raghav/api && npm i && npm run seed && npm start` until WP1 lands.
9. `App.tsx` final route table, with `React.lazy` for `/patient/*`, `/care/*` and `care/replay/ReplayPage` (create a stub page). Write `Home.tsx`.
10. `vercel.json`: `{"rewrites":[{"source":"/((?!models/|mediapipe/|assets/).*)","destination":"/index.html"}],"headers":[{"source":"/(models|mediapipe)/(.*)","headers":[{"key":"Cache-Control","value":"public, max-age=31536000, immutable"}]}]}`.
11. `.env.example`: `VITE_DATA_SOURCE=auto`, `VITE_SUPABASE_URL=`, `VITE_SUPABASE_ANON_KEY=`, `VITE_API_BASE=http://localhost:8081/api # temporary bridge, removed in WP8`.
12. Create empty owned folders with a `.gitkeep` where needed: `supabase/`, `watch/`, `docs/`, `tools/`.

**Acceptance:**
- `cd demo-main/web && npm install && npm run build && npm test` all exit 0. `npm test` passes with zero tests via `--passWithNoTests` in the script until WP1.
- `ls public/mediapipe/wasm/*.wasm` is non-empty.
- `npm run dev`: `/` shows the landing page; `/care` (light) and `/patient` (dark) render against `Raghav/api`.
- Toggling the theme on each area works with no flash on reload.
- `grep -rn "Messages\|Settings\|localDemo" src` returns nothing.

### Parallel WPs (start after WP0 is merged)

**WP1: Data layer, rules, seed.**
- **Owns:** `web/src/data/**` (except `seed/replaySynth.ts`), `web/src/rules/**`, `web/src/api.ts`, `web/src/usePolling.ts`, `web/src/patient/api.ts`.
- **Inputs:** §5 and §6; `Raghav/api/{rules.js, rules.test.js, validate.js, seed.js, router.js}`.
- **Steps:**
  1. Write `errors.ts`, `source.ts`, `validate.ts`, `derive.ts` and `rules/*`, porting the tests.
  2. Write `seed/generate.ts` with the story changes from §6.4 and `seed/summaries.ts`. The summaries are 2 sentences each, no numbers that aren't in the data, no diagnosis.
  3. Implement `LocalSource` and `db.ts` (locks, BroadcastChannel, auto-reseed, `?reset=1`).
  4. Implement `SupabaseSource`, the mappers and `client.ts`, exactly against §5.2. It can't be run without credentials, so unit-test the mappers and error mapping with fixtures.
  5. Rewrite the `api.ts` internals (remove the HTTP bridge) and `index.ts` mode selection + health probe.
  6. `usePolling` + `onDataChange`.
  7. Until WP6 lands, import `synthReplay` from `seed/replaySynth.ts` through a stub that returns a 1-frame valid ReplayFile.
- **Acceptance:**
  - `npm test`: ported rule tests ≥ 50 pass, plus new tests for (a), (b), BP, fall, LocalSource round-trip (post session → alert created once even if posted twice with the same `clientKey`), watch merge, approve/save/dismiss transitions.
  - `npm run build` green.
  - With no `.env`, `/care` shows 3 patients and James is flagged with plateau + adherence.
  - Two windows: approving in `/care` updates `/patient?as=p-james` within 1 s.
  - Killing the network (DevTools offline) changes nothing.

**WP2: Supabase backend + ingest (Shortcut, watch).**
- **Owns:** `demo-main/supabase/**`, `demo-main/tools/**`, `demo-main/docs/SHORTCUT.md`, `demo-main/watch/**`, `web/scripts/gen-seed-sql.ts`.
- **Inputs:** §5; `justin/**`; `Kyle/watch-app/**`; `stuti/server/public/gemma-server.mjs`.
- **Steps:**
  1. Write `0001_init.sql` per §5.2: helpers, 9 tables, indexes, RPCs, RLS, grants, storage bucket and policies. Make it idempotent (`if not exists` / `create or replace`).
  2. Write `tests/pglite-smoke.mjs`:
     - create roles `anon`, `authenticated` and `service_role`, a stub schema `storage` (`buckets`, `objects`, `foldername()`) and stub `auth.uid()`
     - run the migration, then `seed.sql`
     - assert: `submit_session` is idempotent on `clientKey`; watch merge keeps old values; an unknown patient → error; `approve_plan` supersedes and mirrors phase; a second open alert of the same type is ignored; `save_plan` dismisses the open suggestion; NaN is rejected
  3. Write `gen-seed-sql.ts` once WP1's `generate.ts` lands. Until then, hand-write a minimal seed for one patient.
  4. `functions/weekly-summary/index.ts` (Deno):
     - input `{patientId}`
     - read the last 14 days with the service-role client
     - compact the JSON
     - call Gemma through `generativelanguage.googleapis.com` with the `x-goog-api-key` header from `GOOGLE_API_KEY`, model from `GEMMA_MODEL` with Stuti's fallback chain, one retry on 429/5xx
     - prompt: "Two plain sentences for a therapist: symmetry and compensation trend, adherence, any watch or alert concern. Use only the numbers given. Do not diagnose. Do not suggest plan changes."
     - `upsert_summary`, return the row
     - CORS restricted to the app origin env `ALLOWED_ORIGIN`
  5. Write `supabase/README.md`: SQL-editor path (paste migration, then seed), CLI path (`supabase link`, `supabase db push`, `psql -f seed.sql`), `supabase secrets set GOOGLE_API_KEY=…`, `supabase functions deploy weekly-summary`.
  6. `docs/SHORTCUT.md` from Justin's README. The endpoint stays `rpc/submit_watch_daily`. Note the merge semantics.
  7. `tools/watch-check.html`: remove sign-in; anon read.
  8. **Watch** (§10.1 below).
- **Acceptance:**
  - `cd web && npm run db:test` exits 0 with all assertions passing.
  - `npm run seed:sql` regenerates `supabase/seed.sql` deterministically: two runs on the same day are byte-identical.
  - `grep -n "search_path" 0001_init.sql` shows every function pinned.
  - No secrets in the repo: `grep -rn "eyJhbGci\|AIza" demo-main` returns nothing.
  - Watch: the checklist in §10.1 is ticked in the report.

**§10.1 Watch changes (inside WP2, minimal and reviewable; target ≤ 200 changed Swift lines):**
- `git mv`-style copy of `Kyle/watch-app` → `demo-main/watch`, excluding `MobilityWatch.xcodeproj`.
- `Config.example.xcconfig` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PATIENT_ID = p-james`, `DEVELOPMENT_TEAM =`, `BUNDLE_PREFIX = com.example`. `project.yml`:
  - `configFiles: {Debug: Config.xcconfig, Release: Config.xcconfig}`
  - `DEVELOPMENT_TEAM: $(DEVELOPMENT_TEAM)`
  - `PRODUCT_BUNDLE_IDENTIFIER: $(BUNDLE_PREFIX).RehabTrackWatch`
  - remove `NSAllowsArbitraryLoads`, `NSAllowsLocalNetworking` and `NSLocalNetworkUsageDescription`
  - display name "RehabTrack"
- `Info.plist`: `SupabaseURL = $(SUPABASE_URL)`, `SupabaseAnonKey = $(SUPABASE_ANON_KEY)`, `PatientID = $(PATIENT_ID)`. Note that a URL in an xcconfig needs `https:/$()/host`.
- `Config.swift`: `enum Config { static let supabaseURL: URL; static let anonKey: String; static let patientId: String }`, read from `Bundle.main.infoDictionary`. If the values are missing, fall back to empty and skip the upload.
- `WatchModel.swift`:
  - delete `SERVER_URL`, `WATCH_SOURCE`, `flush()`, `buffer`, the flush timer, `startPolling()`/`poll()` and `post(...)`
  - `begin()` makes `cloudSessionId = UUID().uuidString` and resets the trace and HR arrays
  - `record(_:)` appends to `traceElev`, `traceDir` and `traceHr` every 5th sample (25 Hz → 5 Hz)
  - `stopSession()`: if `arm.calibrated`, call `uploadSession(endedAt:)` (Justin's patch: POST `rest/v1/rpc/submit_watch_session` with `apikey` + `Authorization` headers and the §5.4 body; `exercise: kind.rawValue` is fine because the RPC aliases `side_raise`)
  - on a failure, append the body JSON to the `UserDefaults` key `pendingUploads` (max 20)
  - `retryPending()` is called from `applicationDidBecomeActive`
- `MobilityWatchApp.swift`: remove the `startPolling` call and add `retryPending`. `Reminders.swift`: seated wording. `ContentView.swift`: "Dashboard connected" → "Synced".
- **Verification:** if `xcodegen` is installable (`brew install xcodegen`) and `xcodebuild` exists, run `xcodegen && xcodebuild -scheme MobilityWatch -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO build`. Otherwise mark "not compiled" and list every changed symbol for Kyle to review in Xcode. Also verify the body against `submit_watch_session` with `curl` in the PGlite test.

**WP3: Camera and session engine.**
- **Owns:** `web/src/camera/**`, `web/src/patient/session/{repCounter.ts, baseline.ts, compensation.ts, *.test.ts}`, `web/src/patient/data/exercises.ts`, `web/src/patient/screens/SessionRun.tsx`, `web/src/patient/components/CameraView.tsx`.
- **Inputs:** §7; `stuti/server/public/rehab.js`; `Raghav/AGENTS.md` known issues.
- **Steps:** implement §7.1–7.8. Update `fakeTracker` to emit `trunkVec` (upright with small noise, and a lean on demo-compensation reps), `shoulderWidthM` and `reachM`. `SessionRun` passes `reachCm`/`closedMin` into the result. The `SessionContext.addRound` signature is unchanged.
- **Acceptance:**
  - Unit tests:
    - `bursts([smooth bell]) === 1`, `bursts([two humps]) === 2`
    - a partial rep (never reaches `upAt`) isn't counted
    - forward reach with rest 125 → thresholds 133/147
    - baseline trunk tilted 7° forward (depth error); current = baseline rotated 10° sideways about an axis perpendicular to it → lean = 10.0 ± 0.1° (Stuti's formula gives about 5°; this is the counter-example)
    - debounce: 2 frames over → not compensating, 3 → compensating
    - hike allowance at θ = 150 is 0.072
  - `npm run build` + `npm test` green.
  - Fake-tracker browser run (`/patient?demo=1`): a full session finishes in about 1 min at ×4 with 6 results and 6 replays.
  - Hand off the real-camera checklist (§7.9) to a human.

**WP4: Patient UI.**
- **Owns:** `web/src/patient/**` except the WP3 and WP1 files.
- **Steps:**
  - Dashboard per §8 (hero Start first; remove CoachCard, CareTeamCard, Recent).
  - `Layout` with a 2-item nav, `ui/EmergencyBar`, `ThemeToggle` and `DataModeBadge` in the footer.
  - `PatientApp` uses `ui/theme`. Delete the `patient-area` class logic.
  - `PatientData`: `e.code === 'not_found'`.
  - `identity`: default `p-maria`, `?as=<id>`, picker only with `?pick=1` or an unknown id.
  - `SessionContext`: `clientKey = crypto.randomUUID()` created when the session starts, reused on retry.
  - `demo.tsx` panel adds:
    - a patient switcher
    - "Reset demo data" (local)
    - "Simulate Shortcut upload" with presets (normal day / resting HR +12 / fall), which calls `submitWatchDaily` for today
  - Retheme CheckIn, Summary, SafetyStop, History and ProgressChart with tokens and `useChartTheme`. `patient.css` keeps only the slider and coach keyframes.
- **Acceptance:**
  - Build and test green.
  - At 390×844 (phone) the Start button is visible without scrolling on `/patient?as=p-james`.
  - Every button in the patient path is ≥64 px (DevTools check, or a small vitest + jsdom test over `Button size="xl"`).
  - Light/dark toggle works.
  - Voice speaks on each screen.
  - The safety stop from the check-in (pain 8) uploads with `stopReason` and creates a safety-stop + pain alert visible in `/care`.

**WP5: Care UI.**
- **Owns:** `web/src/care/**` except `care/replay/**`.
- **Steps:**
  - Split `PatientDetail` into the `sections/*` files from §4.
  - Retheme with `ui/*` and `useChartTheme` (remove the `CHART_COLORS` literals).
  - Add the new watch series and the `getPatientWatchSessions` chart.
  - `SessionList` with replay chips linking to `/care/patients/:id/sessions/:sid?exercise=…&side=…`.
  - `CheckinControl` (date input + "−3 days" + "+7 days" → `setNextCheckin`); a setback alert quick action sets today+3.
  - `PlanCards`: phase field on suggested; "Edit plan" on the current plan → `savePlan`.
  - `WeeklySummaryCard`.
  - `useRulesSweep` in `CareLayout`.
  - Fix the contrast literals.
- **Acceptance:**
  - Build and test green.
  - `/care/patients/p-james` shows: the plateau + adherence alerts, a suggested plateau plan, a falling weak-arm-minutes line, a session list with a replay chip on the latest session, and a summary card with text.
  - Edit plan on Maria (no suggestion) → the new approved plan appears and the patient Home banner shows.
  - Move check-in −3 days updates the patient Home countdown.
  - No `text-slate-400` / `neutral-500` literals remain (grep).

**WP6: 3D replay.**
- **Owns:** `web/src/care/replay/**`, `web/src/data/seed/replaySynth.ts`, `web/public/demo/replays/**`.
- **Inputs:** §5.1 ReplayFile, §8 replay screen, Stuti's viewer (`stuti/server/public/app.js` lines 18–52 and 182–213) for behaviour reference.
- **Steps:**
  1. `replayMath.ts`:
     - `BONES` as index pairs into `REPLAY_JOINTS`: `[1,2],[1,3],[3,5],[2,4],[4,6],[1,7],[2,8],[7,8],[7,9],[9,11],[8,10],[10,12]`, plus nose→mid-shoulder
     - `toScene([x,y,z]) = [x, −y, −z]` (non-mirrored; y up)
     - centre on the mid-hip of frame 0
     - `frameAngles(frame, exercise, bodySide)`: arm_raise = angle(hip, shoulder, elbow), forward_reach = angle(shoulder, elbow, wrist), trunk lean = angle(mid-shoulder − mid-hip, up)
  2. `SkeletonScene` (`<Canvas camera={{position: [0, 0.3, 2.4], fov: 40}}>`, `<OrbitControls enablePan={false}/>`, `<gridHelper/>`, instanced spheres + `<Line>` from drei). The frame index lives in a ref advanced in `useFrame` at 15 fps × speed. The selected `side` sets the body side through `patient.weakSide`.
  3. `ReplayControls`, `AngleChart`, `ReplayPage` (loads `getSessionReplays` + `getSessionReplay` + `getPatient` for `weakSide`; tabs; Both = load both sides).
  4. `replaySynth.ts`:
     - `synthReplay({seed, exercise, side, weakSide, peakDeg, reps: 5, leanReps?: number[], hikeReps?: number[]}) → ReplayFile`
     - a seated skeleton (hips at origin, knees forward at 90°, shoulders 0.5 m above the hips), a cosine rep profile at 3.2 s/rep
     - lean reps rotate the trunk 15° sideways at the peak
     - `warnings[]` marks frames where lean > 12°
     - ≤ 600 frames, deterministic
     - also export `parseSynthPath('synth:…')`
  5. Optional: copy 1–2 real-camera replays (non-zero z) from the untracked `Raghav/api/data/replays/` into `public/demo/replays/`, wired as `synth:file:<name>`.
- **Acceptance:**
  - Unit tests: `toScene` y-flip; BONES indices are < 13; the synth replay passes `validateReplay` (import it from WP1's `data/validate.ts`; if it hasn't landed yet, a local copy of the checks); the lean reps produce warnings.
  - The replay route lazy-loads (the three chunk is not in the initial bundle: check `dist/assets` names and that the `index-*.js` gzip is ≤ 260 KB).
  - The browser can rotate, scrub, play and pause. Warning frames are red. Clicking the chart seeks.
  - A live session recorded on the fake tracker plays back.

### WP8: Integration (serial, last, about 1–2 h)

**Owns:** everything left over: `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/CONTRACTS.md`, `docs/DEMO.md`, and the "Requests" from all reports.

**Steps:**
1. Remove the HTTP bridge and `VITE_API_BASE`.
2. Apply the requested changes to frozen files.
3. Run the §11 checklist in local mode, and in Supabase mode if credentials exist.
4. Run `grep -ri "diagnos\|ntfy\|localhost:808" demo-main/web/src` → 0 hits.
5. Bundle check.
6. Write the docs.
7. Prepare the repo-migration PR (§13), but do not merge the deletions without the team.

**Acceptance:** the §11 checklist is all green and recorded in `docs/DEMO.md`.

### Dependency graph

```
WP0 ──┬─> WP1 (data) ──┬─> WP2.seed.sql (needs generate.ts)   ┐
      ├─> WP2 (supabase+watch; migration/RPC/edge/watch need nothing) │
      ├─> WP3 (camera)                                         ├─> WP8
      ├─> WP4 (patient UI; uses api.ts signatures, bridge until WP1) │
      ├─> WP5 (care UI; same)                                  │
      └─> WP6 (replay; synth used by WP1 seed, stubbed until then) ┘
```

Critical path: WP0 → WP1 → WP8. WP3 is the highest demo risk, so start it immediately.

---

## 11. Demo click-path (3 min) and verification

**Setup:**
- **Offline:** one laptop, `cd demo-main/web && npm run dev`.
  - Chrome window A: `http://localhost:5173/patient?as=p-james` on the laptop screen.
  - Window B: `http://localhost:5173/care` on the projector.
  - Load both pages once while still online, or they load from local assets anyway.
  - For insurance, have tab C ready with `?demo=1&tracker=fake`.
- **Online:** two laptops on the Vercel URL with Supabase env set and `seed.sql` re-run in the morning.

| Time | Who / route | Action → what the judges see |
|---|---|---|
| 0:00–0:20 | Slides | Problem |
| 0:20–0:30 | A `/patient?as=p-james` | Home: hero "Start today's session", check-in in N days, the 911 bar. Tap Start → check-in: pain 2, tiredness 🙂 |
| 0:30–1:10 | A `/patient/session` | Arm raise: **healthy arm** (bar fills, voice counts 1-2-3), then **weak arm**: dashed goal line; lean on purpose → "Sit back against the chair". Skip the other exercises with "I'm done with this arm" (or run demo speed ×4). Summary: "Your weak arm reached 64% of your stronger arm, up from 58% last week" |
| 1:10–1:20 | B `/care` | James is at the top, flagged (plateau, adherence), and the row flashes from the new session |
| 1:20–1:50 | B `/care/patients/p-james` | Symmetry flat for 2 weeks (the phase target line); watch: weak-arm active minutes **dropping**; AI summary card. Sessions → latest replay chip → **rotate the 3D figure**, scrub to the red warning frames: the trunk lean is visible |
| 1:50–2:10 | B, plan card | Suggested plan (plateau: hand-open reps 12→14); move the next check-in to "−3 days"; **Approve** |
| 2:10–2:30 | A `/patient` | Within 1–5 s the Banner "New plan from your care team" appears, the exercises show the new reps, and the countdown shows the earlier date |
| 2:30–3:00 | Slides | Accuracy number, architecture (one app, Supabase, watch, offline fallback), close |

**Verification checklist** (WP8 runs it; a human re-runs it before the demo):
1. `npm ci && npm run build && npm test` exit 0. `npm run db:test` exits 0.
2. Offline: DevTools Network "Offline" + hard reload of `/patient` and `/care`. Both render with fonts. The real camera tracker starts (no CDN requests in the Network tab).
3. Fresh profile (clear site data) → the seed appears. `?reset=1` resets.
4. The patient full session on the fake tracker ends with 6 results + 6 replays saved. On the real webcam, §7.9 passes.
5. A live session appears in `/care` within 1 s (BroadcastChannel) with no manual refresh.
6. Safety stop (pain 8) → `/patient/stop`, and an alert shows in care.
7. Approve, Dismiss, Edit plan and Move check-in each reflect on patient Home.
8. Replay: seeded `synth:` and live replays both play. Rotate, scrub, warnings work.
9. Demo panel "Simulate Shortcut upload → resting HR +12" raises a heart-rate alert once (and not again on a second click).
10. Supabase mode (if credentials exist): the same checks 4–9 pass across two machines with a 5 s poll. Shortcut curl (from `docs/SHORTCUT.md`) inserts and merges. The watch `curl` body is accepted.
11. a11y: patient buttons ≥64 px; contrast spot-check with DevTools; keyboard focus visible; no "diagnosis" anywhere.
12. `vercel build` (or `npm run build` + `npx serve dist` with a deep link `/care/patients/p-james` reloaded) works.

---

## 12. Decisions for the team, risks, scope

**Decisions for the team** (a default is chosen; change it by updating this section):
1. **Hand-opening symmetry definition.** Default: **mapped 0–100%** (`(ratio − 1.0)/0.6`).
   - It reflects usable range. The raw ratio ×100 inflates symmetry because of the ~1.0 fist floor (weak 1.4 / healthy 1.7 gives 82% raw vs 67% mapped).
   - The alternative is the brief's literal raw ratio.
   - Whichever is chosen, document it on the pitch slide.
2. **Demo patient for the live loop:** **James** (plateau + adherence + falling arm use + lean replay). Maria and Priya are context.
3. **Offline demo topology:** one laptop with two windows (BroadcastChannel). The alternative is a phone hotspot and Supabase on two laptops. Bring both options.
4. **`hrv` / `sleep_hr`:** kept as nullable columns and seeded, but **not charted**. `walking_steadiness` is added but not charted.
5. **`secPerRep` = movement duration** (Stuti), not the interval between rep starts. **`trunkLeanMax` / `shoulderHikeMax` = relative to the rest baseline.** Both are documented in CONTRACTS.
6. **Models:** committed as plain git blobs in `demo-main/web/public/models`. The blobs are identical to `Raghav/web`'s, so the repo grows by 0 bytes. **No LFS**, which avoids teammate and Vercel LFS friction. CDN fallback is kept.
7. **Patient default theme dark, care default light**, with a toggle in both.
8. **Brand:** product "RehabTrack", team line "by Ctrl+Alt+Heal" in the footers and landing page.
9. **Replays bucket is public-read**, because the data is fake. Must be changed before any real patient.
10. **Watch scope:** session summaries only. Passive weak-arm minutes come from seeded Route C data.
11. **LLM:** Gemma via an Edge Function. Pre-generated text is the default display. "Regenerate" appears only in Supabase mode.
12. **When to delete the old folders:** after WP8 is green and one full rehearsal has passed (§13).

**Risks and mitigations:**
- **Real-webcam tracking** (highest). Mitigations: the §7 fixes, Start-anyway, the demo panel ×4 with the fake tracker, the "Demo motion" badge for honesty, and rehearsing in the venue lighting.
- **Supabase not ready or keys unknown.** LocalSource is the default and the demo runs fully offline. The migration is tested in PGlite.
- **Open RPCs** (anyone with the anon key can approve plans). Acceptable for fake data. Optional `p_demo_pin` (stretch). Rotate the anon key after the event.
- **Swift not compiled by agents.** Keep the diff minimal and checklisted. Kyle builds it in Xcode before H32. The demo never depends on the watch (seeded `watch_sessions`).
- **Two windows on one laptop** (camera + WebGL + MediaPipe). Close the replay page before the live session, or keep the replay on the projector window only after the session. Both are lazy.
- **localStorage quota.** Tables are ~300 KB and replays live in IndexedDB with oldest-first eviction.
- **Bundle size.** Lazy routes and manual chunks; the three chunk loads only on the replay page.
- **Day rollover during judging.** Auto-reseed happens only when the date changes; reset manually before the demo.
- **Parallel-agent conflicts.** Strict ownership (§10); frozen files changed only through WP8 requests.

**Explicitly out of scope** (do not build):
- auth / login, enrollment UI, multi-clinic
- Supabase Realtime, Edge-Function rules, DB webhooks
- AFib, SpO2, walking-steadiness charts, passive arm-use counting on the watch, two-watch use ratio
- watch live streaming, the HTML watch simulator, prompts from the dashboard to the watch, ntfy/push
- Messages, physicians, profiles, settings
- the muscle model or any "weak muscle" inference
- legs, standing, speech, memory
- i18n
- the dataset accuracy pipeline (the pitch number comes from the separate notebook)

**Stretch** (only after §11 is green, in this order):
1. WeeklySummary "Regenerate" live via the Edge Function.
2. A one-click "Earlier check-in" on setback alerts (already specified; cheap).
3. The watch `appSessionId` link, with the watch HR shown on the session row.
4. `p_demo_pin` on the care RPCs.
5. Enrollment form (`/care/new`).
6. Optional real-camera replay files.

---

## 13. Making `demo-main/` the single source of truth

Do this in one PR after WP8 is green and the team has agreed (Decision 12):
1. **Delete:**
   - `Kyle/`, `main/`, `stuti/`, `justin/`
   - `Raghav/` (including `api/`, `docs/`, `web/`; `web/public/models` already lives on in demo-main with the same blobs)
   - `render.yaml`
   - all `.gitkeep` files
   - Then `git rm -r` these and commit "Converge on demo-main".
2. **Optionally flatten later:** `git mv demo-main/* .`. Not before the hackathon, because it breaks every builder's paths. Keeping `demo-main/` as the root folder is fine; Vercel's Root Directory handles it.
3. **Root `README.md`** (replace the one-liner):
   - project pitch (2 lines)
   - "Everything lives in `demo-main/`"
   - quick start: `cd demo-main/web && npm install && npm run dev` → open `/patient` and `/care`
   - online mode: copy `.env.example` → `.env.local`, set the Supabase URL and anon key, apply `demo-main/supabase/migrations/0001_init.sql` and `seed.sql`
   - links to `demo-main/docs/DEMO.md`, `CONTRACTS.md` and `SHORTCUT.md`, and `demo-main/watch/README.md`
4. **Root `.gitignore`:** `node_modules/`, `dist/`, `.env*` (but `!.env.example`), `*.tsbuildinfo`, `.DS_Store`, `demo-main/web/public/mediapipe/`, `demo-main/watch/Config.xcconfig`, `demo-main/watch/*.xcodeproj/`, `xcuserdata/`, `supabase/.temp/`, `.vercel/`.
   - `.DS_Store` exists untracked at the root today. Remove it locally.
5. **`.gitattributes`** (root, or `demo-main/.gitattributes`): `*.task binary`, `*.wasm binary`, `*.sql text eol=lf`, `*.ts text eol=lf`, `*.tsx text eol=lf`. This also stops the CRLF churn seen in `stuti/`.
6. **Models:**
   - Plain blobs, no LFS (Decision 6).
   - If repo size ever matters, move them to a CDN or Supabase Storage public bucket and set `VITE_MODEL_BASE`. The tracker already tries local first, then the Google CDN.
   - Never commit `public/mediapipe/wasm`; `postinstall` regenerates it.
7. **Vercel:**
   - Import the repo with Root Directory `demo-main/web` (framework Vite, build `npm run build`, output `dist`).
   - Env `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production and Preview. Leave them unset to deploy a fully offline demo build.
   - `vercel.json` (WP0) handles SPA rewrites and model caching. HTTPS gives the camera a secure context.
8. **Agent and team docs:**
   - `demo-main/AGENTS.md` becomes the only workflow doc: ownership by WP and folder, the report template from Raghav's AGENTS.md, and the "Known issues" list carried forward and pruned.
   - Delete per-person instructions.
9. **Branch hygiene:** after the deletion PR, protect `main`. New work goes through branches touching `demo-main/**` only.
