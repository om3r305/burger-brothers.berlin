import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Native APNs is intentionally not requested automatically.
        // It can be activated later after the Apple Developer account,
        // App ID and server-side device-token endpoint are ready.
        true
    }
}
