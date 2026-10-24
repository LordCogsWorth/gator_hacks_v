import SwiftUI

struct ContentView: View {
    @EnvironmentObject var model: WatchModel

    var body: some View {
        switch model.stage {
        case .home: HomeView()
        case .demo: DemoView()
        case .calibrate: CalibrateView(arm: model.arm)
        case .live: LiveView(arm: model.arm)
        case .done: DoneView(arm: model.arm)
        }
    }
}

// MARK: - Home: pick an exercise
struct HomeView: View {
    @EnvironmentObject var model: WatchModel

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("Mobility Lab").font(.headline)
                if let p = model.pendingPrompt {
                    Text(p.title).font(.footnote).bold().multilineTextAlignment(.center)
                }
                ForEach(ExerciseKind.allCases) { k in
                    Button {
                        model.prepare(k)
                    } label: {
                        Label(k.title, systemImage: k.icon).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Stepper("\(model.targetReps) reps", value: $model.targetReps, in: 3...20)
                    .font(.footnote)
                HStack(spacing: 4) {
                    Circle().fill(model.serverOK ? .green : .red).frame(width: 6, height: 6)
                    Text(model.serverOK ? "Dashboard connected" : "Can't reach dashboard")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                if let s = model.lastSummary {
                    Text(s).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
            }
        }
    }
}

// MARK: - Demo: example rep + instructions
struct DemoView: View {
    @EnvironmentObject var model: WatchModel
    private var leftArm: Bool { model.arm.isLeftArm }

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Text(model.kind.title).font(.headline)
                Text("\(model.targetReps) reps · \(leftArm ? "left" : "right") arm").font(.caption).foregroundStyle(.secondary)
                DemoFigure(kind: model.kind, leftArm: leftArm).frame(height: 90)
                Text(model.kind.cue).font(.caption2).multilineTextAlignment(.center)
                Text("Use the arm wearing the watch.").font(.caption2).foregroundStyle(.secondary)
                Button {
                    model.begin()
                } label: {
                    Label("Begin session", systemImage: "play.fill").frame(maxWidth: .infinity)
                }
                .tint(.green)
                Button("Back") { model.goHome() }.font(.footnote)
            }
        }
    }
}

// MARK: - Calibrate "straight ahead"
struct CalibrateView: View {
    @EnvironmentObject var model: WatchModel
    @ObservedObject var arm: ArmTracker

    var body: some View {
        VStack(spacing: 6) {
            Text("Calibrate").font(.headline)
            FigureView(viewpoint: .side, elevation: 90, plane: 0, leftArm: arm.isLeftArm, armColor: .yellow)
                .frame(height: 70)
            Text("Hold your arm straight out in front of you")
                .font(.caption2).multilineTextAlignment(.center)
            ProgressView(value: arm.calibProgress).tint(.green)
            Text("Arm angle \(Int(arm.elevation))°").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
            Button("Cancel", role: .destructive) { model.stopSession() }.font(.footnote)
        }
    }
}

// MARK: - Live tracking
struct LiveView: View {
    @EnvironmentObject var model: WatchModel
    @ObservedObject var arm: ArmTracker

    private var directionText: String {
        guard arm.elevation > 30 else { return "—" }
        if arm.plane < 35 { return "forward" }
        if arm.plane > 55 && arm.plane < 125 { return "side" }
        if arm.plane >= 125 { return "behind" }
        return "diagonal"
    }

    var body: some View {
        VStack(spacing: 2) {
            HStack {
                Text("\(arm.reps)/\(model.targetReps)").font(.title3.bold().monospacedDigit())
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text(model.elapsedText).font(.caption2.monospacedDigit())
                    Text(model.heartRate.map { "♥︎ \(Int($0))" } ?? "♥︎ --").font(.caption2).foregroundStyle(.pink)
                }
            }
            FigureView(viewpoint: model.kind.figureView, elevation: arm.elevation, plane: arm.plane,
                       leftArm: arm.isLeftArm,
                       armColor: arm.reachedTarget ? .green : (arm.elevation > 45 && !model.kind.planeOK(arm.plane) ? .orange : .cyan))
                .frame(height: 80)
            HStack {
                Text("\(Int(arm.elevation))°").font(.footnote.monospacedDigit().bold())
                Spacer()
                Text(directionText).font(.caption2).foregroundStyle(.secondary)
            }
            Text(arm.hint.isEmpty ? model.kind.cue : arm.hint)
                .font(.caption2).lineLimit(2).multilineTextAlignment(.center).frame(minHeight: 24)
            Button(role: .destructive) { model.stopSession() } label: {
                Label("Stop", systemImage: "stop.fill").frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 2)
    }
}

// MARK: - Summary
struct DoneView: View {
    @EnvironmentObject var model: WatchModel
    @ObservedObject var arm: ArmTracker

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Image(systemName: arm.reps >= model.targetReps ? "checkmark.circle.fill" : "flag.checkered")
                    .font(.title).foregroundStyle(.green)
                Text(arm.reps >= model.targetReps ? "Great work!" : "Session ended").font(.headline)
                Text(model.kind.title).font(.caption)
                Text("\(arm.reps)/\(model.targetReps) reps · \(arm.attempts) attempts").font(.caption2)
                Text("Best height \(Int(arm.bestPeak))° · \(model.elapsedText)").font(.caption2).foregroundStyle(.secondary)
                Button("Done") { model.goHome() }.tint(.green)
            }
        }
    }
}
