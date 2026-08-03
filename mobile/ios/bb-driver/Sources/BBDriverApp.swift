import SwiftUI

@main
struct BBDriverApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            BBWebView()
                .ignoresSafeArea()
        }
    }
}
