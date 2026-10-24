# RehabTrack API — for Lucas (and anyone calling the backend)

Base URL during development: **`http://localhost:8081/api`**

If Raghav’s laptop IP is different on Wi‑Fi, replace `localhost` with that IP.

All timestamps are ISO-8601 strings (e.g. `"2026-10-24T15:30:00.000Z"`).
Dates without time are `"YYYY-MM-DD"`.

Exercises: `"arm_raise"` | `"forward_reach"` | `"hand_open"`  
Sides: `"weak"` | `"healthy"`  
Weak body side on a patient: `"left"` | `"right"`

Symmetry % for an exercise = weak `bestValue` ÷ healthy `bestValue` × 100.

---

## GET /api/health

Is the API running?

**Response `200`**
```json
{ "ok": true, "service": "rehabtrack-api" }
```

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

One patient, their current plan (suggested if one exists, else approved), the approved plan, and open alerts.

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
    "createdAt": "2026-10-24T12:00:00.000Z"
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

Send up to 6 results (3 exercises × 2 sides). You do **not** need to send `avgHr` or a replay here.

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
    "replayFile": null
  },
  "results": [ /* same shape as above, with id + sessionId filled in */ ],
  "alertsCreated": [],
  "planSuggested": null
}
```

**Response `400`** if required fields are missing  
**Response `404`** if `patientId` is unknown

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

One day of Health data from the iPhone Shortcut. Posting the same `patientId` + `date` again **replaces** that day. Every field except `patientId` and `date` is optional.

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

**Response `201`**
```json
{
  "watchDaily": { /* saved row with id */ },
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

Acknowledge an alert (hides it from open lists).

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
  "acknowledged": true
}
```

---

## POST /api/plans/:id/approve

Care team approves a plan (usually a `suggested` one). You can edit exercises / frequency / next check-in in the same call. `approvedBy` is required.

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

**Response `200`** — the plan with `status: "approved"` and `approvedBy` set.  
Also updates the patient’s `nextCheckin` and `phase` when provided.

---

## Demo patient IDs

| id | Story |
| --- | --- |
| `p-maria` | Improving symmetry, good adherence |
| `p-james` | Plateau + missed sessions |
| `p-priya` | High compensation + rising resting HR + high BP |

---

## Quick start for Lucas

1. Ask Raghav to run the API (`cd Raghav/api && npm install && npm run seed && npm start`).
2. Point your app at `http://localhost:8081/api` (or Raghav’s Wi‑Fi IP).
3. On home screen: `GET /patients/p-maria/plan` (or whichever patient you are demoing).
4. After a session: `POST /sessions` with the body shape above.
5. Do not invent extra fields — stick to this file and `Raghav/docs/CONTRACTS.md`.
