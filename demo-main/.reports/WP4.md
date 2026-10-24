# WP4 (Patient UI): report

Status: **done, uncommitted.** The patient path is rethemed on `ui/*`, Home is restructured per §8, and the browser check passed at 390×844 (the full run is below). No files outside `web/src/patient/**` (minus WP1/WP3 files) were edited.

**Two WP4 builders ran.** The task prompt arrived twice, so a second WP4 builder wrote the same files between 16:53 and 17:00, then stopped and left `.reports/WP4-duplicate.md`. Its versions and mine match in function. The tree is a mix of both, and I verified the tree **as it is now** rather than overwriting it again. That note asks for this file to be the authoritative one. Nobody else has written `patient/**` since: every file is older than my last check except my own Dashboard edit.

## Acceptance

| Check | Result |
|---|---|
| `npx tsc -b` (WP4 files) | 0 errors. The **only** remaining error in the whole tree is in WP1's `src/data/validate.ts(16,3)`: `'SessionUploadBody' is declared but never used`. Because of it, `npm run build` currently exits non-zero. |
| `npm test` | **78/78 pass**, 8 files. `src/patient/patient.test.tsx` adds 13 of them. |
| 390×844, `/patient?as=p-james`, Start above the fold | Without the banner, Start is at y 505–577 px. **With** the "New plan" banner, it is at y 659–731. The fixed tab bar starts at 774 px. Maria is the same as James without the banner. |
| Light/dark toggle | dark → light on tap (`data-theme` changes). Screenshots of both looked right. |
| Voice on every screen | `speechSynthesis` was stubbed to record what is spoken. Home, Check-in, Safety stop, My sessions and the picker all speak on open. The new-plan line is queued after the welcome. In dev, each line is recorded twice because React StrictMode runs effects twice; real speech hears one, since `speak` cancels first. |
| Pain 8 at check-in → `/patient/stop` uploads with `stopReason` | `POST /sessions` body `{patientId: p-james, pain: 8, tiredness: 2, stopReason: "pain"}`. The API then shows James's open alerts as `adherence, pain, plateau, safety-stop`. |
| New-plan banner | I approved James's suggested plan through the API with the page open. The banner appeared on the next poll and was announced. **OK** hides it. It stays hidden after a reload, because `localStorage['rehabtrack.p-james.planSeenAt']` is set. |
| Identity | `/patient` with nothing remembered → Maria. `?as=p-james` → James, and the param is removed from the URL. `?pick=1` → the "Who are you?" picker. |
| Demo panel (`?demo=1`) | A floating "Demo" button at the bottom left opens the panel. The patient switcher moves to Maria. "Reset demo data" is shown (the bridge's `dataMode()` is `'local'`). "Resting HR +12" shows "Not available with this data source yet." (bridge `not_implemented`), and nothing crashes. |
| Tap sizes (DOM audit of every visible button, link and input) | Home, Stop, History and the demo panel: none under 64 px. Check-in: only the range input's **track** is 24 px. Its thumb is 64 px, which is the touch target. |
| Greps over WP4 files | `neutral-`/`slate-`/hex/`min-h-[4x–5x px]`/`patient-area`/`CoachCard`/`Recent sessions`: 0 real hits. `grep -rni diagnos src`: 0. |
| Page errors | none. |

**How I ran the browser check.**
- The IDE browser tool stopped attaching to tabs ("No browser tab available"), so I used headless Python Playwright (cached Chromium), 390×844 at DPR 2.
- `api.ts` is still WP1's HTTP bridge, so I seeded a scratch copy of `Raghav/api` in `/tmp` and ran it on **8094**, with `VITE_API_BASE=http://127.0.0.1:8094/api`.
- Vite was the plain `npx vite --port 5184 --strictPort` (plus `--host 127.0.0.1`).
- For the first run only, WP3's `SessionRun.tsx` didn't load, because it imported exports `exercises.ts` didn't have yet. I used a throwaway `/tmp` vite config that stubbed just that module. After WP3 landed, I reran everything on the plain config.
- Both servers are stopped and the `/tmp` copies are deleted. Port 8081 (someone else's) was not touched.

## Files (all under `web/src/patient/`)

- `identity.tsx`:
  - `resolvePatientId(params, stored)` returns null for `?pick=1` (show the picker); otherwise `?as=` → the remembered id → `p-maria`.
  - `WhoAreYou` and `PatientChoice` use tokens, `Banner`, `Spinner`, `BrandLockup` and `min-h-tap`, and the picker speaks "Who are you?".
- `PatientApp.tsx`:
  - starts from `resolvePatientId`; applies `?as`/`?pick`/`?demo`, then removes them from the URL
  - calls `applyArea('patient')` (`ui/theme`) on mount; no `patient-area` logic
  - an unknown id goes to the picker with a notice
- `PatientData.tsx`:
  - checks `e instanceof ApiError && e.code === 'not_found'`
  - The new-plan logic is `isNewPlan(plan, seenAt, lastSessionStartedAt)`, exported. A plan is new when its `approvedAt ?? createdAt` is later than the last seen value in `localStorage['rehabtrack.<patientId>.planSeenAt']`.
  - On a first visit on a device (nothing stored), it compares with the last session's start instead.
  - `dismissNewPlan()` stores the seen value. The loading and error screens use tokens.
- `session/SessionContext.tsx`:
  - `newClientKey()` uses `crypto.randomUUID()`, with a v4 fallback through `getRandomValues` for plain-http LAN origins (`dev:lan`), where `randomUUID` is undefined.
  - A new key is made in `begin()` and reused on every retry of that session. It goes into `saveSession` as `SaveInput & { clientKey }`, so the code compiles both before and after WP1 adds the field.
  - `addRound`'s signature is unchanged.
- `components/Layout.tsx`:
  - two nav items (Home, My sessions), plus the bottom tab bar on phones
  - the header has Voice, `ThemeToggle area="patient"` and `ui/EmergencyBar`
  - a footer on every screen with `DataModeBadge` and "RehabTrack by Ctrl+Alt+Heal" (`BRAND_NAME` + `TEAM_LINE`)
  - `DemoPanel` floats outside `<main>`
  - The unused `Card` and `Initials` exports are removed. `BigButton` (= `ui/Button size="xl"`) stays because WP3's SessionRun imports it.
- `screens/Dashboard.tsx`, top to bottom:
  - a success `Banner` "New plan from your care team" with an **OK** button, announced by voice. On phones its detail line is hidden so Start stays above the fold. Start also marks the plan as seen.
  - `TodayCard`, exported: a primary Card "Today's session" with exercise chips ("Arm raise to the side · 10 reps · goal 101°") and `Button size="xl" fullWidth` "Start today's session". After a finished session it shows "Start another session" and "Today's session is done".
  - 3 StatTiles: Next check-in (In N days / Tomorrow / Today), Streak N days, This week X / Y sessions
  - the StatTile "Weak arm vs healthy" N % with `delta { goodWhen: 'up', label: 'from last week' }` (▲/▼ and text)
  - `ProgressChart`
  - CoachCard, CareTeamCard and Recent sessions are gone.
- `components/ProgressChart.tsx`:
  - colours from `useChartTheme()` (no literals)
  - a `SegmentedControl` (All / each exercise; wraps; `min-h-tap`)
  - a `Delta` headline, a `useId` gradient id and a token-styled tooltip
  - `isAnimationActive={false}`
- `screens/CheckIn.tsx`:
  - Cards and tokens. The tiredness tiles show the selected one with `border-primary bg-primary-soft`, plus `aria-pressed`.
  - The slider has `aria-valuetext` and speaks on pointer-up and key-up. At pain ≥ 7 it says "We'll skip exercises today".
  - The xl Next button shows a hint until tiredness is picked.
- `screens/Summary.tsx`:
  - a Card per exercise
  - the save status as a `Banner` (success with the streak and replays sent, danger with Try again, or info)
  - `useSpeakOnMount` for the result sentence, and "Back to Home"
- `screens/SafetyStop.tsx`:
  - a danger Card with the 911 advice and `Button variant="danger" size="xl" href="tel:911"`
  - the save status as a `Banner`; voice includes the 911 advice
  - still uploads `stopReason`
- `screens/History.tsx`:
  - tokens, and an `EmptyState` when there are no sessions
  - "Stopped early (pain)" as a warning `Badge`; `aria-controls`
  - the details table scrolls horizontally and values are rounded
  - **Fixed in the browser check:** on phones the exercise tiles were squeezed beside the date block, which pushed the date off-screen. Date and chevron are now on top, with the tiles full-width below.
- `demo.tsx`:
  - the floating bottom-left "Demo" button opens a panel with a patient switcher (`PatientChoice`; it navigates to `/patient`)
  - "Simulate Shortcut upload (today)": Normal day, Resting HR +12 and Fall (`shortcutUpload()`, exported). Each calls `submitWatchDaily` for today's local date (`localDate()`). The HR baseline is the mean resting HR of the previous 7 days, or 68.
  - "Reset demo data", shown only when `dataMode()==='local'`; it calls `resetDemoData()` and then refreshes
  - `ApiError` `not_implemented` shows "Not available with this data source yet."
  - the fake-camera sliders, with "Speed up demo" as a 64 px toggle button
  - a link to open `/care` in a new tab
- `components/ExerciseAvatar.tsx`:
  - The SVG coach uses token fill and stroke classes (`fill-primary`, `fill-text-muted` …) instead of hex, so it follows light and dark.
  - The explainer and `StepList` use tokens and `ui/Button size="xl"`. Its props are unchanged for SessionRun.
- `patient.css`: only the pain slider (a success → warning → danger token gradient, 64 px thumb) and the coach keyframes, plus `prefers-reduced-motion: animation: none` for the coach.
- `voice/useVoice.ts`: `useSpeakOnMount('')` says nothing.
- `patient.test.tsx` (new):
  - `resolvePatientId` (default, `?as`, remembered, `?pick`)
  - `isNewPlan` (first visit, after dismissal)
  - `TodayCard`: an xl Start button (`min-h-16 … text-xl`), 3 chips, "Start another session", no button without a plan
  - the Shortcut preset bodies, `localDate`, and the `newClientKey` v4 format and uniqueness

## Deviations

- On phones the banner's detail line ("Phase N, approved by …") and the hero's "· stronger arm first" are hidden, so Start stays above the fold even when the banner shows. Voice still says the phase, and both texts show from `sm` up.
- On a device's first visit, "newer than the last seen value" falls back to "approved after the last session", so a plan approved before the patient ever opened Home still gets announced once.
- "This week X / Y" counts sessions in the last 7 days (rolling), safety stops included, as the old Dashboard did.
- The demo panel is a floating button that opens a panel, not a `<details>` element, so it can float bottom-left above the phone tab bar.

## Known issues

- **`clientKey` doesn't reach the API yet.** The recorded `POST /sessions` body had no `clientKey`, because `patient/api.ts` `saveSession` (WP1) doesn't forward it. It is created and passed in on WP4's side.
- Until WP1's LocalSource lands, "Simulate Shortcut upload" and "Reset demo data" show the "Not available …" message (bridge `not_implemented`). They are written against the final §6.1 signatures and were not exercised end to end.
- The safety-stop flow was tested from check-in (pain 8). The dizzy stop from inside SessionRun (WP3) was not exercised.
- I didn't verify the reduced-motion behaviour in a browser. It comes from CSS (`patient.css` plus the global rule in `index.css`).

## Requests

- **WP1:**
  - forward `clientKey` in `patient/api.ts` `saveSession` → `postSession`
  - fix the unused `SessionUploadBody` import in `data/validate.ts` (the only `npm run build` error left)
- **WP3:** `SessionRun.tsx` still imports `BigButton` from `components/Layout`. Switching to `ui/Button size="xl"` would let WP8 drop `BigButton`.
- **Coordinator / WP8:**
  - Make sure only one builder per WP writes its files. Two WP4 (and two WP5/WP6) builders overwrote each other this round.
  - `.reports/WP4-duplicate.md` can be deleted once this report is accepted.
- **Frozen files:** none needed.
