import Foundation
import CoreMotion
import HealthKit
import UserNotifications
import WatchKit

// ⚠️ Set this to the "Watch app server URL" printed when the Node server starts
// (your Mac's Wi-Fi address). The watch and Mac must be on the same network.
let SERVER_URL = URL(string: "http://10.192.252.41:8080")!
let WATCH_SOURCE = "Kyle's Apple Watch"

// Supabase (justin/watch-sessions). Each finished session is saved as one row in `watch_sessions`.
// Fill in from Supabase → Project Settings → API. Uploads are skipped while these are placeholders.
let SUPABASE_URL = URL(string: "https://qyzrzofwmdxcxztbgrix.supabase.co")!
let SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5enJ6b2Z3bWR4Y3h6dGJncml4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NzE4NzAsImV4cCI6MjEwODQ0Nzg3MH0.nbbC-DJkSMr8fCsJaNcNjIx1ipyFXsyXy9dOl1nQtrs"
let PATIENT_ID = "p-test"
var supabaseConfigured: Bool { !SUPABASE_ANON_KEY.hasPrefix("YOUR-") && !SUPABASE_URL.absoluteString.contains("YOUR-PROJECT") }

struct Prompt: Decodable { let seq: Int; let id: String; let title: String; let message: String }
private struct PromptsResponse: Decodable { let latestSeq: Int; let prompts: [Prompt] }
private struct SessionStartResponse: Decodable { struct Active: Decodable { let id: String }; let active: Active }

/// Care plan approved by the doctor in RehabTrack (GET /plan).
struct CarePlan: Decodable, Equatable {
    struct Item: Decodable, Equatable, Identifiable {
        let exercise: String
        let reps: Int
        var id: String { exercise }
        /// Exercises the watch can track (hand_open needs the camera).
        var kind: ExerciseKind? {
            switch exercise {
            case "arm_raise", "side_raise": return .sideRaise
            case "forward_reach": return .forwardReach
            default: return nil
            }
        }
    }
    let id: String
    let approvedBy: String?
    let approvedAt: String?
    let phase: Int?
    let exercises: [Item]
}
private struct PlanResponse: Decodable { let plan: CarePlan? }

/// Screens of the watch app.
enum Stage { case home, demo, calibrate, live, done }

@MainActor
final class WatchModel: NSObject, ObservableObject {
    static let shared = WatchModel()

    @Published var stage: Stage = .home
    @Published var kind: ExerciseKind = .sideRaise
    @Published var targetReps = 10
    @Published var heartRate: Double?
    @Published var samplesSent = 0
    @Published var elapsedText = "0:00"
    @Published var serverOK = false
    @Published var pendingPrompt: Prompt?
    @Published var lastSummary: String?
    @Published var plan: CarePlan?
    /// True until the user opens the new plan on the watch.
    @Published var planIsNew = false

    // Progress + reminder settings (saved on the watch)
    @Published var streak = 0
    @Published var todayReps = 0
    @Published var remindersOn = false
    @Published var remindEvery = 2
    private let defaults = UserDefaults.standard

    override init() {
        super.init()
        remindersOn = defaults.bool(forKey: "remindersOn")
        let every = defaults.integer(forKey: "remindEvery")
        remindEvery = every == 0 ? 2 : every
        loadStats()
    }

    let arm = ArmTracker()
    var isRecording: Bool { stage == .calibrate || stage == .live }

    private let motion = CMMotionManager()
    private let health = HKHealthStore()
    private var workout: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var sessionId: String?
    private var startDate = Date()
    private var buffer: [[String: Any]] = []
    /// After the Mac fails to answer, skip it (use the Supabase relay) until this time.
    private var directDownUntil = Date.distantPast
    private var flushTimer: Timer?
    private var clockTimer: Timer?
    private var pollTimer: Timer?
    private var lastSeq: Int?

    // Supabase session summary (5 Hz trace + heart rate)
    @Published var cloudStatus: String?
    private var cloudSessionId = ""
    private var hrValues: [Double] = []
    private var traceElev: [Double] = []
    private var traceDir: [Double] = []
    private var traceHr: [Any] = []
    private var tick = 0
    private let pendingKey = "pendingCloudSessions"

