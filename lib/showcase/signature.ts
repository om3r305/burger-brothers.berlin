import type { ShowcaseProduct, ShowcaseScene } from "@/lib/showcase/types";

/**
 * Vitrin "imza" animasyonları. Katmanlı olanlar Burger Studio'nun aynı ışık ve
 * açıyla kesilmiş malzeme fotoğraflarını kullanır; fotoğraflı olanlar her
 * ürünün kendi görseliyle çalışır (içecek, donut vb. dahil).
 */
export const SIGNATURE_LAYER_ANIMATIONS = ["explode", "open", "drop", "lid"] as const;
export const SIGNATURE_PHOTO_ANIMATIONS = ["sizzle", "spin", "macro"] as const;
export const SIGNATURE_ANIMATIONS = [
  ...SIGNATURE_LAYER_ANIMATIONS,
  ...SIGNATURE_PHOTO_ANIMATIONS,
] as const;

export type SignatureAnimation = (typeof SIGNATURE_ANIMATIONS)[number];
export type ShowcaseProductAnimation = "classic" | "mix" | SignatureAnimation;
export type ShowcaseProductAnimationOverride = "auto" | ShowcaseProductAnimation;

export const PRODUCT_ANIMATION_LABELS: Record<ShowcaseProductAnimation, string> = {
  classic: "Klasik kart (animasyonsuz)",
  mix: "Karışık – her ürün farklı",
  explode: "Malzeme şovu – ayrılıp birleşir",
  open: "Açılış – fotoğraftan katmanlara açılır",
  drop: "Katman yağmuru – tek tek düşüp oturur",
  lid: "Kapak açılışı – buharlı iç görünüm",
  sizzle: "Cızırtı – buhar ve kıvılcım",
  spin: "Sahne ışığı – dönerek gelir",
  macro: "Yakın plan – detaydan geri çekilir",
};

export const SIGNATURE_SAUCE_KEYS = [
  "bb-sauce",
  "avocado-sauce",
  "bbq-sauce",
  "hot-sauce",
  "mustard",
  "vegan-mayo",
] as const;

export const SIGNATURE_LAYER_KEYS = [
  "bun-classic",
  "bun-smash",
  "bun-gluten-free",
  ...SIGNATURE_SAUCE_KEYS,
  "guacamole",
  "cheddar",
  "gouda",
  "mozzarella",
  "gorgonzola",
  "jalapeno",
  "bacon",
  "beef",
  "black-angus",
  "chicken-breast",
  "crispy",
  "vegan",
  "farmers-market",
  "fried-onion",
  "onion",
  "pickle",
  "tomato",
  "lettuce",
  "bun-bottom",
] as const;

export type SignatureLayerKey = (typeof SIGNATURE_LAYER_KEYS)[number];

export const SIGNATURE_LAYER_LABELS: Record<SignatureLayerKey, string> = {
  "bun-classic": "Sesam-Bun",
  "bun-smash": "Smash Bun",
  "bun-gluten-free": "Glutenfreies Bun",
  "bb-sauce": "BB Special Sauce",
  "avocado-sauce": "Avocado-Sauce",
  "bbq-sauce": "BBQ-Sauce",
  "hot-sauce": "Scharfe Sauce",
  mustard: "Senf",
  "vegan-mayo": "Vegane Mayo",
  guacamole: "Guacamole",
  cheddar: "Cheddar",
  gouda: "Gouda",
  mozzarella: "Mozzarella",
  gorgonzola: "Gorgonzola",
  jalapeno: "Jalapeños",
  bacon: "Bacon",
  beef: "Rindfleisch",
  "black-angus": "Black Angus",
  "chicken-breast": "Hähnchenbrust",
  crispy: "Crispy Chicken",
  vegan: "Vegan Patty",
  "farmers-market": "Gemüsepatty",
  "fried-onion": "Röstzwiebeln",
  onion: "Rote Zwiebeln",
  pickle: "Gurke",
  tomato: "Tomate",
  lettuce: "Salat",
  "bun-bottom": "",
};

/** Görsel yükseklik / genişlik oranı (public/images/burger-studio). */
export const SIGNATURE_LAYER_ASPECT: Record<SignatureLayerKey, number> = {
  "bun-classic": 0.469, "bun-smash": 0.445, "bun-gluten-free": 0.423,
  "bb-sauce": 0.12, "avocado-sauce": 0.12, "bbq-sauce": 0.12,
  "hot-sauce": 0.12, mustard: 0.12, "vegan-mayo": 0.12,
  guacamole: 0.287, cheddar: 0.344, gouda: 0.35, mozzarella: 0.345,
  gorgonzola: 0.298, jalapeno: 0.288, bacon: 0.419, beef: 0.403,
  "black-angus": 0.47, "chicken-breast": 0.383, crispy: 0.416, vegan: 0.404,
  "farmers-market": 0.283, "fried-onion": 0.288, onion: 0.335, pickle: 0.246,
  tomato: 0.31, lettuce: 0.437, "bun-bottom": 0.35,
};

