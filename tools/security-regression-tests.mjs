import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(relative) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) {
    failures.push(`missing file: ${relative}`);
    return "";
  }
  return fs.readFileSync(full, "utf8");
}

function requireText(relative, text, message) {
  const source = read(relative);
  if (!source.includes(text)) failures.push(message || `${relative} missing ${text}`);
}

function rejectPattern(relative, pattern, message) {
  const source = read(relative);
  if (pattern.test(source)) failures.push(message || `${relative} matched ${pattern}`);
}

const middleware = read("middleware.ts");
if (!middleware.includes('if (path === "/api/orders") return "operational"')) {
  failures.push("legacy /api/orders is not middleware protected");
}
if (!middleware.includes('return "admin"')) {
  failures.push("unknown API routes do not fail closed");
}
if (!middleware.includes('path === "/api/payments/session"')) {
  failures.push("payment session public route is not explicitly classified");
}
if (!middleware.includes('child(path, "/api/admin/cron")')) {
  failures.push("cron token route is not explicitly handled");
}

const legacyOrders = read("app/api/orders/route.ts");
if (!legacyOrders.includes("legacy_orders_mutation_disabled")) {
  failures.push("legacy order mutations are not disabled");
}
for (const action of ["addDummy", "updateDriverPosition", "setStatus", "duplicate", "import"]) {
  if (legacyOrders.includes(`action === "${action}"`)) {
    failures.push(`legacy /api/orders still implements ${action}`);
  }
}

