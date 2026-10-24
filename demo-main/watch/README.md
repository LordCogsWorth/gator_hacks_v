# RehabTrack: Apple Watch app

A watchOS app (SwiftUI, watchOS 10) that guides two seated exercises and measures the arm the watch is on.
It needs no server or shared Wi-Fi of its own. When a session ends it posts **one summary** to Supabase
(`rpc/submit_watch_session`), and the care dashboard shows it under the patient.

```
Watch ──(on Stop, HTTPS)──▶ Supabase rpc/submit_watch_session ──▶ watch_sessions ◀── /care dashboard
```

## Flow

1. **Home:** pick **Arm raise to side** or **Forward reach** and set the number of reps.
2. **Demo:** an animated figure shows one example rep.
3. **Begin session, then Calibrate:** hold the watch arm straight out in front for 1.5 s. This sets "straight ahead" so
   the app can tell forward from sideways.
4. **Live:** the figure's arm mirrors your real arm. Height comes from gravity, direction from the calibrated heading.
   A rep counts at about 75° or more in the right direction, and back down. Haptics at shoulder height and per rep.
5. **Done:** reps, best height and time. The summary uploads; the home screen shows "Synced" once an upload succeeds.

What is uploaded per session (see `uploadSession` in `WatchModel.swift`): `sessionId` (a new UUID), `patientId`,
`exercise` (`side_raise` is stored as `arm_raise`), `arm` (wrist), `startedAt`, `endedAt`, `targetReps`, `reps`,
`attempts`, `bestElevationDeg`, `avgHr`/`maxHr`/`minHr` (from the workout session) and a 5 Hz `trace` of elevation,
direction and heart rate. The contract is in `demo-main/supabase/migrations/0001_init.sql` (`submit_watch_session`).

**Offline:** if the upload fails (no connection, timeout, 5xx) the JSON body is kept in `UserDefaults`
(`pendingUploads`, newest 20) and re-sent when the app becomes active. Re-sending is safe: the same `sessionId`
replaces the row. A 4xx answer (for example an unknown patient id) is not retried.

**Heart rate on camera sessions:** when a watch session overlaps a camera session of the same patient (±5 min),
Supabase copies the watch's average heart rate onto that camera session.

## Files

| File | What it does |
|---|---|
| `project.yml` | XcodeGen spec. Reads `Config.xcconfig`. Bundle id `$(BUNDLE_PREFIX).RehabTrackWatch`, display name RehabTrack. No ATS exceptions (Supabase is HTTPS). |
| `Config.example.xcconfig` | Template for `Config.xcconfig` (git-ignored): Supabase URL, anon key, patient id, team, bundle prefix. |
| `MobilityWatch/Config.swift` | Reads `SupabaseURL`, `SupabaseAnonKey`, `PatientID` from Info.plist. If any is missing, uploads are skipped. |
| `MobilityWatch/WatchModel.swift` | Flow, sensors, workout session, Supabase upload + retry queue. |
| `MobilityWatch/ArmTracker.swift` | Orientation maths and rep counting. |
| `MobilityWatch/ContentView.swift`, `FigureView.swift`, `Theme.swift`, `Exercise.swift` | Screens, stick figure, colours, exercise definitions. |
| `MobilityWatch/Reminders.swift` | Local reminders on the watch (9 AM to 9 PM every N hours), seated wording. |
| `MobilityWatch/MobilityWatchApp.swift` | App entry, notification actions, retries pending uploads on launch and when active. |

`MobilityWatch.xcodeproj` is not committed. Generate it with XcodeGen.

## Build and install (about 10 minutes)

1. Install XcodeGen once: `brew install xcodegen`.
2. Configure:
   ```sh
   cd demo-main/watch
   cp Config.example.xcconfig Config.xcconfig
   ```
   Edit `Config.xcconfig`:
   - `SUPABASE_URL = https:/$()/<project-ref>.supabase.co`. The `$()` is required: in an xcconfig `//` starts a comment.
   - `SUPABASE_ANON_KEY` = Supabase → Project Settings → API → **anon public** key. Never the service_role key.
   - `PATIENT_ID` = `p-james` (or `p-maria` / `p-priya`). It must exist in the `patients` table.
   - `DEVELOPMENT_TEAM` = your team id (Xcode → Settings → Accounts), or leave empty and pick the team in Xcode.
   - `BUNDLE_PREFIX` = a reverse-DNS prefix you own, for example `com.yourname`.
3. Generate and open: `xcodegen && open MobilityWatch.xcodeproj`.
4. Get the devices ready: plug in the paired iPhone, keep the watch near it, and turn on **Developer Mode** on both
   (Settings → Privacy & Security).
5. Choose the watch as the run destination and press **Run ▶**. On the watch, allow notifications and Health access.

Command-line build check (no signing): `xcodegen && xcodebuild -scheme MobilityWatch -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO build`.

## Testing without the watch

`demo-main/tools/watch-check.html` lists `watch_sessions` and has a **Send test session** button that posts the same body
through the same RPC. Or with curl:

```sh
curl -s "$SUPABASE_URL/rest/v1/rpc/submit_watch_session" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"sessionId":"test-1","patientId":"p-james","exercise":"side_raise","arm":"right",
       "startedAt":"2026-10-24T15:30:00Z","endedAt":"2026-10-24T15:38:00Z","targetReps":10,"reps":8,"attempts":11,
       "bestElevationDeg":96.5,"avgHr":88,"maxHr":104,"minHr":76}'
```

## Notes

- **Free Apple ID:** apps installed this way expire after 7 days. Press Run again to reinstall.
- The dashboard → watch prompt polling from the old Mac server was removed (out of scope). Local reminders still work.
- The watch measures the arm it is worn on (`arm` = left/right). Wear it on the weak arm for rehab sessions.
