import SwiftUI

@main
struct BurgerBrothersApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            BBWebView()
                .ignoresSafeArea()
        }
    }
}
