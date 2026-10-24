import Foundation
import CoreMotion
import HealthKit
import UserNotifications

// ⚠️ Set this to the "Watch app server URL" printed when the Node server starts
// (your Mac's Wi-Fi address). The watch and Mac must be on the same network.
let SERVER_URL = URL(string: "http://10.192.252.41:8080")!
let WATCH_SOURCE = "Kyle's Apple Watch"

struct Prompt: Decodable { let seq: Int; let id: String; let title: String; let message: String }
private struct PromptsResponse: Decodable { let latestSeq: Int; let prompts: [Prompt] }
private struct SessionStartResponse: Decodable { struct Active: Decodable { let id: String }; let active: Active }

@MainActor
final class WatchModel: NSObject, ObservableObject {
    static let shared = WatchModel()

    @Published var isRecording = false
    @Published var exercise = ""
    @Published var heartRate: Double?
    @Published var motionLevel: Double = 0
    @Published var samplesSent = 0
    @Published var elapsedText = "0:00"
    @Published var serverOK = false
    @Published var pendingPrompt: Prompt?
    @Published var lastSummary: String?

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
        let hr = HKQuantityType(.heartRate)
        health.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [hr]) { _, _ in }
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
            // First poll: don't replay old prompts, just remember where we are.
            if lastSeq == nil { lastSeq = r.latestSeq; return }
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

    // MARK: - Session
    func startSession(exercise: String) {
        guard !isRecording else { return }
        self.exercise = exercise
        isRecording = true
        samplesSent = 0
        startDate = Date()
        pendingPrompt = nil

        Task {
            let body: [String: Any] = ["by": "watch", "exercise": exercise]
            if let data = try? await post("session/start", body),
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
        isRecording = false
        motion.stopDeviceMotionUpdates()
        flushTimer?.invalidate()
        clockTimer?.invalidate()
        flush()
        workout?.end()
        builder?.endCollection(withEnd: Date()) { _, _ in
            Task { @MainActor in self.builder?.finishWorkout { _, _ in } }
        }
        lastSummary = "Last: \(exercise) · \(elapsedText) · \(samplesSent) samples"
        Task { _ = try? await post("session/stop", ["by": "watch"]) }
        sessionId = nil
    }

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
        motion.startDeviceMotionUpdates(to: .main) { [weak self] m, _ in
            guard let self, let m else { return }
            Task { @MainActor in self.record(m) }
        }
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private func record(_ m: CMDeviceMotion) {
        let a = m.userAcceleration, g = m.rotationRate
        motionLevel = motionLevel * 0.8 + sqrt(a.x * a.x + a.y * a.y + a.z * a.z) * 0.2
        var s: [String: Any] = [
            "timestamp": Self.iso.string(from: Date()),
            "accel": ["x": a.x, "y": a.y, "z": a.z],
            "gyro": ["x": g.x, "y": g.y, "z": g.z],
            "source": WATCH_SOURCE,
            "sessionId": sessionId ?? "pending"
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
