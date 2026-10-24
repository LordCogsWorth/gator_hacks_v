# RehabTrack API — for Lucas (and anyone calling the backend)

Base URL during development: **`http://localhost:8081/api`**

From another laptop on the same Wi‑Fi, replace `localhost` with the IP the API prints on startup (`on your LAN: http://…`). Browser apps served from `localhost`, `127.0.0.1`, or a private LAN address (`10.x`, `172.16–31.x`, `192.168.x`) are allowed by CORS; other origins can be added with the `ALLOWED_ORIGINS` env var (comma-separated).

All timestamps the API **returns** are ISO-8601 UTC strings (e.g. `"2026-10-24T15:30:00.000Z"`).
`POST /sessions` also **accepts** epoch milliseconds (e.g. `Date.now()`) for `startedAt` / `endedAt` and converts them to ISO. Epoch *seconds* are rejected.
Dates without time are `"YYYY-MM-DD"`.

Exercises: `"arm_raise"` | `"forward_reach"` | `"hand_open"`  
Sides: `"weak"` | `"healthy"`  
Weak body side on a patient: `"left"` | `"right"`

Symmetry % for an exercise = weak `bestValue` ÷ healthy `bestValue` × 100.

### Errors

Every error is JSON, never an HTML page:

```json
{ "error": "Patient not found" }
```

Validation errors (`400`) also list **every** problem, so you can fix them all at once:

```json
{
  "error": "Invalid session",
  "details": [
    { "field": "startedAt", "message": "must be an ISO-8601 string or epoch milliseconds" },
    { "field": "results[0].reps", "message": "must be a finite number" }
  ]
}
```

Malformed JSON → `400 { "error": "Request body is not valid JSON" }`. Unknown route → `404`. Server bug → `500 { "error": "Internal server error" }`.

---

## GET /api/health

Is the API running?

**Response `200`**
```json
{ "ok": true, "service": "rehabtrack-api" }
```

---

## GET /api/config

Rule constants the dashboard draws (e.g. the phase-target line on the symmetry chart).

**Response `200`**
```json
{
  "phaseTargets": { "1": 50, "2": 65, "3": 80, "4": 90 },
  "maxPhase": 4,
  "exercises": ["arm_raise", "forward_reach", "hand_open"],
  "alertCooldownHours": 72
}
```

`phaseTargets` = symmetry % the weak arm should reach before moving to the next phase.

---

## GET /api/patients

List all patients with a summary for the care-team list. Flagged patients (any open alert) come first.

**Response `200`** — array of:
```json
[
  {
    "id": "p-james",
    "name": "James Okonkwo",
    "weakSide": "right",
    "strokeDate": "2026-05-03",
    "phase": 2,
    "maxRaiseAngle": 110,
    "nextCheckin": "2026-10-26",
    "bpLimitSys": 145,
    "latestSymmetry": 55,
    "trend": "flat",
    "trendDelta": 0.5,
    "openAlertCount": 2,
    "openAlertTypes": ["plateau", "adherence"],
    "sessionsThisWeek": 0,
    "sessionsPerWeek": 5,
    "flagged": true
  }
]
```

`trend` is `"up"` | `"down"` | `"flat"` | `"none"`.

---

## GET /api/patients/:id

