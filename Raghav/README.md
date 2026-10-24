# RehabTrack — Raghav (API + care-team dashboard)

This folder is the **shared backend** everyone else calls, plus the **care-team dashboard**.

- `api/` — Node + Express. Port **8081**. JSON-file storage. Mountable later into Kyle’s server at `/api`.
- `web/` — React care-team dashboard. Port **5173**.
- `docs/` — project brief and shared contracts (read these first).
- `api/API.md` — **give this file to Lucas** so his coding agent knows exact endpoints.

## Prerequisites

- Node.js 18+ (Node 20 is fine; tests use the built-in `fetch` and `node:test`)
- Two terminal windows

## 1. Install and seed the API

```bash
cd Raghav/api
npm install
npm run seed
npm test
npm start
```

You should see:

```text
RehabTrack API listening on http://localhost:8081
  health: http://localhost:8081/api/health
  on your LAN: http://192.168.x.x:8081/api
```

Leave this terminal running. Give teammates the `on your LAN` URL. The server listens on all interfaces, and CORS allows `localhost` and private LAN origins (`10.x`, `172.16–31.x`, `192.168.x`). To allow another origin (e.g. a deployed patient app), start it with `ALLOWED_ORIGINS=https://a.example.com,https://b.example.com npm start`.

Seed is safe to re-run anytime: it resets demo data (Maria / James / Priya). Seed dates are relative to today (noon UTC), so the stories hold whatever day you seed. To pin a date: `SEED_TODAY=2026-10-24 npm run seed`.

**Restart `npm start` after pulling new API code.** Node doesn't reload changes on its own.

`npm test` runs the rules-engine unit tests and HTTP route tests against a temporary data folder (`REHAB_DATA_DIR`), so it never touches `api/data/`.

## 2. Install and run the care-team dashboard

In a **second** terminal:

```bash
cd Raghav/web
npm install
npm run dev
```

Open **http://localhost:5173**

From another laptop or phone on the same Wi‑Fi, use `npm run dev:lan` (`vite --host`) and open the LAN URL Vite prints (e.g. `http://192.168.x.x:5173`). Point `VITE_API_BASE` at the API’s LAN URL if needed.

You should see a patient list with James and Priya flagged first, then Maria. Click a name for alerts, the suggested plan (review, edit, Approve / Dismiss), and charts. Both pages refresh every 5 seconds while the tab is visible.

Optional: copy `.env.example` to `.env` if the API is not on `http://localhost:8081/api`.

## 3. Quick API smoke check

With the API running:

```bash
curl -s http://localhost:8081/api/health
curl -s http://localhost:8081/api/patients | head
curl -s http://localhost:8081/api/patients/p-maria
curl -s http://localhost:8081/api/alerts
curl -s http://localhost:8081/api/config
```

Simulate the patient app uploading a good and a bad session for Maria:

```bash
bash Raghav/api/simulate-lucas.sh            # or: bash Raghav/api/simulate-lucas.sh http://<LAN-IP>:8081/api
```

## 4. Demo patient view (stand-in for Lucas's app)

Until Lucas's app and Stuti's camera module are in the repo, the dashboard has a **demo patient view** at `/patient/:id` that runs the patient side of the loop with a mock camera. It is a fallback and a reference implementation, labelled "Demo patient view"; it is not a replacement for Lucas's app.

With the API (`npm start` in `Raghav/api`) and dashboard (`npm run dev` in `Raghav/web`) running, open **http://localhost:5173/patient/p-maria**, or click the small **Demo patient view** link in the dashboard header (from a patient's page it opens that patient).

- Home shows today's approved plan (`GET /patients/:id/plan`) and the next check-in; "No plan yet" if there's no approved plan.
- **Start today's session** runs each plan exercise, stronger arm then weaker arm: live value, rep counter, warning banner on lean / shoulder hike, Stop / Next. Then pain (0–10) and tiredness (1–5), then it saves the session and uploads one 3D replay per step.
- **Demo controls** (collapsible, bottom): patient picker, simulated symmetry (defaults to the patient's latest), simulated compensation (over 50% of weak-arm reps raises an alert), and **Speed up demo** (on by default; ≈ 30 s per session).
- While the page is open it checks the plan every 5 s and shows **New plan from your care team** after an approval.
- The webcam preview only works on `localhost` (browsers block cameras on plain-http LAN addresses); without it the numbers still flow.

Code: `web/src/pages/PatientDemo.tsx`, mock camera `web/src/camera/mockCamera.ts` (same signature as Stuti's module, so hers can replace it), types `web/src/camera/types.ts`.

## 5. 60-second demo click-path

Seed first (`npm run seed` in `Raghav/api`), keep the API running, and open two browser windows side by side: the dashboard at `http://localhost:5173` and the patient view at `http://localhost:5173/patient/p-maria`. Both must stay visible: polling pauses in hidden tabs.

1. **Dashboard (10 s):** James and Priya are flagged first. Open **Maria**: symmetry rising toward the phase target, a suggested "Ready for next phase" plan with its reason.
2. **Patient (25 s):** in Maria's view, click **Start today's session** (Speed up demo on). Point out the live value and reps, healthy arm first, then the weak arm aiming at that mark. Pick pain and tiredness, **Save my session**: "Session saved", symmetry per exercise, 6 of 6 recordings sent.
3. **Dashboard (5 s):** within 5 s Maria's charts gain today's point.
4. **Approve (10 s):** on Maria's dashboard click **Approve plan** (edit a target or the check-in date first if you like).
5. **Patient (5 s):** within 5 s the patient view shows **New plan from your care team** with phase 3 and the new targets.

Optional compensation beat: switch the patient view to **Priya** (Demo controls → Patient), set compensation to 70%, and run a session. Her compensation alert is already open from the seed, so no duplicate is raised ("No new alerts"). Acknowledge it on her dashboard, run another 70% session, and a new compensation alert appears (newer data after the acknowledgement overrides the 72 h cooldown).

Re-seed before the real demo to reset everything.

## What Lucas needs

1. This repo (or at least `Raghav/api/API.md` + `Raghav/docs/CONTRACTS.md`).
2. Your API running on port 8081 (or your laptop’s Wi‑Fi IP instead of `localhost`).
3. Demo patient ids: `p-maria`, `p-james`, `p-priya`.
4. His app should call:
   - `GET /api/patients/:id/plan` for today’s approved plan
   - `POST /api/sessions` after each session
   - `POST /api/sessions/:id/replay` once per exercise + side (optional; the camera module's `replay()` output)
5. A working reference: the demo patient view above (`web/src/pages/PatientDemo.tsx`).

## Demo patients (seed stories)

| Id | Story | Suggested plan (from the rules engine) |
| --- | --- | --- |
| `p-maria` | Symmetry rising ~45% → 71%, good adherence, no alerts | Phase 2 → 3, targets +10% |
| `p-james` | Plateau ~53% (hand opening lags), last 4 days missed | Same phase, more hand-open reps at an easier target |
| `p-priya` | Rising symmetry, 55% compensation, resting HR up, BP over limit | Same phase, reps −20%, targets −10%, focus on form |

## Later merge into Kyle’s server

When integrating, mount the same router:

```js
app.use('/api', require('../../Raghav/api/router'));
```

Mount it **before** the server's own `app.use(express.json(...))`. The router parses its own JSON (5 MB limit, for replays) and always answers errors as JSON. If the host's 1 MB parser runs first, its limit applies and its errors come back as HTML.

Until then, keep using `npm start` in `Raghav/api`.
