# RehabTrack — Raghav (API + care-team dashboard)

This folder is the **shared backend** everyone else calls, plus the **web app**: the care-team dashboard and the patient app (Lucas's; it used to be `leonardo/patient-app`, now deleted).

- `api/` — Node + Express. Port **8081**. JSON-file storage. Mountable later into Kyle’s server at `/api`.
- `web/` — one React app on port **5173** with two areas: care dashboard at `/care`, patient app at `/patient`. They share one API client (`src/api.ts`), one set of types (`src/types.ts`) and one camera layer (`src/camera/`).
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

## 2. Install and run the web app (care dashboard + patient app)

In a **second** terminal:

```bash
cd Raghav/web
npm install
npm run dev
```

| URL | What |
| --- | --- |
| http://localhost:5173/care | Care-team dashboard (`/` redirects here; old `/patients/:id` links still work) |
| http://localhost:5173/patient | Patient app. First visit asks "Who are you?" (remembered); `?as=p-james` picks a patient directly |
| http://localhost:5173/patient?demo=1 | Patient app with the **Demo controls** panel (remembered for the browser tab; `?demo=0` turns it off) |
| http://localhost:5173/patient?tracker=real / ?tracker=fake | Force the real webcam + MediaPipe tracker or the fake one (remembered for the tab). Default: fake with `?demo=1`, real otherwise |

From another laptop or phone on the same Wi‑Fi, use `npm run dev:lan` (`vite --host`) and open the LAN URL Vite prints (e.g. `http://192.168.x.x:5173`). Point `VITE_API_BASE` at the API’s LAN URL if needed. The patient app's webcam only works on `localhost` (browsers block cameras on plain-http LAN addresses); the fake tracker's numbers flow either way.

On `/care` you should see a patient list with James and Priya flagged first, then Maria. Click a name for alerts, the suggested plan (review, edit, Approve / Dismiss), and charts. Both pages refresh every 5 seconds while the tab is visible. The header's **Patient app** link opens the patient app as the patient on screen.

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

## 4. Patient app (`/patient`)

Lucas's app, backed by the API (no fake data, no login):

- **Who:** `?as=<patientId>` or the "Who are you?" picker; remembered in localStorage. Settings → **Switch patient (demo)**.
- **Dashboard:** streak, sessions this week, weaker-arm % vs last week, next check-in, coach avatar, today's plan with reps and goals (`GET /patients/:id/plan`; "No plan yet" on 404), care team, progress chart, recent sessions. Polls every 5 s: after the care team approves a plan, **New plan from your care team** appears with the new targets.
- **Session:** check-in (pain 0–10, tiredness) → for each exercise: coach explains → camera setup → stronger arm → weaker arm (goal line = stronger arm's best), voice rep count, lean / shoulder-hike warnings → summary ("up from X% last week") → saved with `POST /sessions` + one replay per round.
- **Safety stop:** pain 7+ at check-in or "I feel dizzy or unwell" ends the session and still uploads it with `stopReason`, so the care team gets a **Safety stop** alert.
- **History, Messages, Settings:** history comes from the API. Messages (with a demo auto-reply), physicians and phone/gender are **demo-only** in localStorage (`src/patient/localDemo.ts`); the name comes from the API.
- **Demo controls** (`?demo=1`, bottom of every screen): simulated symmetry (defaults to the patient's latest), simulated compensation (over 50% of weak-arm reps raises an alert), **Speed up demo** (on by default; ≈ 1 minute per session plus the three "I'm ready" clicks).

Camera: the app talks to a `CameraTracker` (`src/camera/types.ts`, CONTRACTS.md §2). `src/camera/index.ts` runs the real one (`mediapipeTracker.ts`: webcam + MediaPipe; WASM from jsDelivr, models from `public/models/` with the Google CDN as fallback) or the fake one (`?demo=1` / `?tracker=fake`), and falls back to the fake one with a console warning if the real one can't start (no camera, models fail or take over 10 s). The app counts reps and builds `ExerciseResult` and `ReplayFile` itself (`src/patient/session/repCounter.ts`, `screens/SessionRun.tsx`).

## 5. 60-second demo click-path

Seed first (`npm run seed` in `Raghav/api`), keep the API running, and open two browser windows side by side: the dashboard at `http://localhost:5173/care` and the patient app at `http://localhost:5173/patient?as=p-maria&demo=1`. Both must stay visible: polling pauses in hidden tabs.

1. **Dashboard (10 s):** James and Priya are flagged first. Open **Maria**: symmetry rising toward the phase target, a suggested "Ready for next phase" plan with its reason.
2. **Patient (35 s):** on Maria's dashboard click **Start session**, pick a tiredness, **Next**, then **I'm ready, let's start** for each exercise (Speed up demo is on). Point out the coach, the stronger arm setting the goal line, the weaker arm aiming at it, and the reps. The summary says "Your weak arm reached 72% of your healthy arm — up from 63% last week" and "✓ Sent to your care team".
3. **Dashboard (5 s):** within 5 s Maria's charts gain today's point.
4. **Approve (5 s):** on Maria's dashboard click **Approve plan** (edit a target or the check-in date first if you like).
5. **Patient (5 s):** within 5 s the patient dashboard shows **New plan from your care team** with phase 3 and the new goals.

Optional beats:

- **Compensation:** open `/patient?as=p-priya&demo=1`, set Demo controls → compensation to 70%, run a session. Her compensation alert is already open from the seed, so no duplicate is raised. Acknowledge it on her dashboard, run another 70% session, and a new compensation alert appears (newer data after the acknowledgement overrides the 72 h cooldown).
- **Safety stop:** open `/patient?as=p-james`, **Start session**, set pain to 8, **Next**: the app stops ("Your care team has been told") and James gets **Safety stop** and **Pain** alerts on `/care`.

Re-seed before the real demo to reset everything.

## What Lucas needs

1. His app now lives in `Raghav/web/src/patient/**` (he owns that folder; see `AGENTS.md` for the shared files Raghav owns).
2. The API running on port 8081 (or the laptop’s Wi‑Fi IP instead of `localhost`).
3. Demo patient ids: `p-maria`, `p-james`, `p-priya`.
4. Endpoints the app uses (`Raghav/api/API.md`): `GET /patients/:id`, `GET /patients/:id/plan`, `GET /patients/:id/sessions`, `POST /sessions` (with `stopReason` on a safety stop), `POST /sessions/:id/replay`.

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
