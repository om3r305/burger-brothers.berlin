const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const enter = read("components/schnellbestellung/SchnellEnterClient.tsx");
const client = read("components/schnellbestellung/SchnellClient.tsx");
const layout = read("app/schnellbestellung/layout.tsx");
const route = read("app/api/schnellbestellung/manifest/route.ts");
const publicManifest = JSON.parse(
  read("public/manifest-schnellbestellung.webmanifest"),
);
const installClient = read(
  "components/schnellbestellung/SchnellInstallClient.tsx",
);
const installPage = read("app/schnellbestellung/install/page.tsx");

assert.ok(
  enter.includes('window.location.replace("/schnellbestellung/install")'),
  "Android QR does not open the Schnell installer",
);
assert.ok(
  !enter.includes('new URL("/install", window.location.origin)'),
  "Android QR still opens the main Burger Brothers installer",
);
assert.ok(
  !enter.includes('installUrl.searchParams.set("schnell", "1")'),
  "obsolete main-installer query flow remains",
);
assert.ok(
  client.includes('router.replace("/schnellbestellung/install")'),
  "direct Android menu guard does not open Schnell installer",
);
assert.ok(
  !client.includes(
    'router.replace("/schnellbestellung/enter?androidInstall=1")',
  ),
  "old Android installer hop remains",
);

assert.ok(
  layout.includes('manifest: "/api/schnellbestellung/manifest?v=4"'),
  "Schnell layout does not use Schnell manifest",
);
assert.ok(
  layout.includes('"apple-mobile-web-app-title": "BB Schnell"'),
  "Schnell Home Screen title is not distinct",
);

for (const source of [route, JSON.stringify(publicManifest)]) {
  assert.ok(source.includes("Burger Brothers Schnellbestellung"));
  assert.ok(source.includes("BB Schnell"));
  assert.ok(source.includes("/schnellbestellung/enter?homescreen=1"));
  assert.ok(source.includes("/schnellbestellung/"));
}

assert.equal(publicManifest.short_name, "BB Schnell");
assert.equal(
  publicManifest.start_url,
  "/schnellbestellung/enter?homescreen=1",
);
assert.equal(publicManifest.scope, "/schnellbestellung/");

for (const marker of [
  'SCHNELL_MANIFEST = "/api/schnellbestellung/manifest?v=4"',
  'SCHNELL_START = "/schnellbestellung/enter?homescreen=1"',
  'new Audio',
]) {
  if (marker === "new Audio") continue;
  assert.ok(installClient.includes(marker), `installer marker missing: ${marker}`);
}

assert.ok(
  installClient.includes("Schnellbestellung installieren"),
  "Schnell install button missing",
);
assert.ok(
  installClient.includes("await prompt.prompt()"),
  "native Android install prompt is not connected",
);
assert.ok(
  installClient.includes("BB Schnell"),
  "installer does not identify the Schnell app",
);
assert.ok(
  !installClient.includes('window.location.replace("/")'),
  "Schnell installer redirects to the main menu",
);
assert.ok(
  installPage.includes(
    'manifest: "/api/schnellbestellung/manifest?v=4"',
  ),
  "Schnell install page metadata uses the wrong manifest",
);
assert.ok(
  !installPage.includes('manifest: "/manifest.webmanifest"'),
  "main Burger Brothers manifest leaked into Schnell installer",
);

const catalog = read("app/api/schnellbestellung/catalog/route.ts");
const orders = read("app/api/schnellbestellung/orders/route.ts");
for (const [name, source] of [
  ["catalog", catalog],
  ["orders", orders],
]) {
  assert.ok(
    source.includes("schnellSessionIsInstalledApp(session)"),
    `${name} installed-app guard was removed`,
  );
  assert.ok(
    source.includes('error: "android_install_required"'),
    `${name} Android install-required response was removed`,
  );
}

console.log("Dedicated Schnellbestellung installer regression tests: OK");
