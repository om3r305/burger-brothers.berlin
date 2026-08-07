const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const variantModal = read("components/shared/VariantGroupCard.tsx");
const productModal = read("components/menu/ProductCard.tsx");
const swipe = read("components/menu/MobileCategorySwipe.tsx");
const css = read("app/globals.css");

// Varyant modalı gerçek viewport portalında açılmalı.
assert.match(variantModal, /import \{ createPortal \} from "react-dom"/);
assert.match(variantModal, /createPortal\([\s\S]*?document\.body/);
assert.match(variantModal, /className="bb-product-modal/);
assert.match(variantModal, /className="bb-modal-shell/);

// Arka sayfa iOS/Safari dahil sabitlenmeli ve kapanınca konumu korunmalı.
assert.match(variantModal, /body\.style\.position = "fixed"/);
assert.match(variantModal, /body\.style\.top = `-\$\{scrollY\}px`/);
assert.match(variantModal, /window\.scrollTo\(0, scrollY\)/);
assert.match(productModal, /body\.style\.position = "fixed"/);
assert.match(productModal, /window\.scrollTo\(0, scrollY\)/);

// Sadece içerik kaymalı; başlık ve CTA modal içinde sabit kalmalı.
assert.match(variantModal, /bb-modal-scroll min-h-0 flex-1 overflow-y-auto/);
assert.match(variantModal, /bb-modal-footer shrink-0/);
assert.match(variantModal, /Hinzufügen – \{totals\.count\} Artikel/);
assert.match(css, /\.bb-product-modal[\s\S]*?height: 100dvh !important/);
assert.match(css, /\.bb-product-modal \.bb-modal-scroll[\s\S]*?touch-action: pan-y/);

// Swipe bırakıldığında video %100'e büyümemeli, parmak genişliğini korumalı.
assert.match(swipe, /const COMMIT_SETTLE_MS = 180/);
assert.match(
  swipe,
  /style === "cinematic-video" \? previewWidths\[style\] : previewWidths\[style\] \+ 4/,
);
assert.doesNotMatch(swipe, /style === "cinematic-video" \? 100/);
assert.match(swipe, /const committedProgress = clampProgress\(releaseProgress\)/);
assert.match(swipe, /showPreview\(target, direction, committedProgress, false\)/);
assert.match(swipe, /setReveal\(committedProgress, direction, style, true\)/);
assert.match(swipe, /\}, COMMIT_SETTLE_MS\)/);
assert.doesNotMatch(swipe, /durationMs \+ 480/);

console.log("modal + swipe regression tests: OK");
