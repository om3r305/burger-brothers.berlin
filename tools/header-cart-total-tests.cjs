// Runs the real components/store.ts pricing (the NavBar header total) and
// checks it against the checkout/server rules for a delivery cart.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();
const originalResolveFilename = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];

const pricing = {
  discountRate: 0.1,
  surcharges: { burger: 2.8 },
  plzMin: { "13507": 15 },
  freebies: undefined,
};

const stubs = {
  "virtual:settings": {
    getPricingOverrides: () => pricing,
    readSettings: () => ({ cartOffers: [] }),
  },
  "virtual:campaigns-compat": { loadNormalizedCampaigns: () => [] },
};

const storage = new Map();
global.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
global.window = global.window || { localStorage: global.localStorage };

function resolveAlias(request) {
  if (request === "@/lib/settings") return "virtual:settings";
  if (request === "@/lib/campaigns-compat") return "virtual:campaigns-compat";
  if (!request.startsWith("@/")) return null;
  const base = path.join(root, request.slice(2));
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((candidate) =>
    fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  ) || null;
}

Module._resolveFilename = function resolveFilename(request, parent, ...rest) {
  const alias = resolveAlias(request);
  if (alias && alias.startsWith("virtual:")) return alias;
  if (alias) return originalResolveFilename.call(this, alias, parent, ...rest);
  return originalResolveFilename.call(this, request, parent, ...rest);
};

for (const [id, exports] of Object.entries(stubs)) {
  const stub = new Module(id);
  stub.filename = id;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[id] = stub;
}

require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

try {
  const { useCart } = require(path.join(root, "components/store.ts"));

  // 22,00 € burger + 3,00 € cheese extra = 25,00 € goods, 2,80 € delivery surcharge, 10 %.
  useCart.setState({
    orderMode: "delivery",
    plz: "13507",
    items: [
      {
        id: "all-american",
        category: "burger",
        item: { id: "all-american", sku: "all-american", name: "All American", price: 22, category: "burger" },
        add: [{ id: "kaese", label: "Käse", name: "Käse", price: 3 }],
        rm: [],
        qty: 1,
      },
    ],
  });

  const result = useCart.getState().computePricing();
  assert.equal(result.merchandise, 25);
  assert.equal(result.surcharges, 2.8, "no extra surcharge for cheese/bacon add-ons");
  assert.equal(result.discount, 2.78, "campaign rate also discounts the delivery surcharge");
  assert.equal(result.total, 25.02, "header total equals checkout total (was 25,80)");
  assert.equal(result.meetsMin, true);

  // Pickup: no surcharge, cent rounding (no 10-cent rounding).
  useCart.setState({ orderMode: "pickup" });
  const pickup = useCart.getState().computePricing();
  assert.equal(pickup.surcharges, 0);
  assert.equal(pickup.total, 22.5);

  console.log("Header cart total tests passed.");
} finally {
  Module._resolveFilename = originalResolveFilename;
  if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
  else delete require.extensions[".ts"];
}
