# Android WebView suite - validation 2026-10-25

## Release status

Code and local test candidates are prepared on `codex/android-webview-suite`, based on `2963ea9`. No production deployment, Play upload, policy submission or release was performed. Not fully Play-ready: compatible web rollout/production configuration and physical/internal-track end-to-end validation remain. Local real FCM delivery has now passed for all three debug apps; see the latest section below. The signed candidates were subsequently independently verified; see the latest signing verification section below.

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

## Independent Claude review - 2026-10-25

At the user's explicit request, Codex contacted the already open Burger Brothers Claude Code session through its desktop UI. Shared only repository paths, public app/service-account identifiers, test status and review questions; no private keys, passwords or FCM tokens. Claude confirmed it did not edit either worktree and has no local FCM JSON.

- Payment/3DS external-browser return remains a valid release gate. No payment-provider domains were added to the privileged native bridge trust list.
- Suggested customer App Links collision was checked against the customer manifest overlay: `app/src/customer/AndroidManifest.xml` replaces the shared alias with exact root plus explicit customer prefixes. Compiled-manifest smoke already passed; the proposed root-prefix collision does not apply to that merged release manifest.
- Driver empty-subject access already fails closed in the authenticated session validator. Added an explicit 401 guard in both native route handlers as defense in depth and reused the shared `orderAssignedToDriver` domain helper. New empty-subject GET/POST regressions, `npm run native-android:test` and `npm run typecheck` passed after this change.
- At that review, native modal Back used German close-button text and an Escape fallback. This text-coupling limitation is resolved in the continuation below; no claim of universal third-party modal coverage is made.

Findings and corrections were sent back to Claude through the same session. No production or Play publication was authorized by the review exchange.

## Final code/test continuation and Claude handoff

User explicitly delegated Firebase and signing to the already open Claude session. Codex sent the task, exact per-app key plan, secret-handling requirements and build coordination boundaries through that session. Claude independently confirmed the three existing local signed AAB upload fingerprints match `play-release-plan.json`; direct current-Console upload-certificate comparison was still unavailable. Claude has no private Firebase JSON or upload-keystore passwords. No key was deleted and no production/Play state was changed.

Additional code completed:

- Added `lib/client/native-payment-recovery.ts` and mounted it in CustomerAppBootstrap. MainActivity/NativeBridge emits `bb:nativeResume`. A native customer app on resume, visibility restoration or cold start checks its existing recovery candidate against the authenticated recovery API before navigating to a fixed same-origin payment center. Stored manageUrl/paid claims never control navigation. Invalid/unknown responses, 403/404, throttling and service failures do not displace the current screen or destroy recovery. Live payment/action/split pages and operational apps retain their own flows. In-flight checks are bounded, deduplicated, aborted on cleanup and ignored if the candidate/page changed.
- Payment center can reclaim the existing server-authorized payment profile using the recovery token after confirmed finalization, including manual return from the external browser without a Checkout Session ID in the URL.
- Added `DialogBackScript.java` and stable data-bb-dialog-close controls to the product, variants, cart, checkout and notification prompt. Back closes the top visible modal independently of German wording. Hidden/disabled controls are ignored; old deployed web retains the text fallback. A modal consumes Back while its Escape handler settles, preventing navigation underneath it.
- The external payment provider remains in the system browser; app re-entry/cold-start recovery is covered, but automatic App Link return, real Stripe/3DS and physical-device flows still require controlled release validation. No payment provider domain was added to native bridge trust.

Final verification after these changes:

| Check | Result |
|---|---|
| Native Android regression command (now includes payment recovery and actual shipped Back script) | PASS |
| Payment recovery mocked lifecycle/transport | PASS: server verification, invalid/transient responses, fixed origin, single flight, candidate replacement, abort/cleanup, browser isolation |
| Back JavaScript executed from Java source | PASS: changed captions, topmost modal, hidden/disabled controls, legacy web, Escape containment |
| Typecheck / production web build | PASS |
| checkout:safety:test / payment center architecture | PASS |
| mobile-dialog:test / schnell:test | PASS |
| Three APKs and unsigned release AABs / lint / manifest isolation | PASS; lint remains 0 errors, 12 warnings per variant |
| Android 9 connected instrumentation, final full run | PASS: customer 3, Driver 8, Schnell 3; 14 total, zero failures/errors |
| Final APK ZIP and 64-bit ELF 16KB alignment | PASS |

