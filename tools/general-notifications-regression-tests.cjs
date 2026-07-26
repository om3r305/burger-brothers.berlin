const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertContains(source, markers, label) {
  for (const marker of markers) {
    assert(source.includes(marker), `${label} marker missing: ${marker}`);
  }
}

const required = [
  "app/install/page.tsx",
  "app/admin/notifications/page.tsx",
  "app/api/push/route.ts",
  "app/api/push/pending/route.ts",
  "app/api/push/order/route.ts",
  "app/api/admin/notifications/route.ts",
  "app/api/admin/cron/notifications/route.ts",
  "lib/client/general-push.ts",
  "lib/server/general-push.ts",
  "lib/server/automatic-notifications.ts",
  "lib/server/nearby-delivery-settings.ts",
  "public/sw.js",
  "public/burger-brothers-install-qr.png",
  "prisma/migrations/20260726210000_add_general_notifications/migration.sql",
  "prisma/migrations/20260726223000_extend_general_notification_automation/migration.sql",
];

for (const file of required) {
  assert(exists(file), `Missing general notification file: ${file}`);
}

/* Database models and safe migrations */
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
assertContains(
  schema,
  [
    "campaigns      Boolean @default(false)",
    "coupons        Boolean @default(false)",
    "nearbyDelivery Boolean @default(false)",
    "sourceKey  String?",
    "sourceHash String?",
    "expiresAt   DateTime?",
    "@@unique([tenantId, sourceKey])",
    "@@unique([tenantId, dedupeKey])",
  ],
  "Prisma notification schema",
);

const baseMigration = read(
  "prisma/migrations/20260726210000_add_general_notifications/migration.sql",
);
for (const table of [
  "PushSubscription",
  "NotificationPreference",
  "NotificationCampaign",
  "NotificationEvent",
  "NotificationDelivery",
]) {
  assert(
    baseMigration.includes(`CREATE TABLE \"${table}\"`),
    `Base migration does not create ${table}`,
  );
}

const extensionMigration = read(
  "prisma/migrations/20260726223000_extend_general_notification_automation/migration.sql",
);
assertContains(
  extensionMigration,
  [
    'ADD COLUMN IF NOT EXISTS "sourceKey" TEXT',
    'ADD COLUMN IF NOT EXISTS "sourceHash" TEXT',
    'ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3)',
    "CREATE UNIQUE INDEX IF NOT EXISTS",
  ],
  "Automation extension migration",
);
for (const migration of [baseMigration, extensionMigration]) {
  assert(
    !/\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM)\b/i.test(migration),
    "Notification migration contains destructive SQL",
  );
}

/* Public middleware and service worker compatibility */
const middleware = read("middleware.ts");
assertContains(
  middleware,
  ['path === "/api/push"', 'path === "/api/push/pending"', 'path === "/api/push/order"'],
  "Middleware public push access",
);

const sw = read("public/sw.js");
assertContains(
  sw,
  [
    "/api/push/pending",
    "/api/schnellbestellung/push?pending=1",
    "BB_GENERAL_PUSH",
    "BB_SCHNELL_READY_PUSH",
    "expiresAt",
    "notificationclick",
  ],
  "Service worker",
);

/* Existing VAPID configuration must be reused. */
const generalServer = read("lib/server/general-push.ts");
assertContains(
  generalServer,
  [
    "getSchnellPushConfig",
    "sendEmptySchnellPush",
    "notifyGeneralOrderStatus",
    "notifyOrderRefundExecuted",
    "notifyCouponAssigned",
    "notifyNearbyDelivery",
    "createAdminBroadcast",
    "marketingConsentedAt",
  ],
  "General push server",
);
assert(
  !generalServer.includes("generateKeyPair") && !generalServer.includes("generateVAPIDKeys"),
  "General push creates a new VAPID key instead of reusing the configured keys",
);

