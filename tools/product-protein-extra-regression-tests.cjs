const fs = require("node:fs");
const assert = require("node:assert/strict");
const helper = fs.readFileSync("lib/product-protein-extra.ts", "utf8");
const catalog = fs.readFileSync("app/api/catalog/route.ts", "utf8");
const pricing = fs.readFileSync("lib/server/order-pricing.ts", "utf8");

for (const label of [
  "Extra Beef",
  "Extra Black Angus",
  "Extra Crispy",
  "Extra Hähnchen",
  "Extra Farmers",
  "Extra Halloumi",
  "Extra Mozzarella",
  "Extra Vegan Tofu",
]) assert.ok(helper.includes(label), `missing label ${label}`);

assert.ok(helper.includes("beef|rind|rindfleisch"));
assert.ok(helper.includes("bb-protein-"));
assert.ok(helper.includes("defaultPrice, 3"));
assert.ok(catalog.includes("withProductProteinExtra"));
assert.ok(pricing.includes("withProductProteinExtra"));
assert.ok(pricing.includes("extras: extras.map(normalizeExtra)"));
console.log("product protein extra regression checks: OK");