/**
 * Birleşik burgerde alttaki katmanın bu katmanın altına ne kadar girdiği
 * (genişliğe oranla). Katmanlar ayrı kartlar gibi değil, tek sıcak burger gibi
 * üst üste oturur.
 */
export const SIGNATURE_LAYER_SINK: Record<SignatureLayerKey, number> = {
  "bun-classic": 0.235, "bun-smash": 0.22, "bun-gluten-free": 0.21,
  // Sos ekmeğin hemen altında ince bir şerit olarak görünür; altındaki katman
  // ekmek + sos kadar içeri girer.
  "bb-sauce": 0.2, "avocado-sauce": 0.2, "bbq-sauce": 0.2,
  "hot-sauce": 0.2, mustard: 0.2, "vegan-mayo": 0.2,
  guacamole: 0.13, cheddar: 0.17, gouda: 0.17, mozzarella: 0.17,
  gorgonzola: 0.14, jalapeno: 0.14, bacon: 0.19, beef: 0.14,
  "black-angus": 0.16, "chicken-breast": 0.13, crispy: 0.14, vegan: 0.14,
  "farmers-market": 0.13, "fried-onion": 0.14, onion: 0.14, pickle: 0.12,
  tomato: 0.14, lettuce: 0.2, "bun-bottom": 0,
};

const SAUCE_SET = new Set<string>(SIGNATURE_SAUCE_KEYS);

export function isSignatureSauce(key: SignatureLayerKey) {
  return SAUCE_SET.has(key);
}

/** Bir katmanın üstündeki katmanın altına ne kadar girdiği (genişliğe oranla). */
export function signatureLayerOverlap(layers: SignatureLayerKey[], index: number) {
  if (index <= 0) return 0;
  // Sos ekmeğin kenarında görünsün diye yalnızca biraz içeri girer.
  if (isSignatureSauce(layers[index])) return 0.06;
  return SIGNATURE_LAYER_SINK[layers[index - 1]];
}

/** Birleşik burger yüksekliği, genişliğin katı olarak. */
export function signatureStackHeightFactor(layers: SignatureLayerKey[]) {
  return layers.reduce(
    (sum, key, index) => sum + SIGNATURE_LAYER_ASPECT[key] - signatureLayerOverlap(layers, index),
    0,
  );
}

const TOP_BUNS = new Set<SignatureLayerKey>(["bun-classic", "bun-smash", "bun-gluten-free"]);
const LAYER_ORDER = new Map<string, number>(
  SIGNATURE_LAYER_KEYS.map((key, index) => [key, index]),
);
const MAX_LAYERS = 14;

export function signatureLayerUrl(key: SignatureLayerKey) {
  return `/images/burger-studio/${key}.webp`;
}

export function isSignatureLayerKey(value: unknown): value is SignatureLayerKey {
  return LAYER_ORDER.has(String(value));
}

export function isProductAnimation(value: unknown): value is ShowcaseProductAnimation {
  return value === "classic" || value === "mix" ||
    (SIGNATURE_ANIMATIONS as readonly string[]).includes(String(value));
}

export function isLayerAnimation(value: ShowcaseProductAnimation) {
  return (SIGNATURE_LAYER_ANIMATIONS as readonly string[]).includes(value);
}

/**
 * Tek üst ekmek ve tek alt ekmek garanti edilir; tekrarlar (çift köfte, çift
 * cheddar) korunur. Admin'in elle girdiği sıra olduğu gibi kalır; yalnızca
 * otomatik tahmin `sort: true` ile kanonik burger sırasına dizilir.
 */
export function normalizeSignatureLayers(
  value: unknown,
  { sort = false }: { sort?: boolean } = {},
): SignatureLayerKey[] {
  if (!Array.isArray(value)) return [];
  const fillings = value
    .filter(isSignatureLayerKey)
    .filter((key) => !TOP_BUNS.has(key) && key !== "bun-bottom")
    .slice(0, MAX_LAYERS - 2);
  if (!fillings.length) return [];
  const top = value.find((key): key is SignatureLayerKey => TOP_BUNS.has(key as SignatureLayerKey)) || "bun-classic";
  if (sort) fillings.sort((a, b) => (LAYER_ORDER.get(a) ?? 0) - (LAYER_ORDER.get(b) ?? 0));
  return [top, ...fillings, "bun-bottom"];
}

function isBurgerProduct(product: ShowcaseProduct) {
  const category = String(product.category || "").toLowerCase();
  return category === "burger" || category === "vegan";
}

function times(text: string, key: string) {
  const doubled = new RegExp(`(doppelt|double|2\\s*[x×])\\s*(\\w+\\s+)?${key}`, "i");
  return doubled.test(text) ? 2 : 1;
}

/**
 * Ürün adı/açıklamasından tahmini katman tarifi. Menüdeki her burger ekmek,
 * salat, tomate ve zwiebel ile geliyor; açıklama yalnızca farkları yazıyor.
 * Admin panelinden ürün bazında değiştirilebilir.
 */
