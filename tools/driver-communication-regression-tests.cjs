const assert = require("node:assert/strict");
const fs = require("node:fs");

const communication = fs.readFileSync("lib/server/driver-communication.ts", "utf8");
const route = fs.readFileSync("app/api/driver/notifications/route.ts", "utf8");
const planner = fs.readFileSync("components/driver/DriverRoutePlanner.tsx", "utf8");

for (const id of ["at_door", "phone_unreachable", "bell_no_answer", "unclear_address", "come_to_entrance"]) {
  assert.match(communication, new RegExp(`${id}:\\s*\\{`), `${id} must be server-approved`);
}
assert.match(route, /driverMessageTemplate\(body\?\.templateId\)/);
assert.doesNotMatch(route, /body\?\.(title|body)/, "arbitrary client copy must not be accepted");
assert.match(route, /orderAssignedToDriver\(order, driverSubject\)/);
assert.match(route, /order_assigned_to_other_driver/);
assert.match(route, /createdAt: \{ gte: since \}/, "manual messages need a durable cooldown");
assert.match(route, /driver_nearby:\$\{tenantId\}:\$\{order\.id\}:\$\{subscriptionId\}/);
assert.match(route, /currentRouteOrderId\(routeIds\) !== order\.id/);
assert.match(route, /assignedIds\.some\(\(id\) => !routeIds\.includes\(id\)\)/);
assert.match(planner, /const activeOrder = startedOrders\[0\] \|\| null/);
assert.match(planner, /routeOrderIds: startedOrders\.map/);
assert.match(planner, /distanceMeters\(origin, destination\) > DRIVER_NEARBY_DISTANCE_METERS/);

console.log("driver communication regression tests passed");
