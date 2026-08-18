const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const route = read("app/api/orders/notification/route.ts");
const generalPush = read("lib/server/general-push.ts");
const planner = read("components/driver/DriverRoutePlanner.tsx");
const details = read("components/driver/OrderWithDetails.tsx");
const middleware = read("middleware.ts");

const statusRoute = read("app/api/orders/status/route.ts");
const claimRoute = read("app/api/orders/claim/route.ts");
const serviceWorker = read("public/sw.js");

// Protect the already-working order-status notification architecture.
assert.match(
  statusRoute,
  /notifyGeneralOrderStatus/,
  "Existing preparing/ready/out_for_delivery/done customer notifications must stay wired through orders/status.",
);
assert.match(
  statusRoute,
  /runAfterResponse/,
  "Existing order-status notifications must keep their after-response execution path.",
);
assert.match(
  claimRoute,
  /Übernehmen bedeutet ab jetzt nur Fahrer-Zuordnung/,
  "Claim must remain assignment-only; Fahrt starten keeps ownership of out_for_delivery and its existing push.",
);
assert.doesNotMatch(
  claimRoute,
  /notifyGeneralOrderStatus/,
  "The patch must not move existing status push behavior back into claim/Übernehmen.",
);
assert.match(
  generalPush,
  /Bestellung wird vorbereitet/,
  "Existing preparing notification text must remain intact.",
);
assert.match(
  generalPush,
  /Bestellung ist unterwegs/,
  "Existing out-for-delivery notification text must remain intact.",
);
assert.match(
  generalPush,
  /Bestellung wurde geliefert/,
  "Existing delivered notification text must remain intact.",
);
assert.match(
  serviceWorker,
  /startsWith\("order_"\)/,
  "Existing Service Worker order-notification behavior must remain intact.",
);

assert.match(
  route,
  /requireMutationRole\(req,\s*\["driver",\s*"admin"\]\)/,
  "Customer notification route must reuse the existing signed Driver/Admin session.",
);

assert.match(
  route,
  /orderAssignedToDriver\(order,\s*driverSubject\)/,
  "A Driver must only notify customers for an order assigned to that Driver.",
);

assert.match(
  route,
  /selectedTemplate === "nearby" && status !== "out_for_delivery"/,
  "Automatic nearby notifications must only be allowed after Fahrt starten.",
);

assert.doesNotMatch(
  route,
  /body\?\.(title|message|text|notificationBody)/,
  "The client must not be able to send arbitrary notification text.",
);

assert.match(
  middleware,
  /\/api\/orders\/notification/,
  "The new endpoint must use the existing operational middleware access class.",
);

assert.match(
  generalPush,
  /subscriptionsForOrder\(order\)/,
  "Driver customer notifications must reuse the existing order subscription lookup.",
);

assert.match(
  generalPush,
  /queueAndSendGeneralNotification\(/,
  "Driver customer notifications must reuse the existing general notification queue and push sender.",
);

assert.match(
  generalPush,
  /order_driver_nearby/,
  "Driver notifications must use order_* event types so the existing service worker keeps order-notification behavior.",
);

assert.match(
  generalPush,
  /driver:nearby:\$\{order\.id\}:\$\{subscription\.id\}/,
  "Automatic nearby notification must have durable once-per-order/subscription dedupe.",
);

assert.match(
  planner,
  /const activeOrder = startedOrders\[0\] \|\| null;/,
  "The route planner must keep CURRENT A as the first started route stop.",
);

assert.match(
  planner,
  /if \(!activeOrder \|\| !livePosition\) return;/,
  "Automatic notification must only evaluate CURRENT A with a live Driver position.",
);

assert.match(
  planner,
  /distance > 650/,
  "Automatic nearby notification threshold must remain 650 metres.",
);

assert.match(
  planner,
  /templateId: "nearby"/,
  "The route planner must call the fixed nearby notification template.",
);

assert.doesNotMatch(
  planner,
  /for\s*\(\s*const\s+order\s+of\s+startedOrders[\s\S]{0,500}templateId:\s*"nearby"/,
  "Nearby notifications must never be broadcast across every started delivery.",
);

for (const templateId of [
  "at_door",
  "phone_unreachable",
  "no_answer",
  "address_unclear",
  "come_to_entrance",
]) {
  assert.match(
    details,
    new RegExp(templateId),
    `Manual Driver template ${templateId} must be present.`,
  );
}

assert.match(
  details,
  /\/api\/orders\/notification/,
  "Manual Driver messages must use the same protected order notification endpoint.",
);

console.log("Driver customer notification regression tests passed.");
