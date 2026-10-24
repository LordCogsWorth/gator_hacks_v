# RehabTrack — Shared Contracts

These are the agreed shapes of data passed between teammates' code. If you need to change one, tell the owner and everyone who uses it first, then update this file.

| Contract | Owner | Used by |
| --- | --- | --- |
| Camera module | Stuti | Lucas (patient app) |
| ExerciseResult | Stuti | Lucas → Raghav's API → dashboard |
| ReplayFile | Stuti | Lucas uploads → Raghav's dashboard renders |
| REST API | Raghav | Lucas, Kyle, Justin (see `Raghav/api/API.md` once built) |
| Watch daily data | Raghav (API) | Kyle, Justin (iPhone Shortcut) |

## 1. Shared names

```ts
type Exercise = 'arm_raise' | 'forward_reach' | 'hand_open';
type Side = 'weak' | 'healthy';
type BodySide = 'left' | 'right';
```

All timestamps are ISO-8601 strings (e.g. `"2026-10-24T15:30:00.000Z"`). Dates without time are `"YYYY-MM-DD"`.
On input, `POST /api/sessions` also accepts epoch milliseconds (`Date.now()`) for `startedAt` / `endedAt`; the API stores and returns ISO UTC strings.

Units: angles in degrees, `hand_open` values in % (0–100), distances in metres, durations in seconds, heart rate in bpm, blood pressure in mmHg.

## 2. Camera module (Stuti builds, Lucas calls)

```ts
interface LiveFrame {              // emitted about 15 times per second
  value: number;                   // angle in degrees, or hand opening %
  reps: number;                    // reps counted so far
  warning?: 'lean' | 'shoulder_hike' | 'not_visible';
}

interface ExerciseControl {
  stop(): ExerciseResult;          // ends the exercise and returns the summary
  replay(): ReplayFile;            // skeleton recording of this exercise
}

function startExercise(
  video: HTMLVideoElement,
  exercise: Exercise,
  side: Side,
  onFrame: (frame: LiveFrame) => void
): ExerciseControl;
```

Until Stuti's module is ready, the patient app uses a mock with the same signature (e.g. a sine-wave angle that counts reps). A reference mock lives in `Raghav/web/src/camera/mockCamera.ts` (types in `Raghav/web/src/camera/types.ts`); its optional 5th `options` argument is mock-only.

## 3. ExerciseResult (one per exercise, per arm)

```ts
interface ExerciseResult {
  exercise: Exercise;
  side: Side;
  bestValue: number;               // best angle (degrees) or hand opening (%)
  reps: number;
  secPerRep: number;
  smoothness: number;              // speed bursts per rep; lower = smoother
  fatigue: number;                 // last 3 reps avg / first 3 reps avg (1.0 = no drop)
  trunkLeanMax: number;            // degrees from vertical
  shoulderHikeMax: number;         // weak shoulder height above healthy shoulder, in metres
  compRepPct: number;              // % of reps where lean or hike passed the threshold (0–100)
}
```

A full session has up to 6 results: 3 exercises × 2 sides.

Symmetry % for an exercise = weak `bestValue` ÷ healthy `bestValue` × 100.

## 4. ReplayFile (3D skeleton recording)

```ts
interface ReplayFile {
  fps: 15;
  exercise: Exercise;
  side: Side;
  joints: string[];                // order of joints in every frame (list below)
  frames: [number, number, number][][];  // frames[f][j] = [x, y, z] in metres, hip-centred
  warnings?: { frame: number; type: 'lean' | 'shoulder_hike' }[];
}
```

Joint order (13 joints, MediaPipe Pose index in brackets):

```text
nose(0), left_shoulder(11), right_shoulder(12), left_elbow(13), right_elbow(14),
left_wrist(15), right_wrist(16), left_hip(23), right_hip(24),
left_knee(25), right_knee(26), left_ankle(27), right_ankle(28)
```

Coordinates come from MediaPipe's world landmarks (`worldLandmarks`). Depth is estimated: the replay is for watching movement, not for measurements.

## 5. Session upload (Lucas → Raghav's API)

`POST /api/sessions`

