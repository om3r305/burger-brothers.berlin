# Android WebView suite - validation 2026-10-25

## Release status

Code and local test candidates are prepared on `codex/android-webview-suite`, based on `2963ea9`. No production deployment, Play upload, policy submission or release was performed. Not fully Play-ready: missing server credential delivery test, secure upload-key signing and physical/internal-track end-to-end validation remain.

The original `C:/Web/burger-github` dirty main worktree was preserved. All work is isolated in `C:/Web/burger-webview`. No AGENTS.md was found. This report supersedes the phase-one limitations in `ANDROID-WEBVIEW-VALIDATION-2026-10-24.md`; the earlier viewport evidence remains relevant.

## Confirmed causes and fixes

- Existing Android binaries use TWA/Chrome. Web metadata cannot remove the browser's Running in Chrome disclosure. The three new binaries use native Activity + Android System WebView. This requires an Android update; no certificate mismatch is asserted as the cause of that disclosure.
- Schnell had separate installation guards at entry, installation and menu. The menu's Android-browser guard still rejected native WebView despite installed-context detection elsewhere. All three now recognize native context; ordinary Android browser and installed PWA behavior remain covered.
- WebView cannot reuse the browser Web Push registration. Added native Firebase token/permission bridge for customer, Driver and Schnell; server FCM HTTP v1 delivery, operational scopes, queued transient retries, credential revocation and order/device checks.
- Driver browser geolocation alone does not provide the intended screen-off route service. Added user-consented location foreground service only in Driver, persistent Stopp action, fixed HTTPS endpoints, authenticated assigned-route checks, automatic stop boundaries. No unrestricted background-location permission or silent boot restart.
- New Driver APIs initially fell through middleware's default admin-only policy. Added exact method/path driver classifications and negative tests.
- Service destruction now queues a stop-only backend update with a captured session cookie; in-flight route responses cannot publish location after destruction. Added instrumentation regression with a blocked route response and explicit stop.
- The earlier modal visible-viewport scrolling fix is retained. Physical keyboard/checkout verification remains incomplete; business pause/hours/payment settings were not changed.

## Code locations

- Native suite: `mobile/android/webview-suite/app/src/`, `app/build.gradle`, `Build.ps1`, `Prepare-PlayRelease.ps1`, `play-release-plan.json`.
- Web bridge and consumers: `lib/client/android-native-bridge.ts`, general/schnell push clients, CustomerAppBootstrap, DriverLiveTracker, NativeDriverNotifications, Driver logout, Schnell gates.
- Server: `lib/server/fcm.ts`, `native-driver-push.ts`, `native-schnell-push.ts`, Driver native API routes, existing push/status/cron routes and middleware.
- Factual German FCM/Driver privacy disclosure: `app/datenschutz/page.tsx`. Store/legal review was not completed or submitted.
- Regressions: `tools/native-android-regression-tests.cjs`, `fcm-regression-tests.cjs`, `native-push-route-tests.cjs`, middleware matrix, Android instrumentation, manifest smoke and 16KB ELF checker.

## Passed verification

| Check | Result |
|---|---|
| npm run typecheck | PASS |
| npm run build, including Next lint/type validation | PASS |
| npm run security:test | PASS, authorization/session/order/pricing/payment/tracking regression suites |
| npm run schnell:test | PASS |
| npm run notifications:test | PASS, existing Web Push/APNs/nearby/deal behavior |
| npm run mobile-dialog:test | PASS, viewport/keyboard simulation/cleanup/swipe/signing rotation |
| npm run native-android:test | PASS, actual Schnell guards and mocked FCM/API/queue behavior |
| Three debug APK + three unsigned release AAB builds | PASS |
| Three Android lint variants | 0 errors, 12 warnings each |
| JVM origin/navigation policy | PASS, 27 cases |
| Compiled manifest isolation, version-code gates, FCM service, Driver-only FGS, no unrestricted background location | PASS |
| 16KB ELF PT_LOAD alignment | PASS, 12 packaged 64-bit libraries across six artifacts |
| zipalign -c -P 16 4 | PASS, all three debug APKs |
| Android 9 BlueStacks connected instrumentation | PASS: customer 1, Driver 6, Schnell 1; zero errors/failures |

