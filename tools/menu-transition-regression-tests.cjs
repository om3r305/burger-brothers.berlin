const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const swipe = read("components/menu/MobileCategorySwipe.tsx");
const nav = read("components/NavBar.tsx");
const menu = read("app/menu/page.tsx");
const css = read("app/globals.css");
const settings = read("lib/settings.ts");
const settingsRoute = read("app/api/settings/route.ts");
const admin = read("app/admin/settings/page.tsx");
const editor = read("components/admin/MenuTransitionEditor.tsx");
const studio = read("components/burger-studio/BurgerStudioEntry.tsx");

// Sade geçiş: renkli kenar, etiket ve kategori videoları kaldırıldı.
assert.doesNotMatch(swipe, /edgeRevealGeometry|CATEGORY_VIDEOS|swipe-transitions|<video/);
assert.doesNotMatch(css, /bb-mobile-category-swipe/);
assert.ok(!fs.existsSync(path.join(root, "public/swipe-transitions")));
assert.match(swipe, /return viewportWidth <= 900/);
assert.match(swipe, /const LEAVING_CLASS = "bb-swipe-leaving"/);
assert.match(css, /html\.bb-swipe-leaving \.bb-route-view \{[^}]*opacity/);
assert.match(css, /html\.bb-swipe-arriving \.bb-route-view \{[^}]*animation: bbSwipeArrive/);

// Burger ↔ Vegan aynı sayfa: sunucuya RSC isteği atmadan anında değişir.
assert.match(swipe, /if \(nextPath === pathname\) \{\s*window\.history\.pushState\(null, "", href\)/);
assert.match(menu, /window\.history\.replaceState\(null, "", `\$\{pathname\}\?\$\{sp\.toString\(\)\}`\)/);

// Tek örnek: layout'ta. NavBar'da ikinci kopya her kaydırmayı iki kez tetikliyordu.
const layout = read("app/layout.tsx");
assert.match(layout, /<MobileCategorySwipe \/>/);
assert.doesNotMatch(nav, /<MobileCategorySwipe \/>/);

// Kayıtlı ayar biçimi korunur; admin yalnızca aç/kapa gösterir.
assert.match(settings, /menuTransitions\?: MenuTransitionSettings/);
assert.match(settings, /normalizeMenuTransitionSettings\(merged\.menuTransitions\)/);
assert.match(settingsRoute, /"menuTransitions"/);
assert.match(admin, /<MenuTransitionEditor/);
assert.match(editor, /Mobil kaydırma geçişi/);
assert.doesNotMatch(editor, /Sinematik Video|Kategoriye özel renk/);

// Burger Studio: ilk 5 sn gizli, sonra sağ ortada sessizce belirir.
assert.match(studio, /const FIRST_APPEAR_MS = 5_000/);
assert.match(studio, /data-appeared=\{appeared \? "true" : "false"\}/);
assert.match(studio, /\[data-appeared="false"\] \{\s*visibility: hidden/);
assert.match(studio, /right-3 top-1\/2 -translate-y-1\/2/);
assert.match(studio, /bb_burger_studio_floating_position_v2/);

console.log("menu transition regression tests: OK");
