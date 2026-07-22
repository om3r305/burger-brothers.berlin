const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

require.extensions[".ts"] = function compileTypeScript(mod, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  mod._compile(output, filename);
};


const runtime = require(path.join(root, "lib/showcase/runtime.ts"));
const config = require(path.join(root, "lib/showcase/config.ts"));

const products = [
  { id: "big", name: "Big Daddy", category: "burger", price: 12.5, displayPrice: 10.5, originalPrice: 12.5, campaignBadge: "-16%", active: true, order: 2 },
  { id: "fit", name: "Fit Burger", category: "burger", price: 9.5, displayPrice: 9.5, active: true, order: 1 },
  { id: "fries", name: "Fries", category: "extras", price: 3.7, displayPrice: 3.7, active: true, order: 1 },
  { id: "cola", name: "Coca-Cola", category: "drinks", groupKey: "drinks:cola", groupLabel: "Coca-Cola", price: 3.2, displayPrice: 3.2, active: true, order: 1 },
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
assert.deepEqual(runtime.selectedProductsForScene(productScene, products).map((item) => item.id), ["big", "fit"]);
assert.equal(runtime.effectiveShowcaseSceneDuration(productScene, { products }), 24);

const burgerOnly = {
  id: "menu",
  type: "menu",
  name: "Dijital menü",
  enabled: true,
  durationSeconds: 45,
  transition: "fade",
  menuCategories: ["burger"],
  menuItemsPerPage: 8,
  menuPageSeconds: 10,
};
const burgerPages = runtime.buildShowcaseMenuPages(burgerOnly, products);
assert.equal(burgerPages.length, 1, "yalnız Burger seçilince tek kategori oluşturulmalı");
assert(burgerPages.every((page) => page.category === "burger"), "Fries/içecek gibi seçilmeyen gruplar görünmemeli");
assert.equal(runtime.buildShowcaseMenuPages({ ...burgerOnly, menuCategories: [] }, products).length, 0, "boş seçim tüm gruplara geri düşmemeli");

const normalized = config.normalizeShowcaseScene({
  ...productScene,
  productImageScale: 999,
  productImageX: -999,
  productImageY: 999,
  productImageFit: "garbage",
  menuCategories: ["Burger", "BURGER", "fries", "drinks"],
});
assert.equal(normalized.productImageScale, 130);
assert.equal(normalized.productImageX, -40);
assert.equal(normalized.productImageY, 40);
assert.equal(normalized.productImageFit, "contain");
assert.deepEqual(normalized.menuCategories, ["burger", "extras", "drinks"]);

const admin = read("app/admin/showcase/page.tsx");
assert(admin.includes("Ürün görseli yerleşimi"), "ürün görsel boyut/konum paneli bulunmalı");
assert(admin.includes("21:9 Geniş"), "ultra geniş önizleme bulunmalı");
assert(admin.includes("9:16 Dikey"), "dikey önizleme bulunmalı");
assert(admin.includes("Yalnız bu grubu") || admin.includes("setOnlyMenuCategory"), "tek grup seçimi desteklenmeli");

const stage = read("components/showcase/ShowcaseStage.tsx");
const player = read("components/showcase/ShowcasePlayer.tsx");
const css = read("components/showcase/ShowcaseStage.module.css");
assert(stage.includes("sceneCanvas"), "ultra geniş güvenli sahne katmanı bulunmalı");
assert(stage.includes("ResizeObserver"), "dikey menü kapasitesi ekran ölçüsüne göre ayarlanmalı");
assert(stage.includes("productImageScale"), "ürün görsel ölçeği sahneye uygulanmalı");
assert(player.includes("menuPageSize"), "dikey TV menü süresi uyarlanmalı");
assert(css.includes("@container (max-aspect-ratio: 4/3)"), "dikey ekran container düzeni bulunmalı");
assert(css.includes("min-aspect-ratio: 39/20"), "ultra geniş ekran güvenli alanı bulunmalı");
assert(css.includes("--product-image-scale"), "ürün görsel CSS ölçek değişkeni bulunmalı");

console.log("Showcase V4 regression tests: OK");
