const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const middleware = read("middleware.ts");
const route = read("app/api/schnellbestellung/reward/submission/route.ts");
const client = read("components/rewards/RewardCelebration.tsx");

assert.match(
  middleware,
  /path === "\/api\/schnellbestellung\/reward\/submission"[\s\S]*method === "POST"[\s\S]*return "public"/,
  "Reward submission POST must be public at middleware layer",
);

assert.match(
  route,
  /hasTrustedMutationOrigin\(req\)/,
  "Route must keep same-origin protection",
);
assert.match(
  route,
  /verifySessionToken\([\s\S]*SCHNELL_COOKIE/,
  "Route must keep signed Schnell session verification",
);
assert.match(
  route,
  /enforceRateLimit\(/,
  "Route must keep abuse protection",
);
assert.match(
  route,
  /orderMeta\.deviceId[\s\S]*session\.deviceId/,
  "Route must keep device/order ownership verification",
);
assert.match(
  route,
  /display_consent_required/,
  "Route must keep explicit display consent",
);
assert.match(
  client,
  /unauthorized:\s*"Die Bildschirmfreigabe/,
  "Client must explain stale middleware unauthorized errors",
);

console.log("reward share middleware regression tests: OK");
