const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const guard = read("lib/server/burger-studio-order-guard.ts");
const pricing = read("lib/server/order-pricing.ts");
const sync = read("app/api/admin/burger-studio/sync/route.ts");
const catalog = read("app/api/catalog/route.ts");

assert(guard.includes("markerCount !== 1"));
assert(guard.includes("count > ingredient.max"));
assert(guard.includes("total > config.maxIngredients"));
assert(guard.includes("!completion.hasExactlyOneBun"));
assert(guard.includes("!completion.hasProtein"));
assert(pricing.includes("validateBurgerStudioCanonicalSelection"));
assert(pricing.includes("throw new OrderPricingError"));
assert(sync.includes("BURGER_STUDIO_SCRATCH_SKU"));
assert(sync.includes("active: scratchActive"));
assert(catalog.includes("BURGER_STUDIO_SCRATCH_SKU"));
assert(catalog.includes("NOT:"));

console.log("Burger Studio V2 canonical guard checks: OK");
