const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const clientPath = path.join(root, "components", "schnellbestellung", "SchnellClient.tsx");
const enterPath = path.join(root, "components", "schnellbestellung", "SchnellEnterClient.tsx");
const successPath = path.join(root, "app", "schnellbestellung", "success", "page.tsx");

for (const file of [clientPath, enterPath, successPath]) {
  assert.ok(fs.existsSync(file), `missing: ${file}`);
}

const client = fs.readFileSync(clientPath, "utf8");
const enter = fs.readFileSync(enterPath, "utf8");
const success = fs.readFileSync(successPath, "utf8");

assert.ok(client.includes("function primeReadyAudio()"), "primeReadyAudio missing");
assert.ok(client.includes('new Audio("/sounds/dine-in.wav")'), "ready audio file missing");
assert.ok(client.includes("const prime = media.play();"), "trusted-gesture media prime missing");
assert.ok(client.includes('sessionStorage.setItem("bb_schnell_ready_audio_primed", "1")'), "prime marker missing");

assert.ok(
  !client.includes("requestSchnellPushPermissionFromGesture"),
  "push permission must not share the final order gesture"
);

const confirmBlock = client.match(
  /onClick=\{\(\) => \{\s*primeReadyAudio\(\);([\s\S]*?)void placeOrder\(\);\s*\}\}/
);
assert.ok(confirmBlock, "Ja, bestellen flow missing");
assert.ok(
  !/Permission|requestSchnellPush/i.test(confirmBlock[1]),
  "permission request still exists between audio prime and order submission"
);

assert.ok(
  enter.includes("activateSchnellPushFromGesture"),
  "push permission activation must remain on Schnell entry flow"
);
assert.ok(
  success.includes("startPrimedWebAudioAlert") ||
    success.includes("playReadyAlert"),
  "success page ready alert missing"
);

console.log("schnell iOS audio gesture regression tests: OK");
