# Android WebView suite — test candidate

This is a native Activity + Android System WebView replacement candidate for the current Bubblewrap/TWA apps. There is no Chrome Custom Tab/TWA launch path, browser toolbar, translation UI, or "Running in Chrome" disclosure in the embedded first-party page. Android status/navigation bars still belong to the OS. External links/payment providers intentionally open the system browser; their return flow is not yet release-verified.

## Applications

| Flavor | Existing release ID | Debug test ID | Start path |
|---|---|---|---|
| customer | berlin.burgerbrothers.app | berlin.burgerbrothers.app.webviewdebug | / |
| driver | berlin.burgerbrothers.driver | berlin.burgerbrothers.driver.webviewdebug | /driver |
| schnell | berlin.burgerbrothers.schnell | berlin.burgerbrothers.schnell.webviewdebug | /schnellbestellung/enter?homescreen=1 |

Debug apps are separate installations with production App Links disabled. They do not overwrite the Play apps, certificates, cookies, or cart. WebView cookies do not migrate from Chrome. Driver requires a fresh login. Customer App Links exclude Driver/Schnell paths; shared payment return routing between multiple installed apps remains a release validation item.

## Build and tests (Windows)

Requirements: JDK 17, Android SDK platform 36, compatible build-tools, PowerShell, Node 22 for optional DevTools tests. The pinned Gradle wrapper uses AGP 8.9.1. No Kotlin/AndroidX or third-party native bridge dependency.

```powershell
./Build.ps1 -JavaHome '<JDK 17 directory>' -AndroidSdk '<Android SDK directory>'
# Optional unsigned compile candidates (NOT Play-ready):
./Build.ps1 -JavaHome '<JDK 17 directory>' -AndroidSdk '<Android SDK directory>' -UnsignedBundles
./Test.ps1 -JavaHome '<JDK 17 directory>'
./tests/artifact-smoke.ps1 -Release
```

From repository root:

```powershell
npm ci --include=dev
npm run native-android:test
npm run mobile-dialog:test
npm run checkout:safety:test
npm run schnell:test
npm run prisma:generate
npm run typecheck
npm run build
```

`Build.ps1` builds and lints all three debug variants, runs JVM navigation regression tests, validates merged manifest isolation, and copies debug APKs to ignored `build/artifacts/`. The optional AABs are UNSIGNED with placeholder versionCode 1. Never upload these directly to Play. The task name `sign...ReleaseBundle` in Gradle does not imply that a signing configuration exists.

## Native behavior and security

- Exact HTTPS host allowlist for both site hosts, no cleartext/mixed content, file access/content access disabled, no JavaScript bridge; SSL errors are cancelled.
- JavaScript/DOM storage enabled for the existing Next.js application. User-agent app markers only control installation UX and never authorize server access.
- Insets reserve Android status/navigation/cutout and IME space; normal keyboard resizing on older Android versions.
- Back closes known German dialog controls, otherwise navigates WebView history/finishes the Activity. Only debug builds expose WebView DevTools.
- Contextual camera and foreground location permission requests are restricted to trusted documents/origins. No microphone or background location permission.
- External HTTPS, tel/mail/geo use Android handlers; unsupported schemes including intent/file/data/javascript are blocked. File picker accepts content URIs only.
- German retry UI; no SSL bypass or automatic retry of a POST submission.

## Release blockers — do not treat as a finished migration

1. Android WebView does not provide the existing Web Push experience. Native notification registration/delivery/open handling is not implemented. Existing iOS APNs support is not an Android push implementation. Driver/background/ready-notification requirements must be established and preserved before replacing the Play apps.
2. Deploy and verify the branch's web compatibility changes in a suitable environment before releasing the apps. The current live Schnell page still redirects the WebView to its installation page; the branch adds native detection to entry, client, and installation paths. End-to-end Schnell access/QR/geolocation is not verified.
3. Foreground camera/location permission denial, QR scan, login/session persistence, process recreation, payment/3DS return and app selection across all three packages require device testing. Driver background location/service behavior is not implemented by this shell.
4. Orders were paused on the live site during testing. No restaurant settings were changed. Full Abholung/Lieferung/address/phone/checkout/payment flow was not exercised; no order or payment was created.
5. A physical device/Google Play installation of these new builds has not been tested. BlueStacks Android 13 testing is emulator evidence only. An initial BlueStacks hardware renderer crash (`libhwui`, `!grContext.get()`) occurred; a subsequent start rendered successfully. Do not call this a clean cold-start stability pass.
6. Before a release: fetch current Play version codes, choose higher per-app codes, use the established upload signing configuration securely, retain current Play app-signing/rotation fingerprints in assetlinks, and test an internal Play track with the actual Play signing certificates. This project does not read/change signing keys or assetlinks. Never add debug certificates to production assetlinks.

## Optional emulator layout evidence

Connect an authorized emulator, launch a debug app, forward its `webview_devtools_remote_<pid>` socket to localhost:9223, then:

```powershell
# Customer /menu, order-type dialog open:
node tests/viewport-smoke.mjs
# Product configuration open:
node tests/product-viewport-smoke.mjs
```

These use the Android WebView engine with CDP viewport overrides at 360x640, 360x800, 390x844. They are not three physical phone tests and do not verify the OS keyboard at those sizes. Screenshots/measurements are saved under ignored `build/emulator-evidence/`. `tests/cdp.mjs` is a debug inspection helper, not shipped app code.