    // MARK: - Permissions
    func requestHealthAccess() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        health.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [HKQuantityType(.heartRate)]) { _, _ in }
    }

    // MARK: - Prompt polling (dashboard → watch notification)
    func startPolling() {
        retryPendingUploads()
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { _ in
            Task { @MainActor in await self.poll() }
        }
        Task { await poll() }
    }

    private func poll() async {
        var comps = URLComponents(url: SERVER_URL.appendingPathComponent("watch/prompts"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "after", value: String(lastSeq ?? 0))]
        do {
            let (data, _) = try await URLSession.shared.data(from: comps.url!)
            let r = try JSONDecoder().decode(PromptsResponse.self, from: data)
            serverOK = true
            if lastSeq == nil { lastSeq = r.latestSeq; await loadPlan(); return } // don't replay old prompts
            lastSeq = r.latestSeq
            if let p = r.prompts.last {
                pendingPrompt = p
                if p.title == "New plan approved" {
                    await loadPlan()
                    planIsNew = true
                    WKInterfaceDevice.current().play(.notification)
                }
                if !isRecording { notify(p) }
            }
        } catch {
            serverOK = false
        }
    }

    /// Fetch the approved care plan from the server.
    func loadPlan() async {
        guard let (data, _) = try? await URLSession.shared.data(from: SERVER_URL.appendingPathComponent("plan")),
              let r = try? JSONDecoder().decode(PlanResponse.self, from: data) else { return }
        plan = r.plan
    }

    /// Start one exercise from the plan, with the plan's rep count.
    func startPlanItem(_ item: CarePlan.Item) {
        guard let k = item.kind else { return }
        planIsNew = false
        targetReps = max(3, min(20, item.reps))
        prepare(k)
    }

    private func notify(_ p: Prompt) {
        let kind = ExerciseKind.from(p.title + " " + p.message)
        let c = UNMutableNotificationContent()
        c.title = p.title
        c.subtitle = "\(kind.title) · \(targetReps) reps"
        c.body = p.message
        c.sound = .default
        c.categoryIdentifier = Reminders.promptCategory
        c.threadIdentifier = "mobility"
        c.userInfo = ["kind": kind.rawValue]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: p.id, content: c, trigger: nil))
    }

    // MARK: - Reminders + stats
    func setReminders(on: Bool? = nil, every: Int? = nil) {
        if let on { remindersOn = on; defaults.set(on, forKey: "remindersOn") }
        if let every { remindEvery = every; defaults.set(every, forKey: "remindEvery") }
        if remindersOn { Reminders.schedule(everyHours: remindEvery) } else { Reminders.cancel() }
    }

    static func dayKey(_ d: Date = Date()) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    func loadStats() {
        let today = Self.dayKey()
        let yesterday = Self.dayKey(Calendar.current.date(byAdding: .day, value: -1, to: Date())!)
        todayReps = defaults.string(forKey: "repsDay") == today ? defaults.integer(forKey: "repsToday") : 0
        let last = defaults.string(forKey: "lastActiveDay")
        streak = (last == today || last == yesterday) ? defaults.integer(forKey: "streak") : 0
    }

    private func recordCompletion(reps: Int) {
        guard reps > 0 else { return }
        let today = Self.dayKey()
        let yesterday = Self.dayKey(Calendar.current.date(byAdding: .day, value: -1, to: Date())!)
        if defaults.string(forKey: "repsDay") != today { defaults.set(0, forKey: "repsToday") }
        defaults.set(today, forKey: "repsDay")
        defaults.set(defaults.integer(forKey: "repsToday") + reps, forKey: "repsToday")
        let last = defaults.string(forKey: "lastActiveDay")
        if last == yesterday {
            defaults.set(defaults.integer(forKey: "streak") + 1, forKey: "streak")
        } else if last != today {
            defaults.set(1, forKey: "streak")
        }
        defaults.set(today, forKey: "lastActiveDay")
        loadStats()
    }

    // MARK: - Flow: home → demo → calibrate → live → done

    /// Called from the notification's "Start session" button.
    func startSession(exercise: String) {
        guard !isRecording else { return }
        prepare(ExerciseKind.from(exercise + " " + (pendingPrompt?.message ?? "")))
    }

    /// Show the example rep for the chosen exercise.
    func prepare(_ kind: ExerciseKind) {
        guard !isRecording else { return }
        self.kind = kind
        pendingPrompt = nil
        stage = .demo
    }

    /// "Begin session": start recording, then ask the user to calibrate "straight ahead".
    func begin() {
        guard !isRecording else { return }
        arm.reset(kind: kind)
        samplesSent = 0
        startDate = Date()
        cloudSessionId = UUID().uuidString
        hrValues = []; traceElev = []; traceDir = []; traceHr = []; tick = 0
        cloudStatus = nil
        elapsedText = "0:00"
        stage = .calibrate
        WKInterfaceDevice.current().play(.start)

        let title = "\(kind.title) × \(targetReps)"
        Task {
            if let data = try? await post("session/start", ["by": "watch", "exercise": title]),
               let r = try? JSONDecoder().decode(SessionStartResponse.self, from: data) {
                sessionId = r.active.id
            } else {
                sessionId = "watch-\(Int(Date().timeIntervalSince1970))"
            }
        }
        startWorkout()
        startMotion()
        flushTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            Task { @MainActor in self.flush() }
        }
        clockTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            Task { @MainActor in
                let s = Int(Date().timeIntervalSince(self.startDate))
                self.elapsedText = String(format: "%d:%02d", s / 60, s % 60)
            }
        }
    }

    func stopSession() {
        guard isRecording else { return }
        motion.stopDeviceMotionUpdates()
        flushTimer?.invalidate()
        clockTimer?.invalidate()
        flush()
        workout?.end()
        builder?.endCollection(withEnd: Date()) { _, _ in
            Task { @MainActor in self.builder?.finishWorkout { _, _ in } }
        }
        lastSummary = "\(kind.title): \(arm.reps)/\(targetReps) reps · best \(Int(arm.bestPeak))° · \(elapsedText)"
        recordCompletion(reps: arm.reps)
        Task { _ = try? await post("session/stop", ["by": "watch"]) }
        if arm.calibrated { uploadSession(endedAt: Date()) } // skip sessions cancelled before calibrating
        sessionId = nil
        stage = .done
        WKInterfaceDevice.current().play(.stop)
    }

    func goHome() { stage = .home }

    // MARK: - Sensors

    // Workout session keeps the app running with the wrist down and gives live heart rate.
    private func startWorkout() {
        let config = HKWorkoutConfiguration()
        config.activityType = .functionalStrengthTraining
        config.locationType = .indoor
        do {
            let w = try HKWorkoutSession(healthStore: health, configuration: config)
            let b = w.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: health, workoutConfiguration: config)
            b.delegate = self
            workout = w
            builder = b
            w.startActivity(with: Date())
            b.beginCollection(withStart: Date()) { _, _ in }
        } catch {
            print("Workout failed: \(error)")
        }
    }

    private func startMotion() {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1.0 / 25.0 // 25 Hz
        // z-vertical frame: gives a stable "up" so arm direction can be measured relative to calibration.
        motion.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: .main) { [weak self] m, _ in
            guard let self, let m else { return }
            Task { @MainActor in self.handle(m) }
        }
    }

    private func handle(_ m: CMDeviceMotion) {
        arm.update(m)
        if stage == .calibrate && arm.calibrated { stage = .live }
        if stage == .live && arm.reps >= targetReps {
            WKInterfaceDevice.current().play(.notification)
            stopSession()
            return
        }
        record(m)
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private func record(_ m: CMDeviceMotion) {
        let a = m.userAcceleration, g = m.rotationRate
        var s: [String: Any] = [
            "timestamp": Self.iso.string(from: Date()),
            "accel": ["x": a.x, "y": a.y, "z": a.z],
            "gyro": ["x": g.x, "y": g.y, "z": g.z],
            "source": WATCH_SOURCE,
            "sessionId": sessionId ?? "pending",
            "arm": [
                "exercise": kind.rawValue,
                "elevationDeg": (arm.elevation * 10).rounded() / 10,
                "directionDeg": (arm.plane * 10).rounded() / 10,
                "calibrated": arm.calibrated,
                "reps": arm.reps,
                "targetReps": targetReps
            ]
        ]
        if let hr = heartRate { s["heartRate"] = hr }
        buffer.append(s)

        // 25 Hz → 5 Hz trace for the Supabase summary
        tick += 1
        if tick % 5 == 0 {
            traceElev.append((arm.elevation * 10).rounded() / 10)
            traceDir.append((arm.plane * 10).rounded() / 10)
            traceHr.append(heartRate.map { $0.rounded() as Any } ?? NSNull())
            if let hr = heartRate { hrValues.append(hr) }
        }
    }

    // MARK: - Supabase upload (one summary row per session; same sessionId replaces, so retries are safe)

    private func uploadSession(endedAt: Date) {
        guard supabaseConfigured else { cloudStatus = "Cloud not set up"; return }
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
        if let id = sessionId { body["appSessionId"] = id }
        if !hrValues.isEmpty {
            body["avgHr"] = (hrValues.reduce(0, +) / Double(hrValues.count)).rounded()
            body["maxHr"] = hrValues.max()!.rounded()
            body["minHr"] = hrValues.min()!.rounded()
        }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        cloudStatus = "Saving…"
        Task {
            if await sendToSupabase(data) {
                cloudStatus = "Saved to cloud"
            } else {
                queuePending(data)
                cloudStatus = "Saved on watch, will retry"
            }
        }
    }

    /// Retry sessions that failed to upload earlier (called on launch).
    func retryPendingUploads() {
        guard supabaseConfigured else { return }
        let pending = defaults.array(forKey: pendingKey) as? [Data] ?? []
        guard !pending.isEmpty else { return }
        defaults.removeObject(forKey: pendingKey)
        Task {
            for d in pending where !(await sendToSupabase(Self.withCurrentPatient(d))) { queuePending(d) }
        }
    }

    /// Older queued sessions may carry a previous patient id; re-send them as the current PATIENT_ID.
    private static func withCurrentPatient(_ data: Data) -> Data {
        guard var body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return data }
        body["patientId"] = PATIENT_ID
        return (try? JSONSerialization.data(withJSONObject: body)) ?? data
    }

    private func queuePending(_ data: Data) {
        var pending = defaults.array(forKey: pendingKey) as? [Data] ?? []
        pending.append(data)
        defaults.set(Array(pending.suffix(20)), forKey: pendingKey)
    }

    private func sendToSupabase(_ data: Data) async -> Bool {
        var req = URLRequest(url: SUPABASE_URL.appendingPathComponent("rest/v1/rpc/submit_watch_session"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(SUPABASE_ANON_KEY, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(SUPABASE_ANON_KEY)", forHTTPHeaderField: "Authorization")
        req.httpBody = data
        req.timeoutInterval = 20
        guard let (_, resp) = try? await URLSession.shared.data(for: req) else { return false }
        return (resp as? HTTPURLResponse)?.statusCode == 200
    }

    private func flush() {
        guard !buffer.isEmpty else { return }
        let batch = buffer
        buffer.removeAll()
        Task {
            let tryDirect = Date() >= directDownUntil
            if tryDirect, (try? await post("ingest/batch", ["samples": batch])) != nil {
                samplesSent += batch.count
                serverOK = true
            } else if await relayLive(batch) {
                if tryDirect { directDownUntil = Date().addingTimeInterval(30) }
                // Mac not reachable on this network: relayed through Supabase Realtime instead.
                samplesSent += batch.count
                serverOK = true
            } else {
                serverOK = false
            }
        }
    }

    /// Broadcast live samples on Supabase Realtime channel "watch-live" (the Mac server listens to it).
    private func relayLive(_ batch: [[String: Any]]) async -> Bool {
        guard supabaseConfigured else { return false }
        let body: [String: Any] = ["messages": [["topic": "watch-live", "event": "samples", "payload": ["samples": batch]]]]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return false }
        var req = URLRequest(url: SUPABASE_URL.appendingPathComponent("realtime/v1/api/broadcast"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(SUPABASE_ANON_KEY, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(SUPABASE_ANON_KEY)", forHTTPHeaderField: "Authorization")
        req.httpBody = data
        req.timeoutInterval = 5
        guard let (_, resp) = try? await URLSession.shared.data(for: req) else { return false }
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0) < 300
    }

    @discardableResult
    private func post(_ path: String, _ body: [String: Any]) async throws -> Data {
        var req = URLRequest(url: SERVER_URL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        req.timeoutInterval = 5
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return data
    }
}

extension WatchModel: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let hrType = HKQuantityType(.heartRate)
        guard collectedTypes.contains(hrType),
              let q = workoutBuilder.statistics(for: hrType)?.mostRecentQuantity() else { return }
        let bpm = q.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        Task { @MainActor in self.heartRate = bpm }
    }
}