for (const route of [
  "app/api/products/route.ts",
  "app/api/coupons/route.ts",
  "app/api/catalog/route.ts",
  "app/api/groups/route.ts",
]) {
  requireText(route, "requireMutationRole", `${route} mutation auth missing`);
  rejectPattern(route, /startsWith\(["']ok:/, `${route} accepts forged ok: cookie`);
}

requireText("app/api/bootstrap/route.ts", "BOOTSTRAP_MIGRATION_TOKEN", "bootstrap migration token missing");
requireText("app/api/bootstrap/route.ts", "hasSessionRole(req, \"admin\")", "bootstrap admin session fallback missing");
requireText("app/api/pause/route.ts", "requireMutationRole", "pause mutation auth missing");

const settings = read("app/api/settings/route.ts");
for (const marker of ["PUBLIC_SETTING_KEYS", "PRIVATE_TOP_LEVEL_KEYS", "isSensitiveSettingField", "snapshotSafeSettingsView"]) {
  if (!settings.includes(marker)) failures.push(`settings security marker missing: ${marker}`);
}
if (!settings.includes('"drivers"') || !settings.includes('normalized.includes("password")')) {
  failures.push("driver/password settings redaction is incomplete");
}

for (const route of [
  "app/api/track/lookup/route.ts",
  "app/api/track/[session]/route.ts",
  "app/api/track/by-order/[orderId]/route.ts",
]) {
  requireText(route, "tracking", `${route} tracking implementation missing`);
}
requireText("app/api/track/lookup/route.ts", "findOrderByTrackingToken", "public lookup does not require tracking token");
requireText("app/api/track/[session]/route.ts", "requireMutationRole", "tracking writes are not authenticated");
requireText("app/api/track/[session]/route.ts", "order_not_assigned_to_driver", "driver/order binding missing");
requireText("lib/server/public-order.ts", "publicOrderDto", "public order DTO missing");
rejectPattern("lib/server/public-order.ts", /phone|email|address/i, "public order DTO contains PII fields");

requireText("app/api/print/test/route.ts", "requireMutationRole", "print test route auth missing");
requireText("app/api/print/test/route.ts", "PRINT_TEST_ENABLED", "production print-test kill switch missing");
requireText("print-proxy/index.cjs", "127.0.0.1", "print proxy is not localhost-bound by default");
requireText("print-proxy/index.cjs", "PRINT_PROXY_TOKEN", "print proxy token auth missing");
requireText("print-proxy/index.cjs", "ORDER_URL_ORIGIN_NOT_ALLOWED", "print URL allowlist missing");
rejectPattern("app/api/print/jobs/route.ts", /searchParams\.get\(["']token["']\)/, "print jobs accepts token in URL");
rejectPattern("app/api/print/mark/route.ts", /searchParams\.get\(["']token["']\)/, "print mark accepts token in URL");

requireText("app/api/brian/learn/route.ts", "requireMutationRole", "Brian learn auth missing");
requireText("app/api/brian/export/route.ts", "requireAnySessionRole", "Brian export auth missing");
requireText("app/api/analytics/collect/route.ts", "createHmac", "analytics IP is not pseudonymized");
rejectPattern("app/api/analytics/collect/route.ts", /return\s+ip\s*;/, "analytics stores raw IP");
requireText("app/api/diagnostics/operational/route.ts", "requireAnySessionRole", "diagnostics auth missing");


requireText("app/api/telegram/send/route.ts", "requireMutationRole", "Telegram test relay is not admin protected");
requireText("app/api/telegram/send/route.ts", "enforceRateLimit", "Telegram test relay rate limit missing");
requireText("app/api/coupons/validate/route.ts", "publicIssuedCoupon", "coupon validation leaks raw issued coupon records");
requireText("app/api/coupons/validate/route.ts", "enforceRateLimit", "coupon validation rate limit missing");
requireText("app/api/drivers/route.ts", "requireMutationRole", "driver administration mutation auth missing");
requireText("components/DriverLiveTracker.tsx", "/api/track/", "driver tracker does not use secured tracking endpoint");
rejectPattern("components/DriverLiveTracker.tsx", /fetch\(["`]\/api\/orders["`]/, "driver tracker still writes through legacy /api/orders");
requireText("app/api/qr/[id]/route.ts", "legacy_qr_endpoint_disabled", "legacy QR mutation endpoint is still active");
requireText("app/api/qr-image/[id]/route.ts", "requireAnySessionRole", "QR image endpoint exposes order existence publicly");
requireText("app/api/orders/create/route.ts", "databaseUnavailableForEmergency", "emergency Telegram fallback does not verify DB outage");
requireText("app/api/orders/create/route.ts", "orders:emergency", "emergency order fallback rate limit missing");
requireText("app/api/track/[session]/route.ts", "tracking_expired", "public tracking TTL missing");
requireText("app/api/admin/cron/daily-backup/route.ts", "TRACKING_RETENTION_DAYS", "tracking retention cleanup missing");
requireText("app/checkout/page.tsx", "trackingToken", "checkout does not preserve the public tracking token");
requireText("components/ui/TrackPanel.tsx", "trackingToken=", "tracking panel does not use the public tracking token");
rejectPattern("components/ui/TrackPanel.tsx", /track\/lookup\?id=/, "tracking panel still exposes order-number lookup");
requireText("app/track/[id]/page.tsx", "fetchTrackingPosition", "customer tracking page does not load secured live position");
requireText("app/track/[id]/page.tsx", "trackingToken=", "customer tracking page does not use the tracking token");
rejectPattern("app/track/[id]/page.tsx", /\/api\/orders(?:\?|\/list)/, "customer tracking page still calls legacy order APIs");

const nextConfig = read("next.config.mjs");
const middlewareSecurity = read("middleware.ts");
for (const header of [
  "Strict-Transport-Security",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
]) {
  if (!nextConfig.includes(header)) failures.push(`security header missing: ${header}`);
}

for (const marker of [
  "Content-Security-Policy",
  "contentSecurityPolicy",
  "x-nonce",
  "strict-dynamic",
  "https://www.openstreetmap.org",
]) {
  if (!middlewareSecurity.includes(marker)) failures.push(`dynamic CSP marker missing: ${marker}`);
}
if (/script-src[^;\n]*unsafe-inline/.test(middlewareSecurity)) {
  failures.push("production script CSP still allows unsafe-inline");
}
if (!middlewareSecurity.includes('const developmentEval = process.env.NODE_ENV === "production" ? ""')) {
  failures.push("unsafe-eval is not restricted to development");
}

for (const marker of [
  'path === "/api/payments/profile"',
  'path === "/api/payments/share"',
  'path === "/api/tv/logout"',
]) {
  if (!middleware.includes(marker)) failures.push(`middleware access rule missing: ${marker}`);
}
if (!middleware.includes('if (path.startsWith("/api/")) return false')) {
  failures.push("API asset-suffix bypass is not blocked");
}

for (const route of [
  "app/api/payments/profile/route.ts",
  "app/api/payments/share/route.ts",
]) {
  requireText(route, "hasTrustedMutationOrigin", `${route} same-origin protection missing`);
  requireText(route, "enforceRateLimit", `${route} rate limit missing`);
}

requireText("app/api/tv/logout/route.ts", "hasTrustedMutationOrigin", "TV logout origin protection missing");
requireText("app/tv/page.tsx", "response.ok", "TV logout UI ignores failed logout response");
rejectPattern("app/layout.tsx", /DriversSync/, "global driver synchronization is still mounted");
requireText("app/api/drivers/route.ts", 'requireSessionRole(req, "admin")', "driver list is not admin protected");
rejectPattern("app/driver/page.tsx", /bb_driver_lastpass|LASTPASS_KEY|function\s+enc\(/, "driver password is stored client-side");
rejectPattern("app/scan/page.tsx", /const\s+PIN\s*=|1905|Falsche PIN/, "scan page uses a client PIN");
rejectPattern("app/api/tv/login/route.ts", /LOCAL_DEV_FALLBACK_PIN|19051905/, "hard-coded TV fallback PIN remains");
rejectPattern("app/api/coupons/route.ts", /Math\.random/, "server coupon generation uses Math.random");
rejectPattern("lib/coupons.ts", /Math\.random/, "client coupon generation uses Math.random");
requireText("lib/server/request-security.ts", "UPSTASH_REDIS_REST_URL", "persistent rate limiter support missing");
requireText("lib/server/request-security.ts", "RATE_LIMIT_LOCAL_MAX_KEYS", "bounded local rate limiter missing");

for (const route of [
  "app/api/admin/campaigns/route.ts",
  "app/api/admin/customers/route.ts",
  "app/api/admin/visitors/route.ts",
  "app/api/admin/orders/route.ts",
  "app/api/admin/coupons/route.ts",
  "app/api/admin/backup/export/route.ts",
  "app/api/admin/backup/import/route.ts",
  "app/api/admin/maintenance/archive-orders/route.ts",
  "app/api/admin/stats/summary/route.ts",
]) {
  requireText(route, "requireSessionRole", `${route} route-level admin auth missing`);
  rejectPattern(route, /some\([\s\S]{0,250}startsWith\(`?\$\{ADMIN_COOKIE/, `${route} trusts cookie presence`);
}

for (const route of [
  "app/api/admin/login/route.ts",
  "app/api/tv/login/route.ts",
  "app/api/drivers/route.ts",
]) {
  requireText(route, "enforceRateLimit", `${route} brute-force rate limit missing`);
}

requireText("lib/settings.ts", 'driverPin: ""', "client driver PIN fallback was not removed");
rejectPattern("app/qr/[id]/page.tsx", /19051905|123456|driverPin|password/i, "QR page contains client-side credential logic");


const legacyDriverPage = read("app/driver/[orderId]/page.tsx");
rejectPattern("app/driver/[orderId]/page.tsx", /DRIVER_PASSWORD|1905|fetchOrderFromDb|localStorage/, "legacy driver order page still exposes client auth/cache flow");
if (!legacyDriverPage.includes('redirect(`/driver${query}`)')) {
  failures.push("legacy driver order page is not redirected to the signed driver flow");
}
requireText("lib/orders.ts", 'throw error;', "order status persistence errors are still swallowed");
rejectPattern("app/admin/coupons/page.tsx", /Math\.random|makeCouponCode|makeIssuedCode/, "admin coupon UI generates codes client-side");
requireText("app/admin/coupons/page.tsx", "serverGenerateCodes: true", "automatic coupon definitions are not server-generated");
requireText("app/admin/coupons/page.tsx", 'action: "issueCoupon"', "issued coupon codes are not generated server-side");
requireText("app/api/coupons/route.ts", "serverGeneratedCode", "coupon API does not support authoritative server code generation");
rejectPattern("app/api/tv/debug/route.ts", /19051905|dev:fallback/, "TV debug fallback PIN remains");
rejectPattern("app/layout.tsx", /wrap\.innerHTML/, "maintenance overlay still uses innerHTML");
requireText("app/api/payments/session/route.ts", "enforceRateLimit", "payment session endpoint rate limit missing");

for (const route of [
  "app/driver/page.tsx",
  "app/tv/page.tsx",
  "lib/orders.ts",
]) {
  rejectPattern(route, /fetch\(["`]\/api\/orders["`]/, `${route} still calls legacy /api/orders mutation/list endpoint`);
  rejectPattern(route, /\/api\/admin\/orders/, `${route} still uses admin order fallback`);
}

if (failures.length) {
  console.error("SECURITY REGRESSION TESTS FAILED\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Security regression tests passed.");
