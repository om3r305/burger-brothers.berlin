import Foundation

enum AppConfig {
    static let appKind = "driver"
    static let startURL = URL(string: "https://www.burger-brothers.berlin/driver?source=ios-app")!
    /// Flip to true once the backend stores APNs tokens and sends pushes.
    static let nativePushReady = false
}
