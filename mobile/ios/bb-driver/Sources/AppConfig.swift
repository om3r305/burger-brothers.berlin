import Foundation

enum AppConfig {
    static let appSlug = "bb-driver"
    static let title = "BB Driver"
    static let startURL = URL(string: "https://www.burger-brothers.berlin/driver?source=ios-native")!
    static let userAgentToken = "BBMobile/iOS/bb-driver/1.0.0"
    static let emulateStandalone = true
    static let allowedHosts: Set<String> = [
        "www.burger-brothers.berlin",
        "burger-brothers.berlin",
        "checkout.stripe.com"
    ]
}
