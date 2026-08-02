const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const client = fs.readFileSync(
  path.join(root, "components/schnellbestellung/SchnellClient.tsx"),
  "utf8",
);
const success = fs.readFileSync(
  path.join(root, "app/schnellbestellung/success/page.tsx"),
  "utf8",
);
const sw = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");

assert.ok(client.includes("__bbSchnellReadyKeepAlive"), "keepalive state missing");
assert.ok(client.includes("media.loop = true;"), "armed audio loop missing");
assert.ok(client.includes("media.volume = 0.0001;"), "inaudible armed volume missing");
assert.ok(client.includes("const armed = media.play();"), "trusted-gesture playback missing");
assert.ok(client.includes("stopReadyAudioKeepAlive();"), "failed-order cleanup missing");

const prime = client.match(
  /function primeReadyAudio\(\)[\s\S]*?export default function SchnellClient/,
);
assert.ok(prime, "primeReadyAudio block missing");
assert.ok(!prime[0].includes("media.pause();"), "armed audio is still paused");

assert.ok(success.includes("function activateReadyMedia"), "ready activation missing");
assert.ok(success.includes("if (!media.paused)"), "running-media path missing");
assert.ok(success.includes("media.volume = 1;"), "ready volume activation missing");
assert.ok(success.includes("BB_SCHNELL_NOTIFICATION_OPEN"), "notification-open event missing");
assert.ok(success.includes("pendingReadyEventRef"), "pending ready event missing");

assert.ok(sw.includes('const PUSH_STATE_CACHE = "bb-push-state-v5";'), "SW version missing");
assert.ok(sw.includes("BB_SCHNELL_NOTIFICATION_OPEN"), "SW open message missing");
const click = sw.slice(sw.indexOf('self.addEventListener("notificationclick"'));
assert.ok(click.includes("client.postMessage(openMessage);"), "open message not posted");
assert.ok(click.includes("await client.focus();"), "success page is not focused");

console.log("Schnell keepalive ready-audio regression tests: OK");
