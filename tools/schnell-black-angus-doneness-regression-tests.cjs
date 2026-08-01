const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const files = {
  client: "components/schnellbestellung/SchnellClient.tsx",
  catalog: "app/api/schnellbestellung/catalog/route.ts",
  orderCore: "lib/server/schnellbestellung.ts",
  orderRoute: "app/api/schnellbestellung/orders/route.ts",
  printJobs: "app/api/print/jobs/route.ts",
  printAgent: "print-agent/agent.mjs",
  printProxy: "print-proxy/index.cjs",
  catalogClient: "lib/client/schnell-catalog.ts",
};

for (const relativePath of Object.values(files)) {
  assert(fs.existsSync(path.join(root, relativePath)), `missing ${relativePath}`);
}

const client = read(files.client);
const catalog = read(files.catalog);
const orderCore = read(files.orderCore);
const orderRoute = read(files.orderRoute);
const printJobs = read(files.printJobs);
const printAgent = read(files.printAgent);
const printProxy = read(files.printProxy);
const catalogClient = read(files.catalogClient);

for (const label of [
  "Leicht gebraten",
  "Normal gebraten",
  "Durchgebraten",
]) {
  assert(client.includes(label), `client missing ${label}`);
  assert(orderCore.includes(label), `server missing ${label}`);
  assert(printProxy.includes(label), `print proxy missing ${label}`);
}

assert(client.includes('type Doneness = "light" | "normal" | "well_done"'));
assert(client.includes("Wie soll das Fleisch gebraten werden?"));
assert(client.includes("Pflichtauswahl für Black Angus"));
assert(client.includes("productRequiresDoneness(selectedProduct)"));
assert(client.includes("doneness: requiresDoneness ? doneness : undefined"));
assert(client.includes("doneness: line.doneness"));
assert(client.includes("doneness: line.doneness ||"));
assert(client.includes("doneness: productRequiresDoneness(product) ? doneness : undefined"));
assert(client.includes("Garstufe: {donenessLabel(line.doneness)}"));
assert(client.includes("bb_schnell_catalog_v8"));
assert(catalogClient.includes("bb_schnell_catalog_v8"));
assert(!client.includes("bb_schnell_catalog_v7"));
assert(!catalogClient.includes("bb_schnell_catalog_v7"));

assert(catalog.includes("schnellProductRequiresDoneness"));
assert(catalog.includes("requiresDoneness: schnellProductRequiresDoneness(product)"));

assert(orderCore.includes("export function schnellProductRequiresDoneness"));
assert(orderCore.includes('sku.startsWith("burger-black-angus-burger-")'));
assert(orderCore.includes("DONENESS_REQUIRED"));
assert(orderCore.includes("normalizeSchnellDoneness(rawItem.doneness)"));
assert(orderCore.includes("SCHNELL_DONENESS_LABELS[doneness]"));
assert(orderCore.includes("schnellProductRequiresDoneness(burger!)"));
assert(orderCore.includes("schnellProductRequiresDoneness(product)"));
assert(orderRoute.includes("createCashSchnellOrder"));

assert(printJobs.includes("doneness: normalizeDoneness(item?.doneness)"));
assert(printAgent.includes("doneness: normalizeDoneness(item.doneness)"));
assert(printProxy.includes("function receiptDonenessLabel(item)"));
assert(printProxy.includes("text('GARSTUFE')"));
assert(printProxy.includes("text(doneness.toUpperCase())"));

const allowedFiles = new Set([
  files.client,
  files.catalog,
  files.orderCore,
  files.orderRoute,
  files.printJobs,
  files.printAgent,
  files.printProxy,
  files.catalogClient,
  "tools/schnellbestellung-regression-tests.cjs",
  "tools/schnell-mittagsmenue-regression-tests.cjs",
  "tools/schnell-black-angus-doneness-regression-tests.cjs",
  "package.json",
]);
assert(allowedFiles.has(files.orderCore));

console.log("Black Angus doneness regression tests: OK");
