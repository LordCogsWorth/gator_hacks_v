# RehabTrack Stroke, by Ctrl+Alt+Heal

RehabTrack helps stroke survivors rebuild arm function at home. A webcam session counts reps and spots compensation,
an Apple Watch adds daily activity, and a care-team dashboard turns that into alerts and draft plan changes that a
clinician approves.

Everything lives in this folder:

| Path | What |
| --- | --- |
| `web/` | the app: patient app at `/patient`, care dashboard at `/care` (React + Vite + Tailwind) |
| `supabase/` | one migration, a generated seed, the `weekly-summary` Edge Function, a PGlite smoke test |
| `watch/` | the Apple Watch app (Swift, XcodeGen) that posts exercise sessions to Supabase |
| `docs/` | `CONTRACTS.md` (data shapes, RPCs), `DEMO.md` (3-minute click path + checklist), `SHORTCUT.md` (iPhone Shortcut) |
| `tools/watch-check.html` | dev page that shows what the Shortcut / watch uploaded |

## Run it offline (default)

No server, no keys, no network needed after `npm install`:

```bash
cd demo-main/web
npm install          # also copies the MediaPipe WASM into public/mediapipe/
npm run dev          # http://localhost:5173
```

- `http://localhost:5173/` landing page
- `http://localhost:5173/patient?as=p-james` patient app (`?demo=1` adds the demo panel, `?tracker=fake` forces fake motion)
- `http://localhost:5173/care` care dashboard

Data lives in the browser (localStorage + IndexedDB), seeded with three demo patients relative to today
(Maria improving, James plateau + missed sessions, Priya compensation + heart-rate/BP). Windows of the same browser
stay in sync instantly. `?reset=1` or "Reset demo data" on the landing page reseeds.

## Run it online (Supabase)

1. Create a Supabase project. In the SQL editor run `supabase/migrations/0001_init.sql`, then `supabase/seed.sql`
   (details and the CLI path: `supabase/README.md`).
2. `cp web/.env.example web/.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. `npm run dev`. The header badge reads "Live · Supabase". Add `?data=local` to any URL to force offline data.

Deploy: Vercel with Root Directory `demo-main/web` (framework Vite). Set the two env vars, or leave them unset for an
offline-only demo build. `web/vercel.json` handles SPA rewrites and model caching.

## Tests

```bash
cd demo-main/web
npm test             # vitest: rules engine, data layer, camera maths, replay, ui
npm run build        # tsc + vite build
npm run db:test      # migration + seed + RPC smoke tests in PGlite
npm run seed:sql     # regenerate supabase/seed.sql from web/src/data/seed/generate.ts
```

## More

- Demo script and pre-demo checklist: `docs/DEMO.md`
- Contracts: `docs/CONTRACTS.md`
- iPhone Shortcut (watch daily data): `docs/SHORTCUT.md`
- Watch app: `watch/README.md`
- Team and agent workflow: `AGENTS.md`
- How this folder came to be: `CONVERGENCE_PLAN.md`
