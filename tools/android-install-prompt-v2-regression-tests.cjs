const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const enterPath = path.join(
  root,
  "components",
  "schnellbestellung",
  "SchnellEnterClient.tsx",
);
const layoutPath = path.join(root, "app", "schnellbestellung", "layout.tsx");

for (const file of [enterPath, layoutPath]) {
  assert.ok(fs.existsSync(file), `missing: ${file}`);
}

const enter = fs.readFileSync(enterPath, "utf8");
const layout = fs.readFileSync(layoutPath, "utf8");

for (const marker of [
  "AndroidInstallWindow",
  "readCapturedAndroidInstallPrompt",
  "storeCapturedAndroidInstallPrompt",
  'const ANDROID_INSTALL_READY_EVENT = "bb:android-install-ready"',
  "Date.now() + 3_500",
  "await prompt.prompt()",
  "await prompt.userChoice",
  '"Burger Brothers installieren"',
]) {
  assert.ok(enter.includes(marker), `missing enter marker: ${marker}`);
}

assert.ok(
  !enter.includes("Installationsanleitung anzeigen"),
  "dead instructions button label still exists",
);
assert.ok(
  enter.includes('const manualInstall = androidInstallState === "manual";'),
  "manual instructions must appear only after a failed native prompt",
);
assert.ok(
  enter.includes('window.addEventListener("beforeinstallprompt"'),
  "component fallback listener missing",
);
assert.ok(
  enter.includes("ANDROID_INSTALL_READY_EVENT"),
  "captured prompt event listener missing",
);
assert.ok(
  enter.includes("if (!isStandalone && isAndroid)"),
  "Android required-install gate was removed",
);
assert.ok(
  !enter.match(
    /if \(screen === "android_install"\)[\s\S]*?Direkt bestellen[\s\S]*?if \(screen === "scanner"\)/,
  ),
  "Android install screen must not offer direct ordering",
);

for (const marker of [
  'import Script from "next/script"',
  'strategy="beforeInteractive"',
  'id="bb-android-install-capture"',
  'window.__bbAndroidInstallPrompt = event',
  'new Event("bb:android-install-ready")',
  "event.preventDefault()",
]) {
  assert.ok(layout.includes(marker), `missing layout marker: ${marker}`);
}

const promptIndex = layout.indexOf('window.addEventListener("beforeinstallprompt"');
const childrenIndex = layout.indexOf("{children}");
assert.ok(
  promptIndex >= 0 && childrenIndex > promptIndex,
  "install prompt capture must be declared before page children",
);

console.log("Android install prompt V2 regression tests: OK");
