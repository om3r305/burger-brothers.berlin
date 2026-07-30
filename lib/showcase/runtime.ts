import type {
  ShowcaseProduct,
  ShowcaseReview,
  ShowcaseScene,
  ShowcaseSnapshot,
} from "./types";

export const DEFAULT_REVIEW_CTA = {
  title: "WERDE TEIL UNSERER BURGER BROTHERS FAMILIE ❤️",
  body: "Teile deinen Besuch auf Google und lade dein Lieblingsfoto hoch. Vielleicht erscheint dein Beitrag schon bald hier auf unserem Bildschirm. Danke, dass du ein Teil von uns bist!",
  badge: "DEINE MEINUNG ZÄHLT",
  qrLabel: "Jetzt bewerten & Foto teilen",
  durationSeconds: 18,
  accent: "#f5b942",
} as const;

function stableReviewScore(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function showcaseReviewsForScene(
  scene: ShowcaseScene,
  reviews: ShowcaseReview[] = [],
) {
  const filtered = reviews.filter(
    (review) =>
      review.approved !== false &&
      review.rating >= Number(scene.reviewMinRating || 4) &&
      (!scene.reviewOnlyWithPhoto || Boolean(review.photoUrls?.length)),
  );
  const sorted =
    scene.reviewSort === "random"
      ? [...filtered].sort(
          (a, b) =>
            stableReviewScore(`${scene.id}:${a.id}`) -
            stableReviewScore(`${scene.id}:${b.id}`),
        )
      : [...filtered].sort(
          (a, b) =>
            Date.parse(b.updateTime || b.createTime || "") -
              Date.parse(a.updateTime || a.createTime || "") ||
            a.id.localeCompare(b.id),
        );
  return sorted.slice(0, Math.max(1, Number(scene.reviewLimit || 8)));
}

export function createReviewCtaScene(scene: ShowcaseScene): ShowcaseScene {
  return {
    id: `${scene.id}--review-cta`,
    type: "review-qr",
    name: `${scene.name} · Google çağrısı`,
    enabled: true,
    durationSeconds: Math.max(
      8,
      Math.min(90, Number(scene.reviewCtaDurationSeconds || DEFAULT_REVIEW_CTA.durationSeconds)),
    ),
    transition: scene.transition || "fade",
    title: scene.reviewCtaTitle || DEFAULT_REVIEW_CTA.title,
    body: scene.reviewCtaBody || DEFAULT_REVIEW_CTA.body,
    badge: scene.reviewCtaBadge || DEFAULT_REVIEW_CTA.badge,
    qrUrl: scene.reviewCtaQrUrl,
    qrLabel: scene.reviewCtaQrLabel || DEFAULT_REVIEW_CTA.qrLabel,
    qrVariant: "google-review",
    accent: scene.reviewCtaAccent || scene.accent || DEFAULT_REVIEW_CTA.accent,
    fit: "contain",
    showLogo: true,
    showQr: true,
    showPrice: false,
    muted: true,
  };
}

/**
 * Yorum çağrısını editörde ayrı bir playlist satırı oluşturmadan yorum
 * sahnesinin hemen arkasına yerleştirir. Sanal sahne kaydedilmez; yayın
 * döngüsünde üretilir ve bu nedenle sıralama hiçbir zaman kopmaz.
 */
export function expandShowcaseScenesForPlayback(scenes: ShowcaseScene[]) {
  return scenes.flatMap((scene) =>
    scene.type === "reviews" && scene.reviewCtaEnabled !== false
      ? [scene, createReviewCtaScene(scene)]
      : [scene],
  );
}

export const SHOWCASE_CATEGORY_ORDER = [
  "burger",
  "vegan",
  "hotdogs",
  "extras",
  "sauces",
  "drinks",
  "donuts",
  "bubbletea",
] as const;

const CATEGORY_LABELS_DE: Record<string, string> = {
  burger: "Burger",
  vegan: "Vegan",
  hotdogs: "Hotdogs",
  extras: "Pommes & Extras",
  sauces: "Soßen",
  drinks: "Getränke",
  donuts: "Donuts",
  bubbletea: "Bubble Tea",
};

const CATEGORY_LABELS_TR: Record<string, string> = {
  burger: "Burgerler",
  vegan: "Vegan ürünler",
  hotdogs: "Hotdoglar",
  extras: "Patates ve ekstralar",
  sauces: "Soslar",
  drinks: "İçecekler",
  donuts: "Donutlar",
  bubbletea: "Bubble Tea",
};

export function normalizeShowcaseCategory(value?: string | null) {
  const raw = String(value || "").toLowerCase().trim();
  if (raw.includes("vegan")) return "vegan";
  if (raw.includes("drink") || raw.includes("getränk") || raw.includes("getraenk")) return "drinks";
  if (raw.includes("sauce") || raw.includes("soß") || raw.includes("soss") || raw.includes("sos")) return "sauces";
  if (raw.includes("hotdog") || raw.includes("hot dog")) return "hotdogs";
  if (raw.includes("donut") || raw.includes("doughnut")) return "donuts";
  if (raw.includes("bubble")) return "bubbletea";
  if (raw.includes("extra") || raw.includes("pommes") || raw.includes("fries")) return "extras";
  if (raw.includes("burger")) return "burger";
  return raw || "burger";
}

export function showcaseCategoryLabel(value: string, language: "de" | "tr" = "de") {
  const key = normalizeShowcaseCategory(value);
  const labels = language === "tr" ? CATEGORY_LABELS_TR : CATEGORY_LABELS_DE;
  return labels[key] || value || (language === "tr" ? "Diğer" : "Weitere");
}

export function availableShowcaseCategories(products: ShowcaseProduct[]) {
  const found = new Set(
    products
      .filter((product) => product.active !== false)
      .map((product) => normalizeShowcaseCategory(product.category)),
  );
  return [
    ...SHOWCASE_CATEGORY_ORDER.filter((key) => found.has(key)),
    ...Array.from(found).filter(
      (key) => !(SHOWCASE_CATEGORY_ORDER as readonly string[]).includes(key),
    ),
  ];
}

export function selectedProductsForScene(
  scene: ShowcaseScene,
  products: ShowcaseProduct[],
) {
  const ids = Array.from(
    new Set(
      [
        ...(Array.isArray(scene.productIds) ? scene.productIds : []),
        ...(scene.productId ? [scene.productId] : []),
      ]
        .map(String)
        .filter(Boolean),
    ),
  );

  const byId = new Map<string, ShowcaseProduct>();
  for (const product of products) {
    byId.set(String(product.id), product);
    if (product.sku) byId.set(String(product.sku), product);
  }

  const limit = Math.max(1, Math.min(20, Number(scene.productLimit || 8)));
  return ids
    .map((id) => byId.get(id))
    .filter((product): product is ShowcaseProduct => Boolean(product && product.active !== false))
    .slice(0, limit);
}

export type ShowcaseMenuPage = {
  id: string;
  category: string;
  categoryLabel: string;
  groupKey: string;
  groupLabel: string;
  pageIndex: number;
  pageCount: number;
  products: ShowcaseProduct[];
};

export function buildShowcaseMenuPages(
  scene: ShowcaseScene,
  products: ShowcaseProduct[],
  itemsPerPageOverride?: number,
): ShowcaseMenuPage[] {
  const available = availableShowcaseCategories(products);
  const requested = Array.isArray(scene.menuCategories)
    ? Array.from(new Set(scene.menuCategories.map(normalizeShowcaseCategory).filter(Boolean)))
    : [];
  // Grup seçilmediyse tüm aktif kategoriler güvenli varsayılan olarak kullanılır.
  // Böylece unutulan bir seçim TV ekranını boş bırakmaz.
  const selectedCategories = requested.length
    ? requested.filter((category) => available.includes(category))
    : available;
  const requestedPageSize = itemsPerPageOverride ?? scene.menuItemsPerPage ?? 8;
  const itemsPerPage = Math.max(4, Math.min(24, Number(requestedPageSize)));
  const pages: ShowcaseMenuPage[] = [];

  for (const category of selectedCategories) {
    const categoryProducts = products
      .filter(
        (product) =>
          product.active !== false &&
          normalizeShowcaseCategory(product.category) === category,
      )
      .sort(
        (a, b) =>
          Number(a.order ?? 9999) - Number(b.order ?? 9999) ||
          a.name.localeCompare(b.name, "de"),
      );

    const grouped = new Map<string, ShowcaseProduct[]>();
    for (const product of categoryProducts) {
      const key = String(product.groupKey || category);
      const current = grouped.get(key) || [];
      current.push(product);
      grouped.set(key, current);
    }

    for (const [groupKey, items] of grouped) {
      if (!items.length) continue;
      const groupLabel =
        items.find((item) => item.groupLabel)?.groupLabel ||
        showcaseCategoryLabel(category, "de");
      const pageCount = Math.ceil(items.length / itemsPerPage);

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        pages.push({
          id: `${category}-${groupKey}-${pageIndex}`,
          category,
          categoryLabel: showcaseCategoryLabel(category, "de"),
          groupKey,
          groupLabel,
          pageIndex,
          pageCount,
          products: items.slice(pageIndex * itemsPerPage, (pageIndex + 1) * itemsPerPage),
        });
      }
    }
  }

  return pages;
}

export function effectiveShowcaseSceneDuration(
  scene: ShowcaseScene,
  snapshot: Pick<ShowcaseSnapshot, "products">,
  menuItemsPerPageOverride?: number,
) {
  if (scene.type === "product") {
    const count = Math.max(1, selectedProductsForScene(scene, snapshot.products).length);
    const raw = count * Math.max(6, Number(scene.productSeconds || 12));
    return Math.min(raw, Math.max(15, Number(scene.productMaxTotalSeconds || 90)));
  }

  if (scene.type === "menu") {
    const pageCount = Math.max(1, buildShowcaseMenuPages(scene, snapshot.products, menuItemsPerPageOverride).length);
    return pageCount * Math.max(6, Number(scene.menuPageSeconds || 12));
  }

  return Math.max(5, Number(scene.durationSeconds || 45));
}
