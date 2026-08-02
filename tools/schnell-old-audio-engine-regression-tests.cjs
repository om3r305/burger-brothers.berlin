const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const successPath = path.join(
  root,
  "app",
  "schnellbestellung",
  "success",
  "page.tsx",
);
const swPath = path.join(root, "public", "sw.js");

assert.ok(fs.existsSync(successPath), `missing: ${successPath}`);
assert.ok(fs.existsSync(swPath), `missing: ${swPath}`);

const success = fs.readFileSync(successPath, "utf8");
const sw = fs.readFileSync(swPath, "utf8");

for (const forbidden of [
  "primeReadyAudioChannel",
  "startPrimedWebAudioAlert",
  "pendingReadyEventRef",
  "readyAlertRunningRef",
  "readyAlertAttemptRef",
  "scheduleReadyStartBurst",
  "readyStartRetryIdsRef",
  "clearReadyStartRetries",
]) {
  assert.ok(!success.includes(forbidden), `new audio engine remains: ${forbidden}`);
}

for (const required of [
  "function playReadyAlert(timeoutIds: Set<number>)",
  "void context.resume().then(schedule).catch(() => undefined);",
  'new Audio("/sounds/dine-in.wav")',
  'message?.type !== "BB_SCHNELL_READY_PUSH"',
  'message?.type !== "BB_SCHNELL_NOTIFICATION_OPEN"',
  "playReadyAlert(readyTimeoutIdsRef.current);",
  "Bestellung beenden",
  "RewardCelebration",
  "paymentOpen",
]) {
  assert.ok(success.includes(required), `required marker missing: ${required}`);
}

const notifyIndex = sw.indexOf(
  'notifyOpenClients("BB_SCHNELL_READY_PUSH", readyEvent)',
);
const notificationIndex = sw.indexOf(
  "self.registration.showNotification(title",
  notifyIndex,
);

assert.ok(notifyIndex >= 0, "early ready push message missing in service worker");
assert.ok(
  notificationIndex > notifyIndex,
  "open clients must be notified before the system notification is shown",
);

const messageEffect = success.match(
  /if \(\s*message\?\.type !== "BB_SCHNELL_READY_PUSH"[\s\S]*?playReadyAlert\(readyTimeoutIdsRef\.current\);/,
);
assert.ok(
  messageEffect,
  "service worker message must start the alert immediately",
);
assert.ok(
  !messageEffect[0].includes("visibilityState"),
  "early push sound must not wait for visible state",
);

const pollBlock = success.match(
  /const readyEventId = String\(data\.readyEventId \|\| ""\)\.trim\(\);[\s\S]*?legacyReadyActiveRef\.current = false;/,
);
assert.ok(pollBlock, "ready event polling fallback missing");
assert.ok(
  !pollBlock[0].includes("visibilityState"),
  "polling fallback must not require visible state",
);

console.log("schnell old audio engine regression tests: OK");
