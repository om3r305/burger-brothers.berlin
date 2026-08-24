const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const requiredFiles = [
  "lib/burger-studio.ts",
  "lib/burger-studio-order-plan.ts",
  "components/burger-studio/BurgerStack.tsx",
  "components/burger-studio/BurgerStudioEntry.tsx",
  "app/burger-studio/page.tsx",
  "app/admin/burger-studio/page.tsx",
  "app/api/admin/burger-studio/sync/route.ts",
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

const model = read("lib/burger-studio.ts");
const orderPlan = read("lib/burger-studio-order-plan.ts");
const stack = read("components/burger-studio/BurgerStack.tsx");
const entry = read("components/burger-studio/BurgerStudioEntry.tsx");
const customer = read("app/burger-studio/page.tsx");
const admin = read("app/admin/burger-studio/page.tsx");
const syncRoute = read("app/api/admin/burger-studio/sync/route.ts");
const adminShell = read("app/admin/AdminShell.tsx");
const rootLayout = read("app/layout.tsx");
const menuPage = read("app/menu/page.tsx");
const schnellCatalogClient = read("lib/client/schnell-catalog.ts");

// Public feature must remain opt-in and disabled until Admin finishes canonical sync.
assert(model.includes("enabled: false"));
assert(customer.includes("if (!config.enabled && !preview)"));
assert(entry.includes("settings?.menu?.burgerStudio?.enabled === true"));

// v1 intentionally orders from a real menu product so the existing server-authoritative
// order-pricing pipeline remains the source of truth.
assert(admin.includes("scratchEnabled: false"));
assert(customer.includes("planBurgerStudioTemplateOrder"));
assert(customer.includes("linkedProduct"));
assert(customer.includes("addToCart({"));
assert(customer.includes("linkedProduct.sku"));
assert(customer.includes("🔥 BURGER STUDIO:"));

// Canonical extras must be synchronized before public settings can be saved/activated.
const syncIndex = admin.indexOf('fetch("/api/admin/burger-studio/sync"');
const settingsIndex = admin.indexOf('fetch("/api/settings"', syncIndex + 1);
assert(syncIndex >= 0, "Admin must call canonical Burger Studio sync");
assert(
  settingsIndex > syncIndex,
  "Canonical Burger Studio extras must sync before saving public activation settings",
);
assert(syncRoute.includes('requireMutationRole(req, ["admin"])'));
assert(syncRoute.includes('const STUDIO_PREFIX = "bstudio:"'));
assert(syncRoute.includes('id: "bstudio:marker"'));
assert(syncRoute.includes("tx.product.update"));
assert(syncRoute.includes("extrasJson"));
assert(syncRoute.includes("Prisma.JsonNull"));

// v1 never grants a removal/replacement credit. Every added ingredient uses its
// full canonical addPrice so a client cannot replay a discounted replacement extra.
assert(orderPlan.includes("bstudio:add:"));
assert(orderPlan.includes('id: "bstudio:marker"'));
assert(!orderPlan.includes("replacementPools"));
assert(!orderPlan.includes("bstudio:replace:"));
assert(!syncRoute.includes("bstudio:replace:"));
assert(model.includes("removeCredit: 0"));
assert(!model.includes("-Math.abs(deltaQty) * ingredient.removeCredit"));

// Server-only canonical Studio extras must never appear as regular customer modifiers.
assert(menuPage.includes('return !id.startsWith("bstudio:")'));
assert(schnellCatalogClient.includes('const BURGER_STUDIO_EXTRA_PREFIX = "bstudio:"'));
assert(schnellCatalogClient.includes("hideBurgerStudioCanonicalExtras"));

// Studio should be discoverable in customer and Admin shells without joining the normal
// category swipe sequence.
assert(entry.includes('const href = "/burger-studio"'));
assert(rootLayout.includes("<BurgerStudioEntry />"));
assert(adminShell.includes('href: "/admin/burger-studio"'));
assert(adminShell.includes('label: "Burger Studio"'));

// Reuse the existing central public settings cache. The entry must not create another
// settings network request/polling loop merely because it is mounted in the root layout.
assert(!entry.includes("fetchAndApplyRemoteSettings"));
assert(!entry.includes('fetch("/api/settings"'));
assert(entry.includes("bb_settings_changed"));

// The visual is deliberately lightweight 2.5D DOM/CSS. Do not introduce a WebGL runtime
// into this interaction without an explicit performance decision.
assert(!stack.includes("@react-three/fiber"));
assert(!stack.includes("@react-three/drei"));
assert(!stack.includes("THREE."));
assert(!stack.includes("<Canvas"));

console.log("Burger Studio regression tests: OK");
