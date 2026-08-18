const assert = require("node:assert/strict");
const fs = require("node:fs");

const communication = fs.readFileSync("lib/server/driver-communication.ts", "utf8");
const route = fs.readFileSync("app/api/driver/notifications/route.ts", "utf8");
const planner = fs.readFileSync("components/driver/DriverRoutePlanner.tsx", "utf8");
const statusRoute = fs.readFileSync("app/api/orders/status/route.ts", "utf8");
const ordersHook = fs.readFileSync("hooks/driver/use-driver-orders.ts", "utf8");
const orderDetails = fs.readFileSync("components/driver/OrderWithDetails.tsx", "utf8");

for (const id of [
  "at_door",
  "phone_unreachable",
  "bell_no_answer",
  "unclear_address",
  "come_to_entrance",
]) {
  assert.match(
    communication,
    new RegExp(`${id}:\\s*\\{`),
    `${id} must be server-approved`,
  );
}

assert.match(route, /driverMessageTemplate\(body\?\.templateId\)/);
assert.doesNotMatch(
  route,
  /body\?\.(title|body)/,
  "arbitrary client copy must not be accepted",
);
assert.match(route, /orderAssignedToDriver\(order, driverSubject\)/);
assert.match(route, /order_assigned_to_other_driver/);

// Legacy/German values must normalize into the same operational model used by
// the rest of the Driver stack so notification delivery cannot fail on raw DB values.
assert.match(route, /function normalizeOrderMode/);
assert.match(route, /"lieferung"/);
assert.match(route, /function normalizeOrderStatus/);
assert.match(route, /"on_the_way"/);
assert.match(route, /"unterwegs"/);
assert.match(route, /meta\.statusManual/);

// CURRENT A must be derived from server-owned delivery start timestamps, not
// from the client-maintained A/B/C/D array submitted with the proximity call.
assert.match(route, /serverCurrentStopId\(activeOrders, driverSubject\)/);
assert.match(route, /meta\.outForDeliveryAt/);
assert.doesNotMatch(
  route,
  /body\?\.routeOrderIds/,
  "nearby endpoint must not trust client route order",
);
assert.match(
  statusRoute,
  /nextMeta\.outForDeliveryAt[\s\S]*nextMeta\.outForDeliveryAt \?\? nowMs/,
  "status API must persist the first out_for_delivery timestamp",
);
assert.match(
  ordersHook,
  /for \(const order of candidates\)[\s\S]*await startDeliveryOnServer\(order, current\)/,
  "route starts must remain sequential so server timestamps preserve A/B/C/D",
);
assert.match(planner, /const activeOrder = startedOrders\[0\] \|\| null/);
assert.match(
  planner,
  /distanceMeters\(origin, destination\) > DRIVER_NEARBY_DISTANCE_METERS/,
);

// Automatic nearby remains DB-deduplicated per order/subscription.
assert.match(
  route,
  /driver_nearby:\$\{tenantId\}:\$\{order\.id\}:\$\{subscriptionId\}/,
);

// Manual cooldown must be reserved while holding a PostgreSQL row lock.
assert.match(route, /FOR UPDATE/);
assert.match(route, /driverMessageCooldowns/);
assert.match(route, /reservation\.reservationAt/);
assert.doesNotMatch(
  route,
  /driver_message:[^\n]*Date\.now\(\)/,
  "manual notification dedupe must not use Date.now() as its race guard",
);
assert.doesNotMatch(
  route,
  /notificationEvent\.findFirst[\s\S]*createdAt:\s*\{\s*gte:/,
  "manual cooldown must not use a non-atomic check-then-send query",
);

// Failed sends must be diagnosable on the Driver screen and must not leave a
// dead cooldown reservation behind.
assert.match(route, /clearCooldownReservation/);
assert.match(route, /driver_notification_push_failed/);
assert.match(route, /detailCode: safeInternalCode\(error\)/);
assert.match(orderDetails, /notificationErrorText/);
assert.match(orderDetails, /detailCode/);

console.log("driver communication regression tests passed");
