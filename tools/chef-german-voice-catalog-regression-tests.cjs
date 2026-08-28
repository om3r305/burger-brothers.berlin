const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "app/chef/page.tsx"), "utf8");
const route = fs.readFileSync(path.join(root, "app/api/chef/route.ts"), "utf8");
const catalog = fs.readFileSync(path.join(root, "lib/server/chef-catalog.ts"), "utf8");
const server = fs.readFileSync(path.join(root, "lib/server/chef.js"), "utf8");

assert.match(page, /recognition\.lang\s*=\s*"de-DE"/);
assert.match(page, /applyVoice\(clean\)/);
assert.match(page, /NUMBER_WORDS/);
assert.match(page, /zwei Fries, drei Curly Fries/);
assert.doesNotMatch(page, /Sesi listeye uygula/);
assert.doesNotMatch(page, /Akşam stok kontrolü/);
assert.doesNotMatch(page, /Kullanıcı adı/);
assert.doesNotMatch(page, /Mini Chicken/);

assert.match(route, /ensureChefCatalog\(\)/);
assert.match(catalog, /bb_extra_groups_v1/);
assert.match(catalog, /Hähnchen & Snacks/);
assert.match(catalog, /Pommes & Beilagen/);
assert.match(catalog, /canonical\(row\.value\?\.name\) === "mini chicken"/);
assert.match(catalog, /active: false/);
assert.doesNotMatch(catalog, /name:\s*"Mini Chicken"/);

assert.match(server, /BB Chef · Bestandskontrolle/);
assert.match(server, /BB Chef · Bestellung erfasst/);
assert.match(server, /BB Chef · Heutige Vorbereitung/);
assert.match(server, /source: clean\(input\.source/);
assert.match(server, /voiceAliases:/);

console.log("BB Chef German UI, automatic voice and live Extras catalog regression tests: OK");