Six new connected cases run on actual Android Activity/WebView instances using an in-memory first-party HTML fixture: marked modal Back and native resume event for each flavor. Initial fixture historyUrl=null caused the origin guard to reject its blank URL; the fixture now supplies an explicit trusted history URL and asserts it before testing. The final full run passed. This fixture does not perform a real payment, login, order or server mutation.

`Prepare-PlayRelease.ps1 -Unsigned` rebuilt/refreshed the final ignored artifact directory and versioned candidates: bb-customer-v7-UNSIGNED.aab, bb-driver-v2-UNSIGNED.aab, bb-schnell-v4-UNSIGNED.aab. These are not signed/upload-ready. Connected XML and `build/final-connected-tests.log`, `build/final-web-build.log`, `build/final-candidates.log` contain local evidence.

Claude is responsible for the remaining Firebase download/metadata validation and secure local signing handoff. Missing private JSON, secure password entry and real-device/internal-track validation remain release gates; delegation does not establish that these steps succeeded. Existing business settings and live payment configuration were preserved.

## Claude final review and signing blocker

Claude received commit `f8e2345`, reviewed the final server-confirmed recovery change and reported no remaining critical code finding. The valid still-open-payment resume remains intentional duplicate-order protection; real provider/physical-device release tests remain outstanding.

Claude attempted to start the prepared signing command in its user-visible terminal. Its tool returned Blocked; Claude reported that its automatic security review treated this as release preparation and rejected command startup. No signed candidate was produced. Codex did not retry that blocked action through another surface. The three final files remain explicitly named UNSIGNED. Firebase private JSON and secure local password entry remain missing. The user-owned secure handoff was described in Claude's session; no password or private-key content was requested in chat.

The latest inspected artifact directory contains only bb-customer-v7-UNSIGNED.aab, bb-driver-v2-UNSIGNED.aab and bb-schnell-v4-UNSIGNED.aab. No deployment or Play publication occurred. Code/test completion does not mean the complete release gates have passed.

## Signing locale and PowerShell diagnostic fix

After Claude's report, `app/build.gradle` now imports `java.util.Locale` and builds signing environment prefixes with `kind.toUpperCase(Locale.ROOT)`. Actual Gradle configuration using dummy-only environment values reproduced `Missing signing environment for driver` under a Turkish JVM before the fix (English passed). After the fix, the assertions passed under both en_US and tr_TR without JAVA_TOOL_OPTIONS or JDK_JAVA_OPTIONS. The test verifies the JVM's actual default locale and all three flavor/signing-config mappings; it does not run signing or bundle tasks.

`Prepare-PlayRelease.ps1` now calls `JdkTools.ps1` to capture keytool/jarsigner diagnostics without Windows PowerShell 5.1 treating stderr notices as terminating NativeCommandError. Native exit codes and certificate/signature matching remain mandatory; the final printcert exit code is now checked too. The helper temporarily scopes ErrorActionPreference and restores it. A real JDK-tool regression under Windows PowerShell 5.1 passed with a harmless JAVA_TOOL_OPTIONS fixture: both keytool/jarsigner help commands emitted their stderr startup notice and returned success; an invalid keytool command retained a failing exit code. No private key, password, actual signing, deployment or Play upload was involved in these tests.

New regressions: `mobile/android/webview-suite/tests/signing-locale.ps1` and `tests/jdk-tool-output.ps1`. Existing certificates, keystore aliases and app/rotation signing identities are unchanged. These fixes remove toolchain blockers; they do not prove that final signed AABs or real FCM delivery have been completed.

## Latest signed-candidate verification

Claude subsequently produced the three signed candidates using its JDK_JAVA_OPTIONS workaround, before the permanent locale/tool-output fix. Codex independently read these existing files with jarsigner/keytool through the new helper. Every file returned a successful signature verification and matched its exact upload SHA-256 in `play-release-plan.json`. No signing or upload was performed by this verification.

