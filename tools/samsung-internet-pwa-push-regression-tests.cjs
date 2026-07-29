const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const compat = read("lib/client/pwa-compat.ts");
const install = read("app/install/page.tsx");
const bootstrap = read("components/CustomerAppBootstrap.tsx");
const generalPush = read("lib/client/general-push.ts");
const adminControls = read("components/admin/AdminPwaControls.tsx");
const adminPush = read("lib/client/admin-push.ts");
const schnellPush = read("lib/client/schnell-push.ts");
const schnellEnter = read(
  "components/schnellbestellung/SchnellEnterClient.tsx",
);

assert.match(compat, /SamsungBrowser\\\//);
assert.match(compat, /SAMSUNG_SAFE_INSTALL_MARKER/);
assert.match(compat, /withPwaStepTimeout/);
assert.match(compat, /PwaStepTimeoutError/);

assert.match(install, /beforeinstallprompt/);
assert.match(install, /device\.isSamsungInternet/);
assert.match(install, /markSamsungSafeInstallIntent/);
assert.match(install, /„Startbildschirm“/);
assert.match(install, /„App installieren“/);
assert.match(install, /await installPrompt\.prompt\(\)/);
assert.match(install, /device\.isIOS/);
assert.match(install, /activateGeneralPushFromGesture\(/);
assert.match(install, /onStage: setPushStage/);
assert.match(install, /PUSH_STAGE_LABELS/);

const samsungBranch = install.indexOf("if (device.isSamsungInternet)");
const normalPrompt = install.indexOf("await installPrompt.prompt()");
assert.ok(samsungBranch >= 0, "Samsung install branch missing");
assert.ok(normalPrompt > samsungBranch, "Working Android prompt path was removed");
assert.match(
  install.slice(samsungBranch, normalPrompt),
  /return;/,
  "Samsung branch must return before the WebAPK install prompt",
);

assert.match(bootstrap, /hasSamsungSafeInstallIntent/);
assert.match(bootstrap, /isSamsungInternetBrowser/);
assert.match(bootstrap, /repairCustomerPushInBackground/);
assert.match(bootstrap, /STAGE_LABELS/);

for (const source of [generalPush, adminPush, schnellPush]) {
  assert.match(source, /permission_timeout/);
  assert.match(source, /service_worker_timeout/);
  assert.match(source, /subscription_timeout/);
  assert.match(source, /withPwaStepTimeout/);
  assert.match(source, /"PushManager" in window/);
}

assert.match(generalPush, /config_timeout/);
assert.match(generalPush, /server_timeout/);
assert.match(generalPush, /ensureCustomerAppPushRegistration/);
assert.match(generalPush, /saveSubscription\(subscription,\s*ALL_GENERAL_PUSH_PREFERENCES/);
assert.match(generalPush, /repairGeneralPushOrderBindingFromLastOrder/);
assert.match(generalPush, /navigator\.serviceWorker\.register\("\/sw\.js"/);

assert.match(adminControls, /isSamsungInternetBrowser/);
assert.match(adminControls, /markAdminSamsungSafeInstallIntent/);
assert.match(adminControls, /Samsung ana ekran/);
assert.match(adminControls, /activateAdminPushFromGesture\(\{/);
assert.match(adminControls, /onStage: setPushStage/);
assert.match(adminControls, /Ana Ekrana Ekle/);
assert.match(adminPush, /navigator\.serviceWorker\.register\("\/admin-sw\.js"/);
assert.match(adminPush, /scope: "\/admin\/"/);

assert.match(schnellPush, /requestSchnellPushPermissionFromGesture/);
assert.match(schnellPush, /bindSchnellPushToOrder/);
assert.match(schnellPush, /SERVER_TIMEOUT_MS/);
assert.match(schnellEnter, /type SchnellPushActivationStage/);
assert.match(schnellEnter, /activateSchnellPushFromGesture\(setPushStage\)/);

for (const source of [install, adminControls]) {
  assert.doesNotMatch(source, /Play Protect.*(?:deaktiv|kapat)/i);
  assert.doesNotMatch(source, /Yine de yükle/i);
}

console.log("Samsung Internet PWA/push compatibility regression tests: OK");
