const fs = require("fs");
const path = require("path");
const assert = require("assert");
const ts = require("typescript");

const root = process.cwd();
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const files = [
  "components/schnellbestellung/SchnellEnterClient.tsx",
  "components/schnellbestellung/SchnellClient.tsx",
  "lib/server/schnellbestellung.ts",
  "app/api/schnellbestellung/location/verify/route.ts",
  "app/api/schnellbestellung/catalog/route.ts",
  "app/api/schnellbestellung/orders/route.ts",
  "app/api/schnellbestellung/session/route.ts",
];

for (const relative of files) {
  const source = read(relative);
  const result = ts.transpileModule(source, {
    fileName: relative,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      isolatedModules: true,
    },
    reportDiagnostics: true,
  });

  const errors = (result.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );

  assert.equal(
    errors.length,
    0,
    `${relative}: ${errors
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      )
      .join("\n")}`,
  );
}

const enter = read("components/schnellbestellung/SchnellEnterClient.tsx");
const client = read("components/schnellbestellung/SchnellClient.tsx");
const server = read("lib/server/schnellbestellung.ts");
const verify = read(
  "app/api/schnellbestellung/location/verify/route.ts",
);
const catalog = read("app/api/schnellbestellung/catalog/route.ts");
const orders = read("app/api/schnellbestellung/orders/route.ts");
const session = read("app/api/schnellbestellung/session/route.ts");
const manifest = read("app/api/schnellbestellung/manifest/route.ts");

for (const marker of [
  '"android_install"',
  '"android_install_required"',
  "beforeinstallprompt",
  "appinstalled",
  "Burger Brothers installieren",
  "Android-App erforderlich",
  "Installationsanleitung anzeigen",
  "Samsung Internet",
  "androidInstall=1",
]) {
  assert.ok(enter.includes(marker), `Android install marker missing: ${marker}`);
}

assert.ok(
  enter.includes('start(scannedToken, {\n        homeScreen: true,'),
  "installed app scanner must create a Home Screen session",
);
assert.ok(
  enter.includes("if (!isStandalone && isAndroid)"),
  "Android browser gate is missing",
);

const androidBranchIndex = enter.indexOf("if (!isStandalone && isAndroid)");
const desktopBranchIndex = enter.indexOf("if (!isStandalone && !isApple)");
assert.ok(
  androidBranchIndex >= 0 && desktopBranchIndex > androidBranchIndex,
  "Android install gate must run before the retained desktop direct flow",
);

const androidScreen = enter.match(
  /if \(screen === "android_install"\)[\s\S]*?if \(screen === "scanner"\)/,
);
assert.ok(androidScreen, "Android install screen missing");
assert.ok(
  !androidScreen[0].includes("Direkt bestellen"),
  "Android install screen must not offer direct browser ordering",
);

assert.ok(
  client.includes("isAndroidBrowserWithoutInstalledMode"),
  "direct menu Android guard missing",
);
assert.ok(
  client.includes(
    'router.replace("/schnellbestellung/enter?androidInstall=1")',
  ),
  "direct menu does not redirect to install gate",
);
assert.ok(
  client.includes('data.error === "android_install_required"'),
  "menu/order install-required response handling missing",
);

assert.ok(
  server.includes("export function isAndroidUserAgent"),
  "Android user-agent helper missing",
);
assert.ok(
  server.includes("export function schnellSessionIsInstalledApp"),
  "installed-session helper missing",
);
assert.ok(
  server.includes("homeScreen: data.homeScreen === true"),
  "Home Screen claim is not signed into the session",
);

assert.ok(
  verify.includes('error: "android_install_required"'),
  "location verify does not reject Android browser sessions",
);
assert.ok(
  verify.includes("isAndroidUserAgent(req.headers.get"),
  "location verify does not inspect Android requests",
);
assert.ok(
  verify.includes("homeScreen,"),
  "location verify does not preserve Home Screen state",
);

for (const [name, source] of [
  ["catalog", catalog],
  ["orders", orders],
]) {
  assert.ok(
    source.includes("schnellSessionIsInstalledApp(session)"),
    `${name} route does not enforce installed Android session`,
  );
  assert.ok(
    source.includes('error: "android_install_required"'),
    `${name} route does not return install-required`,
  );
}

assert.ok(
  session.includes("installedApp: schnellSessionIsInstalledApp(session)"),
  "session diagnostics do not expose installed-app state",
);
assert.ok(
  session.includes("androidInstallRequired:"),
  "session diagnostics do not expose Android install requirement",
);

assert.ok(
  manifest.includes('display: "standalone"'),
  "Schnell manifest is not installable in standalone mode",
);
assert.ok(
  manifest.includes("start_url: START_URL"),
  "installed app start URL missing",
);

// iOS remains optional and unchanged.
assert.ok(
  enter.includes("Wie möchten Sie auf Ihrem iPhone bestellen?"),
  "iOS choice screen was removed",
);
assert.ok(
  enter.includes("Ohne Installation direkt im Browser fortfahren."),
  "iOS direct-browser option was removed",
);

// Push activation remains available inside the installed app.
assert.ok(
  enter.includes("activateSchnellPushFromGesture"),
  "installed-app push activation was removed",
);
assert.ok(
  enter.includes("Benachrichtigungen aktivieren"),
  "push activation UI was removed",
);

console.log("Android required-install regression tests: OK");
