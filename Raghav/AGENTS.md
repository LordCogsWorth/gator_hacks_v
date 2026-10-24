# RehabTrack — Raghav (API + web app: care dashboard and patient app)

## Project

RehabTrack helps stroke patients recover arm function at home: camera sessions, Apple Watch data, and a care-team dashboard. Raghav owns the shared HTTP API (JSON-file store), the clinician UI, and the web app's shared files; the patient app (Lucas's) lives in the same web app. The pitch loop: patient data → rules engine drafts a suggestion → doctor approves/edits → patient gets the new plan. Suggest only; clinicians approve every plan change. Never say "diagnosis" in the UI.

## Team workflow

- Work arrives as coordinated prompts from the team coordinator (a claude.ai chat). A coordinated prompt is the final decision for its task: don't expand scope; if it conflicts with the code or this file, stop and report.
- Git: `git pull --rebase origin main` before starting and again before pushing. Push at the end only when the prompt asks for it (coordinated prompts do); otherwise never push.
- Ownership: Lucas's agents edit only `Raghav/web/src/patient/**`. Shared files (`src/api.ts`, `src/types.ts`, `src/camera/**`, `App.tsx`, `Brand.tsx`, `usePolling.ts`, `tailwind.config.js`, `package.json`, `package-lock.json`, `index.html`) and all docs including this file belong to Raghav. Lucas's agents list needed shared-file changes in their report instead of making them.
- Lucas never commits `package.json` or `package-lock.json` (his npm 10.9 rewrites the lockfile). Before committing he runs `git checkout -- Raghav/web/package-lock.json Raghav/api/package-lock.json`. If a pull changes `Raghav/web/package.json`, he runs `npm install` in `Raghav/web` first.
- Lucas's agents do NOT edit AGENTS.md; they put state changes in their report, and Raghav's next task updates "Current state".
- Every task ends with this report template (copy it verbatim):

```text
## Report
- Agent + task:
- Commits: (hash: message)
- Files changed: (path: one line what/why)
- Verification: (each command or browser check → result)
- Deviations from the prompt: (or "none")
- Doc/code mismatches found: (or "none")
- Teammate impact: Lucas / Raghav / Kyle+Justin / Stuti (or "none")
- Raghav/Lucas must do manually: (or "none")
- Shared-file changes needed (Lucas only): (or "none")
- Not done / known issues:
- Suggested next step:
```

## Repo rules

