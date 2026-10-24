import SwiftUI
import UserNotifications

@main
struct MobilityWatchApp: App {
    @WKApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var model = WatchModel.shared

    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(model)
        }
    }
}

final class AppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        Reminders.registerCategories()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            Task { @MainActor in
                let m = WatchModel.shared
                if m.remindersOn { m.setReminders() } // re-schedule in case they were cleared
            }
        }
        Task { @MainActor in
            WatchModel.shared.requestHealthAccess()
            WatchModel.shared.startPolling()
        }
    }

    func applicationDidBecomeActive() {
        Task { @MainActor in WatchModel.shared.loadStats() }
    }

    // Show the banner even when the app is open.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    // Buttons on the notification.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let content = response.notification.request.content
        let action = response.actionIdentifier
        let kindRaw = content.userInfo["kind"] as? String
        let text = content.title + " " + content.body
        Task { @MainActor in
            let m = WatchModel.shared
            switch action {
            case Reminders.startSide: m.prepare(.sideRaise)
            case Reminders.startForward: m.prepare(.forwardReach)
            case Reminders.snoozeId: Reminders.snooze(content)
            case UNNotificationDismissActionIdentifier: break
            default: // "Start session" or tapping the notification itself
                if let kindRaw, let kind = ExerciseKind(rawValue: kindRaw) { m.prepare(kind) }
                else { m.startSession(exercise: text) }
            }
            completionHandler()
        }
    }
}
