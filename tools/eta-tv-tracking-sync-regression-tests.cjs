const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const domainPath = path.join(root, "lib", "tv", "domain.ts");
const hookPath = path.join(root, "hooks", "tv", "use-tv-orders.ts");
const trackPath = path.join(root, "app", "track", "[id]", "page.tsx");

for (const filePath of [domainPath, hookPath, trackPath]) {
  assert.equal(fs.existsSync(filePath), true, `missing ${filePath}`);
}

const domain = fs.readFileSync(domainPath, "utf8");
const hook = fs.readFileSync(hookPath, "utf8");
const track = fs.readFileSync(trackPath, "utf8");

assert.match(domain, /export function getOrderAcceptedMs/);
assert.match(domain, /meta\?\.acceptedAt/);
assert.match(domain, /getOrderStartMs\(order, undefined, order\.ts \?\? nowMs\)/);
assert.match(hook, /const safeDeadline =[\s\S]*?startMs && Number\.isFinite\(startMs\)/);
assert.match(track, /function acceptedStartMs/);
assert.match(track, /const start = acceptedStartMs\(order\) \?\? order\.ts \?\? nowMs/);
assert.match(track, /Math\.floor\(\(planned - nowMs\) \/ 60_000\)/);

function remaining({ now, createdAt, acceptedAt, etaMin, plannedAt = null }) {
  if (plannedAt && plannedAt > now) {
    return Math.max(0, Math.floor((plannedAt - now) / 60_000));
  }
  const start = acceptedAt || createdAt || now;
  return Math.max(0, Math.floor((start + etaMin * 60_000 - now) / 60_000));
}

const now = Date.UTC(2026, 6, 30, 0, 53, 0);
const createdAt = now - 31 * 60_000;
const acceptedAt = now;

assert.equal(
  remaining({ now, createdAt, acceptedAt, etaMin: 45 }),
  45,
  "accepted 45-minute ETA must show 45 on both TV and tracking",
);
assert.equal(
  remaining({ now: now + 5 * 60_000, createdAt, acceptedAt, etaMin: 45 }),
  40,
  "both screens must count down from the same acceptedAt timestamp",
);
assert.equal(
  remaining({ now, createdAt, acceptedAt: null, etaMin: 45 }),
  14,
  "legacy fallback demonstrates the old mismatch",
);
assert.equal(
  remaining({ now, createdAt, acceptedAt, etaMin: 45, plannedAt: now + 60 * 60_000 }),
  60,
  "planned target must not receive ETA a second time",
);

console.log("ETA TV/tracking sync regression tests passed.");