The three Firebase instrumentation cases obtained real FCM tokens from the configured project; token values were not printed. The five Driver behavioral cases use fake authenticated routes and a synthetic Berlin location: background continuation with ongoing notification, route-end stop, expired-session stop, notification Stopp, direct stop during an in-flight response, plus notification URL containment (Driver total includes FCM = 6). No real driver login, location transmission, order, payment or campaign was created. Android ddmlib printed a service-list parsing warning on the Android 9 emulator; tests ran and XML shows zero failures.

Android lint warnings concern API-specific attributes, intent-filter clarity, required JavaScript enablement, backup-rule guidance, icon resources/densities/duplicates and a literal native error string. No blanket suppressions were added.

Earlier Android 13/CDP tests covered product/options/local-cart and back/scroll recovery at 360x640, 360x800, 390x844. These are emulator viewport measurements, not real-phone keyboard or actual Play installation proof. The earlier Android 13 emulator renderer crash remains an emulator observation.

## Firebase and signing

Firebase project `burger-brothers-android` contains registrations for the unchanged three release package IDs. Public Firebase client config is ignored locally and does not contain a service-account private key. A narrowly scoped FCM sender service account was created with prior approval.

The first JSON download never appeared locally. The supplied `...-xxxxxxxxxxxx.json` path did not exist, and the user confirmed on 2026-10-25 that no JSON has yet been downloaded. No server private key was read, committed, installed in production, or embedded in an APK. Real server-to-device delivery remains blocked. No additional service-account key was created or deleted during this continuation.

Play observed version maxima: customer 6, Driver 1, Schnell 3. Candidate versions: 1.1.0 / 7, 2, 4 respectively. Package IDs remain `berlin.burgerbrothers.app`, `.driver`, `.schnell`.

Upload SHA-256 values in `play-release-plan.json` were extracted from existing local signed AABs; current Console copy behavior was unreliable across background tabs, so a complete current-Console comparison is NOT claimed. Recompare before submission. Upload and app-signing/rotation keys are distinct. Existing keystores and production assetlinks were not changed. WebView embedding does not require DAL verification, but production App Links still do.

## Remaining release gates

1. User downloads the FCM service-account JSON safely and provides only its local file path. Validate project/role locally and perform real server-to-debug-device delivery without exposing secrets. Configure test environment first; production env changes require approval.
2. Secure local signing using existing upload keystores; passwords through the script's secure terminal prompts. Signed AABs do not exist yet. Current APK/AAB artifacts are debug/unsigned only.
3. Deploy compatible web code to a controlled environment and test integrated Schnell entry/QR/order-ready, authenticated Driver route/notifications and payment/3DS return. No production rollout without approval.
4. Physical-phone/internal-track installation: notification/location grant+deny, keyboard address/phone/footer, small screens, cold/warm start, background delivery/Stopp/logout/route end, App Links with all apps installed. No real kitchen order or payment.
5. Review Data Safety/FGS declarations and pre-launch results; obtain final publication approval.

Both a web rollout and new Android AAB updates are required for the complete change. A web rollout alone cannot replace existing TWA binaries.

## Review artifacts

- Debug APKs and unsigned AABs: `mobile/android/webview-suite/build/artifacts/` (ignored).
- Connected test XML: `mobile/android/webview-suite/app/build/outputs/androidTest-results/connected/debug/flavors/`.
- Lint reports: `mobile/android/webview-suite/app/build/reports/`.
- Test log: `mobile/android/webview-suite/build/final-connected-tests.log`.
- Secure signing instructions and German draft release notes: `mobile/android/webview-suite/README.md`, `PLAY-RELEASE-CHECKLIST.md`.

Technical references: https://firebase.google.com/support/privacy and https://developer.android.com/develop/background-work/services/fgs/service-types#location . These support the technical disclosure/design; no claim of completed legal compliance is made.
