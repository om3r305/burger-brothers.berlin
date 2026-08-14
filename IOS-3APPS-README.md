# Burger Brothers — iOS 3 Apps

Üç ayrı iOS uygulaması:

| App | Bundle ID | Start URL |
|---|---|---|
| MAIN | `berlin.burgerbrothers.app` | `/` |
| SCHNELL | `berlin.burgerbrothers.schnell` | `/schnellbestellung` |
| DRIVER/KURIER | `berlin.burgerbrothers.driver` | `/driver` |

Her biri ayrı Bundle ID, ayrı App Store Connect kaydı ve ayrı provisioning profile kullanır.

Dahil:
- SwiftUI + WKWebView
- Native bildirim izin ekranı
- APNs device token
- WebView'e `bb:nativePushToken` eventi
- `appKind`: main / schnell / driver
- native share
- notification settings bridge
- offline banner
- pull-to-refresh
- dış domainleri Safari'de açma
- `macos-26` üzerinde üçlü GitHub Actions CI
- seçilen uygulama için IPA/TestFlight workflow

## Push

iOS App Store uygulamalarında native APNs kullanılacak. Web tarafı şu eventi alabilir:

```js
window.addEventListener("bb:nativePushToken", (event) => {
  console.log(event.detail.token);
  console.log(event.detail.appKind); // main | schnell | driver
});
```

Backend'de sonraki aşamada APNs token kayıt/gönderim API'si eklenmeli.

## GitHub Secrets

Ortak:
- `APPLE_TEAM_ID`
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_P8_BASE64`

Ayrı:
- `IOS_MAIN_PROVISIONING_PROFILE_BASE64`
- `IOS_SCHNELL_PROVISIONING_PROFILE_BASE64`
- `IOS_DRIVER_PROVISIONING_PROFILE_BASE64`

## Kurulum

```powershell
.\APPLY-IOS-3APPS.ps1
```

Mevcut Android, sipariş, ödeme, TV ve Driver web işleyişine dokunmaz.
