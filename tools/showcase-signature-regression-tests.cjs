const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// signature.ts yalnızca tip import ediyor; derleyip gerçek mantığı çalıştırırız.
const compiled = ts.transpileModule(read("lib/showcase/signature.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", compiled)(mod, mod.exports, require);
const sig = mod.exports;

const product = (name, text, category = "burger") => ({
  id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  ingredientsText: text,
  category,
  price: 9,
  displayPrice: 9,
});

// Otomatik katman tahmini: menüdeki gerçek açıklamalar.
assert.deepEqual(
  sig.autoSignatureLayers(product("Big Daddy", "mit Salat, doppelt Bacon, doppelt Fleisch, doppelt Cheddarkäse")),
  ["bun-classic", "bb-sauce", "cheddar", "cheddar", "bacon", "bacon", "beef", "beef", "onion", "tomato", "lettuce", "bun-bottom"],
);
assert.deepEqual(
  sig.autoSignatureLayers(product("Smashburger", "2×80g Rinderhack, 2× Cheddar & karamellisierte Zwiebeln")),
  ["bun-smash", "mustard", "cheddar", "cheddar", "beef", "beef", "fried-onion", "tomato", "lettuce", "bun-bottom"],
);
assert.deepEqual(
  sig.autoSignatureLayers(product("Montana Blue", "mit Beef, Rucola & Gorgonzola")),
  ["bun-classic", "bb-sauce", "gorgonzola", "beef", "onion", "tomato", "lettuce", "bun-bottom"],
);
assert.ok(sig.autoSignatureLayers(product("Black Angus Burger", "aus 200g Black-Angus-Hackfleisch")).includes("black-angus"));
assert.ok(sig.autoSignatureLayers(product("Vegan Hot Stuff", "mit Jalapeños", "vegan")).includes("vegan"));

// Soslar: her burgerde bir sos, ekmeğin hemen altında.
const sauceOf = (name, text, category = "burger", imageUrl = "") =>
  sig.autoSignatureLayers({ ...product(name, text, category), imageUrl })[1];
assert.equal(sauceOf("Avocado Burger", "Saftiges Rindfleisch, würziger Rucola und feine Avocado."), "avocado-sauce");
assert.equal(sauceOf("Beef & Bacon", "Zartes Rindfleisch & knuspriger Bacon.", "burger", "/images/burgers/BBQ.png"), "bbq-sauce");
assert.equal(sauceOf("Hot Stuff", "mit Jalapeños & Cheddarkäse"), "hot-sauce");
assert.equal(sauceOf("Smashburger", "2×80g Rinderhack"), "mustard");
assert.equal(sauceOf("Bio Vegan – Vegan All American", "mit Tofu, Bio", "vegan"), "vegan-mayo");
assert.equal(sauceOf("All American", "Der Klassiker unter den Klassikern!"), "bb-sauce");
assert.equal(sig.SIGNATURE_LAYER_LABELS["bb-sauce"], "BB Special Sauce");
assert.equal(sig.SIGNATURE_LAYER_LABELS.mustard, "Senf");
assert.equal(sig.SIGNATURE_LAYER_LABELS["vegan-mayo"], "Vegane Mayo");
// Fotoğrafı olmayan malzeme için yanlış etiket gösterilmez.
assert.deepEqual(sig.autoSignatureLayers(product("Vegetarian Halloumi", "mit Rucola", "vegan")), []);
assert.deepEqual(sig.autoSignatureLayers(product("Black Class", "Glasur: Zartbitterschokolade", "donuts")), []);
assert.deepEqual(sig.autoSignatureLayers(product("Burger Studio – Freestyle Base", "Internal canonical Burger Studio base.")), []);

// Elle girilen tarif: tek üst/alt ekmek, geçersiz anahtarlar atılır,
// admin'in girdiği sıra AYNEN korunur (yer değiştirmez).
assert.deepEqual(
  sig.normalizeSignatureLayers(["bun-bottom", "tomato", "bun-smash", "evil<script>", "beef", "bun-classic", "cheddar"]),
  ["bun-smash", "tomato", "beef", "cheddar", "bun-bottom"],
);
assert.deepEqual(
  sig.normalizeSignatureLayers(["bun-classic", "lettuce", "pickle", "beef", "bb-sauce", "bun-bottom"]),
  ["bun-classic", "lettuce", "pickle", "beef", "bb-sauce", "bun-bottom"],
);
// Otomatik tahmin kanonik burger sırasına dizilir.
assert.deepEqual(
  sig.normalizeSignatureLayers(["bun-classic", "lettuce", "beef", "cheddar", "bun-bottom"], { sort: true }),
  ["bun-classic", "cheddar", "beef", "lettuce", "bun-bottom"],
);
// Elle kaydedilen tarif ekranda da aynı sırayla çıkar.
const ordered = ["bun-classic", "tomato", "cheddar", "beef", "lettuce", "bun-bottom"];
assert.deepEqual(
  sig.signatureLayersForProduct({ productLayers: { [product("X", "").id]: ordered } }, product("X", "")),
  ordered,
);
assert.deepEqual(sig.normalizeSignatureLayers(["bun-classic", "bun-bottom"]), []);
assert.deepEqual(sig.normalizeSignatureLayers("beef"), []);

// Animasyon seçimi.
const burger = product("Beef & Bacon", "Zartes Rindfleisch & knuspriger Bacon.");
assert.equal(sig.resolveProductAnimation({}, burger, 0, true), "classic");
assert.equal(sig.resolveProductAnimation({ productAnimation: "explode" }, burger, 0, true), "explode");
assert.equal(sig.resolveProductAnimation({ productAnimation: "explode" }, burger, 0, false), "spin");
assert.equal(sig.resolveProductAnimation({ productAnimation: "drop" }, burger, 0, false), "macro");
assert.equal(sig.resolveProductAnimation({ productAnimation: "lid" }, burger, 0, false), "sizzle");
assert.equal(
  sig.resolveProductAnimation({ productAnimation: "mix", productAnimations: { [burger.id]: "lid" } }, burger, 3, true),
  "lid",
);
assert.equal(
  sig.resolveProductAnimation({ productAnimation: "sizzle", productAnimations: { [burger.id]: "auto" } }, burger, 0, true),
  "sizzle",
);
const mixed = [0, 1, 2, 3, 4, 5, 6].map((index) => sig.resolveProductAnimation({ productAnimation: "mix" }, burger, index, true));
assert.equal(new Set(mixed).size, 7, "karışık mod her üründe farklı animasyon verir");
assert.equal(sig.resolveProductAnimation({ productAnimation: "open" }, burger, 0, true), "open");
assert.equal(sig.resolveProductAnimation({ productAnimation: "open" }, burger, 0, false), "spin");
for (let index = 0; index < 6; index += 1) {
  const photoOnly = sig.resolveProductAnimation({ productAnimation: "mix" }, burger, index, false);
  assert.ok(["sizzle", "spin", "macro"].includes(photoOnly), "katmansız ürün katmanlı animasyon almaz");
}

// Her katman için ölçü ve görsel dosyası var.
for (const key of sig.SIGNATURE_LAYER_KEYS) {
  assert.ok(sig.SIGNATURE_LAYER_ASPECT[key] > 0, `${key} oranı`);
  if (sig.isSignatureSauce(key)) continue; // soslar SVG şerit olarak çizilir
  assert.ok(fs.existsSync(path.join(root, "public", sig.signatureLayerUrl(key))), `${key} görseli`);
}

// Kayıt normalizasyonu ve ekran bağlantısı.
const config = read("lib/showcase/config.ts");
assert.match(config, /productAnimation: isProductAnimation\(value\?\.productAnimation\) \? value\.productAnimation : "classic"/);
assert.match(config, /productLayers: cleanProductLayers\(value\?\.productLayers\)/);
const stage = read("components/showcase/ShowcaseStage.tsx");
assert.match(stage, /if \(animation !== "classic"\) \{\s*return \(\s*<SignatureProduct/);
const css = read("components/showcase/SignatureProduct.module.css");
assert.doesNotMatch(css, /animation:[^;]*(width|height|top|left)\b/, "yalnızca transform/opacity animasyonu");
assert.match(css, /@container \(min-aspect-ratio: 4\/3\)/);
// Final: katmanlar oturunca ürünün gerçek fotoğrafına üst üste binmeden geçilir.
const component = read("components/showcase/SignatureProduct.tsx");
assert.match(component, /const revealSource = layered && imageUrl/);
assert.match(css, /@keyframes sgStackOut \{\s*0%, 51% \{ opacity: 1; \}\s*54%, 100% \{ opacity: 0; \}/);
assert.match(css, /@keyframes sgRevealIn \{\s*0%, 54% \{ opacity: 0;/);
assert.doesNotMatch(css, /sgDrip|sgMelt/, "çizim peynir animasyonu geri gelmesin");
// Malzeme şovu (eski hali) korunur: ayrılır, birleşir, sonda fotoğrafa geçer.
assert.match(css, /@keyframes sgExplode \{\s*0%, 5% \{ transform: translateY\(0\)/);
assert.match(css, /\.root\[data-anim="explode"\] \.reveal,/);
// Açılış: önce ürün fotoğrafı, sonra burger birden açılır ve açık kalır.
assert.match(css, /@keyframes sgOpenPhoto \{\s*0% \{ opacity: 0;[\s\S]*?31%, 100% \{ opacity: 0;/);
assert.match(css, /@keyframes sgOpenLayer \{\s*0%, 29% \{ transform: translateY\(0\)[\s\S]*?100% \{ transform: translateY\(calc\(var\(--c\) \* var\(--spread\)/);
assert.match(css, /\.root\[data-anim="open"\] \.copy \{ animation: sgCopyEarly/);
const classicCss = read("components/showcase/ShowcaseStage.module.css");
assert.match(classicCss, /@container \(min-aspect-ratio: 4\/3\) \{\s*\.productSpotlight \{\s*grid-template-rows: none;\s*grid-template-columns/);

console.log("showcase signature regression tests: OK");
