# RehabTrack — Raghav (API + care-team dashboard)

## Project

RehabTrack helps stroke patients recover arm function at home: camera sessions, Apple Watch data, and a care-team dashboard. Raghav owns the shared HTTP API (JSON-file store) and the clinician UI. The pitch loop: patient data → rules engine drafts a suggestion → doctor approves/edits → patient gets the new plan. Suggest only; clinicians approve every plan change. Never say "diagnosis" in the UI.

## Repo rules

- One folder per teammate, everyone commits to main, no branches.
- Agents work ONLY inside Raghav/. Never edit Kyle/, main/, stuti/, justin/, leonardo/ or anything outside Raghav/ (may read them).
- Teammates: Lucas = patient web app (calls this API); Kyle + Justin = iPhone/Apple Watch (Kyle's server main/server, port 8080); Stuti = camera/CV (MediaPipe).
- Small commits with clear messages. Never push unless asked.
- API changes must be additive/backward-compatible, and Raghav/api/API.md + Raghav/docs/CONTRACTS.md must be updated in the same commit.
- After any API code change, the running API must be restarted (Node doesn't reload).

## Read-first

- `docs/BRIEF.md` — product pitch, team ownership, demo flow
- `docs/CONTRACTS.md` — shared data shapes (ExerciseResult, ReplayFile, watch daily)
- `api/API.md` — endpoint contract for Lucas (and everyone)
- `README.md` — install, seed, run, smoke checks
- `api/router.js` — Express router (mountable at `/api`)
- `api/validate.js` — request-body validation before writes
- `api/rules.js` — alerts + plan suggestions
- `api/store.js` — JSON-file collections under `api/data/`
- `api/seed.js` — demo patients Maria / James / Priya
- `api/dev-server.js` — standalone server on port 8081 (0.0.0.0 + CORS)
- `web/src/pages/*`, `web/src/components/PlanCards.tsx`, `web/src/api.ts`, `web/src/usePolling.ts` — dashboard
- `web/src/pages/PatientDemo.tsx` — demo patient view (stand-in for Lucas's app)
- `web/src/camera/types.ts`, `web/src/camera/mockCamera.ts` — camera contract types + mock (stand-in for Stuti's module)

## How to run

```bash
# API (terminal 1)
cd Raghav/api && npm install && npm run seed && npm test && npm start
# → http://localhost:8081/api  (also prints LAN URL)

# Dashboard (terminal 2)
cd Raghav/web && npm install && npm run dev          # localhost only
cd Raghav/web && npm run dev:lan                     # Vite --host (phone/other laptop)

# Smoke / simulate Lucas
bash Raghav/api/simulate-lucas.sh                    # or … http://<LAN-IP>:8081/api
```

Demo patient view (no curl needed): `http://localhost:5173/patient/p-maria` (header link "Demo patient view").

Demo ids: `p-maria` (improving → phase-up), `p-james` (plateau + adherence), `p-priya` (compensation + HR/BP). Optional: `SEED_TODAY=2026-10-24 npm run seed`. Dashboard default API base `http://localhost:8081/api` (`VITE_API_BASE` / `.env`).

## Architecture in brief

**API:** `dev-server.js` mounts `router.js` at `/api`. Router owns `express.json` (5 MB). `validate.js` → store write → `rules.evaluatePatient`. `store.js` = one JSON file per collection. `seed.js` resets demo data; rules run after seed/session/watch.

**Replays:** `POST /sessions/:id/replay` validates a ReplayFile and writes `data/replays/<sessionId>-<exercise>-<side>.json` (one file each, not a collection); keys go on `session.replays`. Seed deletes `data/replays/`.

**Dashboard:** React + Vite + Tailwind + Recharts. Routes: `/` PatientList, `/patients/:id` PatientDetail, `/patient/:id` PatientDemo (demo patient view). `PlanCards` approve/dismiss. `usePolling` every 5s while tab visible (paused when hidden). All HTTP in `api.ts` (`ApiError` carries status). No Three.js yet.

**Demo patient view / mock camera:** `PatientDemo` runs plan exercises healthy then weak arm through `camera/mockCamera.ts` (`startExercise` with the contract signature + mock-only 5th `options`: symmetryPct, compensationPct, speed, weakSide), then POST /sessions and one replay upload per step. Polls the approved plan every 5 s and shows "New plan from your care team". It is a fallback + reference, not Lucas's app.

## Current state

**Done**

- API routes: health, config, patients, sessions POST/GET, plan GET, watch daily POST/GET, alerts GET/PATCH, plans approve/dismiss
- Validation, JSON errors, watch-day merge, alert 72h cooldown, plan suggestions (compensation / phase-up / plateau) with reason
- Seed stories + `simulate-lucas.sh`; unit + HTTP tests (`REHAB_DATA_DIR`)
- Dashboard: flagged list, detail charts, suggested-plan review/approve/dismiss, live polling
- API LAN + CORS; dashboard LAN via `npm run dev:lan`
- Replay upload: `POST /api/sessions/:id/replay`, `GET /api/sessions/:id/replays`, `GET /api/sessions/:id/replays/:exercise/:side` (validated, stored per file, keys on `session.replays`), with route tests
- Mock camera module (`web/src/camera/`) with the exact contract signature; validated against `validate.js` (sessions + replays)
- Demo patient view `/patient/:id`: plan (+ no-plan 404), guided session with live value / reps / warning banner, demo controls (symmetry, compensation, speed-up ≈ 30 s), check-in, upload, plain-language result, new-plan banner

**Not done**

- 3D replay viewer in the dashboard (replays are stored and served, nothing renders them yet)
- Lucas's real patient app and Stuti's real camera module (demo view + mock stand in until then)
- Mount router into Kyle's server (`main/server`) — must be **before** Kyle's `express.json`
- Auth
- `avgHr` (always `null`; match from watch by session window not implemented)

**Known issues**

- Default `npm run dev` is localhost-only; use `dev:lan` for other devices
- BRIEF mentions Three.js replay; dashboard has no Three.js dependency yet
- Router not mounted in Kyle's server; two backends until merge (8080 watch / 8081 API)
- Demo patient view: webcam preview needs a secure context (localhost); over LAN http and in the Claude browser pane the camera is unavailable and it shows "No camera here — movement is simulated" (values flow either way)
- Polling pauses in hidden tabs, so the 5 s updates only happen while the dashboard / demo tab is visible
- Mock `secPerRep` is reported at real pace even with "Speed up demo" on; replays recorded in speed-up mode play back fast
- Mock replay axes follow MediaPipe worldLandmarks (y down); CONTRACTS.md §4 doesn't state axes yet

## Updating this file

Every task must end by updating **Current state** (Done / Not done / Known issues) to match the code.
