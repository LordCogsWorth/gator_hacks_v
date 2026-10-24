# WP1 report: Data layer, rules, seed (finisher)

Status: **done, uncommitted** (no branch / commit / push). Work only under `demo-main/`. Finisher after a prior WP1 builder landed the implementation then crashed.

## Acceptance

| Check | Result |
|---|---|
| `ApiError` in `data/errors.ts`, re-exported from `api.ts` | yes (unchanged this pass) |
| `patient/api.ts` `saveSession` forwards `clientKey` | yes |
| `getSessionReplay` handles `synth:` via `parseSynthPath` + `synthReplay` | yes |
| Rules tests ≥ 50 + fixes (a)/(b) + BP + fall | **53** in `src/rules/engine.test.ts` |
| LocalSource round-trip / watch merge / plan transitions | **13** in `LocalSource.test.ts` |
| Mapper + error-mapping fixtures | **12** in `mappers.test.ts` |
| `npx vitest run src/data src/rules` | **91 passed** (includes WP6 `replaySynth.test.ts`) |
| `npx tsc -b` | exit 0 |
| `npm run seed:sql` | exit 0 → `supabase/seed.sql` (today = 2026-10-24) |
| `npm run db:test` | **88 passed, 0 failed** (James plateau + adherence, one approved/plan, avgHr, synth replays) |

## Files changed (this finisher pass)

| File | What / why |
|---|---|
| `web/src/rules/engine.test.ts` | **new** — port of `Raghav/api/rules.test.js` + rule cases; empty `missedSessionStreak`; setback vs mean of prior 3 + detail suffix; BP + fall |
| `web/src/data/local/LocalSource.test.ts` | **new** — clientKey idempotency + one compensation alert; watch merge / 0-as-missing / steadiness scale; approve / dismiss / savePlan / setNextCheckin / ack; James seed flags |
| `web/src/data/supabase/mappers.test.ts` | **new** — `*FromRow` / `normWatchDaily` fixtures; `toApiError` for PT* + SQLSTATE |
| `supabase/seed.sql` | regenerated via `npm run seed:sql` from `generate.ts` (3 patients, 6 plans, 52 sessions, 5 alerts, synth replays) |

### Already in place (prior WP1 builder; audited, no code edits needed)

`web/src/data/**` (except WP6 `seed/replaySynth.ts`), `web/src/rules/{engine,constants}.ts`, `web/src/api.ts`, `web/src/usePolling.ts`, `web/src/patient/api.ts` — LocalSource / SupabaseSource / validate / generate+alerts / derive / index health probe match §5–§6 and WP2 RPC argument names.

## Verification

```bash
cd demo-main/web
npx vitest run src/data src/rules   # 91 passed
npx tsc -b                          # exit 0
npm run seed:sql                    # Wrote …/supabase/seed.sql (today = 2026-10-24): …
npm run db:test                     # 88 passed, 0 failed
```

Preferred scoped test command (avoids unrelated WP5/WP6 UI failures): `npx vitest run src/data src/rules`.

## Deviations

1. LocalSource tests call `reseedNow()` instead of `await resetDb()`. Awaiting IndexedDB `clear()` inside `navigator.locks` hangs under jsdom; sync reseed matches production `?reset=1` behaviour for table state.
2. Did not edit WP2-owned `web/scripts/gen-seed-sql.ts` — it already accepted `alerts` and the current `generateDemoData` shape; seed regen succeeded without changes.
3. Did not edit WP6-owned `web/src/data/seed/replaySynth.ts`.

## Known issues

- Browser two-window BroadcastChannel / offline DevTools acceptance from §10 WP1 not re-checked in this pass (unit + PGlite + tsc only).
- `resetDb()` can still stall in jsdom if a test awaits it (production browsers are fine).
- SupabaseSource is fixture-tested for mappers/errors only (no live credentials).

## Requests

### WP8
- Wire the **health-probe banner** (`healthCheck` / `switchToOfflineData` / `offlineDataUrl` already exported from `api.ts`) on app shell when Supabase mode fails the probe.
- Commit regenerated `supabase/seed.sql` with the data-layer work when integrating.
- Keep frozen files (`types.ts`, `package.json`, configs) unchanged unless a follow-up needs additive contract docs in `docs/CONTRACTS.md` (RPC table + error map already in WP2 report).

### WP5
- `useRulesSweep` + care polling already can call `evaluatePatient` / `onDataChange` via `api.ts`.

### WP6
- `synth:` paths in seed use `synthReplay` / `parseSynthPath` from `seed/replaySynth.ts` (owned by WP6).

## Suggested next step

WP8 integration: health banner, CONTRACTS.md sync, commit seed + WP1 sources together; then end-to-end offline two-window smoke on `/care` + `/patient?as=p-james`.
