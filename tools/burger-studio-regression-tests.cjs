const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const requiredFiles = [
  "lib/burger-studio.ts",
  "lib/burger-studio-v2.ts",
  "lib/burger-studio-order-plan.ts",
  "lib/burger-studio-v2-order-plan.ts",
  "lib/server/burger-studio-order-guard.ts",
  "components/burger-studio/BurgerStackV2.tsx",
  "components/burger-studio/BurgerStudioV2.tsx",
  "components/burger-studio/BurgerStudioAdminV2.tsx",
  "components/burger-studio/BurgerStudioEntry.tsx",
  "app/burger-studio/page.tsx",
  "app/admin/burger-studio/page.tsx",
  "app/api/admin/burger-studio/sync/route.ts",
  "app/api/catalog/route.ts",
  "lib/server/order-pricing.ts",
  "app/admin/AdminShell.tsx",
  "app/layout.tsx",
  "app/menu/page.tsx",
  "lib/client/schnell-catalog.ts",
];

for (const relativePath of requiredFiles) {
  assert(
    fs.existsSync(path.join(root, relativePath)),
    `Burger Studio required file missing: ${relativePath}`,
  );
}

const legacyModel = read("lib/burger-studio.ts");
const model = read("lib/burger-studio-v2.ts");
const orderPlan = read("lib/burger-studio-v2-order-plan.ts");
const guard = read("lib/server/burger-studio-order-guard.ts");
const stack = read("components/burger-studio/BurgerStackV2.tsx");
const customer = read("components/burger-studio/BurgerStudioV2.tsx");
const admin = read("components/burger-studio/BurgerStudioAdminV2.tsx");
const customerRoute = read("app/burger-studio/page.tsx");
const adminRoute = read("app/admin/burger-studio/page.tsx");
const syncRoute = read("app/api/admin/burger-studio/sync/route.ts");
const catalogRoute = read("app/api/catalog/route.ts");
const pricing = read("lib/server/order-pricing.ts");
const entry = read("components/burger-studio/BurgerStudioEntry.tsx");
const adminShell = read("app/admin/AdminShell.tsx");
const rootLayout = read("app/layout.tsx");
const menuPage = read("app/menu/page.tsx");
const schnellCatalogClient = read("lib/client/schnell-catalog.ts");

// Public feature remains opt-in; preview can render while disabled.
assert(legacyModel.includes("enabled: false"));
assert(customer.includes("if (!config.enabled && !preview)"));
assert(entry.includes("settings?.menu?.burgerStudio?.enabled === true"));

// V2 migrates the old forced-template setup into real Freestyle without deleting
// existing templates or ingredients.
assert(model.includes('version: 2'));
assert(model.includes('BURGER_STUDIO_SCRATCH_SKU'));
assert(model.includes('sourceVersion < 2 ? true'));
assert(model.includes('smash-brioche'));
assert(model.includes('gluten-free-bun'));
assert(model.includes('Classic Bun'));
assert(model.includes('Grüner Salat'));
assert(model.includes('hasExactlyOneBun'));
assert(model.includes('hasProtein'));

// Customer route mounts the new freestyle-first game flow. No existing burger is
// required; templates remain optional inspiration.
assert(customerRoute.includes("<BurgerStudioV2 />"));
assert(customer.includes("chooseFreestyle"));
assert(customer.includes("Von null bauen"));
assert(customer.includes("Kein Burger muss gewählt werden"));
assert(customer.includes("finishBurger"));
assert(customer.includes("assembled"));
assert(customer.includes("BurgerStackV2"));
assert(customer.includes("BURGER_STUDIO_SCRATCH_SKU"));
assert(customer.includes("addToCart({"));
assert(customer.includes("🔥 BURGER STUDIO:"));
assert(customer.includes("Erst Burger fertig machen"));

// Bun choice is exclusive; completion requires exactly one bun and at least one
// protein before assembly/order is allowed.
assert(model.includes("setExclusiveBurgerStudioBun"));
assert(customer.includes("completion.hasExactlyOneBun"));
assert(customer.includes("completion.hasProtein"));
assert(customer.includes("disabled={!canFinish}"));
assert(customer.includes("disabled={!canOrder}"));

// Admin V2 exposes Freestyle and no longer forces scratchEnabled=false.
assert(adminRoute.includes("<BurgerStudioAdminV2 />"));
assert(admin.includes('title="Freestyle"'));
assert(admin.includes("Freestyle baz €"));
assert(admin.includes("+ Bun"));
assert(admin.includes("Hazır Burger Şablonları"));
assert(admin.includes("Opsiyonel"));
assert(!admin.includes("scratchEnabled: false"));

