import Foundation

enum AppConfig {
    static let appSlug = "bb-schnell"
    static let title = "BB Schnell"
    static let startURL = URL(string: "https://www.burger-brothers.berlin/schnellbestellung/enter?homescreen=1&source=ios-native")!
    static let userAgentToken = "BBMobile/iOS/bb-schnell/1.0.0"
    static let emulateStandalone = true
    static let allowedHosts: Set<String> = [
        "www.burger-brothers.berlin",
        "burger-brothers.berlin",
        "checkout.stripe.com"
    ]
}
