export type ProductExtraLike = {
  id?: unknown;
  sku?: unknown;
  code?: unknown;
  name?: unknown;
  label?: unknown;
  price?: unknown;
  [key: string]: unknown;
};

type ProteinExtraSpec = { key: string; label: string };

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function proteinExtraSpecForProduct(params: {
  productName: string;
  productDescription?: string | null;
  category?: string | null;
}): ProteinExtraSpec | null {
  const category = normalizeText(params.category);
  const productText = normalizeText(
    `${params.productName} ${params.productDescription ?? ""}`,
  );
  const isVeganOrVegetarian =
    category.includes("vegan") || category.includes("vegetar");

  if (!isVeganOrVegetarian && category !== "burger") return null;

  if (isVeganOrVegetarian) {
    if (/\bfarmers?\b/.test(productText)) {
      return { key: "farmers", label: "Extra Farmers" };
    }
    if (/\bhalloumi\b/.test(productText)) {
      return { key: "halloumi", label: "Extra Halloumi" };
    }
    if (/\bitalian\b/.test(productText)) {
      return { key: "mozzarella", label: "Extra Mozzarella" };
    }
    return { key: "vegan-tofu", label: "Extra Vegan Tofu" };
  }

  if (/\bblack\s+angus\b/.test(productText)) {
    return { key: "black-angus", label: "Extra Black Angus" };
  }
  if (/\bcrispy\b/.test(productText)) {
    return { key: "crispy", label: "Extra Crispy" };
  }
  if (
    /\bfit\s*burger\b/.test(productText) ||
    /\bhahnchen\b/.test(productText) ||
    /\bchicken\b/.test(productText)
  ) {
    return { key: "haehnchen", label: "Extra Hähnchen" };
  }
  return { key: "beef", label: "Extra Beef" };
}

function isProteinSlot(extra: ProductExtraLike, spec: ProteinExtraSpec) {
  const identity = normalizeText(
    [extra.id, extra.sku, extra.code, extra.name, extra.label]
      .filter(Boolean)
      .join(" "),
  );
  const id = String(extra.id ?? extra.sku ?? extra.code ?? "").trim();
  const desired = normalizeText(spec.label);
  return (
    id.startsWith("bb-protein-") ||
    /\b(beef|rind|rindfleisch)\b/.test(identity) ||
    normalizeText(extra.name) === desired ||
    normalizeText(extra.label) === desired
  );
}

function finitePrice(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const numeric = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function withProductProteinExtra(params: {
  productName: string;
  productDescription?: string | null;
  category?: string | null;
  extras: ProductExtraLike[];
  defaultPrice?: number;
}): ProductExtraLike[] {
  const extras = Array.isArray(params.extras)
    ? params.extras.map((extra) => ({ ...extra }))
    : [];
  const spec = proteinExtraSpecForProduct(params);
  if (!spec) return extras;

  const defaultPrice = finitePrice(params.defaultPrice, 3);
  const index = extras.findIndex((extra) => isProteinSlot(extra, spec));
  if (index >= 0) {
    const existing = extras[index];
    extras[index] = {
      ...existing,
      name: spec.label,
      label: spec.label,
      price: finitePrice(existing.price, defaultPrice),
    };
    return extras;
  }

  const id = `bb-protein-${spec.key}`;
  extras.push({
    id,
    sku: id,
    name: spec.label,
    label: spec.label,
    price: defaultPrice,
  });
  return extras;
}
