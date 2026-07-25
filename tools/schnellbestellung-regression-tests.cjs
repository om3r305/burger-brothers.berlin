const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const requiredFiles = [
  "app/schnellbestellung/page.tsx",
  "app/schnellbestellung/enter/page.tsx",
  "app/schnellbestellung/success/page.tsx",
  "app/schnellbestellung/access-display/page.tsx",
  "app/api/schnellbestellung/access-token/route.ts",
  "app/api/schnellbestellung/catalog/route.ts",
  "app/api/schnellbestellung/location/verify/route.ts",
  "app/api/schnellbestellung/orders/route.ts",
  "app/api/schnellbestellung/status/route.ts",
  "app/admin/schnellbestellung/page.tsx",
  "components/schnellbestellung/SchnellClient.tsx",
  "lib/server/schnellbestellung.ts",
  "lib/tv/domain.ts",
  "types/tv.ts",
  "app/api/orders/list/route.ts",
  "app/api/orders/status/route.ts",
  "middleware.ts",
  "print-proxy/index.cjs",
];

for (const relativePath of requiredFiles) {
  assert(fs.existsSync(path.join(root, relativePath)), `missing ${relativePath}`);
}

const core = read("lib/server/schnellbestellung.ts");
const accessRoute = read("app/api/schnellbestellung/access-token/route.ts");
const accessDisplay = read("app/schnellbestellung/access-display/page.tsx");
const client = read("components/schnellbestellung/SchnellClient.tsx");
const success = read("app/schnellbestellung/success/page.tsx");
const catalog = read("app/api/schnellbestellung/catalog/route.ts");
const admin = read("app/admin/schnellbestellung/page.tsx");
const adminRoute = read("app/api/admin/schnellbestellung/route.ts");
const tvDomain = read("lib/tv/domain.ts");
const tvSoundHook = read("hooks/tv/use-tv-sound.ts");
const tvCard = read("components/tv/OrderCard.tsx");
const tvOverlay = read("components/tv/AcceptOrderOverlay.tsx");
const pause = read("lib/pause.ts");
const pauseApi = read("app/api/pause/route.ts");
const ordersList = read("app/api/orders/list/route.ts");
const tvPage = read("app/tv/page.tsx");
const ordersStatus = read("app/api/orders/status/route.ts");
const enterPage = read("app/schnellbestellung/enter/page.tsx");
const locationRoute = read("app/api/schnellbestellung/location/verify/route.ts");
const orderRoute = read("app/api/schnellbestellung/orders/route.ts");
const publicStatusRoute = read("app/api/schnellbestellung/status/route.ts");
const middleware = read("middleware.ts");
const tvTypes = read("types/tv.ts");
const printProxy = read("print-proxy/index.cjs");

assert(core.includes("Serializable"));
assert(core.includes('mode: "dine_in"'));
assert(core.includes('channel: "schnellbestellung"'));
assert(core.includes("idempotencyKey"));
assert(core.includes('path: ["idempotencyKey"]'));
assert(core.includes("heinz\\s+"), "Only plain table ketchup/mayo should be hidden");
assert(core.includes('qrMode: "static"'));
assert(core.includes('typ: "schnell-static-access"'));
assert(core.includes("getSchnellCampaignPrice"));
assert(core.includes("isComplimentaryTableSauce"));
assert(core.includes("cleanSchnellGroupVariantName"));
assert(core.includes("stripSchnellGroupPrefix"));
assert(core.includes("prefixPattern"));
assert(
  core.includes('if (variantName) return variantName;'),
  "Group variant cards must use the exact admin Varianten name",
);
assert(core.includes("settings.visibleCategories.length > 0"));
assert(core.includes('fulfillment: takeaway ? "takeaway" : "eat_here"'));
assert(core.includes("timeWarningMinutes"));
assert(core.includes("timeCriticalMinutes"));
assert(core.includes("locationCheckEnabled: false"));

assert(!client.includes("alert("));
assert(!client.includes("window.confirm("));
assert(client.includes("Bestellung abschließen?"));
assert(client.includes("zum Mitnehmen aufgegeben"));
assert(client.includes("zum Verzehr im Restaurant aufgegeben"));
assert(client.includes("Zutaten"));
assert(client.includes("Allergene"));
assert(client.includes("bb_schnell_pending_order"));
assert(client.includes("bb_schnell_order_history_v1"));
assert(client.includes("Letzte Bestellungen"));
assert(client.includes("primeReadyAudio"));
assert(client.includes("__bbSchnellReadyMedia"));
assert(client.includes('new Audio("/sounds/dine-in.wav")'));
assert(client.includes("bb_schnell_catalog_v5"));
assert(!client.includes("bb_schnell_catalog_v4"));
assert(!client.includes("bb_schnell_catalog_v3"));
assert(!client.includes("bb_schnell_catalog_v2"));
assert(!client.includes('fetch("/api/schnellbestellung/session"'));
assert(client.includes('fetch("/api/schnellbestellung/catalog"'));
assert(client.includes("preloadCatalogImages"));
assert(client.includes("CatalogProductImage"));
assert(client.includes("formatCampaignBadge"));
assert(client.includes("🔥"));

