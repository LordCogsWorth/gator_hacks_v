import Foundation
import UserNotifications

/// Local notifications scheduled on the watch itself — they fire even when the
/// app is closed and the Mac/dashboard is off.
enum Reminders {
    static let promptCategory = "EXERCISE"   // from the dashboard
    static let reminderCategory = "REMINDER" // scheduled on the watch
    static let startSide = "START_SIDE"
    static let startForward = "START_FORWARD"
    static let start = "START"
    static let snoozeId = "SNOOZE"

    private static let messages: [(String, String, ExerciseKind)] = [
        ("Time to move 💪", "10 side raises keeps your shoulder moving freely.", .sideRaise),
        ("Shoulder check-in", "Two minutes: forward reaches to shoulder height.", .forwardReach),
        ("Quick break?", "Stand up and do 10 arm raises to the side.", .sideRaise),
        ("Keep your streak 🔥", "A short set of forward reaches counts for today.", .forwardReach),
        ("Loosen up", "Slow, controlled side raises — thumb up, shoulder height.", .sideRaise)
    ]

    static func registerCategories() {
        let side = UNNotificationAction(identifier: startSide, title: "↔ Side raise", options: [.foreground])
        let forward = UNNotificationAction(identifier: startForward, title: "→ Forward reach", options: [.foreground])
        let go = UNNotificationAction(identifier: start, title: "▶ Start session", options: [.foreground])
        let snooze = UNNotificationAction(identifier: snoozeId, title: "⏰ In 10 min", options: [])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: promptCategory, actions: [go, snooze], intentIdentifiers: []),
            UNNotificationCategory(identifier: reminderCategory, actions: [side, forward, snooze], intentIdentifiers: [])
        ])
    }

    private static func content(_ i: Int) -> UNMutableNotificationContent {
        let (title, body, kind) = messages[i % messages.count]
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.sound = .default
        c.categoryIdentifier = reminderCategory
        c.threadIdentifier = "mobility"
        c.userInfo = ["kind": kind.rawValue]
        return c
    }

    /// Repeating daily reminders between 9 AM and 9 PM.
    static func schedule(everyHours: Int, from: Int = 9, to: Int = 21) {
        cancel()
        let center = UNUserNotificationCenter.current()
        for (i, hour) in stride(from: from, through: to, by: max(1, everyHours)).enumerated() {
            let trigger = UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: hour, minute: 0), repeats: true)
            center.add(UNNotificationRequest(identifier: "reminder-\(hour)", content: content(i), trigger: trigger))
        }
    }

    static func cancel() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: (0..<24).map { "reminder-\($0)" })
    }

    static func snooze(_ original: UNNotificationContent) {
        guard let c = original.mutableCopy() as? UNMutableNotificationContent else { return }
        c.title = "⏰ " + original.title.replacingOccurrences(of: "⏰ ", with: "")
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 600, repeats: false)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "snooze-\(UUID())", content: c, trigger: trigger))
    }

    /// Fires in 5 seconds — lower your wrist to see it as a real notification.
    static func test() {
        let c = content(Int.random(in: 0..<messages.count))
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "test-\(UUID())", content: c, trigger: trigger))
    }
}
