const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function loadTsModule(relative) {
  const filename = path.join(root, relative);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(output, filename);
  return mod.exports;
}

const runtime = loadTsModule("lib/showcase/runtime.ts");

const products = [
  { id: "big", name: "Big Daddy", category: "burger", price: 12.5, displayPrice: 10.5, originalPrice: 12.5, campaignBadge: "-16%", active: true, order: 2 },
  { id: "fit", name: "Fit Burger", category: "burger", price: 9.5, displayPrice: 9.5, active: true, order: 1 },
  { id: "cola-zero", name: "Zero", category: "drinks", groupKey: "drinks:cola", groupLabel: "Coca-Cola", price: 3.2, displayPrice: 3.2, depositAmount: 0.25, active: true, order: 1 },
  { id: "cola-classic", name: "Classic", category: "drinks", groupKey: "drinks:cola", groupLabel: "Coca-Cola", price: 3.2, displayPrice: 3.2, depositAmount: 0.25, active: true, order: 2 },
  { id: "fritz", name: "Kola", category: "drinks", groupKey: "drinks:fritz", groupLabel: "Fritz-Kola", price: 3.5, displayPrice: 3.5, active: true, order: 1001 },
];

const productScene = {
  id: "products",
  type: "product",
  name: "Ürün akışı",
  enabled: true,
  durationSeconds: 45,
  transition: "fade",
  productIds: ["big", "fit"],
  productSeconds: 12,
};

assert.deepEqual(
  runtime.selectedProductsForScene(productScene, products).map((item) => item.id),
  ["big", "fit"],
  "çoklu ürün sırası korunmalı",
);
assert.equal(
  runtime.effectiveShowcaseSceneDuration(productScene, { products }),
  24,
  "ürün sahnesi süresi ürün sayısına göre hesaplanmalı",
);

const menuScene = {
  id: "menu",
  type: "menu",
  name: "Dijital menü",
  enabled: true,
  durationSeconds: 45,
  transition: "fade",
  menuCategories: ["burger", "drinks"],
  menuItemsPerPage: 4,
  menuPageSeconds: 10,
};
const menuPages = runtime.buildShowcaseMenuPages(menuScene, products);
assert.deepEqual(
  menuPages.map((page) => page.groupLabel),
  ["Burger", "Coca-Cola", "Fritz-Kola"],
  "kategori ve mevcut varyant grupları ayrı menü sayfaları olmalı",
);
assert.equal(
  runtime.effectiveShowcaseSceneDuration(menuScene, { products }),
  30,
  "menü sahnesi süresi sayfa sayısına göre hesaplanmalı",
);
assert.deepEqual(
  runtime
    .buildShowcaseMenuPages({ ...menuScene, menuCategories: [] }, products)
    .map((page) => page.groupLabel),
  ["Burger", "Coca-Cola", "Fritz-Kola"],
  "kategori seçilmemişse ekran boş kalmamalı ve tüm aktif kategorilere düşmeli",
);

const checkout = read("app/checkout/page.tsx");
const onlineStart = checkout.indexOf('{paymentSettings.online && (');
const savedStart = checkout.indexOf('Gespeicherte Zahlungsart', onlineStart);
const trustStart = checkout.indexOf('<PaymentTrustBadges compact', onlineStart);
const splitStart = checkout.indexOf('Getrennt zahlen', onlineStart);
assert(onlineStart >= 0 && savedStart > onlineStart, "kayıtlı ödeme Online-Zahlung kartının içinde olmalı");
assert(trustStart > savedStart && splitStart > trustStart, "güven rozetleri online alanında, split ödeme ise sonrasında olmalı");
assert(!checkout.slice(onlineStart, savedStart).includes('✓ Gespeichert'), "yanıltıcı kayıtlı rozeti kaldırılmalı");

const admin = [
  read("app/admin/showcase/page.tsx"),
  read("lib/showcase/editor.ts"),
  read("components/showcase/admin/ProductSceneEditor.tsx"),
  read("components/showcase/admin/SceneBasicsEditor.tsx"),
].join("\n");
assert(admin.includes('menu: "Dijital menü"'), "Dijital menü sahnesi admin alanında bulunmalı");
assert(admin.includes("Çoklu ürün akışı"), "çoklu ürün düzenleyicisi bulunmalı");
assert(admin.includes("Bu sahnede kapalı"), "ürün ve menü sahnelerinde logo kapalı olmalı");

const stage = read("components/showcase/ShowcaseStage.tsx");
assert(stage.includes("productSpotlightVisual"), "ürün görseli için ayrı içerik alanı bulunmalı");
assert(stage.includes("productSpotlightInfo"), "ürün detay alanı bulunmalı");
assert(stage.includes("page.groupLabel"), "dijital menü mevcut içecek/ekstra grup başlıklarını kullanmalı");
assert(stage.includes("depositAmount"), "Pfand bilgisi menüde desteklenmeli");

const server = read("lib/showcase/server.ts");
assert(server.includes('bb_drink_groups_v1'), "içecek grupları DB Settings kaynağından alınmalı");
assert(server.includes('bb_extra_groups_v1'), "ekstra grupları DB Settings kaynağından alınmalı");
assert(server.includes("productCampaignPrice"), "ürün kampanya fiyatı vitrin snapshot'ına eklenmeli");

console.log("Showcase V3 regression tests: OK");