/* Immutable per-order/per-status dedupe and all requested transactional texts. */
assertContains(
  generalServer,
  [
    "Bestellung eingegangen ✅",
    "Bestellung wird vorbereitet 🍔",
    "Bestellung ist abholbereit!",
    "Bestellung ist unterwegs! 🚗",
    "Bestellung wurde geliefert ✅",
    "Bestellung wurde storniert",
    "Erstattung wurde ausgeführt ✅",
    "`order:${order.id}:${nextStatus}:${subscription.id}`",
    "`order:${order.id}:refunded:${subscription.id}`",
  ],
  "Transactional notification flow",
);
assert(
  !generalServer.includes("order:${order.id}:${nextStatus}:${Date.now"),
  "Order-status dedupe key contains a timestamp and could send duplicates",
);

const createRoute = read("app/api/orders/create/route.ts");
assertContains(
  createRoute,
  [
    'import { NextResponse } from "next/server";',
    'import { runAfterResponse } from "@/lib/server/after-response";',
    'notifyGeneralOrderStatus(created, "", "new")',
  ],
  "Order creation notification",
);

const statusRoute = read("app/api/orders/status/route.ts");
assertContains(
  statusRoute,
  [
    "notifyGeneralOrderStatus",
    "notifyOrderRefundExecuted",
    "notifyNearbyDelivery",
    "COMPLETED_REOPEN_LOCK_MS",
  ],
  "Order status route",
);
const claimRoute = read("app/api/orders/claim/route.ts");
assertContains(
  claimRoute,
  [
    "notifyGeneralOrderStatus",
    "notifyNearbyDelivery",
    '"out_for_delivery"',
    "!result.alreadyMine",
  ],
  "Driver claim route",
);
const adminOrdersRoute = read("app/api/admin/orders/route.ts");
assertContains(
  adminOrdersRoute,
  ["notifyGeneralOrderStatus", "notifyNearbyDelivery", 'nextStatus === "out_for_delivery"'],
  "Legacy admin order route",
);

/* Personal coupon notification is targeted and deduplicated. */
const couponRoute = read("app/api/coupons/route.ts");
assertContains(
  couponRoute,
  [
    "notifyCouponAssigned",
    'action === "issueCoupon"',
    "assignedToPhone",
    "assignedToEmail",
  ],
  "Coupon assignment route",
);
assertContains(
  generalServer,
  [
    "coupons: true",
    "`coupon:${cleanText(input.code, 100)}:${subscription.id}`",
  ],
  "Coupon audience",
);

/* Automatic campaigns, offers and announcements. */
const automatic = read("lib/server/automatic-notifications.ts");
assertContains(
  automatic,
  [
    "reconcileCatalogCampaignNotifications",
    "reconcileSettingsAutomaticNotifications",
    "processDueAutomaticNotifications",
    "catalog-campaign:",
    "announcement:",
    "cart-offer:",
    "scheduledAt: { lte: now }",
    "existing?.sentAt",
    "automatic:${campaign.id}:${subscription.id}",
    "campaigns: true",
    "marketingConsentedAt: { not: null }",
    "resolveCampaignProduct",
    "targetProductSku",
    "categoryPath",
    "?product=${encodeURIComponent(productKey)}",
    "/menu?cat=",
  ],
  "Automatic campaign processor",
);

const campaignRoute = read("app/api/admin/campaigns/route.ts");
assertContains(
  campaignRoute,
  [
    "reconcileCatalogCampaignNotifications",
    "processDueAutomaticNotifications",
    "beforeCampaigns",
  ],
  "Admin campaign automatic trigger",
);
const campaignPage = read("app/admin/campaigns/page.tsx");
assertContains(
  campaignPage,
  ['const API_CAMPAIGNS = "/api/admin/campaigns"', "campaigns: rows.map(campaignForDb)"],
  "Campaign admin save flow",
);

const settingsRoute = read("app/api/settings/route.ts");
assertContains(
  settingsRoute,
  [
    "reconcileSettingsAutomaticNotifications",
    "processDueAutomaticNotifications",
    "previousSettings",
  ],
  "Settings automatic trigger",
);
const settingsLib = read("lib/settings.ts");
const settingsPage = read("app/admin/settings/page.tsx");
assertContains(settingsLib, ["id?: string", "announcement-${index + 1}"], "Announcement stable IDs");
assertContains(settingsPage, ["crypto.randomUUID", "id: item?.id || `announcement-${index + 1}`"], "Announcement editor stable IDs");

