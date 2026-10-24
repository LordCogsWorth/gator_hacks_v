# RehabTrack: shared contracts

The agreed shapes of data passed between the parts of `demo-main/`. This file replaces `Raghav/docs/CONTRACTS.md`
and `Raghav/api/API.md`. If you change a contract, update this file in the same commit.

| Contract | Source of truth | Producers → consumers |
| --- | --- | --- |
| TypeScript types | `web/src/types.ts` | everything in `web/` |
| `api.ts` facade (§3) | `web/src/api.ts` | patient app, care dashboard |
| `DataSource` (§4) | `web/src/data/source.ts` | `api.ts` → LocalSource / SupabaseSource |
| SQL schema + RPCs (§5) | `supabase/migrations/0001_init.sql` | SupabaseSource, iPhone Shortcut, watch app, Edge Function |
| Camera (`CameraTracker`) (§6) | `web/src/camera/types.ts` | patient session engine |
| ReplayFile (§2.4) | `web/src/types.ts` | patient app writes, 3D replay reads |
| Watch payloads (§7) | this file + `docs/SHORTCUT.md` + `watch/README.md` | Shortcut / watch → Supabase |

## 1. Conventions

- Ids are text: `p-maria`, `sess-…`, `plan-…`, `al-…`. New ids are `prefix + uuid without dashes`.
- Timestamps are ISO-8601 UTC strings (`2026-10-24T15:30:00.000Z`). Session uploads also accept epoch milliseconds.
  Dates without time are `YYYY-MM-DD`.
- Units: angles in degrees, `hand_open` values in mapped % (0–100), distances in metres (except `reachCm`), durations in
  seconds, heart rate in bpm, blood pressure in mmHg.
- TypeScript is camelCase, SQL is snake_case. RPCs take and return camelCase JSON; only table `select`s need mappers
  (`web/src/data/supabase/mappers.ts`).
- The word "diagnosis" never appears in the UI or in generated text.

## 2. Types (`web/src/types.ts`)

### 2.1 Names

```ts
type Exercise = 'arm_raise' | 'forward_reach' | 'hand_open';
type Side = 'weak' | 'healthy';           // which of the patient's arms, relative to the stroke
type BodySide = 'left' | 'right';         // the patient's own left/right
type StopReason = 'pain' | 'dizziness' | 'other';
type PlanStatus = 'suggested' | 'approved' | 'superseded' | 'dismissed';
type PlanKind = 'phase-up' | 'plateau' | 'compensation';
type AlertType = 'plateau' | 'setback' | 'compensation' | 'adherence' | 'pain' | 'safety-stop'
               | 'heart-rate' | 'blood-pressure' | 'fall';
type DataMode = 'local' | 'supabase';
```

### 2.2 ExerciseResult (one per exercise per arm; up to 6 per session)

Built by the patient app (`patient/session/repCounter.ts` + `SessionRun.tsx`), not by the tracker.

