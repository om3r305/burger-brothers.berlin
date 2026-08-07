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
assert.match(cache, /const MAX_RETAINED_WARM_IMAGES = 12/);
assert.match(cache, /image\.decode\?\.\(\)/);
assert.match(cache, /await Promise\.allSettled\(unique\.map\(warmImageUrl\)\)/);

// Sos, donut ve bubble tea kartları artık büyük PNG yerine WebP'yi seçmeli.
assert.match(sauceCard, /const optimizedSrc = optimizedLocalImageUrl\(src\) \|\| src/);
assert.match(sauceCard, /src=\{optimizedSrc\}/);

// Aktif kategorinin iki komşusu, kullanıcı kaydırmadan önce hazırlanmalı.
assert.match(catalogProvider, /const neighbors = \[keys\[currentIndex - 1\], keys\[currentIndex \+ 1\]\]/);
assert.match(catalogProvider, /void warmCategoryData\(key\)/);

// Public menü görselleri browser ve PWA katmanlarında cache'lenmeli.
assert.match(nextConfig, /public, max-age=300, stale-while-revalidate=604800/);
assert.match(nextConfig, /source: "\/images\/:path\*"/);
assert.match(serviceWorker, /const MENU_IMAGE_CACHE = "bb-menu-images-v1"/);
assert.match(serviceWorker, /function isMenuImageRequest\(/);
assert.match(serviceWorker, /event\.respondWith\(menuImageResponse\(event\)\)/);
assert.doesNotMatch(serviceWorker, /self\.addEventListener\("fetch", \(\) => \{\}\)/);

console.log("image navigation regression tests: OK");
