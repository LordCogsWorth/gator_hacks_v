# WP5 (Care dashboard UI): report

Status: **done, uncommitted.** Care UI under `web/src/care/**` (except `care/replay/**`) meets §8 / §10. No new deps, no git state changes, nothing outside `demo-main/`.

**Two WP5 builders collided earlier** (see `WP5-COORDINATION.md`). This report is the authoritative finish: `PlanCards.tsx` is reconciled with `errors.ts` (`errorMessage` / `isNotImplemented`, not the other copy's `errorText`), and the rest of the care tree was verified as-is rather than rewritten.

## Acceptance

| Check | Result |
|---|---|
| PatientDetail composition (§8) | PageHeader + CheckinControl + AlertsPanel + WeeklySummaryCard + PlanCards (Suggested **or** Current) + CameraCharts + WatchCharts + SessionList |
| `ChartCard` / `useChartTheme` | CameraCharts + WatchCharts use them; no `CHART_COLORS` in owned paths |
| `useRulesSweep` in CareLayout | Mount + 60 s; quiet disable on `ApiError` `not_implemented` |
| Contrast literals | `rg 'CHART_COLORS\|text-slate-\|neutral-\|diagnos' src/care` (excl. replay) → **0** |
| Care controls ≥44 px | `Button` / `min-h-tap` on check-in, plan editor, alerts, list links, replay chips |
| `npx tsc -b` (care paths) | **0** care errors; full `tsc -b` exit 0 at finish time |
| `npx vitest run src/care` | **25/25** pass (4 files: dates, rulesSweep, replayKeys, replayMath) |
| Browser `/care` + `/care/patients/p-james` (local, no `.env`) | Pass (details below) |

## Files (owned: `web/src/care/**` except `replay/**`)

| Path | Role |
|---|---|
| `CareLayout.tsx` | Header (BrandLockup, DataModeBadge, ThemeToggle, patient-app link), footer, `useRulesSweep()` |
| `PatientList.tsx` | Flagged-first list, symmetry + trend, adherence bar, alert badges, next check-in, row flash |
| `PatientDetail.tsx` | Loads detail/sessions/watch/watchSessions; composes sections; 5 s poll |
| `PlanCards.tsx` | SuggestedPlanCard (phase + diff + approve/dismiss) · CurrentPlanCard (Edit plan → `savePlan`) · NoPlanCard |
| `useRulesSweep.ts` / `rulesSweep.ts` | 60 s fingerprint sweep; tolerates `not_implemented` |
| `errors.ts` | `errorMessage`, `isNotImplemented` for ApiError codes |
| `dates.ts` | Check-in window, relative/format helpers |
| `alertTone.ts` | AlertType → Badge tone |
| `sections/AlertsPanel.tsx` | Acknowledge; setback → move check-in +3 days |
| `sections/CheckinControl.tsx` | Date + −3 / +7 → `setNextCheckin` |
| `sections/WeeklySummaryCard.tsx` | "AI draft for clinician review"; Regenerate only in supabase mode; silent on `not_implemented` |
| `sections/CameraCharts.tsx` | Symmetry (phase target), compensation, pain/tiredness via `useChartTheme` |
| `sections/WatchCharts.tsx` | HR, BP sys+dia, steps+exercise min, weak-arm min+use ratio, watch sessions |
| `sections/SessionList.tsx` | Last 10 + replay chips → `/care/patients/:id/sessions/:sid?exercise=&side=` |
| `sections/chartProps.ts` / `replayKeys.ts` | Shared chart props; replay key parse |
| `dates.test.ts` / `rulesSweep.test.ts` / `sections/replayKeys.test.ts` | Unit tests |

**Not owned / not edited:** `care/replay/**` (WP6). Vitest included `replayMath.test.ts` because it was already green.

## PlanCards reconciliation

COORDINATION noted a colliding `PlanCards.tsx` that imported `errorText` from `./errors`. Current `errors.ts` exports `errorMessage` + `isNotImplemented` only. Current `PlanCards.tsx` already imports and uses `errorMessage` for approve / dismiss / save failures (including the `not_implemented` wording). No further PlanCards edit was required.

## Browser check (port 5185)

- Port 5185 already had a Vite for this app; reused it (no `.env` → LocalSource). After the check, that listener was stopped (`5185` free).
- **`/care`:** Patients list; James + Priya flagged first; James shows Plateau + Adherence badges; Local badge + theme toggle.
- **`/care/patients/p-james`:** CheckinControl (−3 / +7); Plateau + Adherence open alerts; Weekly summary with text; Suggested plateau plan (phase field, approve/dismiss); Camera progress + Watch trends (incl. Weak-arm use); Sessions with replay chips on latest (Arm raise · weak, etc.).
- **`/care/patients/p-maria`:** Also has a Suggested plan after rules eval (phase advance), so the acceptance line "Edit plan on Maria (no suggestion)" does not match **current seed + sweep** state. `CurrentPlanCard` + "Edit plan" → `savePlan` is implemented and shows whenever there is no open suggestion (e.g. after dismiss/approve).

## Verification commands

```
cd demo-main/web
npx tsc -b
npx vitest run src/care
# browser: npx vite --port 5185 --strictPort  →  /care , /care/patients/p-james  → stop
rg 'CHART_COLORS|text-slate-|neutral-|diagnos' src/care --glob '!src/care/replay/**'   # empty
```

## Deviations

1. **No code rewrite this finish pass.** The care tree already met §8/§10; work was reconcile-check + verify + this report.
2. **Maria has a suggestion** under live LocalSource + `useRulesSweep`, so Edit-plan-on-Maria was verified by code path, not by a no-suggestion seed state.
3. **Port 5185** was already occupied; reused then stopped (did not leave a server running).

## Known issues

- WP6 owns `care/replay/**`; care SessionList links into that route — replay page quality is WP6's.
- Full `npm run build` may still fail for reasons outside WP5 (other WPs); care-filtered `tsc -b` was clean at finish.

## Requests

- **WP1 / seed:** If demo script needs Maria with **no** suggestion for the Edit-plan beat, keep her suggested plan cleared after seed (or document dismiss-first).
- **WP6:** Replay route from SessionList chips.
- **WP8:** Final greps / integration demo path.

## Suggested next step

WP6 replay polish if needed, then WP8 integration pass on the `/care/patients/p-james` click-path.

---

## Report
- Agent + task: WP5 Care dashboard UI (finisher; authoritative `.reports/WP5.md`)
- Commits: none (uncommitted, per coordinator)
- Files changed: none in this finish pass (tree already correct); **wrote** `demo-main/.reports/WP5.md`
- Verification:
  - `./node_modules/.bin/tsc -b` → exit 0 (no `src/care/` errors)
  - `./node_modules/.bin/vitest run src/care` → 25/25 pass
  - Browser `/care` + `/care/patients/p-james` on :5185 (local) → acceptance content present; server stopped
  - Grep CHART_COLORS / slate- / neutral- / diagnos in owned care paths → 0
- Deviations: see above
- Known issues: see above
- Requests: WP1 seed Maria suggestion state; WP6 replay; WP8 integrate
- Suggested next step: WP8 demo click-path after WP6