| Field | Meaning | DB range |
| --- | --- | --- |
| `bestValue` | max peak of counted reps; if 0 reps, the max value seen. Degrees (arm_raise = shoulder angle, forward_reach = elbow angle) or mapped hand opening % | 0–180 |
| `reps` | counted reps (hysteresis: a rep counts only if it passes `upAt` and returns below `restAt`) | 0–200 |
| `secPerRep` | mean **movement duration** (leave rest → back to rest), s | 0–120 |
| `smoothness` | mean speed bursts per rep (Stuti's `bursts()`), ≥1, lower = smoother | 0–50 |
| `fatigue` | last-3 / first-3 peak ratio; 1 if under 6 reps | 0–5 |
| `trunkLeanMax` | max trunk lean in degrees **from the rest baseline** | 0–90 |
| `shoulderHikeMax` | max shoulder hike above rest in metres (arm_raise only, else 0) | 0–0.5 |
| `compRepPct` | % of reps with compensation (lean or hike, 3-frame debounced) | 0–100 |
| `reachCm?` | forward_reach only: max shoulder→wrist distance over counted reps, cm | 0–150 |
| `closedMin?` | hand_open only: smallest hand opening %, i.e. how well the fist closes | 0–100 |

Symmetry % for an exercise = weak `bestValue` ÷ healthy `bestValue` × 100. Hand opening is mapped
`clamp((ratio − 1.0) / 0.6 × 100, 0, 100)` (fist ≈ 0 %, open hand ≈ 100 %), which keeps symmetry honest.

### 2.3 Session upload

```ts
interface SessionUploadBody {
  clientKey?: string;              // uuid, makes the upload idempotent (retries return the same session)
  patientId: string;
  startedAt: string | number;      // ISO or epoch ms
  endedAt: string | number;        // ≥ startedAt, < 3 h later
  pain?: number | null;            // 0..10
  tiredness?: number | null;       // 1..5
  stopReason?: StopReason | null;  // safety stop: then results may be []
  results: ExerciseResult[];       // 1..6 (0..6 with stopReason); no duplicate exercise+side
}
```

`Session.avgHr` is filled from an overlapping watch session (±5 min) in Supabase mode, and seeded for demo data.

### 2.4 ReplayFile (one per round: exercise + side)

```ts
interface ReplayFile {
  fps: 15;
  exercise: Exercise;
  side: Side;
  joints: string[];                        // exactly REPLAY_JOINTS
  frames: [number, number, number][][];    // 1..1800 frames; frames[f][j] = [x, y, z] metres
  warnings?: { frame: number; type: 'lean' | 'shoulder_hike' }[];
}
// REPLAY_JOINTS (MediaPipe Pose index): nose(0), left_shoulder(11), right_shoulder(12), left_elbow(13),
// right_elbow(14), left_wrist(15), right_wrist(16), left_hip(23), right_hip(24), left_knee(25),
// right_knee(26), left_ankle(27), right_ankle(28)
```

Axes are MediaPipe world landmarks: hip-centred, x toward the patient's left, **y down**, z negative toward the camera.
The viewer converts with `toScene([x, y, z]) = [x, −y, −z]`. Depth is estimated; the replay is for watching movement.

Replay keys and `Session.replays` entries are `${sessionId}-${exercise}-${side}`.

Where replays live:
- **Supabase:** Storage bucket `replays`, path `<sessionId>/<exercise>-<side>.json`, indexed by `register_replay`.
- **Local:** IndexedDB (`idb-keyval`), key `${sessionId}-${exercise}-${side}`.
- **Seeded:** `session_replays.path` is a self-describing synthetic path, regenerated in the browser by
  `web/src/data/seed/replaySynth.ts` (`synthPath()` / `parseSynthPath()` / `synthReplay()`), e.g.
  `synth:v1;seed=james-lean;ex=arm_raise;side=weak;ws=left;peak=95;reps=5;lean=3,5;hike=`.

### 2.5 Plan, Alert, Patient, Watch, Summary

See `web/src/types.ts` for the full interfaces. Key rules:
- At most **one `suggested` and one `approved` plan per patient** (DB partial unique indexes; LocalSource matches).
- The rules engine only drafts `suggested` plans. A clinician's `approvePlan` / `savePlan` makes one `approved`, the old
  one becomes `superseded`, and the patient's `phase` and `nextCheckin` are mirrored from the approved plan.
- At most **one open (unacknowledged) alert per patient and type**. Acknowledging starts a 72 h cooldown for that type.
- `WatchDaily` uploads **merge**: missing/blank/null fields keep the old value; `0` means "no reading" for
  `restingHr`, `hrv`, `bpSys`, `bpDia`, `walkingSteadiness`.
- `WeeklySummary.source` is `pregenerated` (seeded) or `llm` (Edge Function). The UI labels it
  "AI draft for clinician review".

## 3. `web/src/api.ts` (the UI's only data entry point)

UI code imports from `api.ts`, never from `data/*`.

| Function | Returns | Notes |
| --- | --- | --- |
| `getPatients()` | `PatientSummary[]` | flagged first, then name |
| `getPatient(id)` | `PatientDetailResponse` | `ApiError` `not_found` |
| `getPatientSessions(id)` | `Session[]` | oldest first, enriched (symmetry, compensation, replays) |
| `getPatientWatch(id)` | `WatchDaily[]` | by date |
| `getPatientWatchSessions(id)` | `WatchSession[]` | newest first, max 50, no trace |
| `getApprovedPlan(id)` | `Plan \| null` | |
| `postSession(body)` | `SessionUploadResponse` | validate → insert (idempotent on `clientKey`) → rules |
| `uploadReplay(sessionId, replay)` | `ReplayUploadResponse` | validate → store |
| `getSessionReplays(sessionId)` | `ReplaySummary[]` | |
| `getSessionReplay(sessionId, exercise, side)` | `ReplayFile` | `synth:` paths generated locally |
| `acknowledgeAlert(id)` | `Alert` | |
| `approvePlan(id, body)` / `dismissPlan(id, by?)` | `Plan` | `conflict` unless the plan is `suggested` |
| `savePlan(patientId, body)` | `Plan` | clinician edit without a suggestion |
| `setNextCheckin(patientId, date)` | `Patient` | today … today+180 |
| `submitWatchDaily(body)` | `WatchDaily` | merge, then rules |
| `getWeeklySummary(id)` / `refreshWeeklySummary(id)` | `WeeklySummary` | refresh: Supabase only |
| `evaluatePatient(id, now?)` | `{alertsCreated, planSuggested}` | used by the care 60 s sweep |
| `resetDemoData()` | `void` | local only |
| `getConfig()` | `ApiConfig` | from `rules/constants.ts` |
| `dataMode()` / `onDataChange(cb)` | | |

`ApiError(message, status, code)` with `code` ∈ `not_found | invalid | conflict | network | not_implemented`.
Check `code`, never the message.

## 4. Data sources

`web/src/data/index.ts` picks one source at startup:
1. `?data=local` or `?data=supabase` (remembered in `sessionStorage['rehabtrack.data']`);
2. else `VITE_DATA_SOURCE` = `local` | `supabase` | `auto` (default);
3. `auto` = Supabase when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are both set, else local.

There is no silent fallback: if the Supabase health probe fails, the UI offers "Use offline demo data" (reloads with
`?data=local`).

- **LocalSource:** `localStorage['rehabtrack.db.v1']` (tables) + IndexedDB (replays). Writes take
  `navigator.locks` and post `{type:'changed'}` on `BroadcastChannel('rehabtrack')`, so other windows refresh at once.
  Seeds on first load and re-seeds when the stored `seededOn` date is not today; `?reset=1` forces it.
- **SupabaseSource:** reads with `select` (public demo read), writes only through the RPCs in §5.

The rules engine (`web/src/rules/engine.ts`, `evaluate(snapshot, now)`) runs after every write and in a 60 s sweep while
`/care` is open.

## 5. Supabase (`supabase/migrations/0001_init.sql`)

Tables (all RLS on, FK cascade from `patients`): `patients`, `plans`, `sessions`, `exercise_results`,
`session_replays`, `watch_daily`, `watch_sessions`, `alerts`, `patient_summaries`. Read: `demo_read` policy for
`anon`/`authenticated` (**demo only: fake data**). No direct writes: every write goes through a `SECURITY DEFINER`
RPC with `search_path = ''`.

"Raw body" RPCs take one **unnamed** `jsonb` parameter, so PostgREST passes the request body as-is
(`POST /rest/v1/rpc/<name>` with the contract JSON; supabase-js `rpc(name, body)`).

| RPC | Arguments | Returns |
| --- | --- | --- |
| `submit_watch_daily` (raw body) | `{patientId, date, steps?, exerciseMin?, standHr?, restingHr?, hrv?, sleepHr?, bpSys?, bpDia?, falls?, walkingSteadiness?, weakArmActiveMin?, useRatio?}` | WatchDaily + `ok`, `updatedAt` (merge semantics, §2.5) |
| `submit_watch_session` (raw body) | §7 Route B body | `{ok, sessionId, patientId, updatedAt, sessionsUpdated}`; back-fills `sessions.avg_hr` |
| `submit_session` (raw body) | `SessionUploadBody` | `{session, results}`; same `clientKey` → existing rows + `duplicate: true` |
| `register_replay` (raw body) | `{sessionId, exercise, side, path, fps, frameCount, seconds, warningCount}` | ReplaySummary + `sessionId`, `path` |
| `apply_rule_results` | `p_patient_id, p_alerts jsonb = '[]', p_plan jsonb = null` | `{alertsCreated, planSuggested}` (only inserted rows) |
| `ack_alert` | `p_alert_id` | Alert |
| `approve_plan` | `p_plan_id, p_approved_by, p_overrides = '{}'` (`{phase?, exercises?, sessionsPerWeek?, nextCheckin?}`) | Plan |
| `dismiss_plan` | `p_plan_id, p_dismissed_by = null` | Plan |
| `save_plan` | `p_patient_id, p_plan (SavePlanBody), p_approved_by = null` | Plan (dismisses an open suggestion) |
| `set_next_checkin` | `p_patient_id, p_date` | Patient (also updates the approved plan) |
| `upsert_summary` | `p_patient_id, p_week_start, p_text, p_model` | void, **service_role only** (Edge Function) |

**Errors** (PostgREST maps `PTxyz` → HTTP xyz; SupabaseSource maps SQLSTATE → `ApiError.code`):

| SQLSTATE | `ApiError.code` |
| --- | --- |
| `PT400`, `23514` (CHECK), `22P02`, `22007`, `22008` | `invalid` |
| `PT404`, `23503` (FK) | `not_found` |
| `PT409`, `23505` (unique) | `conflict` |

**Storage:** bucket `replays` (public read, 2 MB, `application/json`). Anonymous uploads are allowed only into a folder
named after a session created in the last day: `replays/<sessionId>/<exercise>-<side>.json`, uploaded with
`upsert: true`, then indexed with `register_replay`.

**Edge Function `weekly-summary`:** `POST {patientId}` → reads 14 days → Gemma (`GOOGLE_API_KEY`, `GEMMA_MODEL`
secrets) → `upsert_summary` → `WeeklySummary`. CORS limited to `ALLOWED_ORIGIN`; repeat calls within 60 s return the
stored row. See `supabase/README.md`.

**Seed:** `supabase/seed.sql` is generated by `cd web && npm run seed:sql` from the same generator LocalSource uses
(`web/src/data/seed/generate.ts`), with dates relative to `current_date`. Re-run it on demo morning.

## 6. Camera (`web/src/camera/types.ts`)

The patient app only talks to a `CameraTracker`; the tracker reports per-frame measurements and never counts reps.

```ts
interface CameraTracker {
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  configure(opts: { exercise: Exercise; activeSide: BodySide }): void;
  onFrame(cb: (frame: TrackingFrame) => void): () => void;
  status(): { mode: 'real' | 'fake'; reason?: 'forced' | 'demo' | 'no-camera' | 'model-load' | 'timeout' };
  preloadHand(): void;
}
```

`TrackingFrame` (≈30/s, every value a 5-frame average, `null` when visibility < 0.5): `shoulderAngle`, `elbowAngle`,
`handOpening` per side; absolute `trunkLeanDeg` and `shoulderHike` (fallback only); `trunkVec` (unit mid-hip →
mid-shoulder vector, world coords), `shoulderWidthM`, `reachM` per side; `joints2d` / `joints3d` (13 joints, §2.4 order).

Session engine (`web/src/patient/session/`): `RestBaseline` (per round, during the countdown), `compensation.ts`
(lean = true angle between the current and resting trunk vectors, limit 12°; hike above rest minus an above-90°
allowance, arm_raise only, limit 0.10 of shoulder width; 3-frame debounce), `repCounter.ts` (hysteresis with
`thresholds(exercise, v0)` from `patient/data/exercises.ts`).

Tracker choice: `?tracker=real|fake` (per tab); the fake tracker in demo mode (`?demo=1`); otherwise real, falling back to
the fake tracker if the camera or models fail. The patient then sees a "Demo motion" badge.

MediaPipe WASM is served from `/mediapipe/wasm` (copied at `npm install`), models from `/models`; CDNs are fallbacks only.

## 7. Watch payloads

- **Route A: iPhone Shortcut → `POST /rest/v1/rpc/submit_watch_daily`** (headers `apikey` and
  `Authorization: Bearer <anon key>`). Body as in the RPC table. Numbers may be strings with commas. Build steps:
  `docs/SHORTCUT.md`.
- **Route B: watch app → `POST /rest/v1/rpc/submit_watch_session`**. Body:
  `{sessionId (uuid), patientId, exercise ('side_raise' | 'arm_raise' | 'forward_reach'), arm ('left' | 'right'),
  startedAt, endedAt, targetReps, reps, attempts, bestElevationDeg, avgHr?, maxHr?, minHr?,
  trace?: {hz: 5, elevationDeg[], directionDeg[], heartRate[]}, repLog?: {atSec, peakDeg, directionDeg, counted}[],
  appSessionId?}`. `side_raise` is stored as `arm_raise`. Re-sending the same `sessionId` replaces the row.
  Setup: `watch/README.md`.
- **Route C: recorded data.** Seeded `watch_daily` and `watch_sessions` rows, so the demo never depends on a watch.
