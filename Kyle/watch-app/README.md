# Mobility Lab — Apple Watch app

Swift sources for the watchOS companion app. Flow:

1. The dashboard sends an exercise prompt.
2. The watch shows a notification with a **Start session** button.
3. Tapping it starts recording: motion at 25 Hz plus heart rate, streamed to the dashboard.
4. **Stop** ends the session.

## Install on "Kyle's Apple Watch" (about 10 minutes)

1. Xcode → **File → New → Project → watchOS → App**.
   - Product name: `MobilityWatch`
   - Interface: SwiftUI
   - Choose "Watch-only App"
2. Delete the generated `ContentView.swift` and `MobilityWatchApp.swift`. Drag in the 3 `.swift` files from this folder and tick "Copy items if needed".
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
