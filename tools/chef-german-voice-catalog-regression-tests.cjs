const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "app/chef/page.tsx"), "utf8");
const route = fs.readFileSync(path.join(root, "app/api/chef/route.ts"), "utf8");
const catalog = fs.readFileSync(path.join(root, "lib/server/chef-catalog.ts"), "utf8");
const server = fs.readFileSync(path.join(root, "lib/server/chef.js"), "utf8");
const voiceAI = fs.readFileSync(path.join(root, "lib/server/chef-voice-ai.ts"), "utf8");

assert.match(page, /recognition\.lang\s*=\s*"de-DE"/);
assert.match(page, /MediaRecorder/);
assert.match(page, /getUserMedia/);
assert.match(page, /Anhören/);
assert.match(page, /Neu aufnehmen/);
assert.match(page, /Löschen/);
assert.match(page, /Übernehmen/);
assert.match(page, /action:\s*"interpretVoice"/);
assert.match(page, /SMART FALLBACK/);
assert.match(page, /KI · OLLAMA/);
assert.match(page, /NUMBER_WORDS/);
assert.doesNotMatch(page, /if \(finalText\.trim\(\)\) applyVoice/);
assert.doesNotMatch(page, /Sesi listeye uygula/);
assert.doesNotMatch(page, /Akşam stok kontrolü/);
assert.doesNotMatch(page, /Kullanıcı adı/);
assert.doesNotMatch(page, /Mini Chicken/);

assert.match(route, /ensureChefCatalog\(\)/);
assert.match(route, /interpretChefVoiceWithAI/);
assert.match(route, /action === "interpretVoice"/);
assert.match(route, /voiceAI:\s*getChefVoiceAIConfig\(\)/);

assert.match(voiceAI, /CHEF_OLLAMA_URL/);
assert.match(voiceAI, /CHEF_OLLAMA_MODEL/);
assert.match(voiceAI, /format:\s*"json"/);
assert.match(voiceAI, /Erfinde niemals neue Produkte/);
assert.match(voiceAI, /confidence < 0\.5/);
assert.match(voiceAI, /map\.get\(itemId\)/);

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

console.log("BB Chef German UI, reviewable smart voice and live Extras catalog regression tests: OK");
