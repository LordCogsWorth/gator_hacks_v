import Foundation

/// The two guided exercises the watch can track.
enum ExerciseKind: String, CaseIterable, Identifiable {
    case sideRaise = "side_raise"       // shoulder abduction
    case forwardReach = "forward_reach" // shoulder flexion

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sideRaise: return "Arm raise to side"
        case .forwardReach: return "Forward reach"
        }
    }

    var icon: String {
        switch self {
        case .sideRaise: return "arrow.left.and.right"
        case .forwardReach: return "arrow.forward"
        }
    }

    var cue: String {
        switch self {
        case .sideRaise:
            return "Thumb up. Raise your arm out to the side to shoulder height, then lower slowly."
        case .forwardReach:
            return "Thumb up. Reach straight out in front to shoulder height, then lower slowly."
        }
    }

    /// Ideal direction of the arm, in degrees from "straight ahead" (0 = forward, 90 = out to the side).
    var idealPlane: Double { self == .sideRaise ? 90 : 0 }

    /// Which way the figure is drawn so the movement is visible: front view for side raises, side view for reaches.
    var figureView: FigureView.Viewpoint { self == .sideRaise ? .front : .side }

    /// Is the measured arm direction acceptable for this exercise?
    func planeOK(_ plane: Double) -> Bool {
        self == .sideRaise ? plane >= 50 : plane <= 40
    }

    /// Picks an exercise from a notification title / free text.
    static func from(_ text: String) -> ExerciseKind {
        let t = text.lowercased()
        return t.contains("forward") || t.contains("reach") || t.contains("front") || t.contains("flexion")
            ? .forwardReach : .sideRaise
    }
}

/// Elevation needed to count a rep (shoulder height is 90°).
let REP_TARGET_DEG: Double = 90
let REP_COUNT_DEG: Double = 75
