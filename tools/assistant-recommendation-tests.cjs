const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "lib/assistant/local-engine.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

const mod = { exports: {} };
new Function("require", "module", "exports", compiled)(require, mod, mod.exports);
const { runLocalAssistant } = mod.exports;

function product(id, name, category, price, description = "", badge = "") {
  return {
    id, sku: id, name, category, description,
    basePrice: price, displayPrice: price, badge,
    extras: [], allergens: [],
  };
}

const catalog = [
  product("ketchup", "Ketchup (To Go)", "sauces", 0.5, "Ketchup Dip"),
  product("mayo", "Mayonnaise (To Go)", "sauces", 0.5, "Mayonnaise Dip"),
  product("all-american", "All American", "burger", 6.5, "Klassischer Burger"),
  product("beef-bacon", "Beef & Bacon", "burger", 8.9, "Saftiger Burger mit Bacon"),
  product("vegan-classic", "Vegan Classic", "vegan", 7.9, "Veganer Burger"),
  product("chili-burger", "Hot Chili Burger", "burger", 9.4, "Scharf mit Chili und Jalapenos"),
  product("chili-sauce", "Hot Chili Sauce", "sauces", 1.2, "Sehr scharf Chili Dip"),
  product("pommes", "Pommes", "extras", 4.2, "Knusprige Pommes"),
  product("cola", "Cola", "drinks", 3.2, "Getraenk"),
];

const ids = (result) => (result.actions || []).map((action) => action.productId);

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const generic = ids(runLocalAssistant({ message: "Was empfiehlst du?", catalog }));
assert(
  generic[0] === "all-american" &&
    generic.every((id) => !["ketchup", "mayo", "chili-sauce"].includes(id)),
  "Generic recommendation is main-dish first, not condiment first",
);

const budget = ids(runLocalAssistant({
  message: "Was empfiehlst du unter 15 Euro?",
  catalog,
}));
assert(
  budget[0] === "all-american" &&
    budget.every((id) => !["ketchup", "mayo"].includes(id)),
  "Budget recommendation remains main-dish first",
);

const spicy = ids(runLocalAssistant({
  message: "Ich moechte etwas Scharfes",
  catalog,
}));
assert(
  spicy[0] === "chili-burger",
  "Spicy request prefers matching main dish over hot sauce",
);

const sauce = ids(runLocalAssistant({
  message: "Welche Sauce empfiehlst du?",
  catalog,
}));
assert(
  sauce.length > 0 &&
    sauce.every((id) => ["ketchup", "mayo", "chili-sauce"].includes(id)),
  "Explicit sauce request stays in sauce category",
);

const vegan = ids(runLocalAssistant({
  message: "Vegan unter 15 Euro",
  catalog,
}));
assert(
  vegan[0] === "vegan-classic",
  "Vegan budget request stays vegan",
);

if (process.exitCode) {
  console.error("\nAssistant recommendation behavior tests FAILED.");
  process.exit(process.exitCode);
}
console.log("\nAssistant recommendation behavior tests PASSED.");
