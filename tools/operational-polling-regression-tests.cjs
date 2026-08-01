const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const tvOrders = read("hooks/tv/use-tv-orders.ts");
const tvBrian = read("hooks/tv/use-tv-brian.ts");
const tvProducts = read("hooks/tv/use-tv-products.ts");
const tvSettings = read("hooks/tv/use-tv-settings.ts");
const driverOrders = read("hooks/driver/use-driver-orders.ts");
const driverSettings = read("hooks/driver/use-driver-settings.ts");
const dashboard = read("app/dashboard/page.tsx");
const attention = read("components/admin/AdminAttentionBell.tsx");
const showcase = read("components/showcase/ShowcasePlayer.tsx");
const settingsSync = read("app/SettingsSync.tsx");
const productsSync = read("app/ProductsSync.tsx");
const printAgent = read("print-agent/agent.mjs");

assert.match(tvOrders, /TV_ACTIVE_REFRESH_MS = 5_000/);
assert.match(tvOrders, /TV_IDLE_REFRESH_MS = 8_000/);
assert.match(tvOrders, /TV_HIDDEN_REFRESH_MS = 60_000/);
assert.match(tvOrders, /hasOperationalOrders/);
assert.match(tvOrders, /document\.visibilityState === "visible"/);
assert.match(tvOrders, /window\.addEventListener\("online"/);

assert.match(driverOrders, /if \(!current\?\.id\)/);
assert.match(driverOrders, /DRIVER_IDLE_REFRESH_MS = 15_000/);
assert.match(driverOrders, /DRIVER_HIDDEN_REFRESH_MS = 60_000/);
assert.match(driverOrders, /hasOperationalOrders/);
assert.match(driverOrders, /window\.clearTimeout\(timerId\)/);
assert.doesNotMatch(driverOrders, /window\.setInterval\(\(\) => \{/);

assert.match(tvBrian, /BRIAN_BACKGROUND_REFRESH_MS = 5 \* 60_000/);
assert.match(tvBrian, /document\.visibilityState === "visible"/);
assert.doesNotMatch(tvBrian, /setInterval\(\(\) => void load\(\), 30_000\)/);

assert.match(attention, /ATTENTION_FALLBACK_REFRESH_MS = 2 \* 60_000/);
assert.match(attention, /BB_ADMIN_PUSH/);
assert.match(attention, /document\.visibilityState === "visible"/);
assert.doesNotMatch(attention, /setInterval[\s\S]*30_000/);

assert.match(showcase, /SHOWCASE_EVENT_POLL_MS = 10_000/);
assert.match(showcase, /SHOWCASE_STEADY_REFRESH_MS = 30_000/);
assert.match(showcase, /SHOWCASE_FAST_REFRESH_WINDOW_MS = 2 \* 60_000/);
assert.match(showcase, /document\.visibilityState !== "visible"/);
assert.match(showcase, /knownVersion/);

assert.match(dashboard, /refreshRunningRef/);
assert.match(dashboard, /hasActiveOrders \? 5_000 : 10_000/);
assert.match(dashboard, /document\.visibilityState === "visible"/);

assert.match(settingsSync, /isDedicatedOperationalRoute/);
for (const route of ["/tv", "/driver", "/showcase"]) {
  assert.ok(settingsSync.includes(`"${route}"`));
}

assert.match(productsSync, /isProductIndependentRoute/);
for (const route of ["/tv", "/driver", "/dashboard", "/showcase"]) {
  assert.ok(productsSync.includes(`"${route}"`));
}

assert.match(tvProducts, /TV_PRODUCTS_MIN_REFRESH_GAP_MS = 30_000/);
assert.match(tvSettings, /TV_SETTINGS_MIN_REFRESH_GAP_MS = 30_000/);
assert.match(driverSettings, /DRIVER_SETTINGS_MIN_REFRESH_GAP_MS = 30_000/);

assert.match(printAgent, /pollSeconds: Number\([^\n]+\|\| 5\)/);
assert.match(printAgent, /await sleep\(Math\.max\(1, cfg\.pollSeconds\) \* 1000\)/);

const favicon = path.join(root, "public", "favicon.ico");
assert.ok(fs.existsSync(favicon), "public/favicon.ico must exist");
assert.ok(fs.statSync(favicon).size > 1_000, "favicon must be a real icon");

console.log("operational polling performance regression tests: OK");
