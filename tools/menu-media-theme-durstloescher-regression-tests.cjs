const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const css = read("app/globals.css");
const card = read("components/shared/VariantGroupCard.tsx");
const helper = read("lib/media/local-optimized-image.ts");

for (const selector of [
  ".bb-drinks-card .product-card__body > div:first-child",
  ".bb-extras-card .product-card__body > div:first-child",
  ".bb-bubble-tea-card .card > div:first-child",
  ".bb-sauces-card .card > div:first-child",
  ".bb-donuts-card .card > div:first-child",
  ".bb-hotdogs-card .cover",
]) {
  assert(css.includes(selector), `Tema medya seçicisi eksik: ${selector}`);
}

assert(
  card.includes('className="bb-menu-product-cover relative mb-2 h-48'),
  "VariantGroupCard tema medya sınıfını kullanmıyor",
);
assert(
  card.includes("optimizedLocalImageUrl(image)"),
  "VariantGroupCard optimize edilmiş yerel görsel yolunu kullanmıyor",
);
assert(
  card.includes("restoreLocalImageFallback(event.currentTarget, image)"),
  "VariantGroupCard PNG geri dönüşünü kullanmıyor",
);
assert(
  helper.includes('/images/drinks/durst.webp'),
  "Durstlöscher WEBP kanonik yolu eksik",
);
assert(
  helper.includes('/images/drinks/durst.png'),
  "Durstlöscher PNG geri dönüş yolu eksik",
);
assert(
  fs.existsSync(path.join(root, "public/images/drinks/durst.webp")),
  "Durstlöscher WEBP dosyası eksik",
);
assert(
  fs.existsSync(path.join(root, "public/images/drinks/durst.png")),
  "Durstlöscher PNG dosyası eksik",
);

console.log("Menü medya teması ve Durstlöscher testleri başarılı.");
