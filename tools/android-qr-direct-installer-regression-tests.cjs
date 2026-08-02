const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();

const enter = fs.readFileSync(
  path.join(root, "components", "schnellbestellung", "SchnellEnterClient.tsx"),
  "utf8",
);
const layout = fs.readFileSync(path.join(root, "app", "layout.tsx"), "utf8");

const androidBranch = enter.match(
  /if \(!isStandalone && isAndroid\) \{[\s\S]*?\n      \}/,
);
assert.ok(androidBranch, "Android browser branch missing");

for (const marker of [
  'new URL("/install", window.location.origin)',
  'installUrl.searchParams.set("schnell", "1")',
  "window.location.replace(",
]) {
  assert.ok(androidBranch[0].includes(marker), `missing Android redirect: ${marker}`);
}

for (const forbidden of [
  'setScreen("android_install")',
  "await start(token",
]) {
  assert.ok(
    !androidBranch[0].includes(forbidden),
    `old custom install flow remains in Android branch: ${forbidden}`,
  );
}

assert.ok(
  enter.includes("if (!isStandalone && !isApple)"),
  "desktop direct flow was removed",
);
assert.ok(
  enter.includes('if (screen === "scanner")'),
  "installed app QR scanner was removed",
);
assert.ok(
  enter.includes("Wie möchten Sie auf Ihrem iPhone bestellen?"),
  "iOS optional choice flow was removed",
);

assert.ok(
  layout.includes('installParams.get("schnell") === "1"'),
  "special Schnell installer is not exempt from legacy home redirect",
);
assert.ok(
  layout.includes('installParams.get("settings") === "1"'),
  "install settings exemption was removed",
);

const clientPath = path.join(
  root,
  "components",
  "schnellbestellung",
  "SchnellClient.tsx",
);
const catalogPath = path.join(
  root,
  "app",
  "api",
  "schnellbestellung",
  "catalog",
  "route.ts",
);
const ordersPath = path.join(
  root,
  "app",
  "api",
  "schnellbestellung",
  "orders",
  "route.ts",
);

for (const file of [clientPath, catalogPath, ordersPath]) {
  assert.ok(fs.existsSync(file), `mandatory-install guard file missing: ${file}`);
}

const client = fs.readFileSync(clientPath, "utf8");
const catalog = fs.readFileSync(catalogPath, "utf8");
const orders = fs.readFileSync(ordersPath, "utf8");

assert.ok(
  client.includes('router.replace("/schnellbestellung/enter?androidInstall=1")'),
  "direct Android menu guard was removed",
);

for (const [name, source] of [
  ["catalog", catalog],
  ["orders", orders],
]) {
  assert.ok(
    source.includes('error: "android_install_required"'),
    `${name} Android server guard was removed`,
  );
  assert.ok(
    source.includes("schnellSessionIsInstalledApp(session)"),
    `${name} installed-session enforcement was removed`,
  );
}

console.log("Android QR direct-installer regression tests: OK");