// Canonical sync must happen before public settings save. Freestyle receives an
// internal canonical Product that is not meant for normal customer surfaces.
const syncIndex = admin.indexOf('fetch("/api/admin/burger-studio/sync"');
const settingsIndex = admin.indexOf('fetch("/api/settings"', syncIndex + 1);
assert(syncIndex >= 0, "Admin must call canonical Burger Studio sync");
assert(
  settingsIndex > syncIndex,
  "Canonical Burger Studio data must sync before saving public activation settings",
);
assert(syncRoute.includes('requireMutationRole(req, ["admin"])'));
assert(syncRoute.includes("BURGER_STUDIO_SCRATCH_SKU"));
assert(syncRoute.includes("BURGER_STUDIO_SCRATCH_NAME"));
assert(syncRoute.includes('id: "bstudio:marker"'));
assert(syncRoute.includes("tx.product.create"));
assert(syncRoute.includes("tx.product.update"));
assert(syncRoute.includes("scratchReady"));

// Public catalog and Schnell must hide the internal Freestyle base while normal
// menu modifiers still hide all bstudio:* canonical extras.
assert(catalogRoute.includes("BURGER_STUDIO_SCRATCH_SKU"));
assert(catalogRoute.includes(".filter("));
assert(catalogRoute.includes("NOT:"));
assert(menuPage.includes('return !id.startsWith("bstudio:")'));
assert(schnellCatalogClient.includes("BURGER_STUDIO_SCRATCH_SKU"));
assert(schnellCatalogClient.includes("isBurgerStudioInternalProduct"));
assert(schnellCatalogClient.includes("hideBurgerStudioCanonicalExtras"));

// Server-authoritative price path revalidates Studio state, mode, marker, ingredient
// activity, max quantities and Freestyle bun/protein requirements.
assert(pricing.includes("validateBurgerStudioCanonicalSelection"));
assert(pricing.includes("studioGuard"));
assert(pricing.includes("BURGER_STUDIO_SCRATCH_SKU"));
assert(guard.includes("BURGER_STUDIO_MARKER_INVALID"));
assert(guard.includes("BURGER_STUDIO_INGREDIENT_QTY_INVALID"));
assert(guard.includes("BURGER_STUDIO_BUN_REQUIRED"));
assert(guard.includes("BURGER_STUDIO_PROTEIN_REQUIRED"));
assert(guard.includes("BURGER_STUDIO_TOO_MANY_INGREDIENTS"));

// Freestyle price plan uses the internal canonical base and canonical ingredient
// extras. Removal/replacement credit stays disabled.
assert(orderPlan.includes("BURGER_STUDIO_SCRATCH_SKU"));
assert(orderPlan.includes("bstudio:add:"));
assert(orderPlan.includes('id: "bstudio:marker"'));
assert(!orderPlan.includes("bstudio:replace:"));
assert(!guard.includes("bstudio:replace:"));
assert(legacyModel.includes("removeCredit: 0"));

// Customer and Admin shells expose Studio without adding it to the normal category
// swipe sequence. Entry reuses central settings cache and adds no polling/fetch.
assert(entry.includes('const href = "/burger-studio"'));
assert(rootLayout.includes("<BurgerStudioEntry />"));
assert(adminShell.includes('href: "/admin/burger-studio"'));
assert(adminShell.includes('label: "Burger Studio"'));
assert(!entry.includes("fetchAndApplyRemoteSettings"));
assert(!entry.includes('fetch("/api/settings"'));
assert(entry.includes("bb_settings_changed"));

// Game visual stays lightweight DOM/CSS: floating layers while editing, staggered
// physical assembly on Fertig, and no WebGL/Three runtime.
assert(stack.includes("is-building"));
assert(stack.includes("is-assembled"));
assert(stack.includes("transition-delay"));
assert(stack.includes("cubic-bezier"));
assert(stack.includes("bsv2-layer--beef"));
assert(stack.includes("bsv2-layer--crispy"));
assert(stack.includes("bsv2-layer--lettuce"));
assert(stack.includes("bsv2-bun--gluten-free"));
assert(!stack.includes("@react-three/fiber"));
assert(!stack.includes("@react-three/drei"));
assert(!stack.includes("THREE."));
assert(!stack.includes("<Canvas"));

console.log("Burger Studio V2 regression tests: OK");
