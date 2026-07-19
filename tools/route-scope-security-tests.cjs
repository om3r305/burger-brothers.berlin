"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();

function source(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

const legacyOrders = source("app/api/orders/route.ts");
assert.match(
  legacyOrders,
  /requireAnySessionRole\(req, \["admin", "tv"\]\)/,
  "legacy order reads must be limited to admin/TV sessions",
);
assert.doesNotMatch(
  legacyOrders,
  /requireAnySessionRole\(req, \["admin", "tv", "driver"\]\)/,
  "driver sessions must not read the legacy full-order endpoint",
);

const lookup = source("app/api/track/lookup/route.ts");
assert.doesNotMatch(
  lookup,
  /hasAnySessionRole\(req, \["admin", "tv", "driver"\]\)/,
  "driver sessions must not bypass public tracking-token checks",
);
assert.match(
  lookup,
  /payment_session_not_operational_order/,
  "TV tracking lookup must reject internal payment-session records",
);

const sessionRoute = source("app/api/track/[session]/route.ts");
assert.match(
  sessionRoute,
  /tracking_session_owned_by_other_driver/,
  "tracking-session reads must enforce driver ownership",
);
assert.match(
  sessionRoute,
  /const isAdmin = await hasSessionRole\(req, "admin"\)/,
  "admin tracking writes must ignore stale driver cookies",
);

const byOrder = source("app/api/track/by-order/[orderId]/route.ts");
assert.match(
  byOrder,
  /orderAssignedToDriver\(order, driverSubject\)/,
  "driver tracking lookup must be bound to the assigned order",
);
assert.match(
  byOrder,
  /driverSubject \? \{ driverId: driverSubject \} : \{\}/,
  "driver tracking lookup must only return the driver's own session",
);

for (const route of [
  "app/api/orders/list/route.ts",
  "app/api/orders/status/route.ts",
  "app/api/orders/claim/route.ts",
]) {
  assert.match(
    source(route),
    /startsWith\("payment_"\)/,
    `${route} must reject every internal payment-session status`,
  );
}

for (const route of [
  "app/api/admin/db/health/route.ts",
  "app/api/admin/orders/[id]/route.ts",
]) {
  assert.match(
    source(route),
    /requireSessionRole\(req, "admin"\)/,
    `${route} must enforce route-level admin authentication`,
  );
}

const cron = source("app/api/admin/cron/daily-backup/route.ts");
assert.match(
  cron,
  /process\.env\.NODE_ENV === "production"/,
  "cron authentication must fail closed in every production runtime",
);
assert.match(
  cron,
  /if \(production\) \{\s*return false;/,
  "cron endpoint must reject production requests when CRON_SECRET is missing",
);

for (const page of [
  "app/admin/print/page.tsx",
  "app/api/admin/print/page.tsx",
]) {
  assert.doesNotMatch(
    source(page),
    /api\.qrserver\.com/,
    `${page} must not send customer addresses to an external QR service`,
  );
  assert.match(
    source(page),
    /from "react-qr-code"/,
    `${page} must render map QR codes locally`,
  );
}

console.log("Route scope security tests passed.");
