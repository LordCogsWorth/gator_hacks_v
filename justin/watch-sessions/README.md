# Watch sessions: Apple Watch app → Supabase (draft)

When a patient finishes an exercise session on the watch, the watch app sends **one summary** of that session
to Supabase: exercise, reps, best arm height, heart rate, and a small trace of the arm movement.
The care-team dashboard can then show each patient's sessions. It goes over the internet, so the watch
doesn't need to be on the same Wi-Fi as anything; it only needs a connection (through its iPhone, Wi-Fi or cellular).

```
Watch app ──(on Stop)──▶ Supabase rpc/submit_watch_session ──▶ watch_sessions table ◀── dashboard (signed in)
```

| File | What it is |
|------|------------|
| [`schema.sql`](schema.sql) | Table, access rules and the `submit_watch_session` function. Run once in Supabase. |

**Status: draft.** The Supabase side is done and tested. The watch app (Kyle's code) still needs the
upload added; see "For Kyle" below. Raghav should add the contract to `CONTRACTS.md` so the dashboard can use it.

## Setup

Supabase → **SQL Editor** → paste all of [`schema.sql`](schema.sql) → **Run**. Same project and anon key as the
daily Shortcut ([`../watch-daily`](../watch-daily)).

## Contract: `POST /rest/v1/rpc/submit_watch_session`

Headers: `apikey: <anon key>`, `Authorization: Bearer <anon key>`, `Content-Type: application/json`.

```json
{
  "sessionId": "8F14E45F-CEEA-4E7A-9B1C-2D3E4F5A6B7C",
  "patientId": "p-maria",
  "exercise": "arm_raise",
  "arm": "left",
  "startedAt": "2026-10-24T15:30:00.000Z",
  "endedAt": "2026-10-24T15:40:00.000Z",
  "targetReps": 10,
  "reps": 8,
  "attempts": 11,
  "bestElevationDeg": 104.5,
  "avgHr": 92,
  "maxHr": 118,
  "minHr": 76,
  "trace": {
    "hz": 5,
    "elevationDeg": [3.1, 8.4, 22.0, 61.7, 95.2],
    "directionDeg": [85.0, 86.2, 84.9, 83.1, 82.4],
    "heartRate": [90, 90, null, 91, 91]
  },
  "repLog": [{ "atSec": 12.4, "peakDeg": 95.2, "directionDeg": 82.4, "counted": true }],
  "appSessionId": "s-123"
}
```

| Field | Required | Notes |
|---|---|---|
| `sessionId` | yes | Made by the watch (a UUID). Sending the same id again **replaces** that session, so retries are safe. |
| `patientId` | yes | Same ID as the daily Shortcut. |
| `exercise` | yes | `arm_raise` or `forward_reach` (contract names). The watch's `side_raise` is accepted and saved as `arm_raise`. |
| `arm` | no | `left` / `right`: the wrist the watch is on, which is the arm being measured. |
| `startedAt`, `endedAt` | yes | ISO-8601 times. Used to match the session with camera results from the patient app. |
| `targetReps`, `reps`, `attempts` | no | `reps` = reps that counted; `attempts` = every lift. `completed` is worked out from these. |
| `bestElevationDeg` | no | Highest arm angle: 0° arm down, 90° shoulder height, 180° overhead. |
| `avgHr`, `maxHr`, `minHr` | no | Heart rate during the session (bpm). 0 is saved as empty. |
| `trace` | no | Arm angles and HR over time, at `hz` samples per second. ~40 KB for 10 minutes at 5 Hz. Max ~2 MB. |
| `repLog` | no | Per-rep details, if the watch keeps them. |
| `appSessionId` | no | The patient web app's session id, if the session was started from there. |

Success returns `{"ok": true, "sessionId": "…", "patientId": "…", "updatedAt": "…"}`. Errors return a message such
as `exercise must be arm_raise or forward_reach`.

Raw 25 Hz accelerometer and gyroscope data isn't included (several MB per session). If it's needed later, upload it as a
file to Supabase Storage and add its path to the session.

### Table columns (for the dashboard)

`session_id, patient_id, exercise, arm, started_at, ended_at, duration_sec, target_reps, reps, attempts,
best_elevation_deg, completed, avg_hr, max_hr, min_hr, rep_log, trace, app_session_id, created_at, updated_at`

A patient's sessions, newest first (signed in, supabase-js):

```js
supabase.from('watch_sessions')
  .select('session_id, exercise, arm, started_at, duration_sec, reps, target_reps, best_elevation_deg, avg_hr, max_hr')
  .eq('patient_id', 'p-maria')
  .order('started_at', { ascending: false })
```

Leave `trace` out of list queries and fetch it only when opening one session.

## For Kyle: adding the upload to the watch app

All changes are in `WatchModel.swift`. The existing upload to the Mac server can stay as it is; this adds a
second upload, to Supabase, when the session ends.

**1. Settings** (top of the file, next to `SERVER_URL`):

```swift
let SUPABASE_URL = URL(string: "https://YOUR-PROJECT.supabase.co")!
let SUPABASE_ANON_KEY = "YOUR-ANON-KEY"
let PATIENT_ID = "p-maria"
```

**2. New properties** in `WatchModel`:

```swift
private var cloudSessionId = ""
private var hrValues: [Double] = []
private var traceElev: [Double] = []
private var traceDir: [Double] = []
private var traceHr: [Any] = []
private var tick = 0
```

**3. Reset them in `begin()`**, after `startDate = Date()`:

```swift
cloudSessionId = UUID().uuidString
hrValues = []; traceElev = []; traceDir = []; traceHr = []; tick = 0
```

**4. Sample the trace at the end of `record(_:)`**, from 25 Hz down to 5 Hz:

```swift
tick += 1
if tick % 5 == 0 {
    traceElev.append((arm.elevation * 10).rounded() / 10)
    traceDir.append((arm.plane * 10).rounded() / 10)
    traceHr.append(heartRate.map { $0.rounded() as Any } ?? NSNull())
    if let hr = heartRate { hrValues.append(hr) }
}
```

**5. Upload in `stopSession()`**, next to the existing `post("session/stop", …)` line:

```swift
if arm.calibrated { uploadSession(endedAt: Date()) } // skip sessions cancelled before calibrating
```

**6. The upload function** (inside `WatchModel`):

```swift
private func uploadSession(endedAt: Date) {
    var body: [String: Any] = [
        "sessionId": cloudSessionId,
        "patientId": PATIENT_ID,
        "exercise": kind.rawValue,
        "arm": arm.isLeftArm ? "left" : "right",
        "startedAt": Self.iso.string(from: startDate),
        "endedAt": Self.iso.string(from: endedAt),
        "targetReps": targetReps,
        "reps": arm.reps,
        "attempts": arm.attempts,
        "bestElevationDeg": (arm.bestPeak * 10).rounded() / 10,
        "trace": ["hz": 5, "elevationDeg": traceElev, "directionDeg": traceDir, "heartRate": traceHr] as [String: Any]
    ]
    if !hrValues.isEmpty {
        body["avgHr"] = (hrValues.reduce(0, +) / Double(hrValues.count)).rounded()
        body["maxHr"] = hrValues.max()!.rounded()
        body["minHr"] = hrValues.min()!.rounded()
    }

    var req = URLRequest(url: SUPABASE_URL.appendingPathComponent("rest/v1/rpc/submit_watch_session"))
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(SUPABASE_ANON_KEY, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(SUPABASE_ANON_KEY)", forHTTPHeaderField: "Authorization")
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    req.timeoutInterval = 20

    Task {
        let ok = (try? await URLSession.shared.data(for: req)).map { ($0.1 as? HTTPURLResponse)?.statusCode == 200 } ?? false
        lastSummary = (lastSummary ?? "") + (ok ? " · saved" : " · not saved")
    }
}
```

Supabase uses HTTPS, so no App Transport Security exception is needed for it.

**Not handled yet:** if the watch has no connection when the session ends, the upload fails and the session is lost.
A simple fix is to save `body` to `UserDefaults` on failure and retry on the next launch. Because the same
`sessionId` replaces the row, retrying is safe.

## Testing without the watch

[`../watch-daily/check.html`](../watch-daily/check.html) has a **Watch sessions** table and a **Send test session**
button that posts a fake session through the same function.
