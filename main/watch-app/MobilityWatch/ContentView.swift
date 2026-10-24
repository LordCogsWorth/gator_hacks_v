import SwiftUI

struct ContentView: View {
    @EnvironmentObject var model: WatchModel

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch model.stage {
            case .home: HomeView().transition(.opacity)
            case .demo: DemoView().transition(.move(edge: .trailing).combined(with: .opacity))
            case .calibrate: CalibrateView(arm: model.arm).transition(.opacity)
            case .live: LiveView(arm: model.arm).transition(.scale(scale: 0.9).combined(with: .opacity))
            case .done: DoneView(arm: model.arm).transition(.scale(scale: 0.9).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.3), value: model.stage)
    }
}

// MARK: - Home
struct HomeView: View {
    @EnvironmentObject var model: WatchModel
    @State private var showReminders = false

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                HStack {
                    Label("\(model.streak)", systemImage: "flame.fill")
                        .font(.caption.bold())
                        .foregroundStyle(model.streak > 0 ? .orange : .secondary)
                    Spacer()
                    Text("\(model.todayReps) reps today")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                if let p = model.pendingPrompt {
                    HStack(spacing: 6) {
                        Image(systemName: "bell.badge.fill").foregroundStyle(.yellow)
                        Text(p.title).font(.caption2.bold()).lineLimit(2)
                    }
                    .padding(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.yellow.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))
                }

                ForEach(ExerciseKind.allCases) { k in
                    ExerciseCard(kind: k) { model.prepare(k) }
                }

                HStack {
                    Button { model.targetReps = max(3, model.targetReps - 1) } label: { Image(systemName: "minus") }
                        .buttonStyle(.bordered).frame(width: 40)
                    Spacer()
                    VStack(spacing: 0) {
                        Text("\(model.targetReps)").font(.title3.bold().monospacedDigit())
                            .contentTransition(.numericText())
                            .animation(.snappy, value: model.targetReps)
                        Text("reps").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { model.targetReps = min(20, model.targetReps + 1) } label: { Image(systemName: "plus") }
                        .buttonStyle(.bordered).frame(width: 40)
                }

                Button { showReminders = true } label: {
                    Label(model.remindersOn ? "Every \(model.remindEvery)h" : "Reminders off",
                          systemImage: model.remindersOn ? "bell.fill" : "bell.slash")
                        .font(.footnote)
                }

                HStack(spacing: 4) {
                    Circle().fill(model.serverOK ? Theme.good : .red).frame(width: 6, height: 6)
                    Text(model.serverOK ? "Dashboard connected" : "Dashboard offline")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 2)
        }
        .sheet(isPresented: $showReminders) { ReminderSettingsView() }
    }
}

struct ExerciseCard: View {
    let kind: ExerciseKind
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: kind.icon)
                    .font(.body.bold())
                    .frame(width: 30, height: 30)
                    .background(.white.opacity(0.22), in: Circle())
                VStack(alignment: .leading, spacing: 1) {
                    Text(kind.title).font(.footnote.bold()).lineLimit(1)
                    Text(kind.muscles).font(.caption2).opacity(0.85).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption2.bold()).opacity(0.7)
            }
            .foregroundStyle(.white)
            .padding(10)
            .background(Theme.gradient(kind), in: RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
    }
}

struct ReminderSettingsView: View {
    @EnvironmentObject var model: WatchModel
    @State private var sent = false

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Image(systemName: "bell.badge.fill").font(.title2).foregroundStyle(.yellow)
                Text("Exercise reminders").font(.headline)
                Toggle("Remind me", isOn: Binding(get: { model.remindersOn }, set: { model.setReminders(on: $0) }))
                if model.remindersOn {
                    HStack {
                        ForEach([1, 2, 3, 4], id: \.self) { h in
                            Button("\(h)h") { model.setReminders(every: h) }
                                .buttonStyle(.bordered)
                                .tint(model.remindEvery == h ? .green : .gray)
                        }
                    }
                    Text("Between 9 AM and 9 PM. Tap ↔ or → on the reminder to start straight away.")
                        .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                Button {
                    Reminders.test()
                    sent = true
                } label: {
                    Label(sent ? "Lower your wrist…" : "Test in 5 s", systemImage: "paperplane.fill")
                }
                .tint(Theme.accent)
            }
        }
    }
}

// MARK: - Demo (example rep)
struct DemoView: View {
    @EnvironmentObject var model: WatchModel
    @State private var step = 0
    private let timer = Timer.publish(every: 0.75, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                HStack {
                    Image(systemName: model.kind.icon)
                    Text(model.kind.title).font(.headline).lineLimit(1)
                }
                .foregroundStyle(Theme.color(model.kind))

                Text("\(model.targetReps) reps · \(model.arm.isLeftArm ? "left" : "right") arm")
                    .font(.caption2).foregroundStyle(.secondary)

                DemoFigure(kind: model.kind, leftArm: model.arm.isLeftArm)
                    .frame(height: 92)
                    .padding(.vertical, 4)
                    .background(Theme.gradient(model.kind).opacity(0.25), in: RoundedRectangle(cornerRadius: 14))

                // Step-by-step cue that cycles with the animation
                HStack(spacing: 4) {
                    ForEach(model.kind.steps.indices, id: \.self) { i in
                        Capsule().fill(i == step ? Theme.color(model.kind) : .gray.opacity(0.35))
                            .frame(height: 4)
                    }
                }
                Text(model.kind.steps[step]).font(.footnote.bold())
                    .id(step)
                    .transition(.opacity)

                Button {
                    model.begin()
                } label: {
                    Label("Begin session", systemImage: "play.fill").frame(maxWidth: .infinity).bold()
                }
                .tint(Theme.good)

                Button("Back") { model.goHome() }.font(.footnote).buttonStyle(.plain).foregroundStyle(.secondary)
            }
        }
        .onReceive(timer) { _ in withAnimation { step = (step + 1) % model.kind.steps.count } }
    }
}

