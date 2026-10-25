# Android WebView suite

Native Activity + Android System WebView for the three existing applications. The embedded first-party page has no Chrome toolbar, translation prompt or Running in Chrome disclosure. Android system bars remain visible as appropriate. External payment/login links open the browser; physical-device return-flow validation remains required.

| Flavor | Release application ID | Candidate version | Start path |
|---|---|---|---|
| customer | berlin.burgerbrothers.app | 1.1.0 (7) | / |
| driver | berlin.burgerbrothers.driver | 1.1.0 (2) | /driver |
| schnell | berlin.burgerbrothers.schnell | 1.1.0 (4) | /schnellbestellung/enter?homescreen=1 |

Debug IDs append `.webviewdebug` and disable production App Links. They do not overwrite Play installations. WebView does not inherit Chrome cookies; users must log in again.

## Build

Requires JDK 17, Android SDK platform 36, PowerShell and Node dependencies installed at repository root. Gradle 8.11.1 / AGP 8.9.1 / AndroidX WebKit 1.14.0 / Firebase Messaging BOM 34.0.0.

```powershell
./Build.ps1 -JavaHome '<JDK17>' -AndroidSdk '<AndroidSDK>' -UnsignedBundles
./gradlew.bat connectedCustomerDebugAndroidTest connectedDriverDebugAndroidTest connectedSchnellDebugAndroidTest
# Verify existing keystores; prompt securely for passwords, never in chat:
./Prepare-PlayRelease.ps1 -JavaHome '<JDK17>' -AndroidSdk '<AndroidSDK>'
# Without signing:
./Prepare-PlayRelease.ps1 -JavaHome '<JDK17>' -AndroidSdk '<AndroidSDK>' -Unsigned
```

`Prepare-PlayRelease.ps1` keeps package IDs, existing upload keystores and aliases. It checks certificate fingerprints against `play-release-plan.json`, verifies signed AABs, and never generates keys or uploads. Version codes were observed in Play on 2026-10-25; recheck immediately before upload. Upload SHA values are independently extracted from existing local signed AABs; compare with current Play upload certificates before submission. Upload keys and Play app-signing/rotation keys are distinct. Production assetlinks were not modified.

## Signing regressions

```powershell
# Windows PowerShell 5.1: real JDK stderr notices and nonzero exit codes, no keys:
powershell.exe -NoProfile -File ./tests/jdk-tool-output.ps1 -JavaHome '<JDK17>'
# Actual Gradle signing configuration under en_US and tr_TR, dummy env values only:
powershell.exe -NoProfile -File ./tests/signing-locale.ps1 -JavaHome '<JDK17>'
```

The Gradle environment prefix uses `toUpperCase(Locale.ROOT)` so Turkish casing cannot turn DRIVER into a different environment variable name. No JAVA_TOOL_OPTIONS/JDK_JAVA_OPTIONS locale workaround is required. JDK tool diagnostics are captured locally and their exit codes are checked before certificate/signature validation. A benign stderr notice does not count as failure; a nonzero native exit still stops release preparation. The regression restores its temporary environment values and never reads a keystore, signs a bundle or uploads anything.

## Local configuration and secrets

Ignored `firebase-config.properties` contains public Android client configuration only: projectId, senderId, apiKey and customerAppId/driverAppId/schnellAppId. Release bundles fail validation if configuration or version codes are missing. Client API configuration is not a server credential.

Server FCM uses `FIREBASE_SERVICE_ACCOUNT_JSON`. Keep its private key outside Git, APK/AAB, logs and chat. Only the FCM sender role is needed. No server credential or production environment variable has been installed by this change. A missing private-key download currently blocks end-to-end server delivery verification.

Signing reads existing keystores from `%USERPROFILE%/BurgerBrothersKeys`; passwords are prompted with SecureString or supplied through `BB_CUSTOMER_KEYSTORE_PASSWORD`, `BB_DRIVER_KEYSTORE_PASSWORD`, `BB_SCHNELL_KEYSTORE_PASSWORD` and optional corresponding `KEY_PASSWORD` variables. The script restores temporary process variables. Do not put passwords in tracked files.

## Behavior and security

- Exact HTTPS bare/www origins only; main-frame WebMessage bridge, no addJavascriptInterface. Notification URLs are constrained to the correct app route. Invalid or external links cannot execute native actions.
- FCM notification permission and token refresh supported for all three flavors. Customer, authenticated Driver and order-bound Schnell subscriptions are separated. Operational notifications do not enter customer marketing campaigns. Transient deliveries remain queued for the existing protected notification cron; revoked/expired sessions and stale orders are rechecked.
- Schnell entry, installation page and menu all recognize the native app. Ordinary Android browsers retain their installation flow. Browser fixtures test this; live code still requires deployment.
- Driver starts a location foreground service only after visible user consent and runtime permission, for assigned active deliveries. Persistent notification includes Stopp. It stops on logout, route end, revoked session, task removal, extended connection failure or explicit stop. No boot restart or unrestricted ACCESS_BACKGROUND_LOCATION permission.
- Native customer resume/cold start verifies stored payment recovery with the server before returning to the fixed payment center in the same WebView. Invalid/transient access never forces a recovery-page loop. Payment profile recovery remains server-authorized. Provider UI remains external and real 3DS/App Links require release validation.
- Modal Back uses stable data-bb-dialog-close controls before the legacy deployed-web text fallback. Activity/WebView fixture tests cover the close action and native resume signal in every flavor.
- Driver service keeps only the driver session cookie in memory. It uses fixed HTTPS API hosts and server-derived assignments; JS never receives the HttpOnly cookie. Instrumentation uses fake routes and a synthetic Berlin location, without real driver login or live location upload.

## Evidence and remaining release gates

See repository root `ANDROID-WEBVIEW-VALIDATION-2026-10-25.md` and `PLAY-RELEASE-CHECKLIST.md`. Instrumentation XML and lint reports live in ignored `app/build/outputs/` and `app/build/reports/`. Debug APKs and unsigned AABs live in ignored `build/artifacts/`; signed candidates, if built, live in `build/play-candidates/`.

No production deployment or Play release is performed by any of these scripts. A web deployment is required for the bridge-compatible frontend/API code, and a new Android AAB is required to replace the existing TWA binaries. Unsigned bundles are not upload-ready.
