import Foundation
import CoreMotion
import WatchKit

/// Turns Core Motion data from the wrist into arm angles and counts reps.
///
/// Orientation model
/// - The watch's x-axis runs along the forearm (crown side → hand for the standard
///   left-wrist / crown-right setup). `handAxisSign` flips it for other wrist/crown setups.
/// - **Elevation** (0° arm down, 90° shoulder height, 180° overhead) is the angle between the
///   hand axis and gravity. It only uses the gravity vector, so it never drifts.
/// - **Direction** (0° straight ahead, 90° out to the side) is the compass-free heading of the
///   hand axis in a z-vertical world frame, measured relative to a "straight ahead" heading
///   captured during calibration (user holds their arm out in front for 1.5 s).
@MainActor
final class ArmTracker: ObservableObject {
    @Published var elevation: Double = 0
    @Published var plane: Double = 90
    @Published var calibrated = false
    @Published var calibProgress: Double = 0
    @Published var reps = 0
    @Published var repPeak: Double = 0
    @Published var bestPeak: Double = 0
    @Published var reachedTarget = false
    @Published var hint = ""
    @Published var attempts = 0

    private(set) var kind: ExerciseKind = .sideRaise
    private var forwardHeading: Double?
    private var calibSum = SIMD2<Double>(0, 0)
    private var calibStart: Date?
    private var up = false
    private var ready = false
    private var planeSum = 0.0
    private var planeN = 0

    func reset(kind: ExerciseKind) {
        self.kind = kind
        elevation = 0
        plane = kind.idealPlane
        calibrated = false
        calibProgress = 0
        reps = 0
        repPeak = 0
        bestPeak = 0
        reachedTarget = false
        hint = ""
        attempts = 0
        forwardHeading = nil
        calibSum = .zero
        calibStart = nil
        up = false
        ready = false
    }

    /// +1 when the device +x axis points toward the hand.
    private var handAxisSign: Double {
        let d = WKInterfaceDevice.current()
        let leftWrist = d.wristLocation == .left
        let crownRight = d.crownOrientation == .right
        return leftWrist == crownRight ? 1 : -1
    }

    var isLeftArm: Bool { WKInterfaceDevice.current().wristLocation == .left }

    func update(_ m: CMDeviceMotion) {
        let s = handAxisSign

        // 1) Elevation from gravity (device frame). Arm hanging → hand points along gravity → 0°.
        let g = m.gravity
        let gLen = max(1e-6, sqrt(g.x * g.x + g.y * g.y + g.z * g.z))
        let cosE = max(-1, min(1, s * g.x / gLen))
        let elev = acos(cosE) * 180 / .pi
        elevation += (elev - elevation) * 0.35

        // 2) Hand axis in the world frame (z up). Core Motion's matrix convention is easy to
        // get backwards, so take whichever of row/column agrees with gravity (world z = -cosE).
        let r = m.attitude.rotationMatrix
        let row = SIMD3(r.m11, r.m12, r.m13) * s
        let col = SIMD3(r.m11, r.m21, r.m31) * s
        let hand = abs(row.z + cosE) <= abs(col.z + cosE) ? row : col
        let horiz = SIMD2(hand.x, hand.y)
        let horizLen = sqrt(horiz.x * horiz.x + horiz.y * horiz.y)
        let headingValid = horizLen > 0.35 // arm at least ~20° away from vertical

        if !calibrated {
            calibrate(headingValid: headingValid, horiz: horiz / max(horizLen, 1e-6))
            return
        }

        if headingValid, let fwd = forwardHeading {
            var d = atan2(horiz.y, horiz.x) - fwd
            while d > .pi { d -= 2 * .pi }
            while d < -.pi { d += 2 * .pi }
            let p = abs(d) * 180 / .pi // 0 forward … 90 side … 180 behind
            plane += (p - plane) * 0.3
        }

        countReps()
    }

    // Hold arm straight out in front (60–120°) and steady for 1.5 s.
    private func calibrate(headingValid: Bool, horiz: SIMD2<Double>) {
        guard headingValid, (60...120).contains(elevation) else {
            calibStart = nil
            calibSum = .zero
            calibProgress = 0
            return
        }
        if calibStart == nil { calibStart = Date() }
        calibSum += horiz
        let t = Date().timeIntervalSince(calibStart!)
        calibProgress = min(1, t / 1.5)
        if t >= 1.5 {
            forwardHeading = atan2(calibSum.y, calibSum.x)
            calibrated = true
            hint = "Lower your arm, then start"
            WKInterfaceDevice.current().play(.success)
        }
    }

    private func countReps() {
        // After calibrating (arm held out front) the arm must come down first,
        // otherwise lowering from the calibration pose would count as a rep.
        if !ready {
            if elevation < 25 { ready = true; hint = kind.cue }
            return
        }
        if !up && elevation > 35 {
            up = true
            repPeak = elevation
            planeSum = 0
            planeN = 0
            reachedTarget = false
            hint = ""
        }
        guard up else { return }

        repPeak = max(repPeak, elevation)
        if elevation > 45 {
            planeSum += plane
            planeN += 1
            if !kind.planeOK(plane) {
                hint = kind == .sideRaise ? "Move more out to the side" : "Bring your arm more in front"
            } else if !reachedTarget {
                hint = "Keep lifting…"
            }
        }
        if !reachedTarget && elevation >= REP_COUNT_DEG {
            reachedTarget = true
            hint = "Now lower slowly"
            WKInterfaceDevice.current().play(.directionUp)
        }

        if elevation < 25 {
            up = false
            attempts += 1
            bestPeak = max(bestPeak, repPeak)
            let avgPlane = planeN > 0 ? planeSum / Double(planeN) : plane
            if repPeak >= REP_COUNT_DEG && kind.planeOK(avgPlane) {
                reps += 1
                hint = "Good rep! (\(Int(repPeak))°)"
                WKInterfaceDevice.current().play(.success)
            } else if !kind.planeOK(avgPlane) {
                hint = kind == .sideRaise ? "That was forward — raise out to the side" : "That was sideways — reach straight ahead"
                WKInterfaceDevice.current().play(.failure)
            } else {
                hint = "Lift higher — aim for shoulder height (\(Int(repPeak))°)"
                WKInterfaceDevice.current().play(.retry)
            }
            reachedTarget = false
        }
    }
}
