import SwiftUI

enum Theme {
    static let accent = Color(red: 0.22, green: 0.74, blue: 0.97)
    static let good = Color(red: 0.13, green: 0.80, blue: 0.40)
    static let warn = Color.orange
    static let background = LinearGradient(colors: [Color(red: 0.04, green: 0.09, blue: 0.20), .black],
                                           startPoint: .top, endPoint: .bottom)

    static func gradient(_ kind: ExerciseKind) -> LinearGradient {
        switch kind {
        case .sideRaise:
            return LinearGradient(colors: [Color(red: 0.16, green: 0.52, blue: 0.98), Color(red: 0.42, green: 0.26, blue: 0.92)],
                                  startPoint: .topLeading, endPoint: .bottomTrailing)
        case .forwardReach:
            return LinearGradient(colors: [Color(red: 0.06, green: 0.74, blue: 0.58), Color(red: 0.10, green: 0.48, blue: 0.86)],
                                  startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    static func color(_ kind: ExerciseKind) -> Color {
        kind == .sideRaise ? Color(red: 0.35, green: 0.45, blue: 0.98) : Color(red: 0.08, green: 0.72, blue: 0.62)
    }
}

/// Circular progress ring with content in the middle.
struct ProgressRing<Content: View>: View {
    var progress: Double
    var color: Color
    var lineWidth: CGFloat = 6
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.2), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0.001, min(1, progress)))
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.spring(response: 0.45, dampingFraction: 0.7), value: progress)
            content()
        }
    }
}

/// Pill-shaped feedback label.
struct HintPill: View {
    var text: String
    var color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity)
            .background(color.opacity(0.22), in: Capsule())
            .foregroundStyle(color == .white ? .white : color)
    }
}
