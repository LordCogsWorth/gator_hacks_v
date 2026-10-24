import Foundation
import CoreMotion
import HealthKit
import UserNotifications
import WatchKit

// Uploads go to Supabase (rpc/submit_watch_session); settings come from Config.swift.
// One summary per session; failed uploads are queued in UserDefaults and retried.

struct Prompt: Decodable { let seq: Int; let id: String; let title: String; let message: String }

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
    private var startDate = Date()
    private var clockTimer: Timer?

    // Supabase session summary (see uploadSession)
    private var cloudSessionId = ""
    private var hrValues: [Double] = []
    private var traceElev: [Double] = []
    private var traceDir: [Double] = []
    private var traceHr: [Any] = []
    private var tick = 0
    private var retrying = false
    private static let pendingKey = "pendingUploads"

    // MARK: - Permissions
    func requestHealthAccess() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        health.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [HKQuantityType(.heartRate)]) { _, _ in }
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
        elapsedText = "0:00"
        stage = .calibrate
        WKInterfaceDevice.current().play(.start)

        cloudSessionId = UUID().uuidString
        hrValues = []; traceElev = []; traceDir = []; traceHr = []; tick = 0
        startWorkout()
        startMotion()
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
        clockTimer?.invalidate()
        workout?.end()
        builder?.endCollection(withEnd: Date()) { _, _ in
            Task { @MainActor in self.builder?.finishWorkout { _, _ in } }
        }
        lastSummary = "\(kind.title): \(arm.reps)/\(targetReps) reps · best \(Int(arm.bestPeak))° · \(elapsedText)"
        recordCompletion(reps: arm.reps)
        if arm.calibrated { uploadSession(endedAt: Date()) } // skip sessions cancelled before calibrating
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

    /// Downsample the arm trace from 25 Hz to 5 Hz for the session summary.
    private func record(_ m: CMDeviceMotion) {
        tick += 1
        guard tick % 5 == 0 else { return }
        traceElev.append((arm.elevation * 10).rounded() / 10)
        traceDir.append((arm.plane * 10).rounded() / 10)
        traceHr.append(heartRate.map { $0.rounded() as Any } ?? NSNull())
        if let hr = heartRate { hrValues.append(hr) }
        samplesSent += 1
    }

    // MARK: - Supabase upload (POST rest/v1/rpc/submit_watch_session)

    private func uploadSession(endedAt: Date) {
        guard Config.isConfigured else { return }
        var body: [String: Any] = [
            "sessionId": cloudSessionId,
            "patientId": Config.patientId,
            "exercise": kind.rawValue, // side_raise is accepted and stored as arm_raise
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
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        Task {
            let status = await send(data)
            serverOK = (200..<300).contains(status)
            lastSummary = (lastSummary ?? "") + (serverOK ? " · saved" : " · not saved")
            if Self.retryable(status) { enqueue(data) }
        }
    }

    /// No connection (0), timeouts, rate limits and server errors are worth retrying;
    /// other 4xx (bad body, unknown patient) never will be.
    private static func retryable(_ status: Int) -> Bool {
        status == 0 || status == 408 || status == 429 || status >= 500
    }

    /// POSTs one summary; returns the HTTP status, or 0 if there was no response.
    private func send(_ data: Data) async -> Int {
        guard let base = Config.supabaseURL else { return 0 }
        var req = URLRequest(url: base.appendingPathComponent("rest/v1/rpc/submit_watch_session"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(Config.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(Config.anonKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = data
        req.timeoutInterval = 20
        guard let result = try? await URLSession.shared.data(for: req),
              let http = result.1 as? HTTPURLResponse else { return 0 }
        return http.statusCode
    }

    private func enqueue(_ data: Data) {
        var queue = defaults.array(forKey: Self.pendingKey) as? [Data] ?? []
        queue.append(data)
        defaults.set(Array(queue.suffix(20)), forKey: Self.pendingKey) // keep the newest 20
    }

    /// Re-send queued session summaries. Safe to repeat: the same sessionId replaces the row.
    func retryPending() {
        guard Config.isConfigured, !retrying else { return }
        let queue = defaults.array(forKey: Self.pendingKey) as? [Data] ?? []
        guard !queue.isEmpty else { return }
        retrying = true
        defaults.removeObject(forKey: Self.pendingKey)
        Task {
            var anyOK = false
            for data in queue {
                let status = await send(data)
                if (200..<300).contains(status) { anyOK = true } else if Self.retryable(status) { enqueue(data) }
            }
            if anyOK { serverOK = true }
            retrying = false
        }
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
