const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const sources = {
  middleware: read("middleware.ts"),
  settingsSync: read("app/SettingsSync.tsx"),
  statusRoute: read("app/api/shop-status/route.ts"),
  statusReader: read("lib/server/shop-status.ts"),
  orderValidation: read("lib/server/order-validation.ts"),
  schnellOrders: read("app/api/schnellbestellung/orders/route.ts"),
};

for (const [name, source, jsx] of [
  ["middleware.ts", sources.middleware, false],
  ["app/SettingsSync.tsx", sources.settingsSync, true],
  ["app/api/shop-status/route.ts", sources.statusRoute, false],
  ["lib/server/shop-status.ts", sources.statusReader, false],
  ["lib/server/order-validation.ts", sources.orderValidation, false],
  ["app/api/schnellbestellung/orders/route.ts", sources.schnellOrders, false],
]) {
  const result = ts.transpileModule(source, {
    fileName: name,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  });
  const errors = (result.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.strictEqual(
    errors.length,
    0,
    `${name} syntax failed: ${errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join(" | ")}`,
  );
}

assert(
  sources.middleware.includes('"/api/shop-status"') &&
    sources.middleware.includes("maintenancePageResponse") &&
    sources.middleware.includes("maintenanceApiResponse") &&
    sources.middleware.includes("readShopStatus(req)"),
  "Middleware must own the global server-side maintenance gate",
);
assert(
  sources.middleware.includes("!adminPage") &&
    sources.middleware.includes("!adminOk") &&
    sources.middleware.includes('path === "/api/admin/login"') &&
    sources.middleware.includes('path === "/api/stripe/webhook"'),
  "Admin recovery and Stripe webhook must bypass the maintenance gate",
);
assert(
  sources.middleware.includes('path === "/api/orders/create"') &&
    sources.middleware.includes('path === "/api/payments/prepare"') &&
    sources.middleware.includes('path === "/api/schnellbestellung/orders"'),
  "Order/payment routes must use their fresh in-route shop-status checks",
);
assert(
  sources.settingsSync.includes("SHOP_STATUS_REFRESH_MS = 5_000") &&
    sources.settingsSync.includes("/api/shop-status?ts=") &&
    sources.settingsSync.includes('new CustomEvent("bb_settings_changed"'),
  "Open clients must receive the emergency stop without a reload",
);
assert(
  sources.statusRoute.includes('"Cache-Control": "no-store, no-cache, must-revalidate"') &&
    sources.statusRoute.includes("closed: true"),
  "Shop-status endpoint must be no-store and fail closed",
);
assert(
  sources.statusReader.includes('"bb_settings_v6"') &&
    sources.statusReader.includes("getShopStatusFresh") &&
    sources.statusReader.includes("WHOLE_SETTINGS_PRECEDENCE"),
  "Shop status must be read fresh from canonical DB settings",
);
assert(
  sources.orderValidation.includes("getShopStatusFresh(params.tenantId)") &&
    sources.orderValidation.includes('source === "payment_locked"') &&
    sources.orderValidation.includes("pricingLocked === true") &&
    sources.orderValidation.includes('"ORDER_SHOP_STATUS_UNAVAILABLE"'),
  "Checkout must fail closed while preserving verified paid finalization",
);
assert(
  sources.schnellOrders.includes("getShopStatusFresh()") &&
    sources.schnellOrders.includes('error: "SHOP_CLOSED"') &&
    sources.schnellOrders.includes('error: "SHOP_STATUS_UNAVAILABLE"'),
  "Schnellbestellung cash orders must respect the same emergency stop",
);

console.log("Shop-status global gate regression tests passed");
