const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const swipe = read("components/menu/MobileCategorySwipe.tsx");
const nav = read("components/NavBar.tsx");
const css = read("app/globals.css");
const settings = read("lib/settings.ts");
const settingsRoute = read("app/api/settings/route.ts");
const admin = read("app/admin/settings/page.tsx");
const editor = read("components/admin/MenuTransitionEditor.tsx");

assert.match(swipe, /function edgeRevealGeometry\(/);
assert.match(swipe, /"edge-glow": 6\.5/);
assert.match(swipe, /style === "edge-glow"[\s\S]*?normalized > 0[\s\S]*?\? 6\.5/);
assert.match(swipe, /--bb-swipe-color-strength/);
assert.doesNotMatch(swipe, /pinnedCornerBowGeometry/);
assert.match(swipe, /resolveMenuTransitionStyle\(settings, target\)/);
assert.match(swipe, /data-style="edge-glow"/);
assert.doesNotMatch(swipe, /MENU_TRANSITION_REQUEST_EVENT/);
assert.match(swipe, /activeThemePalette\(categoryAccent\)/);
assert.match(swipe, /return viewportWidth <= 900/);
assert.doesNotMatch(nav, /MENU_TRANSITION_REQUEST_EVENT/);
assert.match(nav, /Mobil özel[\s\S]*?yalnızca sağ\/sol parmak hareketinde çalışır/);
assert.match(nav, /import MobileCategorySwipe from "@\/components\/menu\/MobileCategorySwipe"/);
assert.match(nav, /<MobileCategorySwipe \/>/);

assert.match(css, /BB MOBILE CATEGORY SWIPE V12 - EDGE LIGHT PRO ENGINE/);
assert.match(css, /@media \(max-width: 900px\)[\s\S]*?bb-mobile-category-swipe--pro/);
assert.match(css, /data-style="edge-glow"/);
assert.match(css, /data-style="edge-glow"[\s\S]*?mask-image: linear-gradient/);
assert.match(css, /data-style="edge-glow"[\s\S]*?bb-mobile-category-swipe-real__edge-lines[\s\S]*?display: none/);
assert.match(css, /--bb-swipe-accent-2/);
assert.match(css, /data-style="cinematic-video"/);
assert.match(css, /data-style="theme-auto"/);
assert.match(css, /data-style="color-wave"/);
assert.match(css, /data-style="soft-ribbon"/);
assert.match(css, /V16: iOS Liquid Glass; metalik dolgu yok, tema yalnızca cama hafifçe yansır/);
assert.match(css, /backdrop-filter: blur\(6px\) saturate\(1\.34\) contrast\(1\.025\) brightness\(1\.065\)/);
assert.match(css, /--bb-swipe-reveal-width/);
assert.match(css, /transparent var\(--bb-swipe-reveal-width\)/);
assert.match(css, /data-style="minimal"[\s\S]*?rgba\(240,248,255,\.08\)/);
assert.match(css, /data-style="theme-auto"[\s\S]*?--bb-swipe-accent-2/);
assert.match(css, /color-mix\(in srgb, var\(--bb-swipe-theme-bg\) 3%, transparent\)/);
assert.match(css, /background-size: auto !important/);

assert.match(settings, /menuTransitions\?: MenuTransitionSettings/);
assert.match(settings, /normalizeMenuTransitionSettings\(merged\.menuTransitions\)/);
assert.match(settingsRoute, /"menuTransitions"/);
assert.match(admin, /<MenuTransitionEditor/);
assert.match(editor, /Kategoriye özel renk ve geçiş/);
assert.match(editor, /Önerilen ayarlara dön/);
assert.match(editor, /Temaya Uygun iOS Cam/);
assert.match(editor, /iOS Şeffaf Cam/);

console.log("menu transition regression tests: OK");
