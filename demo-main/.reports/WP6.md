# WP6 (3D session replay): report

Status: **done, uncommitted.** Finisher pass after the WP6 duplicate collision (see `WP6-duplicate.md`). Owned paths only; no new deps; no git changes.

## Acceptance

| Check | Result |
|---|---|
| §10 behaviour: BONES, `toScene` y-flip, SkeletonScene (OrbitControls, ±3 warning tint), ReplayControls, AngleChart seek-on-click, ReplayPage (tabs, Healthy\|Weak\|Both), UI imports from `api.ts` only | **pass** — already present from the colliding builders; finisher verified, no code edits required |
| Keep `replaySynth.ts` (`SynthParams` / `synthPath` / `parseSynthPath` / `synthReplay`, `synth:v1;…`) | **pass** — left as the working generator |
| `npx vitest run src/care/replay src/data/seed` | **21/21 pass** (8 `replayMath` + 13 `replaySynth`) |
| `npx tsc -b` errors under owned paths | **none** |
| Bundle: `three` chunk exists; `index-*.js` gzip ≤ 260 KB | **pass** — `three-*.js` gzip **227 KB**; `index-*.js` gzip **27 KB**; separate `ReplayPage-*.js` gzip **8 KB** |
| Browser (port 5186): rotate / scrub / play / pause / warning tint / chart seek | **pass** (see Verification) |
| Optional real-camera `public/demo/replays/**` | **skipped** — only non-zero-z captures in `Raghav/api/data/replays/` are 138–169 KB (>120 KB cap); also needs WP1 `synth:file:` wiring |

## What landed (owned tree)

**`web/src/care/replay/`**
- `replayMath.ts` — `BONES` (12 contract pairs), `toScene([x,y,z]) → [x,−y,−z]`, mid-hip origin, `scenePoints` + mid-shoulder, `frameAngles`, `bodySideFor`, `warningMask` (±3), `warningRuns`, `formatTime`
- `replayMath.test.ts` — y-flip, BONES indices &lt; 13, centering, angles, peaks vs synth, warning pad/merge
- `SkeletonScene.tsx` — r3f Canvas `camera={{position:[0,0.3,2.4],fov:40}}`, `OrbitControls enablePan={false}`, grid, instanced joints + drei `Line` bones, `useFrame` playback at fps×speed, danger tint when `warnMask[i]`
- `ReplayControls.tsx` — play/pause/replay, 0.5×/1×, scrubber with red warning ticks, frame time
- `AngleChart.tsx` — exercise angle + trunk lean (+ dashed healthy ghost in Both), warning bands, click → `onSeek`
- `ReplayPage.tsx` — loads via `getSessionReplays` / `getSessionReplay` / `getPatient` from `../../api` only; exercise tabs; Healthy \| Weak \| Both; reduced-motion disables autoplay

**`web/src/data/seed/replaySynth.ts`** (unchanged generator from the first builder)
- Deterministic seated cosine reps; lean/hike compensations; lean &gt; 12° and hike &gt; 0.03 m → `warnings[]`; ≤ 600 frames; path round-trip

**`web/public/demo/replays/`** — empty (optional files skipped)

Route already lazy in WP0 `App.tsx`: `React.lazy(() => import('./care/replay/ReplayPage'))`.

## Verification

```
cd demo-main/web
npx vitest run src/care/replay src/data/seed
# ✓ 2 files, 21 tests

npx tsc -b
# errors only in WP1 LocalSource.test.ts (outside owned paths); none under care/replay or data/seed/replaySynth*

npx vite build
# three-*.js  847 kB / gzip 227 kB
# index-*.js   82 kB / gzip  27 kB
# ReplayPage-* 20 kB / gzip   8 kB
# charts / supabase / react chunks separate as designed
```

Browser (`npx vite --port 5186 --strictPort --host 127.0.0.1`, then stopped):
- `/care/patients/p-james/sessions/sess-james-04?exercise=arm_raise&side=weak` — canvas, Pause/Play, scrubber, 2 lean warnings (8.5 s / 14.9 s)
- Seek to 8.5 s → frame 129, trunk lean **12°**, danger badge present
- **Both** → URL `side=both`, ghost healthy overlay (“healthy arm (left) faint”), dual angles on the moment card
- Screenshot helper timed out (WebGL canvas); DOM/a11y checks above still green

## Deviations

1. **No code edits in this finisher pass.** The duplicate builders already left a coherent tree: real `replaySynth.ts` + full UI. Finisher verified §10 and acceptance only.
2. **`npm run build` (`tsc -b && vite build`) fails** on WP1 `src/data/local/LocalSource.test.ts` (missing `id` on upload result; unused `maria`). Owned-path `tsc` is clean; `npx vite build` alone succeeds for the bundle check.
3. **Optional real-camera replays** not copied (size + `synth:file:` wiring). Same conclusion as `WP6-duplicate.md`.

## Known issues

- Full `npm run build` blocked by WP1 test type errors (not WP6).
- Browser screenshot MCP timed out against the WebGL canvas; functional checks used CDP/`innerText` instead.

## Requests

- **WP1:** fix `LocalSource.test.ts` so `tsc -b` / `npm run build` are green.
- **WP8 / coordinator:** none for frozen files. Optional later: `synth:file:` + ≤120 KB captures under `public/demo/replays/` if desired for the pitch.

## Suggested next step

WP8 integration / §11 checklist once WP1 build is green; demo path uses James latest weak arm-raise lean replay (`sess-james-04` in today’s seed).
