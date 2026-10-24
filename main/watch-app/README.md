# Mobility Lab — Apple Watch app

Swift sources for the watchOS companion app. Flow:

1. **Home:** pick **Arm raise to side** or **Forward reach** and set the number of reps (or tap **Start session** on a dashboard notification).
2. **Demo:** an animated figure shows an example rep (side raise in front view, forward reach in side view), with instructions.
3. **Begin session → Calibrate:** hold the watch arm straight out in front for 1.5 s. This sets "straight ahead" so the app can tell forward from sideways.
4. **Live:** the figure's arm mirrors your real arm: its height comes from gravity, its direction from the calibrated heading.
   - Reps count when the arm reaches about 75° or more in the right direction and comes back down.
   - The watch gives a haptic tap at shoulder height and for each rep, with feedback such as "Move more out to the side".
   - Motion, heart rate and arm angles stream to the dashboard (`arm` field on each sample).
5. **Done:** reps, best height and time. The session ends automatically when you reach the rep goal.

Files: `MobilityWatchApp.swift` (app + notifications), `WatchModel.swift` (flow, sensors, networking), `ArmTracker.swift` (orientation math + rep counting), `FigureView.swift` (stick figure + demo animation), `Exercise.swift`, `ContentView.swift` (screens).

## Install on "Kyle's Apple Watch" (about 10 minutes)

1. Xcode → **File → New → Project → watchOS → App**.
   - Product name: `MobilityWatch`
   - Interface: SwiftUI
   - Choose "Watch-only App"
2. Delete the generated `ContentView.swift` and `MobilityWatchApp.swift`. Drag in all 6 `.swift` files from this folder and tick "Copy items if needed".
3. Set up the target's **Signing & Capabilities**:
   - Team: your Apple ID (Xcode → Settings → Accounts → add your Apple ID).
   - Add the **HealthKit** capability.
   - Add **Background Modes** and tick **Workout processing**.
4. In the target's **Info** tab, add these keys:
   - `NSHealthShareUsageDescription`: "Reads heart rate during exercise sessions."
   - `NSHealthUpdateUsageDescription`: "Saves exercise sessions as workouts."
   - `NSMotionUsageDescription`: "Records arm movement during exercise sessions."
   - `NSAppTransportSecurity` → `NSAllowsArbitraryLoads` = YES. The local server is plain http.
   - `NSLocalNetworkUsageDescription`: "Connects to the Mobility Lab dashboard on your Mac."
5. In `WatchModel.swift`, set `SERVER_URL` to the **Watch app server URL** printed by the Node server (currently `http://10.192.252.41:8080`).
6. Get the devices ready:
   - Plug the iPhone into the Mac and keep the watch near it.
   - Turn on **Developer Mode** on both: Settings → Privacy & Security on the iPhone, and on the watch.
   - Choose the watch as the run destination and press **Run ▶**.
7. On the watch:
   - Allow notifications and Health access.
   - The watch must be on the **same Wi-Fi** as the Mac.

## Notes
- **Seeing prompts:** the watch checks for new prompts about every 3 s while the app is open, or right after you raise your wrist on it. A prompt sent while the app is fully suspended is shown when you next open it. Instant delivery with the app closed would need push notifications (APNs), which require a paid developer account.
- **Free Apple ID:** apps installed this way expire after 7 days. Press Run again to reinstall.
- **Simulated feed:** stop it before recording real data (`pkill -f "/simulate"`), otherwise the fake samples get mixed in.
