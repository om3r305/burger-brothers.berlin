import SwiftUI

@main
struct BBSchnellApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            BBWebView()
                .ignoresSafeArea()
        }
    }
}
