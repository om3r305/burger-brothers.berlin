const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

function containsInOrder(text, values) {
  let cursor = -1;
  for (const value of values) {
    const next = text.indexOf(value, cursor + 1);
    assert.ok(next > cursor, `Expected ${value} after position ${cursor}`);
    cursor = next;
  }
}

const menu = read("lib/menu-navigation.ts");
containsInOrder(menu, [
  'key: "burger"',
  'key: "vegan"',
  'key: "extras"',
  'key: "drinks"',
  'key: "hotdogs"',
  'key: "sauces"',
  'key: "donuts"',
  'key: "bubbletea"',
]);

const server = read("lib/server/schnellbestellung.ts");
assert.match(server, /MENU_NAV_KEYS/);
assert.match(server, /orderWindowMinutes:\s*15/);
assert.match(server, /orderLimitPolicyVersion:\s*2/);
assert.match(server, /Math\.min\(15,\s*storedOrderWindow\)/);
assert.match(server, /matchingDeviceOrders/);
assert.match(server, /retryAfterSeconds/);
assert.match(server, /Promise\.all\(\[/);

const rewardAudio = read("lib/client/reward-celebration.ts");
const prewarmBody = rewardAudio.match(
  /export function prewarmRewardCelebration\(\) \{([\s\S]*?)\n\}/,
);
assert.ok(prewarmBody, "prewarmRewardCelebration not found");
assert.doesNotMatch(prewarmBody[1], /\.play\(/);
assert.match(rewardAudio, /stopRewardCelebrationSound/);
assert.match(rewardAudio, /primeContextSilently/);

const client = read("components/schnellbestellung/SchnellClient.tsx");
assert.match(client, /loadSchnellCatalog/);
assert.match(client, /stopRewardCelebrationSound\(\);/);
assert.match(client, /retryAfterSeconds/);
assert.doesNotMatch(
  client,
  /fetch\("\/api\/schnellbestellung\/catalog"/,
);

const enter = read(
  "components/schnellbestellung/SchnellEnterClient.tsx",
);
assert.match(enter, /prefetchSchnellCatalog/);
assert.match(enter, /if \(!isStandalone && !isApple\)/);
assert.match(enter, /router\.prefetch\("\/schnellbestellung"\)/);
assert.match(enter, /Promise\.all\(\[\s*loadSessionInfo\(\),\s*resumeActiveOrder\(router\)/);

const scanner = read(
  "components/schnellbestellung/SchnellQrScanner.tsx",
);
assert.match(scanner, /CAMERA_PERMISSION_MARKER/);
assert.match(scanner, /name: "camera" as PermissionName/);
assert.match(scanner, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
assert.match(scanner, /writeCameraPermissionMarker\(true\)/);
assert.doesNotMatch(scanner, /useEffect\(\(\) => \{\s*void startCamera/);

const ordersRoute = read(
  "app/api/schnellbestellung/orders/route.ts",
);
assert.match(ordersRoute, /Retry-After/);
assert.match(ordersRoute, /retryAfterSeconds/);

const admin = read("app/admin/schnellbestellung/page.tsx");
assert.match(admin, /MENU_NAV_ITEMS/);
assert.match(admin, /Önerilen: 15 dakika/);

const celebration = read("components/rewards/RewardCelebration.tsx");
assert.match(celebration, /stopRewardCelebrationSound/);

const catalogHelper = read("lib/client/schnell-catalog.ts");
assert.match(catalogHelper, /__bbSchnellCatalogPromise/);
assert.match(catalogHelper, /REQUEST_TIMEOUT_MS = 10_000/);
assert.match(catalogHelper, /saveBrowserCache/);

console.log("schnell performance/permission regression tests: OK");
