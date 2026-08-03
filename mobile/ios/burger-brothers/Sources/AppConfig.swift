import Foundation

enum AppConfig {
    static let appSlug = "burger-brothers"
    static let title = "Burger Brothers"
    static let startURL = URL(string: "https://www.burger-brothers.berlin/?source=ios-native")!
    static let userAgentToken = "BBMobile/iOS/burger-brothers/1.0.0"
    static let emulateStandalone = true
    static let allowedHosts: Set<String> = [
        "www.burger-brothers.berlin",
        "burger-brothers.berlin",
        "checkout.stripe.com"
    ]
}
