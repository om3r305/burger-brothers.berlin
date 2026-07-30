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
  "lib/server/nearby-delivery-matcher.ts",
  "public/sw.js",
  "prisma/migrations/20260726210000_add_general_notifications/migration.sql",
  "prisma/migrations/20260726223000_extend_general_notification_automation/migration.sql",
  "prisma/migrations/20260727090000_add_all_notifications_consent/migration.sql",
  "prisma/migrations/20260727120000_add_customer_app_push_scope/migration.sql",
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
    "allNotifications Boolean @default(false)",
    'appScope String @default("unknown")',
    "@@index([tenantId, appScope, active])",
    "campaigns        Boolean @default(false)",
    "coupons          Boolean @default(false)",
    "nearbyDelivery   Boolean @default(false)",
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
const allConsentMigration = read(
  "prisma/migrations/20260727090000_add_all_notifications_consent/migration.sql",
);
assertContains(
  allConsentMigration,
  [
    'ADD COLUMN IF NOT EXISTS "allNotifications" BOOLEAN NOT NULL DEFAULT false',
    'CREATE INDEX IF NOT EXISTS "NotificationPreference_tenantId_allNotifications_idx"',
  ],
  "All-notifications consent migration",
);
const customerAppScopeMigration = read(
  "prisma/migrations/20260727120000_add_customer_app_push_scope/migration.sql",
);
assertContains(
  customerAppScopeMigration,
  [
    'ADD COLUMN IF NOT EXISTS "appScope" TEXT NOT NULL DEFAULT \'unknown\'',
    'CREATE INDEX IF NOT EXISTS "PushSubscription_tenantId_appScope_active_idx"',
  ],
  "Customer-app push scope migration",
);
for (const migration of [
  baseMigration,
  extensionMigration,
  allConsentMigration,
  customerAppScopeMigration,
]) {
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
    'GENERAL_PUSH_APP_SCOPE = "customer_app"',
    "appScope: GENERAL_PUSH_APP_SCOPE",
    "event.subscription.appScope !== GENERAL_PUSH_APP_SCOPE",
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
    "allNotifications: true",
    "campaigns: true",
    "marketingConsentedAt: { not: null }",
    "appScope: GENERAL_PUSH_APP_SCOPE",
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
    "previousSettings",
  ],
  "Settings automatic trigger",
);
assert(
  !settingsRoute.includes("processDueAutomaticNotifications"),
  "Public settings reads must not execute due-notification side effects",
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
const nearbyMatcher = read("lib/server/nearby-delivery-matcher.ts");
assertContains(
  nearbySettings,
  [
    "sameStreet",
    "streetGroupsEnabled",
    "streetGroups",
    "readAdminRouteStreetGroups",
    "plz: plzList(rule?.plz)",
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
    'status === "out_for_delivery"',
    "closeRouteDealOpportunityForOrder",
    "source_order_out_for_delivery",
    '!["new", "preparing", "ready"].includes(status)',
    "orderIsPlanned(order)",
    'reason: "planned_order"',
    'orderMode(order) !== "delivery"',
    "excludedSubscriptionId",
    "activePhones",
    "activeEmails",
    "activeSubscriptionIds",
    "minimumPastOrders",
    "readAdminRouteStreetGroups",
    "previous completed delivery orders",
    "historyByPhone",
    "historyByEmail",
    "historyBySubscriptionId",
    "preferenceAddress",
    "mode: true",
    "orderMode(completedOrder) !== \"delivery\"",
    'type: "nearby_delivery"',
    "cooldownHours",
    "eventRuleId !== currentRuleId",
    "recentCustomerIds",
    "recentPhones",
    "recentEmails",
    "maxRecipients",
    "opportunityMinutes",
    "routeDealTitle",
    "activeRouteDeal.message",
    "Noch ${opportunityMinutes} Minuten gültig.",
  ],
  "Nearby-delivery matching and source-order closure",
);
assertContains(
  nearbyMatcher,
  [
    "group.plz.size === 0 && group.streets.size === 0",
    "groupAcceptsNearbyAddress",
    "rankNearbyDeliveryMatch",
    'matchType = "same_street"',
    'matchType = "street_group"',
    'matchType = "same_plz"',
    'matchType = "route_cluster"',
    'matchType = "radius"',
  ],
  "Nearby-delivery pure matcher",
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
const pushRoute = read("app/api/push/route.ts");
assert(pushRoute.includes("allNotifications: normalized.allNotifications"));
assert(!pushRoute.includes("plz: normalized.plz"), "Push API still exposes stored PLZ");
assert(!pushRoute.includes("street: normalized.street"), "Push API still exposes stored street");

const install = read("app/install/page.tsx");
assertContains(
  install,
  [
    "beforeinstallprompt",
    "Burger Brothers installieren",
    "Zum Home-Bildschirm",
    "Benachrichtigungen aktivieren?",
    '"Ja"',
    "Nein",
    "NOTIFICATION_DECISION_KEY",
    'window.location.replace(HOME_URL)',
    'const HOME_URL = "/"',
    "Die Auswahl wird gespeichert",
  ],
  "Install and one-time consent page",
);

assert(!install.includes('placeholder="PLZ"'), "Install page still asks for PLZ");
assert(!install.includes("Gerätestandort verwenden"), "Install page still asks for location");
assert(!install.includes("ToggleRow"), "Install page still exposes separate notification toggles");
assert(
  !install.includes("Alle Benachrichtigungen aktivieren"),
  "Install page still uses the confusing all-notifications wording",
);
assert(
  !install.includes('window.location.replace("/menu")'),
  "Installed app still redirects to menu instead of the home page",
);

const customerAppBootstrap = read("components/CustomerAppBootstrap.tsx");
assertContains(
  customerAppBootstrap,
  [
    "Benachrichtigungen aktivieren?",
    "ensureCustomerAppPushRegistration",
    "repairCustomerPushInBackground",
    "saveDecision",
  ],
  "Direct-home customer app bootstrap",
);
const customerManifest = JSON.parse(read("app/manifest.webmanifest"));
assert(
  customerManifest.start_url === "/",
  "Customer PWA must open the home page directly",
);

const pushClient = read("lib/client/general-push.ts");
assertContains(
  pushClient,
  [
    "ensureCustomerAppPushRegistration",
    "Notification.permission !== \"granted\"",
    "saveSubscription(subscription, ALL_GENERAL_PUSH_PREFERENCES)",
    "repairGeneralPushOrderBindingFromLastOrder",
    "readLastCustomerTracking",
  ],
  "Silent customer-app registration repair",
);


assertContains(
  generalServer,
  [
    "allNotifications",
    'GENERAL_PUSH_CONSENT_VERSION = "3-single-prompt"',
    'GENERAL_PUSH_APP_SCOPE = "customer_app"',
    "Address/location values are never accepted from the permission screen",
  ],
  "Master notification consent",
);

if (exists("components/menu/ProductCard.tsx")) {
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
}
if (exists("components/RouteCatRedirect.tsx")) {
  const categoryRedirect = read("components/RouteCatRedirect.tsx");
  assertContains(categoryRedirect, ['sp.get("cat")', "router.replace"], "Category offer deep link");
}

/* Order binding remains in both customer recovery paths. */
const checkout = read("app/checkout/page.tsx");
assert(checkout.includes("bindGeneralPushToOrder"), "Checkout does not bind push subscription to order");
const track = read("app/track/[id]/page.tsx");
assert(track.includes("bindGeneralPushToOrder"), "Tracking page does not repair order push binding");

console.log("General notifications regression tests: OK");
