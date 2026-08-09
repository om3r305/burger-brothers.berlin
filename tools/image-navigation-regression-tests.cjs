const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const cache = read("lib/public-data-cache.ts");
const catalogProvider = read("components/catalog/CatalogProvider.tsx");
const sauceCard = read("components/sauces/SauceCard.tsx");
const nextConfig = read("next.config.mjs");
const serviceWorker = read("public/sw.js");

// Ön yükleyici, kartın gerçek kullandığı WebP URL'sini ısıtmalı.
assert.match(
  cache,
  /import \{ optimizedLocalImageUrl \} from "@\/lib\/media\/local-optimized-image"/,
);
assert.match(cache, /function actualMenuImageUrl\(/);
assert.match(cache, /\.map\(actualMenuImageUrl\)/);
assert.match(cache, /const retainedWarmImages = new Map/);
assert.match(cache, /const MAX_RETAINED_WARM_IMAGES = 4/);
assert.match(cache, /const IMAGE_WARM_CONCURRENCY = 2/);
assert.doesNotMatch(cache, /image\.decode\?\.\(\)/);
assert.match(cache, /Math\.min\(IMAGE_WARM_CONCURRENCY, queue\.length\)/);
assert.match(cache, /category === "burger" \? 4 : 3/);

// Sos, donut ve bubble tea kartları artık büyük PNG yerine WebP'yi seçmeli.
assert.match(sauceCard, /const optimizedSrc = optimizedLocalImageUrl\(src\) \|\| src/);
assert.match(sauceCard, /src=\{optimizedSrc\}/);

// Sayfa açılır açılmaz komşu kategoriler topluca indirilmemeli.
assert.doesNotMatch(catalogProvider, /warmCategoryData/);
assert.doesNotMatch(catalogProvider, /const neighbors/);

// Public menü görsellerini HTTP cache yönetmeli; service worker her geçişte
// arka planda yeniden indirme başlatmamalı.
assert.match(nextConfig, /public, max-age=300, stale-while-revalidate=604800/);
assert.match(nextConfig, /source: "\/images\/:path\*"/);
assert.doesNotMatch(serviceWorker, /const MENU_IMAGE_CACHE/);
assert.doesNotMatch(serviceWorker, /function isMenuImageRequest\(/);
assert.doesNotMatch(serviceWorker, /event\.respondWith\(menuImageResponse\(event\)\)/);
assert.match(serviceWorker, /key\.startsWith\("bb-menu-images-"\)/);

console.log("image navigation regression tests: OK");
