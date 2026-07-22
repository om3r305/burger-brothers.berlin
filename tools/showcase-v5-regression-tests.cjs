const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  { id: "big", name: "Big Daddy", category: "burger", imageUrl: "/big.png", price: 12.5, displayPrice: 10.5, originalPrice: 12.5, campaignBadge: "-16%", active: true, order: 2 },
  { id: "fit", name: "Fit Burger", category: "burger", imageUrl: "/fit.png", price: 9.5, displayPrice: 9.5, active: true, order: 1 },
  { id: "fries", name: "Fries", category: "extras", imageUrl: "/fries.png", price: 3.7, displayPrice: 3.7, active: true, order: 1 },
  { id: "cola", name: "Coca-Cola", category: "drinks", groupKey: "drinks:cola", groupLabel: "Coca-Cola", imageUrl: "/cola.png", price: 3.2, displayPrice: 3.2, active: true, order: 1 },
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
  menuShowImages: true,
  menuImageSize: 58,
};
const burgerPages = runtime.buildShowcaseMenuPages(burgerOnly, products);
assert.equal(burgerPages.length, 1, "yalnız Burger seçilince tek kategori oluşturulmalı");
assert(burgerPages.every((page) => page.category === "burger"), "seçilmeyen gruplar görünmemeli");
assert.equal(runtime.buildShowcaseMenuPages({ ...burgerOnly, menuCategories: [] }, products).length, 0, "boş seçim tüm gruplara geri düşmemeli");

const normalized = config.normalizeShowcaseScene({
  ...productScene,
  productImageScale: 999,
  productImageX: -999,
  productImageY: 999,
  productImageFit: "garbage",
  menuCategories: ["Burger", "BURGER", "fries", "drinks"],
  menuShowImages: "invalid",
  menuImageSize: 999,
});
assert.equal(normalized.productImageScale, 130);
assert.equal(normalized.productImageX, -40);
assert.equal(normalized.productImageY, 40);
assert.equal(normalized.productImageFit, "contain");
assert.deepEqual(normalized.menuCategories, ["burger", "extras", "drinks"]);
assert.equal(normalized.menuShowImages, true);
assert.equal(normalized.menuImageSize, 104);

const normalizedDocument = config.normalizeShowcaseDocument({ settings: { refreshSeconds: 60 } });
assert.equal(normalizedDocument.settings.refreshSeconds, 5, "eski 60 sn ayarı canlı senkron için 5 sn'ye düşürülmeli");

const admin = read("app/admin/showcase/page.tsx");
assert(admin.includes("üstte ürün görseli, altta ürün adı"), "tek parça ürün yerleşimi admin açıklamasında bulunmalı");
assert(admin.includes("Küçük ürün görselleri"), "dijital menü görsel kontrolü bulunmalı");
assert(admin.includes("menuImageSize"), "dijital menü küçük görsel boyutu ayarlanabilmeli");
assert(admin.includes("signalShowcasePublished"), "yayın sonrası açık ekranlara anlık sinyal gönderilmeli");
assert(admin.includes("2–5 saniye"), "admin canlı senkron geri bildirimi bulunmalı");

const stage = read("components/showcase/ShowcaseStage.tsx");
const player = read("components/showcase/ShowcasePlayer.tsx");
const css = read("components/showcase/ShowcaseStage.module.css");
assert(stage.includes("productSpotlight"), "tek parça ürün sahnesi kullanılmalı");
assert(!stage.includes("setDetails("), "eski iki aşamalı sağa kaydırma akışı kaldırılmalı");
assert(stage.includes("menuItemThumb"), "dijital menüde küçük ürün görselleri desteklenmeli");
assert(stage.includes("scene.menuShowImages !== false"), "küçük görseller admin ayarına bağlı olmalı");
assert(player.includes("BroadcastChannel"), "aynı cihazdaki açık Showcase sekmeleri anlık güncellenmeli");
assert(player.includes("Math.min(5"), "uzak TV güncelleme kontrolü en fazla 5 saniye olmalı");
assert(player.includes("bb_showcase_publish_ping"), "storage tabanlı canlı güncelleme sinyali bulunmalı");
assert(css.includes(".productSpotlight"), "tek parça ürün kartı CSS'i bulunmalı");
assert(css.includes(".menuItemThumb"), "küçük menü görseli CSS'i bulunmalı");
assert(css.includes("@container (max-aspect-ratio: 4/3)"), "dikey ekran düzeni korunmalı");
assert(css.includes("min-aspect-ratio: 39/20"), "ultra geniş güvenli alan korunmalı");

const route = read("app/api/showcase/route.ts");
assert(route.includes('"Cache-Control": "private, no-store'), "Showcase API canli yayin icin CDN cache kullanmamali");
assert(route.includes('"Vercel-CDN-Cache-Control": "no-store"'), "Vercel CDN canli yayin cache'i kapali olmali");

console.log("Showcase V5 regression tests: OK");