```json
{
  "patientId": "p-maria",
  "startedAt": "2026-10-24T15:30:00.000Z",
  "endedAt": "2026-10-24T15:42:00.000Z",
  "pain": 3,
  "tiredness": 2,
  "results": [
    {
      "exercise": "arm_raise", "side": "healthy",
      "bestValue": 165, "reps": 10, "secPerRep": 3.1, "smoothness": 1.2,
      "fatigue": 0.97, "trunkLeanMax": 4, "shoulderHikeMax": 0.01, "compRepPct": 0
    },
    {
      "exercise": "arm_raise", "side": "weak",
      "bestValue": 104, "reps": 8, "secPerRep": 4.6, "smoothness": 2.8,
      "fatigue": 0.88, "trunkLeanMax": 14, "shoulderHikeMax": 0.04, "compRepPct": 38
    }
  ]
}
```

The patient app doesn't send average heart rate. Sessions have an `avgHr` field, but it is **not filled in yet** (always `null`); matching it from watch data by `startedAt` / `endedAt` is planned, not implemented.

The API validates the whole body before saving anything and answers `400 { error, details: [{ field, message }] }` listing every problem (rules in `Raghav/api/API.md`). Every `ExerciseResult` number is required and must be finite; `compRepPct` is 0–100; `pain` 0–10 and `tiredness` 1–5 are optional; 1–6 results per session.

Replays are uploaded separately (**implemented**): after the session is saved, `POST /api/sessions/:id/replay` once per exercise + side with the `ReplayFile` from `replay()`. The API checks `fps` = 15, the 13 joints in the order above, 1–1800 frames (≤ 120 s) of `[x, y, z]` number triples, and valid `warnings`; it stores each one under the key `<sessionId>-<exercise>-<side>` and lists the keys on `session.replays`. Read them back with `GET /api/sessions/:id/replays` (summaries) and `GET /api/sessions/:id/replays/:exercise/:side` (full file). Sessions still carry a legacy `replayFile` field that is always `null`; use `replays`. Details: `Raghav/api/API.md`.

## 5b. Plan (Raghav's API → Lucas's patient app)

`GET /api/patients/:id/plan` returns the approved plan the patient follows today:

```ts
interface Plan {
  id: string;
  patientId: string;
  phase: number;                   // 1–4
  exercises: { exercise: Exercise; reps: number; target: number }[];
  sessionsPerWeek: number;
  status: 'suggested' | 'approved' | 'superseded' | 'dismissed';
  approvedBy: string | null;
  nextCheckin: string;             // YYYY-MM-DD
  createdAt: string;
  approvedAt?: string;
  kind?: 'phase-up' | 'plateau' | 'compensation';    // rules-engine suggestions only
  reason?: string;                                    // why the rules engine suggested it
  basedOn?: { sessions: number; avgSymmetry: number; avgCompensation: number };
}
```

The rules engine drafts `suggested` plans; only a clinician's approval makes one `approved` (the old one becomes `superseded`), and the care team can reject one with `POST /api/plans/:id/dismiss` (→ `dismissed`). The patient app should only ever show the approved plan.

## 6. Watch daily data (iPhone Shortcut → Raghav's API)

`POST /api/watch/daily`

```json
{
  "patientId": "p-maria",
  "date": "2026-10-24",
  "steps": 4200,
  "exerciseMin": 22,
  "standHr": 9,
  "restingHr": 68,
  "hrv": 41,
  "sleepHr": 7.2,
  "bpSys": 132,
  "bpDia": 84,
  "falls": 0,
  "weakArmActiveMin": 95,
  "useRatio": 0.58
}
```

Every field except `patientId` and `date` is optional; send what the Shortcut can read. Values must be JSON numbers, not strings. Posting the same `patientId` + `date` again **merges**: sent fields overwrite, missing or `null` fields keep their previous value.

## 7. Kyle's watch server (existing, `main/server/index.js`, port 8080)

Raw watch samples go to Kyle's server, not Raghav's API:

- `POST /ingest/batch` — `{ samples: [{ timestamp, accel: {x,y,z}, gyro: {x,y,z}, heartRate?, source, sessionId }] }`
- `GET /events` — live stream (Server-Sent Events)
- `POST /session/start`, `POST /session/stop`, `GET /session`
- `GET /health`

At merge time, Raghav's API router is mounted into this server at `/api`, so everything runs on one port. The router parses its own JSON (5 MB limit) and returns JSON errors, so mount it **before** this server's own `app.use(express.json({ limit: '1mb' }))`; otherwise that parser runs first, its 1 MB limit applies to replays, and its parse errors come back as HTML.

## 8. Ports during development

| Service | Port |
| --- | --- |
| Kyle's watch server | 8080 |
| Raghav's API | 8081 |
| Care dashboard (Vite) | 5173 |
| Lucas's patient app (Vite) | 5174 |

When running on different laptops, replace `localhost` with the host laptop's Wi-Fi IP address.
