const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertContains(source, markers, label) {
  for (const marker of markers) {
    assert(source.includes(marker), `${label} marker missing: ${marker}`);
  }
}

const lifecycle = read("lib/server/route-deal-lifecycle.ts");
const eligibility = read("lib/server/route-deal-eligibility.ts");
const eligibleRoute = read("app/api/route-deals/eligible/route.ts");
const routeDealClient = read("lib/client/route-deal.ts");
const createRoute = read("app/api/orders/create/route.ts");
const pushServer = read("lib/server/general-push.ts");
const notificationAdmin = read("app/admin/notifications/page.tsx");
const settingsAdmin = read("app/admin/settings/page.tsx");
const campaignsAdmin = read("app/admin/campaigns/page.tsx");
const checkout = read("app/checkout/page.tsx");
const cart = read("components/CartSummary.tsx");

assertContains(
  createRoute,
  [
    "Geplant sipariş teslimat rotasına henüz çıkmamıştır",
    "cleanText(order?.planned)",
    "if (routeDealActivated)",
    "notifyNearbyDelivery(created)",
  ],
  "Create-stage route deal and push lifecycle",
);

assertContains(
  lifecycle,
  [
    "findActiveRouteDealOpportunityForOrder",
    "closeRouteDealOpportunityForOrder",
    'status: "closed"',
    'closedReason: text(reason, 80)',
    "noticeExpiresAt",
    "source_order_out_for_delivery",
  ],
  "Unterwegs close lifecycle",
);

assertContains(
  pushServer,
  [
    'if (status === "out_for_delivery")',
    "closeRouteDealOpportunityForOrder(",
    '"source_order_out_for_delivery"',
    '["new", "preparing", "ready"].includes(status)',
    "if (orderIsPlanned(order))",
    "activeRouteDeal.durationMinutes",
    "Ihr Nachbarschafts-Angebot ist ${opportunityMinutes} Minuten gültig.",
    "Bestellen Sie, solange die Lieferung noch im Restaurant ist.",
    "dispatch result",
  ],
  "Nearby push timing, duration and close behavior",
);

assert(
  !pushServer.includes(
    "Kurye Unterwegs olduğunda aynı kaynak siparişin fırsat süresini yeniden başlat",
  ),
  "Old Unterwegs refresh behavior still exists",
);

assertContains(
  eligibility,
  [
    "recentlyClosedDeals",
    '"source_order_out_for_delivery"',
    "unusedClosedDeal",
    'status: { notIn: ["done", "cancelled"] }',
    '"active_order_out_for_delivery"',
  ],
  "Closed opportunity and active-order eligibility",
);

assertContains(
  eligibleRoute,
  [
    'type: "opportunity_ended"',
    "Das Nachbarschafts-Angebot ist beendet",
    "Die zugehörige Lieferung hat das Restaurant bereits verlassen.",
  ],
  "Closed opportunity API notice",
);

assertContains(
  routeDealClient,
  [
    '"order_underway" | "opportunity_ended"',
    '["order_underway", "opportunity_ended"].includes',
    '"opportunity_ended" as const',
  ],
  "Route-deal notice client union",
);

assertContains(
  checkout,
  [
    "notice: routeDealNotice",
    "routeDealNotice &&",
    "!routeDealNotice && routeDealBenefit.deal",
  ],
  "Checkout information banner",
);

assertContains(
  cart,
  [
    "notice?: RouteDealNotice | null",
    "if (notice)",
    "notice={routeDealNotice}",
  ],
  "Cart information banner",
);

assert(
  !pushServer.includes(
    "body: `Nur für die nächsten ${settings.opportunityMinutes} Minuten",
  ),
  "Nearby push still uses Notification Center duration",
);

assertContains(
  notificationAdmin,
  [
    "Fırsat süresi dakika",
    "push metni",
    "canlı geri sayım",
  ],
  "Notification admin duration explanation",
);

assertContains(
  settingsAdmin,
  [
    "sipariş restorandayken",
    "Geplant siparişlerde fırsat ve push hiç başlamaz",
    "Kaynak sipariş Unterwegs olduğunda fırsat anında kapanır",
  ],
  "Route deal admin lifecycle explanation",
);

assertContains(
  campaignsAdmin,
  [
    "saveSingleCampaignToDb",
    'method: "POST"',
    "replace: false",
    "const result = await saveSingleCampaignToDb(payload)",
    'setCampaignSaveMessage("Gespeichert ✅")',
    "result.error",
    'type="button"',
    "onClick={() => void save()}",
  ],
  "Campaign Hinzufügen single-record DB save",
);

console.log("Nearby push before Unterwegs + planned suppression + campaign create tests: OK");
