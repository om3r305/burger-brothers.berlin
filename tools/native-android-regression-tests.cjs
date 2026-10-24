const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("lib/client/native-android.ts", "utf8");
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsObject });
const detect = exportsObject.isNativeAndroidWebView;
for (const kind of ["main", "driver", "schnell"]) assert.equal(detect(`Mozilla/5.0 Android 13 Chrome/130 BurgerBrothers-Android/${kind}`), true);
for (const ua of ["", "Mozilla/5.0 Android 13 Chrome/130", "BurgerBrothers-iOS/main", "BurgerBrothers-Android/other", "BurgerBrothers-Android/mainly", "BurgerBrothers-Android/main-legacy", "BurgerBrothers-Android/main/extra"]) assert.equal(detect(ua), false);
assert.equal(detect(), false, "SSR has no navigator");
console.log("Native Android detection: PASS (installed-app UX, browser fallback, SSR)");