// MARK: - Calibrate
struct CalibrateView: View {
    @EnvironmentObject var model: WatchModel
    @ObservedObject var arm: ArmTracker

    var body: some View {
        VStack(spacing: 6) {
            Text("Calibrate").font(.headline)
            ProgressRing(progress: arm.calibProgress, color: Theme.good, lineWidth: 5) {
                FigureView(viewpoint: .side, elevation: arm.elevation, plane: 0, leftArm: arm.isLeftArm,
                           armColor: .yellow, showTarget: true)
                    .padding(14)
            }
            .frame(height: 104)
            Text("Hold your arm straight out **in front**")
                .font(.caption2).multilineTextAlignment(.center)
            Text("\(Int(arm.elevation))°").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            Button("Cancel", role: .destructive) { model.stopSession() }.font(.footnote).buttonStyle(.plain)
        }
    }
}

// MARK: - Live tracking
struct LiveView: View {
    @EnvironmentObject var model: WatchModel
    @ObservedObject var arm: ArmTracker
    @State private var pop = false

    private var wrongWay: Bool { arm.elevation > 45 && !model.kind.planeOK(arm.plane) }
    private var armColor: Color { arm.reachedTarget ? Theme.good : (wrongWay ? Theme.warn : Theme.accent) }
    private var hintColor: Color {
        if arm.hint.hasPrefix("Good") { return Theme.good }
        if wrongWay || arm.hint.contains("forward") || arm.hint.contains("sideways") || arm.hint.contains("higher") { return Theme.warn }
        return .white
    }

    var body: some View {
        VStack(spacing: 3) {
            HStack(alignment: .center) {
                ProgressRing(progress: Double(arm.reps) / Double(max(1, model.targetReps)),
                             color: Theme.color(model.kind), lineWidth: 4) {
                    Text("\(arm.reps)")
                        .font(.system(.body, design: .rounded).bold().monospacedDigit())
                        .contentTransition(.numericText())
                        .scaleEffect(pop ? 1.35 : 1)
                }
                .frame(width: 38, height: 38)
                VStack(alignment: .leading, spacing: 0) {
                    Text("of \(model.targetReps)").font(.caption2).foregroundStyle(.secondary)
                    Text(model.elapsedText).font(.caption2.monospacedDigit())
                }
                Spacer()
                Label(model.heartRate.map { "\(Int($0))" } ?? "--", systemImage: "heart.fill")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.pink)
                    .symbolEffect(.pulse, isActive: model.heartRate != nil)
            }

            ZStack(alignment: .topTrailing) {
                FigureView(viewpoint: model.kind.figureView, elevation: arm.elevation, plane: arm.plane,
                           leftArm: arm.isLeftArm, armColor: armColor)
                Text("\(Int(arm.elevation))°")
                    .font(.system(.title3, design: .rounded).bold().monospacedDigit())
                    .foregroundStyle(armColor)
            }
            .frame(height: 74)

            Gauge(value: min(arm.elevation, 120), in: 0...120) { EmptyView() }
                .gaugeStyle(.accessoryLinear)
                .tint(Gradient(colors: [Theme.accent, Theme.accent, Theme.good]))

            HintPill(text: arm.hint.isEmpty ? model.kind.cue : arm.hint, color: hintColor)

            Button(role: .destructive) { model.stopSession() } label: {
                Image(systemName: "stop.fill")
            }
            .buttonStyle(.bordered)
            .frame(height: 30)
        }
        .padding(.horizontal, 2)
        .onChange(of: arm.reps) { _, _ in
            withAnimation(.spring(response: 0.25, dampingFraction: 0.5)) { pop = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { withAnimation(.spring) { pop = false } }
        }
    }
}

// MARK: - Done
struct DoneView: View {
    @EnvironmentObject var model: WatchModel
    @ObservedObject var arm: ArmTracker
    @State private var bounce = 0

    private var finished: Bool { arm.reps >= model.targetReps }

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                ProgressRing(progress: Double(arm.reps) / Double(max(1, model.targetReps)),
                             color: finished ? Theme.good : Theme.color(model.kind), lineWidth: 6) {
                    Image(systemName: finished ? "checkmark" : "flag.checkered")
                        .font(.title2.bold())
                        .foregroundStyle(finished ? Theme.good : .white)
                        .symbolEffect(.bounce, value: bounce)
                }
                .frame(width: 70, height: 70)

                Text(finished ? "Great work!" : "Nice effort").font(.headline)
                Text(model.kind.title).font(.caption).foregroundStyle(Theme.color(model.kind))

                HStack {
                    stat("\(arm.reps)/\(model.targetReps)", "reps")
                    stat("\(Int(arm.bestPeak))°", "best")
                    stat(model.elapsedText, "time")
                }

                if model.streak > 0 {
                    Label("\(model.streak)-day streak", systemImage: "flame.fill")
                        .font(.caption.bold()).foregroundStyle(.orange)
                }

                Button {
                    model.prepare(model.kind)
                } label: {
                    Label("Go again", systemImage: "arrow.clockwise").frame(maxWidth: .infinity)
                }
                .tint(Theme.color(model.kind))
                Button("Done") { model.goHome() }.font(.footnote).buttonStyle(.plain).foregroundStyle(.secondary)
            }
        }
        .onAppear { bounce += 1 }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 0) {
            Text(value).font(.footnote.bold().monospacedDigit()).lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
