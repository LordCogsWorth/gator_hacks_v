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

Demo ids: `p-maria` (improving → phase-up), `p-james` (plateau + adherence), `p-priya` (compensation + HR/BP). Optional: `SEED_TODAY=2026-10-24 npm run seed`. Dashboard default API base `http://localhost:8081/api` (`VITE_API_BASE` / `.env`).

## Architecture in brief

**API:** `dev-server.js` mounts `router.js` at `/api`. Router owns `express.json` (5 MB). `validate.js` → store write → `rules.evaluatePatient`. `store.js` = one JSON file per collection. `seed.js` resets demo data; rules run after seed/session/watch.

**Dashboard:** React + Vite + Tailwind + Recharts. Routes: `/` PatientList, `/patients/:id` PatientDetail. `PlanCards` approve/dismiss. `usePolling` every 5s while tab visible. No Three.js yet.

## Current state

**Done**

- API routes: health, config, patients, sessions POST/GET, plan GET, watch daily POST/GET, alerts GET/PATCH, plans approve/dismiss
- Validation, JSON errors, watch-day merge, alert 72h cooldown, plan suggestions (compensation / phase-up / plateau) with reason
- Seed stories + `simulate-lucas.sh`; unit + HTTP tests (`REHAB_DATA_DIR`)
- Dashboard: flagged list, detail charts, suggested-plan review/approve/dismiss, live polling
- API LAN + CORS; dashboard LAN via `npm run dev:lan`

**Not done**

- 3D replay UI + `POST /api/sessions/:id/replay` upload
- Mount router into Kyle's server (`main/server`) — must be **before** Kyle's `express.json`
- Auth
- `avgHr` (always `null`; match from watch by session window not implemented)

**Known issues**

- Default `npm run dev` is localhost-only; use `dev:lan` for other devices
- BRIEF mentions Three.js replay; dashboard has no Three.js dependency yet
- Router not mounted in Kyle's server; two backends until merge (8080 watch / 8081 API)

## Updating this file

Every task must end by updating **Current state** (Done / Not done / Known issues) to match the code.
