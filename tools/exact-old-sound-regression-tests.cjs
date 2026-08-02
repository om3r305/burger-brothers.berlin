const fs = require("fs");
const path = require("path");
const assert = require("assert");
const crypto = require("crypto");

const root = process.cwd();
const clientPath = path.join(root, "components", "schnellbestellung", "SchnellClient.tsx");
const successPath = path.join(root, "app", "schnellbestellung", "success", "page.tsx");
const swPath = path.join(root, "public", "sw.js");

for (const file of [clientPath, successPath, swPath]) {
  assert.ok(fs.existsSync(file), `missing ${file}`);
}

const client = fs.readFileSync(clientPath, "utf8");
const success = fs.readFileSync(successPath, "utf8");
const sw = fs.readFileSync(swPath, "utf8");

assert.ok(client.includes("function primeReadyAudio()"), "primeReadyAudio missing");
assert.ok(client.includes('new Audio("/sounds/dine-in.wav")'), "old media prime missing");
assert.ok(client.includes("const prime = media.play();"), "trusted gesture media prime missing");
assert.ok(client.includes("requestSchnellPushPermissionFromGesture();"), "push permission flow was accidentally removed");

assert.ok(success.includes("function playReadyAlert(timeoutIds: Set<number>)"), "old alert engine missing");
assert.ok(success.includes('message?.type !== "BB_SCHNELL_READY_PUSH"'), "early push listener missing");
assert.ok(!success.includes("BB_SCHNELL_NOTIFICATION_OPEN"), "new click-message engine still present");
assert.ok(!success.includes("scheduleReadyStartBurst"), "new retry engine still present");
assert.ok(!success.includes("pendingReadyEventRef"), "new pending engine still present");
assert.ok(success.includes("void context.resume().then(schedule).catch(() => undefined);"), "old resume-then-schedule behavior missing");
assert.ok(success.includes("Bestellung beenden"), "finish button missing");
assert.ok(success.includes("RewardCelebration"), "reward UI missing");
assert.ok(success.includes("paymentOpen"), "payment notice missing");

assert.ok(sw.includes('notifyOpenClients("BB_SCHNELL_READY_PUSH", readyEvent)'), "early push message missing");
assert.ok(sw.includes('if ("navigate" in client) await client.navigate(targetUrl);'), "old notification navigation missing");
assert.ok(!sw.includes("BB_SCHNELL_NOTIFICATION_OPEN"), "new no-navigation click flow still present");
assert.ok(!sw.includes('target.searchParams.set("readyOpen", "1")'), "readyOpen click workaround still present");

const clickIndex = sw.indexOf('self.addEventListener("notificationclick"');
const navigateIndex = sw.indexOf('client.navigate(targetUrl)', clickIndex);
const focusIndex = sw.indexOf('client.focus()', clickIndex);
assert.ok(clickIndex >= 0 && navigateIndex > clickIndex && focusIndex > navigateIndex, "navigate must happen before focus");

console.log("exact old Schnell sound regression tests: OK");
