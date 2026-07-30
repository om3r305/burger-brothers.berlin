const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const camera = read("components/rewards/RewardCamera.tsx");
const celebration = read("components/rewards/RewardCelebration.tsx");
const route = read("app/api/schnellbestellung/reward/submission/route.ts");

assert.match(camera, /onDraftChange\?: \(hasUnconfirmedPhoto: boolean\)/);
assert.match(camera, /setConfirmed\(Boolean\(file\)\)/);
assert.match(camera, /onDraftChange\?\.\(false\)/);
assert.match(camera, /✓ Foto ausgewählt/);
assert.match(camera, /✓ Wird mitgesendet/);

assert.match(celebration, /const \[photoDraft, setPhotoDraft\]/);
assert.match(celebration, /consent && !photoDraft/);
assert.match(celebration, /form\.set\("expectsPhoto", String\(expectsPhoto\)\)/);
assert.match(celebration, /photo_not_received/);
assert.match(celebration, /onDraftChange=\{setPhotoDraft\}/);
assert.match(celebration, /Zuerst Foto verwenden/);

assert.match(route, /const expectsPhoto = String\(form\.get\("expectsPhoto"\)/);
assert.match(route, /expectsPhoto && !photo/);
assert.match(route, /error: "photo_missing"/);
assert.match(route, /error: "submission_already_name_only"/);
assert.match(route, /photoReceived: Boolean\(photo\)/);

console.log("reward photo confirmation regression tests: OK");
