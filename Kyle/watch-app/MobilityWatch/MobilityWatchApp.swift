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
        let start = UNNotificationAction(identifier: "START", title: "Start session", options: [.foreground])
        let later = UNNotificationAction(identifier: "LATER", title: "Later", options: [])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "EXERCISE", actions: [start, later], intentIdentifiers: [])
        ])
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        WatchModel.shared.requestHealthAccess()
        WatchModel.shared.startPolling()
    }

    // Show the banner even when the app is open.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    // "Start session" button on the notification.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == "START" || response.actionIdentifier == UNNotificationDefaultActionIdentifier {
            let title = response.notification.request.content.title
            DispatchQueue.main.async { WatchModel.shared.startSession(exercise: title) }
        }
        completionHandler()
    }
}