- One folder per teammate, everyone commits to main, no branches.
- Agents work ONLY inside Raghav/. Never edit Kyle/, main/, stuti/, justin/ or anything outside Raghav/ (may read them). Lucas has no separate folder any more: his patient app is `Raghav/web/src/patient/**` (the old `leonardo/` folder was deleted; it stays in git history).
- Teammates: Lucas = patient app (`web/src/patient/**`, calls this API); Kyle + Justin = iPhone/Apple Watch (Kyle's server main/server, port 8080); Stuti = camera/CV. Her `stuti/` folder (commit bee196f) is a standalone ArmSense app (Express on port 8080, MediaPipe, watch ingest, Gemma proxy) that does not implement `CameraTracker`; its `REPLAY_JOINTS` and replay JSON differ from ours. The `CameraTracker` integration is done in `Raghav/web/src/camera/` by Raghav.
- Ownership inside `web/`: Lucas owns Raghav/web/src/patient/**; Raghav owns the API, the care area, and the shared files src/api.ts, src/types.ts, src/camera/**, App.tsx, tailwind.config.js (also src/Brand.tsx and src/usePolling.ts). If patient work needs a shared-file change, ask Raghav.
- Small commits with clear messages. Never push unless asked.
- API changes must be additive/backward-compatible, and Raghav/api/API.md + Raghav/docs/CONTRACTS.md must be updated in the same commit.
- After any API code change, the running API must be restarted (Node doesn't reload).

## Read-first

- `docs/BRIEF.md` — product pitch, team ownership, demo flow
- `docs/CONTRACTS.md` — shared data shapes (CameraTracker, ExerciseResult, ReplayFile, session upload incl. stopReason, watch daily)
- `api/API.md` — endpoint contract for the patient app (and everyone)
- `README.md` — install, seed, run, URLs, demo click-path
- `api/router.js` — Express router (mountable at `/api`)
- `api/validate.js` — request-body validation before writes
- `api/rules.js` — alerts (incl. safety-stop) + plan suggestions
- `api/store.js` — JSON-file collections under `api/data/`
- `api/seed.js` — demo patients Maria / James / Priya
- `api/dev-server.js` — standalone server on port 8081 (0.0.0.0 + CORS)
- `web/src/App.tsx` — routes for both areas; `web/src/api.ts`, `web/src/types.ts`, `web/src/usePolling.ts`, `web/src/Brand.tsx` — shared
- `web/src/care/*` — care dashboard (CareLayout, PatientList, PatientDetail, PlanCards)
- `web/src/camera/types.ts`, `mediapipeTracker.ts`, `fakeTracker.ts`, `index.ts` — camera contract, real MediaPipe tracker, fake tracker (+ demo options), delegating wrapper (mode + fallback)
- `web/src/patient/PatientApp.tsx`, `PatientData.tsx`, `api.ts`, `identity.tsx`, `demo.tsx`, `localDemo.ts`, `session/*`, `screens/*` — patient app

## How to run

```bash
# API (terminal 1)
cd Raghav/api && npm install && npm run seed && npm test && npm start
# → http://localhost:8081/api  (also prints LAN URL)

# Web app (terminal 2): care dashboard /care + patient app /patient
cd Raghav/web && npm install && npm run dev          # localhost only
cd Raghav/web && npm run dev:lan                     # Vite --host (phone/other laptop)

# Smoke / simulate Lucas
bash Raghav/api/simulate-lucas.sh                    # or … http://<LAN-IP>:8081/api
```

URLs: `http://localhost:5173/care` (dashboard; `/` redirects), `http://localhost:5173/patient` (patient app; `?as=p-james` picks the patient, else a "Who are you?" picker), `http://localhost:5173/patient?demo=1` (adds the Demo controls panel for the tab). Old links: `/patients/:id` → `/care/patients/:id`, `/patient/:id` → `/patient?as=:id`.

Demo ids: `p-maria` (improving → phase-up), `p-james` (plateau + adherence), `p-priya` (compensation + HR/BP). Optional: `SEED_TODAY=2026-10-24 npm run seed`. Web default API base `http://localhost:8081/api` (`VITE_API_BASE` / `.env`).

## Architecture in brief

**API:** `dev-server.js` mounts `router.js` at `/api`. Router owns `express.json` (5 MB). `validate.js` → store write → `rules.evaluatePatient`. `store.js` = one JSON file per collection. `seed.js` resets demo data; rules run after seed/session/watch.

**Replays:** `POST /sessions/:id/replay` validates a ReplayFile and writes `data/replays/<sessionId>-<exercise>-<side>.json` (one file each, not a collection); keys go on `session.replays`. Seed deletes `data/replays/`.

**Web app:** one Vite app (React + Tailwind + Recharts + lucide-react), port 5173. `App.tsx` routes `/care/*` (CareLayout: light theme; PatientList, PatientDetail with PlanCards approve/dismiss) and `/patient/*` (PatientApp: Lucas's dark theme, scoped by an `html.patient-area` class while mounted). Shared: `api.ts` (all HTTP, `ApiError` carries status), `types.ts` (single source of truth, API camelCase shapes), `camera/`, `usePolling` (every 5 s while visible), `Brand.tsx` + `brand` colour/font tokens in tailwind.config. No Three.js yet.

**Patient app:** `PatientApp` resolves who (`?as=` / picker / localStorage, `identity.tsx`) and `?demo=1` (sessionStorage), then `PatientDataProvider` loads patient + approved plan (404 → null) + sessions and polls them every 5 s (new-plan banner when the approved plan id changes or was approved since the last session). `SessionProvider` holds the run: check-in → `SessionRun` (one `RepCounter` + one ReplayFile per round, frames sampled at 15 fps of tracker time) → `Summary` saves once (POST /sessions, then replays) / `SafetyStop` saves with `stopReason`. Messages, physicians, phone/gender are demo-only in `localDemo.ts`.

**Camera:** `CameraTracker` (start/stop/configure/onFrame → `TrackingFrame`). `camera/index.ts` exports one wrapper `tracker`: real (`mediapipeTracker.ts`: `@mediapipe/tasks-vision` 0.10.14, WASM from jsDelivr, `.task` models from `web/public/models/` with the storage.googleapis.com URL as fallback; Pose in VIDEO mode on a requestAnimationFrame loop capped at ~30 fps, Hands created lazily and run only during `hand_open`; 5-frame averages, visibility < 0.5 → null) unless `?tracker=fake` / demo mode, and falls back to the fake tracker on the same video if the real `start()` throws (`TrackerStartError`: no-camera / model-load / timeout after 10 s). `tracker.setDemoOptions?.()` always drives the fake tracker (weak side, simulated symmetry/compensation, clock speed-up). The app, not the tracker, builds ExerciseResult and ReplayFile.

## Current state

**Done**

- API routes: health, config, patients, sessions POST/GET, plan GET, watch daily POST/GET, alerts GET/PATCH, plans approve/dismiss, replay upload/list/get
- Validation, JSON errors, watch-day merge, alert 72h cooldown, plan suggestions (compensation / phase-up / plateau) with reason
- Safety stop: `POST /sessions` accepts `stopReason` (`pain` | `dizziness` | `other`) and then allows `results: []`; stored on the session (GET returns `null` for older ones); rules raise a `safety-stop` alert (dedupe + cooldown); patient-list symmetry skips sessions without results
- Seed stories + `simulate-lucas.sh`; unit + HTTP tests (`REHAB_DATA_DIR`), incl. safety-stop tests
- API LAN + CORS; web LAN via `npm run dev:lan`
- One web app: care dashboard at `/care` (flagged list, detail charts, alerts incl. "Safety stop", suggested-plan review/approve/dismiss, live polling, reference lines), patient app at `/patient` (Lucas's screens backed by the API: dashboard, check-in, coached session, summary with "vs last week", safety stop, history, progress chart, messages/settings demo-only, patient switcher), redirects for old links
- Real camera tracker (`camera/mediapipeTracker.ts`) is the default outside demo mode; `?tracker=real|fake` (per tab); automatic fallback to the fake tracker with a `console.warn` (verified: no camera / denied permission, blocked models, 10 s timeout; a denied-camera session saves with 201s)
- Camera contract = `CameraTracker`; fake tracker with demo options; app-built ExerciseResult (fatigue ratio, hike in metres) and per-round ReplayFile; sessions and replays validated by the API (201) in the browser loop
- Demo controls panel (`?demo=1`): symmetry, compensation, speed-up; new-plan banner within 5 s of approval
- Old `leonardo/` folder deleted: `Raghav/web/src/patient/**` is the single source of truth for the patient app

**Not done**

- 3D replay viewer in the dashboard (replays are stored and served, nothing renders them yet)
- Messages, physician links and profile extras are not backed by the API (localStorage only, `web/src/patient/localDemo.ts`); the care side can't see or answer them
- Mount router into Kyle's server (`main/server`) — must be **before** Kyle's `express.json`
- Auth (the patient app acts as whoever `?as=` / the picker says)
- `avgHr` (always `null`; match from watch by session window not implemented)

**Known issues**

- Default `npm run dev` is localhost-only; use `dev:lan` for other devices
- BRIEF mentions Three.js replay; the web app has no Three.js dependency yet
- Router not mounted in Kyle's server; two backends until merge (8080 watch / 8081 API)
- Webcam needs a secure context (localhost); over LAN http and in the Claude browser pane the camera is unavailable ("No camera found — demo motion"); the tracker falls back to the fake one, so numbers flow either way
- Real tracker vs the rep thresholds in `patient/data/exercises.ts` (tuned on the fake tracker), measured on a MacBook webcam: **arm raise counts** (3/3 reps, peak 142°); **forward reach never counts** (elbow with the hand in the lap reads 111–125°, facing or side-on, above `restAt` 105; reach peaks 154–160°); **hand open didn't count** at 2 m (open peak 52 %, `upAt` 55; fists at 60 cm read 15–30 %). Session save, replays (13 joints, non-zero z) and lean warnings work
- Real tracker: 3D `trunkLeanDeg` reads 6–8° sitting still facing the camera (20° in a second capture, where upright and leaning sideways read the same), vs 3° on the fake tracker and the 10° limit, so many real reps get a lean warning (healthy arm raise: compRepPct 100)
- Real tracker: when it falls back because the models failed (camera working), the patient sees their own video with the fake figure moving by itself and reps counting; only the console says so (no on-screen sign yet)
- Real tracker needs internet for the WASM (jsDelivr, ~2.6 MB). The first load on slow Wi-Fi can pass the 10 s budget → that session runs on the fake tracker; the models keep loading, so the next session in the tab uses the real one
- Real tracker: `trunkLeanDeg` and `shoulderHike` are absolute (no rest baseline), so camera tilt adds to lean and the shoulder naturally rises when the arm goes above ~90°; lean is null (never flagged) when no shoulder + hip pair is visible; `shoulderAngle` uses straight down as the trunk line if the hip is hidden
- Real tracker: `handOpening` maps the fingertip-to-wrist ÷ palm ratio 0.9 → 0 % and 1.75 → 100 % (estimate: fists measured 1.0–1.15, open hand not measured at 50 cm yet); hand side comes from MediaPipe's handedness label (mirrored: "Left" = patient's right, as in Stuti's and Kyle's code), not yet confirmed on camera and unreliable for fists
- Real tracker: pose ~28 fps, pose + hands ~19 fps (Chrome, Apple Silicon GPU delegate); `web/public/models/` adds 17 MB to the repo and to `dist/`
- Polling pauses in hidden tabs, so the 5 s updates only happen while the tab is visible
- Fake tracker: with the symmetry slider below ~79% (forward reach) / ~69% (hand open) the weak arm is floored so the app's rep thresholds (`patient/data/exercises.ts`) are still crossed; that session's symmetry reads higher than the slider
- Fake tracker figure is flat (z = 0); replay axes follow MediaPipe worldLandmarks (y down), now stated in CONTRACTS.md §4
- `smoothness` from `repCounter` (Lucas's speed-burst count) runs high (~4–5 per rep) with the fake tracker's timer jitter vs ~1–2 in seed data
- A safety-stopped session counts toward the streak and the adherence (missed-days) rule, like any session
- A plan approved mid-session applies to the next session (the run keeps the plan it started with)

## Updating this file

Raghav's tasks end by updating **Current state** (Done / Not done / Known issues) to match the code, including the state changes listed in Lucas's latest reports. Lucas's agents don't edit this file; they report state changes in the "Report" (see Team workflow).