assert(success.includes("Seite schließen"));
assert(!success.includes("Neue Bestellung"));
assert(!success.includes('window.location.replace("/")'));
assert(success.includes("wakeLock"));
assert(success.includes("Ihre Bestellung ist fertig!"));
assert(success.includes("playReadyAlert"));
assert(success.includes("roundOffsets"));
assert(success.includes("navigator.vibrate"));
assert(success.includes("lastReadyEventRef"));
assert(success.includes("legacyReadyActiveRef"));
assert(success.includes("playReadyMediaRound"));
assert(success.includes("__bbSchnellReadyMedia"));
assert(success.includes("/api/schnellbestellung/status"));

assert(catalog.includes("SCHNELL_CATEGORY_ORDER"));
assert(catalog.includes("allergenHinweise"));
assert(catalog.includes("originalPrice"));
assert(catalog.includes("loadSchnellCatalogProducts"));
assert(catalog.includes("CATALOG_MEMORY_TTL_MS"));
assert(catalog.includes("campaignActive"));
assert(catalog.includes("Number(right.campaignActive)"));
assert(catalog.includes("takeawayEnabled"));
assert(catalog.includes("orderHistoryEnabled"));
assert(core.includes("SCHNELL_DRINK_GROUPS_KEY"));
assert(core.includes("SCHNELL_EXTRA_GROUPS_KEY"));
assert(core.includes("buildSchnellGroupVariantProducts"));
assert(core.includes("isSchnellGroupVariantId"));

assert(enterPage.includes("requestSession"));
assert(enterPage.includes("location_required"));
assert(locationRoute.includes("!settings.locationCheckEnabled"));
assert(locationRoute.includes("locationSkipped: true"));
assert(orderRoute.includes("settings.locationCheckEnabled"));
assert(orderRoute.includes("takeaway: body.takeaway === true"));

assert(admin.includes("Konum kontrolü aktif"));
assert(admin.includes("Zum Mitnehmen seçimi aktif"));
assert(admin.includes("Telefon hazır uyarısı aktif"));
assert(admin.includes("TV turuncu uyarı başlangıcı"));
assert(admin.includes("Statik baskı QR"));
assert(admin.includes("Dinamik ekran QR"));
assert(admin.includes("Schnellbestellung kampanyaları"));
assert(admin.includes("Hızlı menü kategorileri"));
assert(admin.includes("toggleCategory"));
assert(admin.includes("fixed_product"));
assert(adminRoute.includes('requireMutationRole(req, ["admin"])'));
assert(adminRoute.includes('action === "rotate_static_qr"'));
assert(adminRoute.includes('action === "invalidate_sessions"'));

assert(tvDomain.includes("dine_in:"), "TV sound sources must include dine_in");
assert(tvDomain.includes('if (order.mode === "dine_in") return "dine_in"'));
assert(tvDomain.includes('text === "dine_in"'));
assert(tvSoundHook.includes("dineInEnabled"));
assert(tvSoundHook.includes("toggleDineIn"));
assert(tvCard.includes("Kundennummer"));
assert(tvCard.includes("Bestellt um"));
assert(tvCard.includes("Seit ${ageMinutes} Min."));
assert(tvCard.includes("ZUM MITNEHMEN"));
assert(tvCard.includes("timeWarningMinutes"));
assert(tvCard.includes("timeCriticalMinutes"));
assert(tvOverlay.includes("Schnellbestellung annehmen"));
assert(tvOverlay.includes("Keine Lieferzeit"));
assert(tvPage.includes('const etaMin = dineInMode'));
assert(tvPage.includes("nowMs,"));
assert(tvPage.includes('setView("finished")'));
assert(tvPage.includes("dineInReady"));
assert(tvPage.includes("statusManual: status"));
assert(!tvOverlay.includes("dineIn ? 1"), "Dine-in must not use fake ETA");
assert(ordersList.includes('return "dine_in"'));
assert(ordersList.includes("isSchnellOrderLike"));
assert(tvDomain.includes("isSchnellOrderLike"));
assert(ordersStatus.includes("isSchnellOrderLike"));
assert(ordersStatus.includes("readyEventSequence"));
assert(ordersStatus.includes("readyEventId"));
assert(ordersStatus.includes('previousStatus !== "ready"'));
assert(tvTypes.includes("takeaway?: boolean"));

assert(pause.includes("dineIn: boolean"));
assert(pauseApi.includes("dineIn: boolean"));
assert(pause.includes("Schnellbestellung vorübergehend pausiert"));

assert(accessRoute.includes('unavailable("disabled")'));
assert(accessRoute.includes('unavailable("paused")'));
assert(accessRoute.includes('"configuration_missing"'));
assert(accessDisplay.includes("PNG herunterladen"));
assert(accessDisplay.includes("SVG herunterladen"));
assert(accessDisplay.includes("Statischer Druck-QR"));

assert(publicStatusRoute.includes("order_forbidden"));
assert(publicStatusRoute.includes("liveReadyAlertEnabled"));
assert(publicStatusRoute.includes("readyEventId"));
assert(publicStatusRoute.includes("readyEventSequence"));
assert(middleware.includes('path === "/api/schnellbestellung/status"'));
assert(printProxy.includes("const isTakeaway"));
assert(printProxy.includes("ZUM MITNEHMEN"));
assert(!printProxy.includes("HIER ESSEN"));

console.log("schnellbestellung regression tests: OK");
