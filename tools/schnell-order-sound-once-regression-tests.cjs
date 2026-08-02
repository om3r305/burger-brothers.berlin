const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();

const client = fs.readFileSync(
  path.join(root, "components", "schnellbestellung", "SchnellClient.tsx"),
  "utf8",
);
const success = fs.readFileSync(
  path.join(root, "app", "schnellbestellung", "success", "page.tsx"),
  "utf8",
);
const sw = fs.readFileSync(path.join(root, "public", "sw.js"), "utf8");

assert.ok(
  client.includes("function playOrderConfirmationSoundOnce()"),
  "one-shot order sound function missing",
);
assert.ok(
  client.includes('new Audio("/sounds/dine-in.wav")'),
  "order confirmation audio file missing",
);
assert.ok(client.includes("media.loop = false;"), "order sound still loops");
assert.ok(client.includes("media.volume = 1;"), "order sound volume missing");
assert.ok(
  client.includes("playOrderConfirmationSoundOnce();"),
  "Ja bestellen does not play the one-shot sound",
);
assert.ok(
  client.includes("requestSchnellPushPermissionFromGesture();"),
  "push permission flow was removed",
);

for (const forbidden of [
  "__bbSchnellReadyKeepAlive",
  "stopReadyAudioKeepAlive",
  "primeReadyAudio",
]) {
  assert.ok(!client.includes(forbidden), `client keepalive remains: ${forbidden}`);
}

for (const forbidden of [
  "playReadyAlert",
  "stopReadyAlert",
  "activateReadyMedia",
  "getReadyMediaElement",
  "__bbSchnellReadyAudio",
  "readyTimeoutIdsRef",
  "pendingReadyEventRef",
  "lastReadyEventRef",
  "legacyReadyActiveRef",
]) {
  assert.ok(
    !success.includes(forbidden),
    `ready-screen audio remains: ${forbidden}`,
  );
}

assert.ok(
  success.includes('message?.type !== "BB_SCHNELL_READY_PUSH"'),
  "push status message handler missing",
);
assert.ok(
  success.includes('setStatus("ready");'),
  "push no longer updates the ready screen",
);
assert.ok(success.includes("Bestellung beenden"), "finish button missing");
assert.ok(success.includes("RewardCelebration"), "reward UI missing");
assert.ok(success.includes("paymentOpen"), "payment notice missing");

assert.ok(
  sw.includes('self.registration.showNotification(title'),
  "system push notification was removed",
);
assert.ok(
  sw.includes('type: "schnell_ready"'),
  "Schnell ready push metadata missing",
);

console.log("Schnell one-shot order sound regression tests: OK");
