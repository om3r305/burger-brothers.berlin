const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const success = read("app/schnellbestellung/success/page.tsx");
const once = read("lib/client/reward-display-once.ts");
const shell = read("app/admin/AdminShell.tsx");
const layout = read("app/admin/layout.tsx");
const controls = read("components/admin/AdminPwaControls.tsx");
const bell = read("components/admin/AdminAttentionBell.tsx");
const clientPush = read("lib/client/admin-push.ts");
const serverPush = read("lib/server/admin-push.ts");
const pushRoute = read("app/api/admin/push/route.ts");
const pendingRoute = read("app/api/admin/push/pending/route.ts");
const inbox = read("lib/server/admin-inbox.ts");
const sw = read("public/admin-sw.js");
const middleware = read("middleware.ts");
const css = read("app/globals.css");
const manifest = JSON.parse(read("public/admin/manifest.webmanifest"));

assert.match(success, /hasDisplayedSchnellReward/);
assert.match(success, /markSchnellRewardDisplayed\(orderId, reward\)/);
assert.match(success, /bb_schnell_reward:\$\{orderId\}/);
assert.match(once, /orderId.*winId/s);
assert.match(once, /MAX_AGE_MS/);
assert.match(once, /localStorage/);

assert.equal(manifest.id, "/admin/");
assert.equal(manifest.start_url, "/admin?source=pwa");
assert.equal(manifest.scope, "/admin/");
assert.equal(manifest.name, "Burger Brothers Admin");
assert.ok(
  manifest.icons.some(
    (icon) =>
      icon.src === "/admin/icons/admin-maskable-512.png" &&
      icon.purpose === "maskable",
  ),
);
assert.ok(manifest.shortcuts.length >= 4);

assert.match(layout, /manifest: "\/admin\/manifest\.webmanifest"/);
assert.match(layout, /admin-apple-touch-icon\.png/);
assert.match(shell, /bb-admin-app/);
assert.match(shell, /AdminPwaControls/);
assert.match(shell, /role="dialog"/);
assert.match(shell, /AdminNav/);
assert.match(controls, /activateAdminPushFromGesture/);
assert.match(controls, /Ana Ekrana Ekle/);
assert.match(controls, /Fotoğraf ve Google yorum bildirimleri açık/);

assert.match(clientPush, /register\("\/admin-sw\.js"/);
assert.match(clientPush, /scope: "\/admin\/"/);
assert.match(clientPush, /\/api\/admin\/push/);
assert.match(serverPush, /ADMIN_PUSH_APP_SCOPE = "admin_app"/);
assert.match(serverPush, /notifyAdminPushSubscribers/);
assert.match(serverPush, /adminInboxNotification\.findMany/);
assert.match(pushRoute, /requireSessionRole\(req, "admin"\)/);
assert.match(pushRoute, /requireMutationRole\(req, \["admin"\]\)/);
assert.match(pendingRoute, /readPendingAdminPushNotifications/);
assert.match(inbox, /scheduleAdminPushWake/);
assert.match(serverPush, /runAfterResponse/);
assert.match(serverPush, /__bbAdminPushWakeScheduledAt/);

assert.match(sw, /\/api\/admin\/push\/pending/);
assert.match(sw, /BB_ADMIN_PUSH/);
assert.match(sw, /admin-badge-96\.png/);
assert.match(sw, /safeAdminUrl/);
assert.match(bell, /BB_ADMIN_PUSH/);
assert.doesNotMatch(bell, /new Notification\(/);

assert.match(middleware, /"\/admin-sw\.js"/);
assert.match(middleware, /"\/admin\/icons"/);
assert.match(css, /BURGER BROTHERS ADMIN — MOBILE\/PWA LAYER/);
assert.match(css, /body:has\(\.bb-admin-app\) footer/);
assert.match(css, /font-size: 16px !important/);
assert.match(css, /div\):has\(> table\)/);

for (const file of [
  "public/admin/icons/admin-192.png",
  "public/admin/icons/admin-512.png",
  "public/admin/icons/admin-maskable-512.png",
  "public/admin/icons/admin-apple-touch-icon.png",
  "public/admin/icons/admin-badge-96.png",
]) {
  const stat = fs.statSync(path.join(root, file));
  assert.ok(stat.size > 500, `${file} should be a real image`);
}

console.log("admin mobile/PWA + reward once regression tests: OK");