export function autoSignatureLayers(product: ShowcaseProduct): SignatureLayerKey[] {
  if (!isBurgerProduct(product)) return [];
  const text = `${product.name} ${product.ingredientsText || ""} ${product.description || ""} ${product.imageUrl || ""}`
    .toLowerCase();
  if (/internal|nicht als normales/.test(text)) return [];
  // Halloumi-Patty için ayrı fotoğraf yok; yanlış etiket göstermek yerine
  // ürün fotoğraflı animasyona düşer (admin isterse elle tarif verir).
  if (/halloumi/.test(text) && !/beef|rind/.test(text)) return [];

  const layers: SignatureLayerKey[] = [
    /smash/.test(text) ? "bun-smash" : /gluten/.test(text) ? "bun-gluten-free" : "bun-classic",
    "lettuce",
    "tomato",
    /röst|karamell|fried onion/.test(text) ? "fried-onion" : "onion",
  ];

  let patty: SignatureLayerKey = "beef";
  if (/black[\s-]?angus/.test(text)) patty = "black-angus";
  else if (/hähnchenbrust|hähnchen|chicken breast|fitburger/.test(text)) patty = "chicken-breast";
  else if (/crispy/.test(text)) patty = "crispy";
  else if (/gemüsefrikadelle|farmer/.test(text)) patty = "farmers-market";
  else if (/tofu|vegan/.test(text)) patty = "vegan";
  else if (/paniert\w* mozzarella/.test(text) && !/beef|rind/.test(text)) patty = "mozzarella";
  const pattyCount =
    /double|doppelt\w* (fleisch|genuss)|2\s*[x×]\s*\d*\s*g?\s*rind/.test(text) ? 2 : 1;
  for (let index = 0; index < pattyCount; index += 1) layers.push(patty);

  if (/bacon/.test(text)) {
    for (let index = 0; index < times(text, "bacon"); index += 1) layers.push("bacon");
  }
  if (/jalape/.test(text)) layers.push("jalapeno");
  if (/cheddar|cheese|käse/.test(text) && !/gorgonzola|gouda/.test(text)) {
    const count = /2\s*[x×]\s*cheddar|doppelt\w* cheddar/.test(text) ? 2 : 1;
    for (let index = 0; index < count; index += 1) layers.push("cheddar");
  }
  if (/gorgonzola/.test(text)) layers.push("gorgonzola");
  if (/gouda/.test(text)) layers.push("gouda");
  if (/mozzarella/.test(text) && patty !== "mozzarella") layers.push("mozzarella");
  if (/avocado|guacamole/.test(text)) layers.push("guacamole");

  // Her burgerin sosu: özel soslar yoksa BB Special Sauce.
  if (/avocado/.test(text)) layers.push("avocado-sauce");
  else if (/smash/.test(text)) layers.push("mustard");
  else if (/hot stuff|scharf|jalape/.test(text)) layers.push("hot-sauce");
  else if (/bbq/.test(text)) layers.push("bbq-sauce");
  else if (patty === "vegan" || /vegan/.test(text)) layers.push("vegan-mayo");
  else layers.push("bb-sauce");

  return normalizeSignatureLayers([...layers, "bun-bottom"], { sort: true });
}

export function signatureLayersForProduct(
  scene: Pick<ShowcaseScene, "productLayers">,
  product: ShowcaseProduct,
): SignatureLayerKey[] {
  const custom = normalizeSignatureLayers(scene.productLayers?.[product.id]);
  return custom.length ? custom : autoSignatureLayers(product);
}

const MIX_LAYER_SEQUENCE: SignatureAnimation[] = ["open", "explode", "sizzle", "drop", "spin", "lid", "macro"];
const MIX_PHOTO_SEQUENCE: SignatureAnimation[] = ["sizzle", "spin", "macro"];

/**
 * Bir ürün için oynatılacak animasyon. Katman tarifi olmayan ürünler katmanlı
 * animasyonlarda otomatik olarak fotoğraflı bir karşılığa düşer.
 */
export function resolveProductAnimation(
  scene: Pick<ShowcaseScene, "productAnimation" | "productAnimations">,
  product: ShowcaseProduct,
  productIndex: number,
  hasLayers: boolean,
): "classic" | SignatureAnimation {
  const override = scene.productAnimations?.[product.id];
  const chosen: ShowcaseProductAnimation =
    override && override !== "auto" ? override : scene.productAnimation || "classic";

  if (chosen === "classic") return "classic";
  if (chosen === "mix") {
    const sequence = hasLayers ? MIX_LAYER_SEQUENCE : MIX_PHOTO_SEQUENCE;
    return sequence[Math.abs(productIndex) % sequence.length];
  }
  if (isLayerAnimation(chosen) && !hasLayers) {
    return chosen === "explode" || chosen === "open" ? "spin" : chosen === "drop" ? "macro" : "sizzle";
  }
  return chosen;
}
