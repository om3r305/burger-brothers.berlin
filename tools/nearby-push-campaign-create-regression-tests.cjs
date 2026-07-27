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
const pushServer = read("lib/server/general-push.ts");
const notificationAdmin = read("app/admin/notifications/page.tsx");
const settingsAdmin = read("app/admin/settings/page.tsx");
const campaignsAdmin = read("app/admin/campaigns/page.tsx");

assertContains(
  lifecycle,
  [
    "const currentRuleId = text(current.ruleId, 100)",
    "array(routeDeals.rules).find",
    "matchedRule?.durationMinutes",
    'durationSource: matchedRule ? "route_rule" : "active_deal"',
  ],
  "Admin route-rule duration source",
);

assertContains(
  pushServer,
  [
    'reason: "route_deal_not_active"',
    "const opportunityMinutes = boundedInteger(",
    "refreshedRouteDeal.durationMinutes",
    "const refreshedExpiresAtMs = Date.parse(",
    "Ihr Nachbarschafts-Angebot ist ${opportunityMinutes} Minuten gültig.",
    "durationMinutes: opportunityMinutes",
    "durationSource: refreshedRouteDeal.durationSource",
    "notificationUrl",
  ],
  "Nearby push duration and click-through countdown",
);

assert(
  !pushServer.includes(
    "body: `Nur für die nächsten ${settings.opportunityMinutes} Minuten",
  ),
  "Nearby push still uses the Notification Center fallback duration instead of the route rule",
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

assert(
  !notificationAdmin.includes(
    '{ key: "opportunityMinutes", label: "Fırsat süresi (dakika)"',
  ),
  "Notification Center still exposes a conflicting opportunity duration field",
);

assertContains(
  settingsAdmin,
  [
    "Unterwegs olduğunda bu kuraldaki Fırsat süresi dakika değeri yeniden",
    "Bildirimde yazan süre",
    "İlk sipariş sahibi kendi fırsatını göremez",
  ],
  "Route deal admin lifecycle explanation",
);

assertContains(
  campaignsAdmin,
  [
    "const [savingFormCampaign, setSavingFormCampaign] = useState(false)",
    "const nextRows = editId",
    "const ok = await saveCampaignsToDb(nextRows)",
    'setCampaignSaveMessage("Gespeichert ✅")',
    'type="button"',
    "onClick={() => void save()}",
  ],
  "Campaign Hinzufügen immediate DB save",
);

assert(
  campaignsAdmin.includes(
    "Kampagne konnte nicht gespeichert werden.",
  ),
  "Campaign create failure is still silent",
);

console.log("Nearby push duration + campaign create regression tests: OK");
