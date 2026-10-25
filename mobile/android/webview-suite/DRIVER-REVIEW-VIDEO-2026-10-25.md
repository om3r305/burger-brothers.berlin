# Driver FGS review video — 2026-10-25

User explicitly authorized a BlueStacks test-data recording, completion of the Driver FGS declaration and submission for Play review. The user additionally authorized Android UiAutomator after desktop mouse gestures could not open the Android notification shade reliably.

Video: https://drive.google.com/file/d/1Dkx0uNuVByKxnBFKhx74Wa83Y1qfa0YY/view

File: BB-Driver-FGS-Review-Android13-Testdaten.mp4. 32 seconds, 720×1360 H.264, silent, faststart. SHA-256: 7FAB6B8CB3212369BAA5589545FACD72DC1E1131DD3437DE72059026075819EC. Drive metadata and anonymous HTTP 200 verify anyone-with-link reader access, not discoverable in search. No other Drive files were changed.

The continuous successful Android screen recording is trimmed at the beginning/end and has a permanent German simulator caption added below the original screen. It shows actual deployed Driver web UI in the separate .webviewdebug app, test profile App Review, Fahrt starten confirmation, unchanged native location disclosure, Android Home/background state, the real ongoing BB Driver · Live-Standort notification, its actual Stopp action, and disappearance of that notification. Test account identity, one order, API responses and GPS coordinates are explicitly simulated. No production login, customer/order mutation, payment, tracking upload or push subscription is performed. This is an emulator/debug demonstration of the native functionality, not a physical device or Play-installation test.

DriverReviewDemoTest uses the public deployed Driver HTML with an in-memory fetch fixture and native API network blocking. The native NativeBridge and DriverRouteService implementation is unchanged; only its existing DEBUG-only backend/location seams are supplied. Assertions check real service startup, native notification, additional location posts while backgrounded, actual notification PendingIntent Stopp, inactive service, backend stop, and no subsequent posts. Final successful run on BlueStacks Android 13/API 33: OK (1 test), 33.888 seconds. Final source also gates this opt-in recording fixture to Android 13+. Ordinary instrumentation skips it unless bbRecordDriverDemo=true is explicitly supplied.

The first manual/automated rehearsals exposed harness issues (null non-HTTP path, missing Android 13 notification permission, native button text selector, stale notification object after periodic updates, notification shade left open). These rehearsal recordings are local only and were not submitted as proof. The final UiAutomator run passed. Runtime source and signed release AAB contents were not modified by the new test dependency or fixture.

Build: gradlew.bat --no-daemon assembleDriverDebugAndroidTest

Opt-in run (separate debug package only):

    adb -s 127.0.0.1:5555 shell am instrument -w -e class berlin.burgerbrothers.shell.DriverReviewDemoTest -e bbRecordDriverDemo true berlin.burgerbrothers.driver.webviewdebug.test/androidx.test.runner.AndroidJUnitRunner

Evidence: build/driver-review-demo-result.txt and the local visualization artifact directory. Test dependency androidx.test.uiautomator:uiautomator:2.3.0 is androidTestImplementation only. No production environment, payment/operations setting, release signing identity, package ID or AAB changed during this video task.

References: https://developer.android.com/reference/androidx/test/uiautomator/UiDevice and https://support.google.com/googleplay/android-developer/answer/13392821?hl=en-GB . Final Play submission state is recorded separately in the production release report and Console screenshots.
