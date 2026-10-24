# WP8 report: Integration

Status: **done, uncommitted.** Serial integrator after WP0–WP6. Docs were largely already in place from an earlier pass; this finish applied remaining Requests, re-verified §11 locally, and wrote this report.

## Acceptance

| Check | Result |
|---|---|
| HTTP bridge / `VITE_API_BASE` removed | **yes** — `.env.example` is local \| supabase \| auto only; no bridge in `api.ts` |
| Frozen-file Requests applied | health banner on shells; dropped unused `BigButton` |
| §11 greps (`diagnos\|ntfy\|localhost:808`) | **0** hits under `web/src` + `.env.example` |
| Bundle | `index` ~27 KB gzip; `three` ~227 KB gzip (replay only) |
| Docs | `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/CONTRACTS.md`, `docs/DEMO.md` present and aligned |
| §13 folder deletions | **not merged** — waits for team after one rehearsal |

## Files changed (this finish pass)

| Path | What / why |
|---|---|
| `web/src/ui/SupabaseHealthBanner.tsx` | **new** — shared health-probe banner + “Use offline demo data” |
| `web/src/ui/index.ts` | export `SupabaseHealthBanner` |
| `web/src/Home.tsx` | use shared banner (was inline) |
| `web/src/care/CareLayout.tsx` | show banner on care shell (WP1 Request) |
| `web/src/patient/components/Layout.tsx` | show banner on patient shell; remove unused `BigButton` |
| `docs/DEMO.md` | checklist already filled; browser re-smoke noted below |
| `.reports/WP8.md` | this report |

Already green before this pass (from WP0–WP6 + prior doc pass): regenerated `supabase/seed.sql`, root `.gitignore` (`Config.xcconfig`, `*.xcodeproj/`, `supabase/.temp/`), CONTRACTS RPC table, README/AGENTS/CLAUDE.

## Verification

```bash
cd demo-main/web
npx tsc -b                          # exit 0
npx vitest run                      # 167 passed
npm run build                       # exit 0; index gzip ~27 KB; three ~227 KB
npm run db:test                     # 88 passed
rg -ri 'diagnos|ntfy|localhost:808|VITE_API_BASE' src .env.example  # empty
```

**Browser (local, no `.env`, Vite :5190):**
- `/care` — James + Priya flagged first; Maria listed
- `/care/patients/p-james` — Plateau + Adherence; weekly summary; Suggested plateau plan (hand-open 12→14); Camera + Watch charts; replay chips
- `/patient?as=p-james` — “Hello, James!”, “Start today's session”, exercise list, 911 bar

Server stopped after checks.

## Deviations

1. Full §11 items 2, 4, 5, 9 (DevTools Offline hard reload, fake-tracker full 6×6 session, BroadcastChannel flash, Shortcut simulate once) remain **dress-rehearsal** items — wired in code, not re-driven end-to-end in this pass.
2. Supabase cross-machine (§11.10) not run (no project credentials).
3. Legacy Tailwind token aliases kept (WP0 question) — still used by the design system; dropping them would be a wide churn with no demo benefit.
4. Duplicate builder notes (`WP4-duplicate.md`, `WP5-COORDINATION.md`, `WP6-duplicate.md`) deleted after acceptance (post-WP8 cleanup).

## Known issues

- Real-webcam §7.9 and Kyle watch Xcode build are human checklists in `docs/DEMO.md`.
- `resetDb()` can stall under jsdom if awaited (LocalSource tests use `reseedNow()`).
- Open RPCs / public replays bucket are demo-only (Decision 9 / risk list).

## Requests

- **Team:** one full dress rehearsal of `docs/DEMO.md`, then decide §13 (delete old per-person folders / make `demo-main/` the repo root) in a separate PR — do not merge deletions from this work.
- **Kyle:** build `demo-main/watch` before H32 (`watch/README.md`).
- **Deploy:** Vercel root `demo-main/web`; leave Supabase env empty for offline-only, or set URL + anon key for live mode.

## Suggested next step

Human dress rehearsal of the 3-minute script (two windows, James loop). Commit uncommitted WP1–WP8 work when the team is ready.
