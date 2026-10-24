import Foundation
import CoreMotion
import HealthKit
import UserNotifications
import WatchKit

// ⚠️ Set this to the "Watch app server URL" printed when the Node server starts
// (your Mac's Wi-Fi address). The watch and Mac must be on the same network.
let SERVER_URL = URL(string: "http://10.192.252.41:8080")!
let WATCH_SOURCE = "Kyle's Apple Watch"

struct Prompt: Decodable { let seq: Int; let id: String; let title: String; let message: String }
private struct PromptsResponse: Decodable { let latestSeq: Int; let prompts: [Prompt] }
private struct SessionStartResponse: Decodable { struct Active: Decodable { let id: String }; let active: Active }

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

    let arm = ArmTracker()
    var isRecording: Bool { stage == .calibrate || stage == .live }

    private let motion = CMMotionManager()
    private let health = HKHealthStore()
    private var workout: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var sessionId: String?
    private var startDate = Date()
    private var buffer: [[String: Any]] = []
    private var flushTimer: Timer?
    private var clockTimer: Timer?
    private var pollTimer: Timer?
    private var lastSeq: Int?

    // MARK: - Permissions
    func requestHealthAccess() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        health.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [HKQuantityType(.heartRate)]) { _, _ in }
    }

    // MARK: - Prompt polling (dashboard → watch notification)
    func startPolling() {
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
            if lastSeq == nil { lastSeq = r.latestSeq; return } // don't replay old prompts
            lastSeq = r.latestSeq
            if let p = r.prompts.last {
                pendingPrompt = p
                if !isRecording { notify(p) }
            }
        } catch {
            serverOK = false
        }
    }

    private func notify(_ p: Prompt) {
        let c = UNMutableNotificationContent()
        c.title = p.title
        c.body = p.message
        c.sound = .default
        c.categoryIdentifier = "EXERCISE"
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: p.id, content: c, trigger: nil))
    }

    // MARK: - Flow: home → demo → calibrate → live → done

    /// Called from the notification's "Start session" button.
    func startSession(exercise: String) {
        guard !isRecording else { return }
        prepare(ExerciseKind.from(exercise + " " + (pendingPrompt?.message ?? "")))
    }

    /// Show the example rep for the chosen exercise.
    func prepare(_ kind: ExerciseKind) {
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
        Task { _ = try? await post("session/stop", ["by": "watch"]) }
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
    }

    private func flush() {
        guard !buffer.isEmpty else { return }
        let batch = buffer
        buffer.removeAll()
        Task {
            if (try? await post("ingest/batch", ["samples": batch])) != nil {
                samplesSent += batch.count
                serverOK = true
            } else {
                serverOK = false
            }
        }
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
