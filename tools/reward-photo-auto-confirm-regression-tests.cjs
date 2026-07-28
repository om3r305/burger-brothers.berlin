const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const camera = fs.readFileSync(
  path.join(root, "components/rewards/RewardCamera.tsx"),
  "utf8",
);

assert.match(
  camera,
  /setConfirmed\(Boolean\(file\)\)/,
  "Captured photo must be confirmed automatically",
);
assert.match(
  camera,
  /onChange\(file, nextUrl\)/,
  "Captured file must be sent to the parent immediately",
);
assert.match(
  camera,
  /onDraftChange\?\.\(false\)/,
  "Photo draft state must be cleared immediately",
);
assert.doesNotMatch(
  camera,
  /const confirmPhoto\s*=/,
  "A second manual confirmation callback must not remain",
);
assert.doesNotMatch(
  camera,
  /Zuerst Foto verwenden/,
  "Camera component must not require a second photo confirmation",
);
assert.match(
  camera,
  /✓ Wird mitgesendet/,
  "The UI must clearly show that the photo is selected",
);
assert.match(
  camera,
  /Nochmal aufnehmen/,
  "Retake option must remain available",
);
assert.match(
  camera,
  /Foto entfernen/,
  "Remove-photo option must remain available",
);

console.log("reward photo auto-confirm regression tests: OK");
