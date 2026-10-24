# RehabTrack — Raghav (API + care-team dashboard)

This folder is the **shared backend** everyone else calls, plus the **care-team dashboard**.

- `api/` — Node + Express. Port **8081**. JSON-file storage. Mountable later into Kyle’s server at `/api`.
- `web/` — React care-team dashboard. Port **5173**.
- `docs/` — project brief and shared contracts (read these first).
- `api/API.md` — **give this file to Lucas** so his coding agent knows exact endpoints.

## Prerequisites

- Node.js 18+ (Node 20 is fine)
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
```

Leave this terminal running.

Seed is safe to re-run anytime — it resets demo data (Maria / James / Priya).

## 2. Install and run the care-team dashboard

In a **second** terminal:

```bash
cd Raghav/web
npm install
npm run dev
```

Open **http://localhost:5173**

You should see a patient list with James and Priya flagged first, then Maria. Click a name for charts and alerts.

Optional: copy `.env.example` to `.env` if the API is not on `http://localhost:8081/api`.

## 3. Quick API smoke check

With the API running:

```bash
curl -s http://localhost:8081/api/health
curl -s http://localhost:8081/api/patients | head
curl -s http://localhost:8081/api/patients/p-maria
curl -s http://localhost:8081/api/alerts
```

## What Lucas needs

1. This repo (or at least `Raghav/api/API.md` + `Raghav/docs/CONTRACTS.md`).
2. Your API running on port 8081 (or your laptop’s Wi‑Fi IP instead of `localhost`).
3. Demo patient ids: `p-maria`, `p-james`, `p-priya`.
4. His app should call:
   - `GET /api/patients/:id/plan` for today’s approved plan
   - `POST /api/sessions` after each session

## Demo patients (seed stories)

| Id | Story |
| --- | --- |
| `p-maria` | Symmetry rising ~45% → 70%, good adherence |
| `p-james` | Plateau ~55%, missed recent sessions |
| `p-priya` | Rising symmetry, high compensation, rising resting HR, high BP |

## Later merge into Kyle’s server

When integrating, mount the same router:

```js
app.use('/api', require('../../Raghav/api/router'));
```

Until then, keep using `npm start` in `Raghav/api`.