One patient, their current plan (suggested if one exists, else approved), the approved plan, and open alerts. See [Plans](#plans) for every plan field.

**Example:** `GET /api/patients/p-maria`

**Response `200`**
```json
{
  "patient": {
    "id": "p-maria",
    "name": "Maria Santos",
    "weakSide": "left",
    "strokeDate": "2026-07-12",
    "phase": 2,
    "maxRaiseAngle": 120,
    "nextCheckin": "2026-10-28",
    "bpLimitSys": 150
  },
  "plan": {
    "id": "plan-…",
    "patientId": "p-maria",
    "phase": 3,
    "exercises": [
      { "exercise": "arm_raise", "reps": 10, "target": 120 },
      { "exercise": "forward_reach", "reps": 10, "target": 145 },
      { "exercise": "hand_open", "reps": 12, "target": 84 }
    ],
    "sessionsPerWeek": 5,
    "status": "suggested",
    "approvedBy": null,
    "nextCheckin": "2026-10-28",
    "createdAt": "2026-10-24T12:00:00.000Z",
    "kind": "phase-up",
    "reason": "Symmetry averaged 69% over the last 3 sessions, above the phase 2 target of 65%, with 12% compensation. Move to phase 3 with targets raised 10%.",
    "basedOn": { "sessions": 3, "avgSymmetry": 69.4, "avgCompensation": 11.7 }
  },
  "approvedPlan": {
    "id": "plan-…",
    "patientId": "p-maria",
    "phase": 2,
    "exercises": [
      { "exercise": "arm_raise", "reps": 10, "target": 101 },
      { "exercise": "forward_reach", "reps": 10, "target": 135 },
      { "exercise": "hand_open", "reps": 12, "target": 71 }
    ],
    "sessionsPerWeek": 5,
    "status": "approved",
    "approvedBy": "Dr. Chen",
    "nextCheckin": "2026-10-28",
    "createdAt": "2026-10-03T12:00:00.000Z"
  },
  "openAlerts": []
}
```

**Response `404`**
```json
{ "error": "Patient not found" }
```

---

## Plans

A plan record (returned by the plan endpoints and inside `GET /patients/:id`):

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `patientId` | string | |
| `phase` | 1–4 | |
| `exercises` | `{ exercise, reps, target }[]` | `target` = degrees (arm exercises) or % (hand_open) |
| `sessionsPerWeek` | number | |
| `status` | `"suggested"` \| `"approved"` \| `"superseded"` \| `"dismissed"` | one `approved` plan per patient at a time |
| `approvedBy` | string \| null | |
| `nextCheckin` | `"YYYY-MM-DD"` | |
| `createdAt` | ISO | |
| `approvedAt` | ISO, optional | set on approval |
| `supersededAt` / `dismissedAt` | ISO, optional | set when the plan is retired |
| `kind` | `"phase-up"` \| `"plateau"` \| `"compensation"`, optional | only on rules-engine suggestions |
| `reason` | string, optional | plain-language explanation, only on suggestions |
| `basedOn` | `{ sessions, avgSymmetry, avgCompensation }`, optional | the sessions the rule looked at (averages rounded to 0.1) |

**How suggestions are made.** After every session or watch upload the rules engine may draft one `suggested` plan per patient (never more than one open). It only looks at sessions recorded *after* the care team's last approve/dismiss for that patient, so a decision isn't immediately re-suggested from the same data. Checked in this order:

1. **Compensation** — average compensation over the last 3 sessions > 50% → same phase, reps −20%, targets −10%, focus on form.
2. **Ready** — last 3 sessions all at or above the phase target (`GET /config`) with compensation < 20% → phase + 1 (never past 4), targets +10% (arm raise capped at the patient's `maxRaiseAngle`).
3. **Plateau** — symmetry within a 5-point range over 4+ sessions in 14 days → same phase; the weakest exercise gets reps +20% and target −5%.

---

## GET /api/patients/:id/sessions

All sessions for a patient, oldest first, each with nested `results` (ExerciseResult rows) plus computed `symmetry`, `compensation`, and `symmetryByExercise`.

**Example:** `GET /api/patients/p-maria/sessions`

**Response `200`**
```json
[
  {
    "id": "sess-…",
    "patientId": "p-maria",
    "startedAt": "2026-10-04T15:30:00.000Z",
    "endedAt": "2026-10-04T15:42:00.000Z",
    "pain": 2,
    "tiredness": 2,
    "avgHr": null,
    "replayFile": null,
    "replays": ["sess-…-arm_raise-healthy", "sess-…-arm_raise-weak"],
    "results": [
      {
        "id": "er-…",
        "sessionId": "sess-…",
        "exercise": "arm_raise",
        "side": "healthy",
        "bestValue": 160,
        "reps": 10,
        "secPerRep": 3.0,
        "smoothness": 1.1,
        "fatigue": 0.98,
        "trunkLeanMax": 3,
        "shoulderHikeMax": 0.01,
        "compRepPct": 0
      },
      {
        "id": "er-…",
        "sessionId": "sess-…",
        "exercise": "arm_raise",
        "side": "weak",
        "bestValue": 72,
        "reps": 8,
        "secPerRep": 4.2,
        "smoothness": 2.4,
        "fatigue": 0.9,
        "trunkLeanMax": 7,
        "shoulderHikeMax": 0.02,
        "compRepPct": 15
      }
    ],
    "symmetry": 45,
    "compensation": 15,
    "symmetryByExercise": {
      "arm_raise": 45,
      "forward_reach": 45,
      "hand_open": 45
    }
  }
]
```

---

## POST /api/sessions  ← Lucas’s patient app calls this

Upload a finished exercise session. The API saves it, runs the rules engine (alerts + maybe a suggested plan), and returns what was created.

**Request body**
```json
{
  "patientId": "p-maria",
  "startedAt": "2026-10-24T15:30:00.000Z",
  "endedAt": "2026-10-24T15:42:00.000Z",
  "pain": 3,
  "tiredness": 2,
  "results": [
    {
      "exercise": "arm_raise",
      "side": "healthy",
      "bestValue": 165,
      "reps": 10,
      "secPerRep": 3.1,
      "smoothness": 1.2,
      "fatigue": 0.97,
      "trunkLeanMax": 4,
      "shoulderHikeMax": 0.01,
      "compRepPct": 0
    },
    {
      "exercise": "arm_raise",
      "side": "weak",
      "bestValue": 104,
      "reps": 8,
      "secPerRep": 4.6,
      "smoothness": 2.8,
      "fatigue": 0.88,
      "trunkLeanMax": 14,
      "shoulderHikeMax": 0.04,
      "compRepPct": 38
    }
  ]
}
```

Send up to 6 results (3 exercises × 2 sides). You do **not** need to send `avgHr` or a replay here: upload replays afterwards with `POST /sessions/:id/replay`, using the `session.id` from this response. (`avgHr` is always `null` for now: filling it from watch data is not implemented yet.)

**Validation** (checked before anything is saved — a rejected upload writes nothing):

| Field | Rule |
| --- | --- |
| `patientId` | required string |
| `startedAt`, `endedAt` | required; ISO-8601 string **or** epoch milliseconds (number). Stored as ISO UTC. |
| `pain` | optional number 0–10 (omit or `null` if not asked) |
| `tiredness` | optional number 1–5 |
| `results` | array of 1–6 items, no duplicate `exercise` + `side` pair |
| `results[i].exercise` | `arm_raise` \| `forward_reach` \| `hand_open` |
| `results[i].side` | `weak` \| `healthy` |
| `results[i].bestValue`, `reps`, `secPerRep`, `smoothness`, `fatigue`, `trunkLeanMax`, `shoulderHikeMax` | required finite numbers |
| `results[i].compRepPct` | required number 0–100 |

Extra fields are ignored.

**Response `201`**
```json
{
  "session": {
    "id": "sess-…",
    "patientId": "p-maria",
    "startedAt": "2026-10-24T15:30:00.000Z",
    "endedAt": "2026-10-24T15:42:00.000Z",
    "pain": 3,
    "tiredness": 2,
    "avgHr": null,
    "replayFile": null,
    "replays": []
  },
  "results": [ /* same shape as above, with id + sessionId filled in */ ],
  "alertsCreated": [],
  "planSuggested": null
}
```

`replays` lists the keys of replays uploaded for this session (see [POST /api/sessions/:id/replay](#post-apisessionsidreplay)); it starts empty. `replayFile` is a legacy placeholder kept for compatibility and is always `null`: use `replays` instead. Sessions saved before replays existed have no `replays` field in storage; `GET /patients/:id/sessions` returns `[]` for them.

**Response `400`** — `{ error: "Invalid session", details: [...] }` (see [Errors](#errors))  
**Response `404`** if `patientId` is unknown

---

## POST /api/sessions/:id/replay  ← Lucas’s patient app calls this (optional)

Upload one 3D skeleton recording (a `ReplayFile`, `Raghav/docs/CONTRACTS.md` §4) for one exercise + side of a saved session. Call it once per exercise per arm, after `POST /sessions` returned the session id. Uploading the same exercise + side again **replaces** the stored one.

Stored at `api/data/replays/<sessionId>-<exercise>-<side>.json`; that key is added to `session.replays`.

**Request body** (≈ 230 bytes per frame; 120 s ≈ 420 KB, well under the 5 MB body limit)
```json
{
  "fps": 15,
  "exercise": "arm_raise",
  "side": "weak",
  "joints": ["nose", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
             "left_wrist", "right_wrist", "left_hip", "right_hip",
             "left_knee", "right_knee", "left_ankle", "right_ankle"],
  "frames": [
    [[0, -0.66, -0.06], [0.18, -0.48, 0], [-0.18, -0.48, 0], "… 13 [x, y, z] triples per frame"]
  ],
  "warnings": [{ "frame": 42, "type": "lean" }]
}
```

**Validation** (checked before anything is saved):

| Field | Rule |
| --- | --- |
| `fps` | must be `15` |
| `exercise` | `arm_raise` \| `forward_reach` \| `hand_open` |
| `side` | `weak` \| `healthy` |
| `joints` | exactly the 13 joint names above, in that order |
| `frames` | 1 to 1800 frames (15 fps × 120 s); each frame is 13 `[x, y, z]` triples of finite numbers (metres, hip-centred). Only the first 5 bad frames are listed in `details`. |
| `warnings` | optional array of `{ frame, type }`: `frame` = index of an existing frame, `type` = `lean` \| `shoulder_hike` |

Extra fields are dropped.

**Response `201`**
```json
{
  "sessionId": "sess-…",
  "replays": ["sess-…-arm_raise-weak"],
  "replay": {
    "key": "sess-…-arm_raise-weak",
    "exercise": "arm_raise",
    "side": "weak",
    "fps": 15,
    "frameCount": 640,
    "seconds": 42.7,
    "warningCount": 3,
    "uploadedAt": "2026-10-24T15:43:00.000Z"
  }
}
```

**Response `400`** — `{ error: "Invalid replay", details: [...] }`  
**Response `404`** — `{ error: "Session not found" }`  
**Response `413`** — body over 5 MB

---

## GET /api/sessions/:id/replays

Summaries of the replays stored for a session (no frames), in upload order. Same shape as `replay` in the upload response.

**Response `200`** — `[{ key, exercise, side, fps, frameCount, seconds, warningCount, uploadedAt }]`  
**Response `404`** — `{ error: "Session not found" }`

---

## GET /api/sessions/:id/replays/:exercise/:side

One full `ReplayFile`, exactly as uploaded (contract fields only).

**Example:** `GET /api/sessions/sess-…/replays/arm_raise/weak`

**Response `200`** — the `ReplayFile`  
**Response `400`** — `exercise` or `side` isn't a valid value  
**Response `404`** — `{ error: "Session not found" }` or `{ error: "Replay not found" }`

---

## GET /api/patients/:id/plan  ← Lucas’s patient app calls this

The **approved** plan the patient should follow today (not a suggested draft).

**Example:** `GET /api/patients/p-maria/plan`

**Response `200`**
```json
{
  "id": "plan-…",
  "patientId": "p-maria",
  "phase": 2,
  "exercises": [
    { "exercise": "arm_raise", "reps": 10, "target": 101 },
    { "exercise": "forward_reach", "reps": 10, "target": 135 },
    { "exercise": "hand_open", "reps": 12, "target": 71 }
  ],
  "sessionsPerWeek": 5,
  "status": "approved",
  "approvedBy": "Dr. Chen",
  "nextCheckin": "2026-10-28",
  "createdAt": "2026-10-03T12:00:00.000Z"
}
```

**Response `404`**
```json
{ "error": "No approved plan for this patient" }
```

---

## GET /api/patients/:id/watch

Daily Apple Watch / Health rows for charts (oldest first).

**Example:** `GET /api/patients/p-priya/watch`

**Response `200`**
```json
[
  {
    "id": "wd-…",
    "patientId": "p-priya",
    "date": "2026-10-04",
    "steps": 3200,
    "exerciseMin": 15,
    "standHr": 8,
    "restingHr": 66,
    "hrv": 35,
    "sleepHr": 6.5,
    "bpSys": 130,
    "bpDia": 78,
    "falls": 0,
    "weakArmActiveMin": 60,
    "useRatio": 0.4
  }
]
```

---

## POST /api/watch/daily

One day of Health data from the iPhone Shortcut. Every field except `patientId` and `date` is optional.

Posting the same `patientId` + `date` again **merges** into that day: fields you send overwrite, fields you leave out (or send as `null`) keep their previous value. So the Shortcut can send heart rate in one call and blood pressure in another.

**Validation:** `date` must be a real date in `YYYY-MM-DD` form; every other field must be a finite **number** (not a string like `"4200"`). Unknown fields are ignored. Errors → `400 { error: "Invalid watch daily data", details: [...] }`.

**Request body**
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

**Response `201`** (also for a merge into an existing day)
```json
{
  "watchDaily": { /* the full merged row with id */ },
  "alertsCreated": []
}
```

---

## GET /api/alerts

All **open** (unacknowledged) alerts across patients, newest first.

**Response `200`**
```json
[
  {
    "id": "alert-…",
    "patientId": "p-james",
    "type": "plateau",
    "detail": "Symmetry has been flat (under 5-point range) for about 2 weeks. Care team may want to review the plan.",
    "createdAt": "2026-10-24T12:00:00.000Z",
    "acknowledged": false
  }
]
```

Alert `type` values:  
`"plateau"` | `"setback"` | `"compensation"` | `"adherence"` | `"pain"` | `"heart-rate"` | `"blood-pressure"` | `"fall"`

---

## PATCH /api/alerts/:id

Acknowledge an alert (hides it from open lists). Sets `acknowledgedAt` (kept from the first acknowledgement).

**Cooldown:** once acknowledged, the rules engine won't raise the same alert type for that patient again for **72 hours** — unless newer triggering data arrives after `acknowledgedAt`:
- session alerts (`plateau`, `setback`, `compensation`, `adherence`, `pain`): a session whose `startedAt` is after `acknowledgedAt`;
- watch alerts (`heart-rate`, `blood-pressure`, `fall`): a watch row whose `date` (taken as midnight UTC) is after `acknowledgedAt`. Re-posting today's row doesn't count; tomorrow's does.

After 72 hours the alert can be raised again from the same data.

**Request body** (optional)
```json
{ "acknowledged": true }
```

**Response `200`**
```json
{
  "id": "alert-…",
  "patientId": "p-james",
  "type": "plateau",
  "detail": "…",
  "createdAt": "2026-10-24T12:00:00.000Z",
  "acknowledged": true,
  "acknowledgedAt": "2026-10-24T16:05:00.000Z"
}
```

---

## POST /api/plans/:id/approve

Care team approves a plan (usually a `suggested` one). You can edit exercises / frequency / next check-in in the same call. `approvedBy` is required.

The patient's previously approved plan becomes `"superseded"`, so `GET /patients/:id/plan` immediately returns the new one.

**Request body**
```json
{
  "approvedBy": "Dr. Chen",
  "exercises": [
    { "exercise": "arm_raise", "reps": 12, "target": 110 },
    { "exercise": "forward_reach", "reps": 10, "target": 140 },
    { "exercise": "hand_open", "reps": 12, "target": 75 }
  ],
  "sessionsPerWeek": 5,
  "nextCheckin": "2026-11-04"
}
```

`exercises`, `sessionsPerWeek`, and `nextCheckin` are optional — omit any field you don’t want to change.

**Validation:** `approvedBy` non-empty string; `exercises` non-empty array of `{ exercise, reps (whole number ≥ 1), target (number > 0) }`; `sessionsPerWeek` whole number 1–14; `nextCheckin` `YYYY-MM-DD`. Errors → `400 { error: "Invalid plan approval", details: [...] }`.

**Response `200`** — the plan with `status: "approved"`, `approvedBy` and `approvedAt` set.  
Also updates the patient’s `nextCheckin` and `phase`.  
**Response `409`** if the plan is `dismissed` or `superseded`.

---

## POST /api/plans/:id/dismiss

Care team rejects a `suggested` plan. The approved plan stays in force. The rules engine won't re-suggest from the sessions it already used (see [Plans](#plans)).

**Request body** (optional)
```json
{ "dismissedBy": "Dr. Chen" }
```

**Response `200`** — the plan with `status: "dismissed"`, `dismissedAt`, `dismissedBy`.  
**Response `404`** if the plan doesn't exist; **`409`** if it isn't `suggested`.

---

## Demo patient IDs

| id | Story |
| --- | --- |
| `p-maria` | Improving symmetry, good adherence → suggested plan: phase up |
| `p-james` | Plateau + missed sessions → suggested plan: more hand-open reps |
| `p-priya` | High compensation + rising resting HR + high BP → suggested plan: lighter load, focus on form |

Seed dates are relative to today, so alerts and suggestions look the same whatever day you seed.

---

## Quick start for Lucas

1. Ask Raghav to run the API (`cd Raghav/api && npm install && npm run seed && npm start`).
2. Point your app at `http://localhost:8081/api` (or Raghav’s Wi‑Fi IP).
3. On home screen: `GET /patients/p-maria/plan` (or whichever patient you are demoing).
4. After a session: `POST /sessions` with the body shape above (`Date.now()` is fine for `startedAt` / `endedAt`). On `400`, log `details`: it lists every bad field.
5. Optional: for each exercise + side, `POST /sessions/:id/replay` with the camera module's `replay()` output.
6. Working reference for steps 3–5: the dashboard's demo patient view (`Raghav/web/src/pages/PatientDemo.tsx`, open `http://localhost:5173/patient/p-maria`) driving the mock camera (`Raghav/web/src/camera/mockCamera.ts`).
7. Do not invent extra fields — stick to this file and `Raghav/docs/CONTRACTS.md`.