const cronRoute = read("app/api/admin/cron/notifications/route.ts");
assertContains(
  cronRoute,
  ["CRON_SECRET", "processDueAutomaticNotifications", 'export async function GET'],
  "Scheduled notification cron route",
);
const paymentCron = read("app/api/admin/cron/expire-payments/route.ts");
assert(
  paymentCron.includes("processDueAutomaticNotifications"),
  "Existing daily cron does not provide notification scheduling fallback",
);
const pendingRoute = read("app/api/push/pending/route.ts");
assert(
  pendingRoute.includes("processDueAutomaticNotifications"),
  "Pending endpoint does not process due automatic campaigns",
);

/* Nearby-delivery matching controls, exclusions and privacy. */
const nearbySettings = read("lib/server/nearby-delivery-settings.ts");
assertContains(
  nearbySettings,
  [
    "sameStreet",
    "streetGroupsEnabled",
    "streetGroups",
    "samePlz",
    "routeCluster",
    "radiusEnabled",
    "radiusM",
    "minimumPastOrders",
    "maxRecipients",
    "cooldownHours",
    "opportunityMinutes",
  ],
  "Nearby-delivery settings",
);
assertContains(
  generalServer,
  [
    'status !== "out_for_delivery"',
    'orderMode(order) !== "delivery"',
    "excludedSubscriptionId",
    "activePhones",
    "activeEmails",
    "minimumPastOrders",
    "same_street",
    "street_group",
    "same_plz",
    "route_cluster",
    'matchType = "radius"',
    'type: "nearby_delivery"',
    "cooldownHours",
    "maxRecipients",
    "opportunityMinutes",
    "Wir liefern gerade in Ihre Nähe! 🍔",
  ],
  "Nearby-delivery matching",
);
assert(
  !/body:\s*`[^`]*\$\{\s*(customer|currentPhone|currentEmail|street|plz)/.test(generalServer),
  "Nearby-delivery notification body exposes customer or address data",
);
const notificationAdminPage = read("app/admin/notifications/page.tsx");
const notificationAdminRoute = read("app/api/admin/notifications/route.ts");
assertContains(
  notificationAdminPage,
  [
    "Aynı sokak",
    "Tanımlı sokak grupları",
    "Aynı PLZ",
    "Rota kümesi",
    "Mesafe yarıçapı",
    "Minimum geçmiş sipariş",
    "Maksimum alıcı",
    "Tekrar bekleme",
    "Fırsat süresi",
  ],
  "Admin nearby-delivery UI",
);
assertContains(
  notificationAdminRoute,
  ["save_nearby_settings", "createAdminBroadcast", "nearbySettings"],
  "Manual notification center",
);

/* Install/onboarding and preference defaults. */
const install = read("app/install/page.tsx");
assertContains(
  install,
  [
    "beforeinstallprompt",
    "Burger Brothers installieren",
    "Zum Home-Bildschirm",
    "Benachrichtigungen aktivieren",
    "Bestellstatus",
    "Angebote & Kampagnen",
    "Persönliche Gutscheine",
    "Lieferung in Ihrer Nähe",
    'window.location.replace("/menu")',
    "campaigns: false",
    "coupons: false",
    "nearbyDelivery: false",
  ],
  "Install and consent page",
);

const productCard = read("components/menu/ProductCard.tsx");
assertContains(
  productCard,
  [
    'get("product")',
    "productId",
    "scrollIntoView",
    "setOpen(true)",
    "data-product-id",
  ],
  "Product offer deep link",
);
const categoryRedirect = read("components/RouteCatRedirect.tsx");
assertContains(categoryRedirect, ['sp.get("cat")', "router.replace"], "Category offer deep link");

/* Order binding remains in both customer recovery paths. */
const checkout = read("app/checkout/page.tsx");
assert(checkout.includes("bindGeneralPushToOrder"), "Checkout does not bind push subscription to order");
const track = read("app/track/[id]/page.tsx");
assert(track.includes("bindGeneralPushToOrder"), "Tracking page does not repair order push binding");

console.log("General notifications regression tests: OK");
