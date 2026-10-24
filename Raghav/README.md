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

## What Lucas needs

1. This repo (or at least `Raghav/api/API.md` + `Raghav/docs/CONTRACTS.md`).
2. Your API running on port 8081 (or your laptop’s Wi‑Fi IP instead of `localhost`).
3. Demo patient ids: `p-maria`, `p-james`, `p-priya`.
4. His app should call:
   - `GET /api/patients/:id/plan` for today’s approved plan
   - `POST /api/sessions` after each session

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
