const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const files = {
  core: "lib/server/schnellbestellung.ts",
  catalog: "app/api/schnellbestellung/catalog/route.ts",
  orders: "app/api/schnellbestellung/orders/route.ts",
  client: "components/schnellbestellung/SchnellClient.tsx",
  catalogClient: "lib/client/schnell-catalog.ts",
  adminPage: "app/admin/schnellbestellung/page.tsx",
  adminPanel:
    "components/schnellbestellung/admin/SchnellLunchMenuPanel.tsx",
  adminRoute: "app/api/admin/schnellbestellung/route.ts",
  print: "print-proxy/index.cjs",
  tvDomain: "lib/tv/domain.ts",
  tvTypes: "types/tv.ts",
  tvDetails: "components/tv/OrderDetailsModal.tsx",
  schema: "prisma/schema.prisma",
};

for (const file of Object.values(files)) {
  assert(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

const core = read(files.core);
const catalog = read(files.catalog);
const orders = read(files.orders);
const client = read(files.client);
const catalogClient = read(files.catalogClient);
const adminPage = read(files.adminPage);
const adminPanel = read(files.adminPanel);
const adminRoute = read(files.adminRoute);
const print = read(files.print);
const tvDomain = read(files.tvDomain);
const tvTypes = read(files.tvTypes);
const tvDetails = read(files.tvDetails);
const schema = read(files.schema);

// The lunch category is Schnellbestellung-only and appears directly after Vegan.
assert(
  /"burger",\s*"vegan",\s*"lunch"/s.test(core),
  "Mittagsmenü must appear beside Vegan in Schnellbestellung",
);
assert(core.includes('export type SchnellCategory = MenuNavKey | "lunch"'));
assert(core.includes('lunch: "Mittagsmenü"'));
assert(!schema.includes("model SchnellLunch"), "No Prisma lunch migration is required");

// Admin stores product references; only the menu base price is manually entered.
assert(adminPage.includes("SchnellLunchMenuPanel"));
assert(adminPanel.includes("Menü fiyatı (€) — manuel yazılan tek fiyat"));
assert(adminPanel.includes("Burger seç"));
assert(adminPanel.includes("Menüye dahil standart Beilage"));
assert(adminPanel.includes("Alternatif Beilage seçenekleri"));
assert(adminPanel.includes("Burada manuel fark alanı yoktur"));
assert(adminPanel.includes('product.category === "extras"'));
assert(adminPanel.includes('product.category === "burger" || product.category === "vegan"'));
assert(!adminPanel.includes("manualUpgradePrice"));
assert(!adminPanel.includes("sideUpgradePrice"));
assert(adminRoute.includes("applyVisibility: false"));

// Current DB/catalog prices drive the side upgrade at display and order time.
assert(
  core.includes("Number(product.price) - Number(includedSide.price)"),
  "Catalog upgrade must use current product prices",
);
assert(
  core.includes("Number(selectedSide!.price) - Number(includedSide!.price)"),
  "Server order pricing must recompute the current side difference",
);
assert(core.includes('priceSource: "database_product_difference"'));
assert(core.includes("allowedSideProductIds"));
assert(core.includes("selectedSideProductId"));
assert(client.includes("side.upgradePrice"));
assert(client.includes("Der Aufpreis wird automatisch aus den aktuellen Produktpreisen berechnet."));

// Server owns the schedule and the customer view automatically follows Berlin time.
assert(core.includes("getSchnellLunchAvailability"));
assert(core.includes('timeZone: "Europe/Berlin"'));
assert(core.includes('throw new Error("LUNCH_MENU_UNAVAILABLE")'));
assert(catalog.includes("lunchSchedule"));
assert(catalog.includes("requireActive: false"));
assert(client.includes("berlinLunchScheduleActive"));
assert(client.includes("window.setInterval(() => setClockMs(Date.now()), 15_000)"));
assert(client.includes("Das Mittagsmenü ist leider nicht mehr verfügbar"));
assert(orders.includes("createCashSchnellOrder"));

// Lunch campaigns and spontaneous reward stacking are blocked.
assert(
  /prepared\.canonicalItems\.some\(\s*\(item\) => item\.category === "lunch"/s.test(core),
  "Orders containing Mittagsmenü must not receive Schnell reward stacking",
);
assert(catalog.includes('product.sourceKind === "lunch_menu"'));

// Ketchup and mayonnaise stay visible, free at table, paid takeaway.
assert(core.includes("isComplimentaryTableSauce"));
assert(
  core.includes("!takeaway && isComplimentaryTableSauce"),
  "Free sauce rule must depend on dine-in",
);
assert(
  !core.includes("if (isComplimentaryTableSauce(product.category, product.name)) return false"),
  "Ketchup and mayonnaise must remain in the Schnell catalog",
);
assert(core.includes('freeReason: complimentaryTableSauce ? "dine_in_table_sauce"'));
assert(client.includes("isComplimentaryTableSauceProduct"));
assert(client.includes("to\\s+go"));
assert(client.includes('"Kostenlos"'));
assert(client.includes("productPriceLabel(product, takeaway)"));
assert(client.includes("productDisplayName(line.product, takeaway)"));
assert(
  /product\.category === "burger"[\s\S]*product\.category === "vegan"[\s\S]*product\.category === "lunch"/.test(client),
  "Mittagsmenü burger images must use the same normalized Schnell profile",
);

// Lunch badges stay below the image, the schedule is visible, and admin cards collapse.
assert(!client.includes('className="absolute left-2 top-2 z-10 rounded-full'));
assert(client.includes("product.lunchMenu.badge.trim()"));
assert(client.includes("activeLunchCategoryLabel"));
assert(client.includes("Mittagsmenü (${start}–${end})"));
assert(adminPanel.includes("aria-expanded={expanded}"));
assert(adminPanel.includes("setExpandedMenuId"));
assert(adminPanel.includes("Boş bırakırsan rozet gösterilmez"));
assert(adminPanel.includes('className="switch--sm'));
assert(adminPage.includes('className="switch--sm'));
assert(core.includes("take\\s*away|takeaway|zum\\s+mitnehmen"));
assert(core.includes("badge: cleanText(raw.badge, 60),"));
assert(!core.includes('badge: cleanText(raw.badge, 60) || "Mittagsmenü"'));

// Customer payload carries only product/choice identifiers; server canonicalizes prices.
assert(client.includes("selectedSideProductId: line.selectedSideProductId"));
assert(client.includes("reconcileCartWithCatalog"));
assert(client.includes('cache: "no-store"'));
assert(client.includes("}, 60_000)"));
assert(core.includes("prisma.product.findMany"));
assert(core.includes("menu.menuPrice + upgradePrice + extrasTotal"));
assert(core.includes("canonicalItems.push"));
assert(core.includes('sourceKind: "lunch_menu"'));

// Kitchen TV and receipt show the real replacement and price difference.
assert(core.includes("statt ${includedSide!.name}"));
assert(core.includes("upgradePrice.toLocaleString"));
assert(print.includes("Mittagsmenü"));
assert(print.includes("Kostenlos"));
assert(print.includes("complimentaryTableSauce"));
assert(tvDomain.includes('lunch: "Mittagsmenü"'));
assert(tvTypes.includes("complimentaryTableSauce?: boolean"));
assert(tvDetails.includes('? "Kostenlos"'));

// Cache versions must remain aligned so prefetched catalogs include lunch data.
assert(client.includes('const CATALOG_CACHE_KEY = "bb_schnell_catalog_v7"'));
assert(catalogClient.includes('const CATALOG_CACHE_KEY = "bb_schnell_catalog_v7"'));
assert(!client.includes("bb_schnell_catalog_v6"));
assert(!catalogClient.includes("bb_schnell_catalog_v6"));

console.log("schnell mittagsmenue regression tests: OK");
