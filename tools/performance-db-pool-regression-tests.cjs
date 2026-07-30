const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const db = read("lib/db.ts");
const prismaAlias = read("lib/server/prisma.ts");
const showcaseRoute = read("app/api/showcase/events/route.ts");
const showcaseQueue = read("lib/server/showcase-live-events.ts");
const showcasePlayer = read("components/showcase/ShowcasePlayer.tsx");
const schnell = read("lib/server/schnellbestellung.ts");
const rewards = read("lib/server/schnell-rewards.ts");
const orderRoute = read("app/api/schnellbestellung/orders/route.ts");
const tvHook = read("hooks/tv/use-tv-orders.ts");
const tvDomain = read("lib/tv/domain.ts");
const adminRewards = read("app/api/admin/rewards/route.ts");
const moderation = read("components/rewards/admin/RewardModerationPanel.tsx");
const attention = read("components/admin/AdminAttentionBell.tsx");
const enter = read("components/schnellbestellung/SchnellEnterClient.tsx");
const submission = read("app/api/schnellbestellung/reward/submission/route.ts");

assert.match(db, /PRISMA_CONNECTION_LIMIT/);
assert.match(db, /supabase_transaction_pooler/);
assert.match(db, /url\.searchParams\.set\(\s*"connection_limit"/);
assert.match(db, /url\.searchParams\.set\("pgbouncer", "true"\)/);
assert.match(db, /getPrismaRuntimeDiagnostics/);
assert.match(prismaAlias, /export \{ prisma \} from "@\/lib\/db"/);

const getHandler = showcaseRoute.split("export async function POST")[0];
assert.doesNotMatch(getHandler, /updateMany\(/, "Showcase GET polling must be read-only");
assert.match(getHandler, /LOOKAHEAD_MS/);
assert.match(showcaseRoute, /scheduledAt: event\.scheduledAt/);
assert.match(showcaseQueue, /createMany\(\{ data: rows \}\)/);
assert.match(showcaseQueue, /scheduledAt = new Date\(queuedAt\.getTime\(\) \+ 6_000\)/);
assert.doesNotMatch(showcaseQueue, /for \(const screenSlug of slugs\)[\s\S]*findFirst/);
assert.match(showcasePlayer, /4_000 \+ screenJitter/);
assert.match(showcasePlayer, /nextEvent\.scheduledAt/);
assert.doesNotMatch(showcasePlayer, /setInterval\(\(\) => void loadLiveEvent\(\), 2_000\)/);

assert.match(schnell, /SCHNELL_SETTINGS_CACHE_MS = 5_000/);
assert.match(schnell, /prepareCashSchnellOrder/);
assert.match(schnell, /transaction dışında hazırlanır/);
assert.match(schnell, /maxWait: 5_000/);
assert.match(schnell, /timeout: 15_000/);
assert.match(schnell, /error\?\.code === "P2024"/);
assert.doesNotMatch(schnell, /take: 100[\s\S]{0,500}matchingDeviceOrders = recent\.filter/);
assert.doesNotMatch(rewards, /take: 1_000/);
assert.match(rewards, /previousEligibleOrders = await params\.transaction\.order\.count/);
assert.match(orderRoute, /code === "DB_BUSY"/);
assert.match(orderRoute, /Server-Timing/);

assert.doesNotMatch(tvHook, /fetchOrdersFromOrdersCache/);
assert.match(tvHook, /refreshInFlightRef/);
assert.match(tvHook, /document\.visibilityState === "visible"/);
assert.match(tvDomain, /take=250/);
assert.doesNotMatch(tvDomain, /take=1000/);

assert.match(adminRewards, /CLEANUP_INTERVAL_MS = 5 \* 60_000/);
assert.doesNotMatch(adminRewards, /take: 1_000/);
assert.match(adminRewards, /prisma\.order\.count/);
assert.match(moderation, /30_000/);
assert.match(attention, /30_000/);
assert.doesNotMatch(
  submission,
  /runAfterResponse/,
  "Reward queue durability must not rely on a serverless after-response callback",
);
assert.match(submission, /Kuyruk\/bildirim bayrakları yalnız kalıcı DB yazımı/);
assert.match(submission, /showcaseQueued = events\.length > 0/);
assert.match(submission, /notificationQueued = true/);

assert.match(enter, /LOCATION_DEADLINE_MS = 10_000/);
assert.match(enter, /maximumAge: 120_000/);
assert.match(enter, /locationCheckEnabledRef/);
assert.match(enter, /gereksiz API turunu atla/);

console.log("performance / DB pool regression tests: OK");
