import SwiftUI

struct ContentView: View {
    @EnvironmentObject var model: WatchModel

    var body: some View {
        if model.isRecording {
            RecordingView()
        } else {
            IdleView()
        }
    }
}

struct IdleView: View {
    @EnvironmentObject var model: WatchModel

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("Mobility Lab").font(.headline)
                if let p = model.pendingPrompt {
                    Text(p.title).font(.footnote).bold().multilineTextAlignment(.center)
                    Text(p.message).font(.caption2).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).lineLimit(4)
                }
                Button {
                    model.startSession(exercise: model.pendingPrompt?.title ?? "Mobility session")
                } label: {
                    Label("Start session", systemImage: "play.fill").frame(maxWidth: .infinity)
                }
                .tint(.green)

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

struct RecordingView: View {
    @EnvironmentObject var model: WatchModel

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                Circle().fill(.red).frame(width: 8, height: 8)
                Text("Recording").font(.caption).bold()
                Spacer()
                Text(model.elapsedText).font(.caption.monospacedDigit())
            }
            Text(model.exercise).font(.footnote).lineLimit(2).multilineTextAlignment(.center)
            HStack {
                VStack {
                    Text(model.heartRate.map { "\(Int($0))" } ?? "--").font(.title3.monospacedDigit()).foregroundStyle(.pink)
                    Text("BPM").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                VStack {
                    Text(String(format: "%.2f", model.motionLevel)).font(.title3.monospacedDigit()).foregroundStyle(.cyan)
                    Text("g motion").font(.caption2).foregroundStyle(.secondary)
                }
            }
            Text("\(model.samplesSent) samples sent").font(.caption2).foregroundStyle(.secondary)
            Button(role: .destructive) {
                model.stopSession()
            } label: {
                Label("Stop", systemImage: "stop.fill").frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 4)
    }
}