| Candidate | Signature / planned upload certificate | File SHA-256 |
|---|---|---|
| bb-customer-v7-SIGNED.aab | PASS / MATCH | 119D9D357BA4C779FC4AAC0374CE343AC68552706CA33FFD830F3F4B250796DB |
| bb-driver-v2-SIGNED.aab | PASS / MATCH | 95A9B1B174E13E3A18C15BD67FD7D6DC26BEA4FA96DCCF6D6A1FFCF2155847F1 |
| bb-schnell-v4-SIGNED.aab | PASS / MATCH | C3DB201B2034B4538836A0159B6E732DFE9590C2F5249C9016D3527793AD3CB1 |

Directory: `mobile/android/webview-suite/build/play-candidates/`. Permanent toolchain fix: `1134b2c`. App source behavior is unchanged by that fix. This supersedes earlier unsigned-only/signing-blocker status; earlier entries describe the state at those points. Direct current-Console comparison, real FCM server delivery, compatible web rollout and physical/internal-track end-to-end gates remain outstanding. These signatures alone do not establish full release readiness. No production deployment or Play publication was performed.

## Real local FCM delivery - 2026-10-25

The user supplied a private service-account JSON file outside the repository. The local sender validated service_account type, project burger-brothers-android and the approved bb-fcm-sender service account. Its private key was read only into the local sender's memory to sign the OAuth assertion; no private-key contents, OAuth token or plaintext device token was logged, committed or embedded in an Android artifact. No production environment variable was changed.

Using the actual `lib/server/fcm.ts` implementation, six real HTTP v1 messages were sent through Google FCM to the emulator's separate debug packages. Every send returned HTTP 200. Instrumentation independently checked the delivered notification title/body/channel, foreground native renderer versus Firebase background system-tray renderer, and notification PendingIntent returning to the correct package and first-party route.

| Debug application | Foreground delivery + tap | Background delivery + tap |
|---|---|---|
| berlin.burgerbrothers.app.webviewdebug | PASS | PASS |
| berlin.burgerbrothers.driver.webviewdebug | PASS | PASS |
| berlin.burgerbrothers.schnell.webviewdebug | PASS | PASS |

Device: BlueStacks Android 9 / API 28 emulator, not a physical phone or a Google Play installation. The foreground case uses the app's real FirebaseMessagingService; the background case uses the pinned Firebase SDK's notification renderer and launcher extras. German test content was explicitly labeled a local test with no order. No production subscription, customer campaign, real order, payment or Driver location upload was created.

The emulator's run-as interface did not permit file access. The opt-in instrumentation instead obtains its own app's token through the Firebase SDK and encrypts it for an ephemeral host-owned RSA key using RSA-OAEP + AES-GCM. Only encrypted test status is transferred; the plaintext token is decrypted and used inside the local sender process. This uses no device-root or file-permission change. Ordinary connected tests skip this case unless the explicit live-test arguments are supplied.

New reusable test sources:
- `tools/test-native-fcm-delivery.cjs`: installs only the three fixed .webviewdebug packages, loads the external JSON only in memory, sends six test messages and writes a sanitized result report.
- `app/src/androidTest/.../FcmDeliveryTest.java`: opt-in real receipt, channel, foreground/background route and notification-tap checks. No change to release application code was required.

Final machine-readable evidence: `mobile/android/webview-suite/build/fcm-live-delivery.json` (ignored, contains only public test metadata and six PASS outcomes). Instrumentation APK compilation and Node syntax checks passed. The signed release AABs previously verified remain unchanged because this continuation added only test sources and documentation.

This supersedes earlier missing-JSON/local-delivery blockers. Production FIREBASE_SERVICE_ACCOUNT_JSON, compatible web rollout, actual web API/subscription/queue integration on a controlled deployed environment, Android 13+ notification permission acceptance/denial and physical/internal-track checkout/Driver/QR flows remain to be validated before production publication. The old unused service-account key was not deleted; no production deployment or Play publication was performed.

Technical references used for test expectations: https://firebase.google.com/docs/cloud-messaging/android/receive-messages and https://firebase.google.com/docs/cloud-messaging/send/v1-api .
