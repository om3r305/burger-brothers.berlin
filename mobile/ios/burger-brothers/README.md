# Burger Brothers iOS

- Bundle ID: `berlin.burgerbrothers.app`
- Başlangıç URL: `https://www.burger-brothers.berlin/?source=ios-native`
- Minimum iOS: 16
- Web kabuğu: SwiftUI + WKWebView
- Cookie/session: kalıcı `WKWebsiteDataStore.default()`
- Universal Link: `applinks:www.burger-brothers.berlin`

## Daha sonra etkinleştirme

1. macOS üzerinde Xcode ve XcodeGen kurulur.
2. Bu klasörde `xcodegen generate` çalıştırılır.
3. Xcode'da Apple Team seçilir.
4. Bundle ID Apple Developer hesabında açılır.
5. Kamera/konum izinleri gerçek cihazda test edilir.
6. APNs gerektiğinde `AppDelegate.swift` içindeki hazır noktaya eklenir.

Schnell iOS kabuğu, mevcut web kodunun kurulu uygulama akışını görmesi için
`navigator.standalone=true` değerini belge başlamadan enjekte eder. Böylece mevcut
QR + GPS + HttpOnly session mantığı korunur.
