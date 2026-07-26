const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const required = [
  "app/install/page.tsx",
  "app/admin/notifications/page.tsx",
  "app/api/push/route.ts",
  "app/api/push/pending/route.ts",
  "app/api/push/order/route.ts",
  "app/api/admin/notifications/route.ts",
  "lib/client/general-push.ts",
  "lib/server/general-push.ts",
  "public/sw.js",
  "public/burger-brothers-install-qr.png",
  "prisma/migrations/20260726210000_add_general_notifications/migration.sql",
];

for (const file of required) {
  assert(exists(file), `Missing general notification file: ${file}`);
}

const schema = read("prisma/schema.prisma");
for (const model of [
  "PushSubscription",
  "NotificationPreference",
  "NotificationCampaign",
  "NotificationEvent",
  "NotificationDelivery",
]) {
  assert(schema.includes(`model ${model}`), `Prisma model missing: ${model}`);
}

const middleware = read("middleware.ts");
assert(middleware.includes('path === "/api/push"'), "General push API is not public at middleware layer");
assert(middleware.includes('path === "/api/push/pending"'), "Pending push API is not public");
assert(middleware.includes('path === "/api/push/order"'), "Order push binding API is not public");

const sw = read("public/sw.js");
assert(sw.includes("/api/push/pending"), "Service worker does not load general pending events");
assert(sw.includes("/api/schnellbestellung/push?pending=1"), "Schnellbestellung push fallback was removed");
assert(sw.includes("BB_GENERAL_PUSH"), "General push client message missing");
assert(sw.includes("BB_SCHNELL_READY_PUSH"), "Schnell ready client message missing");

const statusRoute = read("app/api/orders/status/route.ts");
assert(statusRoute.includes("notifyGeneralOrderStatus"), "Order status notifications are not wired");
assert(statusRoute.includes("notifyNearbyDelivery"), "Nearby delivery notifications are not wired");
assert(statusRoute.includes("COMPLETED_REOPEN_LOCK_MS"), "Completed-order TV lock disappeared");

const couponRoute = read("app/api/coupons/route.ts");
assert(couponRoute.includes("notifyCouponAssigned"), "Coupon assignment notifications are not wired");

const checkout = read("app/checkout/page.tsx");
assert(checkout.includes("bindGeneralPushToOrder"), "Checkout does not bind push subscription to order");

const track = read("app/track/[id]/page.tsx");
assert(track.includes("bindGeneralPushToOrder"), "Tracking page does not repair order push binding");

const install = read("app/install/page.tsx");
assert(install.includes("Benachrichtigungen aktivieren"), "Install page activation button missing");
assert(install.includes("Zum Home-Bildschirm"), "iOS Home Screen instructions missing");
assert(install.includes("Burger Brothers installieren"), "Android install action missing");

const generalServer = read("lib/server/general-push.ts");
for (const marker of [
  "notifyGeneralOrderStatus",
  "notifyCouponAssigned",
  "notifyNearbyDelivery",
  "createAdminBroadcast",
  "marketingConsentedAt",
]) {
  assert(generalServer.includes(marker), `General push server marker missing: ${marker}`);
}

console.log("General notifications regression tests: OK");
