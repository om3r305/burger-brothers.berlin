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
  "app/api/schnellbestellung/orders/route.ts",
  "app/admin/schnellbestellung/page.tsx",
  "components/schnellbestellung/SchnellClient.tsx",
  "lib/server/schnellbestellung.ts",
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
const checkout = read("app/checkout/page.tsx");

assert(
  checkout.includes("dineIn: false"),
  "Checkout PauseState must initialize dineIn",
);
assert(
  core.includes("Prisma.InputJsonObject[]"),
  "Schnellbestellung campaign metadata must use Prisma JSON input types",
);
assert(
  core.includes("campaignPrice.badgeText ?? null"),
  "Optional campaign badge text must remain valid JSON",
);

assert(core.includes("Serializable"));
assert(core.includes('mode: "dine_in"'));
assert(core.includes('channel: "schnellbestellung"'));
assert(core.includes("idempotencyKey"));
assert(core.includes('path: ["idempotencyKey"]'));
assert(core.includes("heinz\\s+"), "Only plain table ketchup/mayo products should be hidden");
assert(core.includes('qrMode: "static"'));
assert(core.includes('typ: "schnell-static-access"'));
assert(core.includes("getSchnellCampaignPrice"));
assert(core.includes("isComplimentaryTableSauce"));
assert(!client.includes("alert("));
assert(!client.includes("window.confirm("));
assert(client.includes("Bestellung abschließen?"));
assert(client.includes("Zutaten"));
assert(client.includes("Allergene"));
assert(client.includes("product.description"));
assert(client.includes("product.allergens"));
assert(client.includes("bb_schnell_pending_order"));
assert(client.includes("getStableIdempotencyKey"));
assert(success.includes("Bestellung beenden"));

assert(catalog.includes("SCHNELL_CATEGORY_ORDER"));
assert(catalog.includes("allergenHinweise"));
assert(catalog.includes("originalPrice"));
assert(catalog.includes("isComplimentaryTableSauce"));

assert(admin.includes("Statik baskı QR"));
assert(admin.includes("Dinamik ekran QR"));
assert(admin.includes("Schnellbestellung kampanyaları"));
assert(admin.includes("fixed_product"));
assert(adminRoute.includes('requireMutationRole(req, ["admin"])'));
assert(adminRoute.includes('action === "rotate_static_qr"'));
assert(adminRoute.includes('action === "invalidate_sessions"'));

assert(tvDomain.includes("dine_in:"), "TV sound sources must include dine_in");
assert(
  tvDomain.includes('if (order.mode === "dine_in") return "dine_in"'),
  "dine-in orders must use dine_in sound",
);
assert(
  tvDomain.includes('text === "dine_in"'),
  "TV mode normalization must preserve dine_in",
);
assert(tvSoundHook.includes("dineInEnabled"));
assert(tvSoundHook.includes("toggleDineIn"));
assert(tvCard.includes("Kundennummer"));
assert(tvCard.includes("Bestellt um"));
assert(tvOverlay.includes("Schnellbestellung annehmen"));
assert(tvOverlay.includes("Keine Lieferzeit"));
assert(tvPage.includes('const etaMin = dineInMode'));
assert(tvPage.includes('? 0'));
assert(!tvOverlay.includes('dineIn ? 1'), "Dine-in must not use a fake ETA");
assert(ordersList.includes('return "dine_in"'));

assert(pause.includes("dineIn: boolean"));
assert(pauseApi.includes("dineIn: boolean"));
assert(pause.includes("Schnellbestellung vorübergehend pausiert"));

assert(accessRoute.includes('unavailable("disabled")'));
assert(accessRoute.includes('unavailable("paused")'));
assert(accessRoute.includes('"configuration_missing"'));
assert(accessDisplay.includes("PNG herunterladen"));
assert(accessDisplay.includes("SVG herunterladen"));
assert(accessDisplay.includes("Statischer Druck-QR"));
assert(accessDisplay.includes("Lokaler Test:"));

console.log("schnellbestellung regression tests: OK");
