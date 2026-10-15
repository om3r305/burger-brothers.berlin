import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static let pushTokenNotification = Notification.Name("bb.pushToken.updated")
    static var pendingURL: URL?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "bb.apnsToken")
        NotificationCenter.default.post(
            name: Self.pushTokenNotification,
            object: nil,
            userInfo: ["token": token]
        )
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[BB iOS] APNs registration failed: \(error.localizedDescription)")
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // The server sends site-relative paths such as /track/<token>.
        if let raw = response.notification.request.content.userInfo["url"] as? String,
           let url = URL(string: raw, relativeTo: AppConfig.startURL)?.absoluteURL {
            // A cold start from a notification tap can happen before the web
            // view exists; it picks this up instead of the start URL.
            AppDelegate.pendingURL = url
            NotificationCenter.default.post(
                name: WebViewModel.openURLNotification,
                object: nil,
                userInfo: ["url": url]
            )
        }
        completionHandler()
    }
}
