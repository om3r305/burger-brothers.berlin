"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { loadNormalizedCampaigns } from "@/lib/campaigns-compat";
import {
  isProductAvailable,
  priceWithCampaign,
  type Campaign,
  type Category,
} from "@/lib/catalog";
import { readSettings } from "@/lib/settings";
import { useCart } from "@/components/store";
import type { ExtraOption, MenuItem } from "@/components/types";
import type {
  AssistantAction,
  AssistantCatalogExtra,
  AssistantCatalogProduct,
  AssistantConversationMessage,
  AssistantResult,
} from "@/lib/assistant/types";

const CUSTOMER_ASSISTANT_PATHS = new Set([
  "/menu",
  "/extras",
  "/drinks",
  "/sauces",
  "/hotdogs",
  "/donuts",
  "/bubble-tea",
]);

const MAX_CLIENT_PRODUCTS = 1200;
const INITIAL_ASSISTANT_TEXT =
  "Hallo! Was möchtest du bestellen? Sag einfach Burger, Pommes/Fries, Getränk, Bubble Tea, Extras oder Soße – ich prüfe das aktuelle Menü und lege es in den Warenkorb.";

type CatalogPayload = {
  ok?: boolean;
  products?: unknown[];
  items?: unknown[];
  campaigns?: unknown[];
};

type GroupsPayload = {
  ok?: boolean;
  drinkGroups?: unknown[];
  extraGroups?: unknown[];
  drinks?: unknown[];
  extras?: unknown[];
};

type AssistantCatalogProductRuntime = AssistantCatalogProduct & {
  aliases?: string[];
  source?: "catalog" | "group_variant";
  groupName?: string;
  variantName?: string;
  pfandType?: string;
  pfandAmount?: number;
  depositType?: string;
  depositAmount?: number;
};

type DisplayMessage = AssistantConversationMessage & {
  id: string;
  actions?: AssistantAction[];
};

function makeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function cleanString(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeCategory(value: unknown) {
  const text = cleanString(value, "burger").toLowerCase();

  if (text.includes("vegan") || text.includes("vegetar")) return "vegan";
  if (text.includes("drink") || text.includes("getränk") || text.includes("getraenk")) {
    return "drinks";
  }
  if (text.includes("sauce") || text.includes("soß") || text.includes("sos")) {
    return "sauces";
  }
  if (text.includes("hotdog") || text.includes("hot dog")) return "hotdogs";
  if (text.includes("donut") || text.includes("doughnut")) return "donuts";
  if (text.includes("bubble") || text.includes("boba")) return "bubbletea";
  if (
    text.includes("extra") ||
    text.includes("snack") ||
    text.includes("pommes") ||
    text.includes("fries")
  ) {
    return "extras";
  }

  return "burger";
}

function normalizeExtra(value: any): AssistantCatalogExtra | null {
  if (!value || typeof value !== "object") return null;

  const id = cleanString(value?.id ?? value?.sku ?? value?.name ?? value?.label);
  const name = cleanString(value?.name ?? value?.label ?? value?.id);
  if (!id || !name) return null;

  return {
    id,
    name,
    price: Math.max(0, cleanNumber(value?.price)),
  };
}

function normalizeAliasText(value: unknown) {
  return cleanString(value)
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqAliases(values: unknown[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = cleanString(value);
    const key = normalizeAliasText(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out.slice(0, 24);
}

function buildGroupVariantAliases(
  groupName: string,
  variantName: string,
  category: "drinks" | "extras",
) {
  const combined = normalizeAliasText(`${groupName} ${variantName}`);
  const aliases: unknown[] = [
    groupName,
    variantName,
    `${groupName} ${variantName}`,
    `${groupName} – ${variantName}`,
  ];

  if (category === "extras" && /(fries|pommes|fritten|patates)/.test(combined)) {
    const isCurly = /(curly|spiral)/.test(combined);
    const isSweet = /(susskartoff|sweet potato)/.test(combined);
    const isStandardFries = !isCurly && !isSweet;

    // "Pommes" is the customer word for the regular fries group even when the
    // concrete variants are sizes such as Klein/Groß rather than a variant
    // literally named "Normal". Give every regular-fries variant the same
    // synonyms; the model will ask for size only when several variants match.
    if (isStandardFries) {
      aliases.push(
        "Pommes",
        "normale Pommes",
        "normal Pommes",
        "Fries",
        "French Fries",
        "Fritten",
        "Patates",
        "patates kızartması",
      );
    }

    if (isCurly) {
      aliases.push("Curly Fries", "Curly Pommes", "Curlys");
    }

    if (isSweet) {
      aliases.push(
        "Süßkartoffel-Pommes",
        "Süßkartoffel Pommes",
        "Sweet Potato Fries",
        "Süßkartoffeln",
      );
    }
  }

  if (category === "drinks" && /(cola|coca|coke|kola)/.test(combined)) {
    const isZero = /(zero|null zucker|ohne zucker|zuckerfrei)/.test(combined);
    if (isZero) {
      aliases.push(
        "Cola Zero",
        "Coca-Cola Zero",
        "Coca Cola Zero",
        "Coke Zero",
        "Kola Zero",
        "Zero Cola",
      );
    } else {
      aliases.push("Cola", "Coca-Cola", "Coca Cola", "Coke", "Kola");
    }
  }

  return uniqAliases(aliases);
}

function isGroupVariantAvailable(value: any) {
  if (!value || typeof value !== "object") return false;
  if (value?.active === false) return false;

  const fromRaw = value?.activeFrom ?? value?.startAt ?? value?.startsAt;
  const toRaw = value?.activeTo ?? value?.endAt ?? value?.endsAt;
  const from = fromRaw ? Date.parse(String(fromRaw)) : NaN;
  const to = toRaw ? Date.parse(String(toRaw)) : NaN;
  const now = Date.now();

  if (Number.isFinite(from) && now < from) return false;
  if (Number.isFinite(to) && now > to) return false;
  return true;
}

function normalizeVariantGroups(
  groups: unknown,
  category: "drinks" | "extras",
): AssistantCatalogProductRuntime[] {
  if (!Array.isArray(groups)) return [];

  const out: AssistantCatalogProductRuntime[] = [];

  for (const rawGroup of groups) {
    if (!rawGroup || typeof rawGroup !== "object") continue;

    const group = rawGroup as any;
    const groupName = cleanString(group?.name ?? group?.title, "Artikel");
    const groupSku = cleanString(
      group?.sku ?? group?.code ?? group?.id ?? groupName,
    );
    const description = cleanString(group?.description ?? group?.desc);
    const variants = Array.isArray(group?.variants)
      ? group.variants
      : Array.isArray(group?.items)
        ? group.items
        : Array.isArray(group?.options)
          ? group.options
          : [];

    for (const rawVariant of variants) {
      if (!isGroupVariantAvailable(rawVariant)) continue;

      const variant = rawVariant as any;
      const variantId = cleanString(
        variant?.id ?? variant?.sku ?? variant?.code ?? variant?.name,
      );
      const variantName = cleanString(
        variant?.name ?? variant?.title ?? variant?.label,
        "Variante",
      );
      if (!groupSku || !variantId || !variantName) continue;

      const sku = `${groupSku}-${variantId}`;
      const price = Math.max(0, cleanNumber(variant?.price ?? variant?.preis));

      out.push({
        id: sku,
        sku,
        name: `${groupName} – ${variantName}`,
        category,
        description,
        basePrice: price,
        displayPrice: price,
        badge: "",
        extras: [],
        allergens: [],
        aliases: buildGroupVariantAliases(groupName, variantName, category),
        source: "group_variant",
        groupName,
        variantName,
        pfandType: cleanString(
          variant?.pfandType ?? variant?.depositType ?? "none",
          "none",
        ),
        pfandAmount: Math.max(
          0,
          cleanNumber(variant?.pfandAmount ?? variant?.depositAmount),
        ),
        depositType: cleanString(
          variant?.depositType ?? variant?.pfandType ?? "none",
          "none",
        ),
        depositAmount: Math.max(
          0,
          cleanNumber(variant?.depositAmount ?? variant?.pfandAmount),
        ),
      });
    }
  }

  return out;
}

function normalizeGroupCatalog(payload: GroupsPayload) {
  const drinks = Array.isArray(payload?.drinkGroups)
    ? payload.drinkGroups
    : Array.isArray(payload?.drinks)
      ? payload.drinks
      : [];
  const extras = Array.isArray(payload?.extraGroups)
    ? payload.extraGroups
    : Array.isArray(payload?.extras)
      ? payload.extras
      : [];

  return [
    ...normalizeVariantGroups(drinks, "drinks"),
    ...normalizeVariantGroups(extras, "extras"),
  ];
}

function mergeAssistantCatalog(
  baseCatalog: AssistantCatalogProductRuntime[],
  groupCatalog: AssistantCatalogProductRuntime[],
) {
  const groupCategories = new Set(
    groupCatalog.map((product) => cleanString(product.category).toLowerCase()),
  );

  const filteredBase = baseCatalog.filter((product) => {
    const category = cleanString(product.category).toLowerCase();
    if (!["extras", "drinks"].includes(category)) return true;
    return !groupCategories.has(category);
  });

  const merged = [...groupCatalog, ...filteredBase];
  const seen = new Set<string>();

  return limitAssistantCatalog(
    merged.filter((product) => {
      const key = cleanString(product.id).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}


const TOOL_CATEGORIES = new Set([
  "burger",
  "vegan",
  "hotdogs",
  "extras",
  "drinks",
  "sauces",
  "donuts",
  "bubbletea",
]);

function normalizeToolCategory(value: unknown) {
  const raw = normalizeAliasText(value).replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.includes("getrank") || raw.includes("drink") || raw.includes("icecek")) return "drinks";
  if (raw.includes("extra") || raw.includes("pommes") || raw.includes("fries") || raw.includes("patates")) return "extras";
  if (raw.includes("bubble") || raw.includes("boba")) return "bubbletea";
  if (raw.includes("sauce") || raw.includes("sos")) return "sauces";
  if (raw.includes("hotdog")) return "hotdogs";
  if (raw.includes("donut")) return "donuts";
  if (raw.includes("vegan") || raw.includes("vegetar")) return "vegan";
  if (raw.includes("burger")) return "burger";
  return TOOL_CATEGORIES.has(raw) ? raw : "";
}

function menuSearchTokens(value: unknown) {
  const stop = new Set([
    "bir", "tane", "bitte", "please", "istiyorum", "isterim", "mochte", "möchte",
    "haben", "var", "gibt", "the", "eine", "einen", "ein", "und", "ile", "with",
  ]);
  return normalizeAliasText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !stop.has(token));
}

function productSearchForms(product: AssistantCatalogProductRuntime) {
  return uniqAliases([
    product.name,
    product.sku,
    product.groupName,
    product.variantName,
    ...(product.aliases || []),
  ]).map(normalizeAliasText).filter(Boolean);
}

function menuSearchScore(
  product: AssistantCatalogProductRuntime,
  query: string,
  category = "",
) {
  const productCategory = normalizeToolCategory(product.category) || cleanString(product.category).toLowerCase();
  if (category && productCategory !== category) return -1;

  const q = normalizeAliasText(query);
  if (!q) return category ? 10 : 0;

  const forms = productSearchForms(product);
  const haystack = forms.join(" ");

  // Protect important modifiers so Cola Zero never resolves to normal Cola,
  // Curly never resolves to regular fries, etc.
  if (/\bzero\b/.test(q) && /(cola|coca|coke|kola)/.test(q) && !/\bzero\b/.test(haystack)) {
    return -1;
  }
  if (/\bcurly\b/.test(q) && !/\bcurly\b/.test(haystack)) return -1;
  if (/(susskartoff|sweet potato)/.test(q) && !/(susskartoff|sweet potato)/.test(haystack)) {
    return -1;
  }

  let score = category ? 12 : 0;
  for (const form of forms) {
    if (form === q) score = Math.max(score, 120);
    else if (form.startsWith(q) || q.startsWith(form)) score = Math.max(score, 86);
    else if (form.includes(q) || q.includes(form)) score = Math.max(score, 68);
  }

  const tokens = menuSearchTokens(q);
  let overlap = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) overlap += 1;
  }
  score += overlap * 14;

  return score;
}

function compactMenuToolProduct(product: AssistantCatalogProductRuntime) {
  return {
    productId: product.id,
    name: product.name,
    category: product.category,
    price: product.displayPrice,
    group: product.groupName || undefined,
    variant: product.variantName || undefined,
    aliases: (product.aliases || []).slice(0, 10),
    extras: product.extras.slice(0, 16).map((extra) => ({
      id: extra.id,
      name: extra.name,
      price: extra.price,
    })),
  };
}

function searchMenuCatalog(
  catalog: AssistantCatalogProductRuntime[],
  query: unknown,
  requestedCategory?: unknown,
) {
  const q = cleanString(query);
  const category = normalizeToolCategory(requestedCategory);

  return catalog
    .map((product, index) => ({
      product,
      index,
      score: menuSearchScore(product, q, category),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8)
    .map((entry) => compactMenuToolProduct(entry.product));
}

function listMenuCategory(
  catalog: AssistantCatalogProductRuntime[],
  requestedCategory: unknown,
) {
  const category = normalizeToolCategory(requestedCategory);
  if (!category) return { category: "", families: [], totalProducts: 0, truncated: false };

  const products = catalog.filter(
    (product) => (normalizeToolCategory(product.category) || cleanString(product.category).toLowerCase()) === category,
  );

  const families = new Map<string, {
    name: string;
    variants: Array<{ productId: string; name: string; price: number }>;
  }>();

  for (const product of products) {
    const familyName = cleanString(product.groupName || product.name, product.name);
    const key = normalizeAliasText(familyName) || product.id;
    let family = families.get(key);
    if (!family) {
      family = { name: familyName, variants: [] };
      families.set(key, family);
    }
    if (family.variants.length < 5) {
      family.variants.push({
        productId: product.id,
        name: cleanString(product.variantName || product.name, product.name),
        price: product.displayPrice,
      });
    }
  }

  const familyList = Array.from(families.values());
  return {
    category,
    families: familyList.slice(0, 12),
    totalProducts: products.length,
    truncated: familyList.length > 12,
  };
}

function cartLinesToContext(lines: any[]) {
  return (Array.isArray(lines) ? lines : []).slice(0, 30).map((line) => ({
    lineId: cleanString(line?.id),
    productId: cleanString(line?.item?.id ?? line?.item?.sku),
    name: cleanString(line?.item?.name),
    quantity: Math.max(1, Number(line?.qty || 1)),
    extraIds: Array.isArray(line?.add)
      ? line.add.map((extra: any) => cleanString(extra?.id)).filter(Boolean)
      : [],
    remove: Array.isArray(line?.rm)
      ? line.rm.map((entry: unknown) => cleanString(entry)).filter(Boolean)
      : [],
  }));
}

function readLiveCartContext() {
  try {
    return cartLinesToContext((useCart.getState() as any)?.items || []);
  } catch {
    return [];
  }
}

function normalizeAvailabilityKey(value: unknown) {
  return cleanString(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isTemporarilyDisabled(product: any) {
  const settings = readSettings() as any;
  const category = normalizeCategory(product?.category);

  const readFeature = (value: any, fallback = true) => {
    if (typeof value === "boolean") return value;
    if (value && typeof value === "object" && typeof value.enabled === "boolean") {
      return value.enabled;
    }
    return fallback;
  };

  if (category === "donuts" && !readFeature(settings?.features?.donuts, true)) {
    return true;
  }

  if (
    category === "bubbletea" &&
    !readFeature(settings?.features?.bubbleTea, true)
  ) {
    return true;
  }

  const availability =
    settings?.productAvailability &&
    typeof settings.productAvailability === "object"
      ? settings.productAvailability
      : {};

  const keys = [
    product?.id,
    product?.sku,
    product?.code,
    product?.name,
  ]
    .map(normalizeAvailabilityKey)
    .filter(Boolean);

  for (const key of keys) {
    const entry = availability?.[key];
    if (!entry || entry?.disabled !== true) continue;

    if (!entry?.until) return true;

    const until = Date.parse(String(entry.until));
    if (!Number.isFinite(until) || until > Date.now()) return true;
  }

  return false;
}

function toMenuItem(product: any): MenuItem {
  const extras = Array.isArray(product?.extras)
    ? product.extras.map(normalizeExtra).filter(Boolean)
    : Array.isArray(product?.extrasJson)
      ? product.extrasJson.map(normalizeExtra).filter(Boolean)
      : [];

  return {
    id: cleanString(product?.id ?? product?.sku ?? product?.name),
    sku: cleanString(product?.sku ?? product?.id) || undefined,
    name: cleanString(product?.name, "Produkt"),
    price: Math.max(0, cleanNumber(product?.price)),
    category: normalizeCategory(product?.category),
    description: cleanString(product?.description),
    imageUrl: cleanString(product?.imageUrl) || undefined,
    addable: extras as ExtraOption[],
  };
}

const ASSISTANT_CATEGORY_ORDER = [
  "burger",
  "vegan",
  "hotdogs",
  "extras",
  "drinks",
  "sauces",
  "donuts",
  "bubbletea",
] as const;

function limitAssistantCatalog(products: AssistantCatalogProductRuntime[]) {
  if (products.length <= MAX_CLIENT_PRODUCTS) return products;

  const buckets = new Map<string, AssistantCatalogProductRuntime[]>();
  for (const product of products) {
    const key = cleanString(product.category, "burger").toLowerCase();
    const bucket = buckets.get(key) || [];
    bucket.push(product);
    buckets.set(key, bucket);
  }

  const selected: AssistantCatalogProductRuntime[] = [];
  const selectedIds = new Set<string>();
  const push = (product: AssistantCatalogProductRuntime | undefined) => {
    if (!product || selectedIds.has(product.id) || selected.length >= MAX_CLIENT_PRODUCTS) {
      return;
    }
    selected.push(product);
    selectedIds.add(product.id);
  };

  // Ordering AI must know every customer-visible article in these operational
  // categories before we spend any cap on long burger lists. This prevents
  // Coca-Cola/Pommes/Curly Fries/Bubble Tea from disappearing when the catalog grows.
  const fullCoverageCategories = [
    "extras",
    "drinks",
    "bubbletea",
    "sauces",
    "hotdogs",
    "donuts",
  ] as const;

  for (const category of fullCoverageCategories) {
    for (const product of buckets.get(category) || []) push(product);
  }

  // Keep strong main-dish coverage as well.
  for (const category of ["burger", "vegan"] as const) {
    for (const product of (buckets.get(category) || []).slice(0, 48)) push(product);
  }

  // Fill any remaining space fairly from every category, without duplicating rows.
  const orderedCategories = [
    ...ASSISTANT_CATEGORY_ORDER,
    ...Array.from(buckets.keys()).filter(
      (category) => !ASSISTANT_CATEGORY_ORDER.includes(category as any),
    ),
  ];

  let index = 0;
  while (selected.length < MAX_CLIENT_PRODUCTS) {
    let added = false;
    for (const category of orderedCategories) {
      const product = (buckets.get(category) || [])[index];
      if (!product || selectedIds.has(product.id)) continue;
      push(product);
      added = true;
      if (selected.length >= MAX_CLIENT_PRODUCTS) break;
    }
    if (!added && index > products.length) break;
    index += 1;
    if (index > products.length) break;
  }

  return selected;
}

function normalizeCatalog(
  payload: CatalogPayload,
  orderMode: "pickup" | "delivery",
) {
  const rawProducts = Array.isArray(payload?.products)
    ? payload.products
    : Array.isArray(payload?.items)
      ? payload.items
      : [];

  try {
    localStorage.setItem("bb_products_v1", JSON.stringify(rawProducts));
    localStorage.setItem(
      "bb_campaigns_v1",
      JSON.stringify(Array.isArray(payload?.campaigns) ? payload.campaigns : []),
    );
  } catch {
    // Existing app already treats localStorage catalog as an optional cache.
  }

  const campaigns = loadNormalizedCampaigns();

  const normalized = rawProducts
    .filter((raw: any) => {
      if (!raw || typeof raw !== "object") return false;
      if (raw?.active === false) return false;
      if (isTemporarilyDisabled(raw)) return false;

      return isProductAvailable(
        {
          id: cleanString(raw?.id ?? raw?.sku ?? raw?.name),
          sku: cleanString(raw?.sku ?? raw?.id) || undefined,
          name: cleanString(raw?.name, "Produkt"),
          price: Math.max(0, cleanNumber(raw?.price)),
          category: normalizeCategory(raw?.category) as Category,
          active: raw?.active !== false,
          activeFrom: raw?.activeFrom || undefined,
          activeTo: raw?.activeTo || undefined,
        },
        new Date(),
      );
    })
    .map((raw: any): AssistantCatalogProductRuntime => {
      const menuItem = toMenuItem(raw);
      const category = normalizeCategory(raw?.category) as Category;
      const pricing = priceWithCampaign(
        {
          id: menuItem.id,
          sku: menuItem.sku,
          name: menuItem.name,
          price: menuItem.price,
          category,
        },
        campaigns as Campaign[],
        orderMode,
      );

      const extras = (menuItem.addable || []).map((extra) => ({
        id: cleanString(extra.id),
        name: cleanString(extra.name ?? extra.label ?? extra.id),
        price: Math.max(0, cleanNumber(extra.price)),
      }));

      return {
        id: menuItem.id,
        sku: cleanString(menuItem.sku ?? menuItem.id),
        name: menuItem.name,
        category,
        description: cleanString(menuItem.description ?? menuItem.desc),
        basePrice: menuItem.price,
        displayPrice: pricing.final,
        badge: cleanString(pricing.badge),
        extras,
        allergens: Array.isArray(raw?.allergens)
          ? raw.allergens.map((entry: unknown) => cleanString(entry)).filter(Boolean)
          : [],
        aliases: uniqAliases([
          raw?.name,
          raw?.title,
          raw?.sku,
          raw?.code,
          menuItem.name,
        ]),
        source: "catalog",
      };
    })
    .filter((product) => product.id && product.name);

  return normalized;
}

function euro(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value) || 0);
}

function safeAssistantResult(value: any): AssistantResult | null {
  if (!value || typeof value !== "object") return null;

  const reply = cleanString(value?.reply);
  if (!reply) return null;

  const actions = Array.isArray(value?.actions)
    ? value.actions
        .filter((action: any) =>
          ["add_to_cart", "show_product", "go_checkout"].includes(
            cleanString(action?.type),
          ),
        )
        .slice(0, 6)
        .map((action: any): AssistantAction => ({
          type: cleanString(action?.type) as AssistantAction["type"],
          productId: cleanString(action?.productId),
          quantity: Math.max(
            1,
            Math.min(10, Math.round(cleanNumber(action?.quantity) || 1)),
          ),
          extraIds: Array.isArray(action?.extraIds)
            ? action.extraIds.map((entry: unknown) => cleanString(entry)).filter(Boolean)
            : [],
          remove: Array.isArray(action?.remove)
            ? action.remove.map((entry: unknown) => cleanString(entry)).filter(Boolean)
            : [],
          note: cleanString(action?.note),
          requiresConfirmation: action?.requiresConfirmation === true,
        }))
    : [];

  return {
    reply,
    language: cleanString(value?.language, "de"),
    actions,
    provider:
      value?.provider === "openai" ||
      value?.provider === "local_fallback" ||
      value?.provider === "local"
        ? value.provider
        : undefined,
    model: cleanString(value?.model) || undefined,
  };
}

function actionProduct(
  action: AssistantAction,
  catalog: AssistantCatalogProductRuntime[],
) {
  return catalog.find((product) => product.id === action.productId) || null;
}


function plainAssistantText(value: unknown) {
  return cleanString(value)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

function AssistantOrbIcon({ active = false }: { active?: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border shadow-[0_0_24px_rgba(245,158,11,0.28)] ${
        active
          ? "border-amber-300/80 bg-amber-400/15"
          : "border-amber-300/40 bg-black/80"
      }`}
    >
      <span className="absolute inset-[5px] rounded-full bg-[radial-gradient(circle_at_35%_30%,rgba(255,225,138,.95),rgba(245,158,11,.56)_30%,rgba(113,63,18,.18)_60%,transparent_72%)]" />
      <span className={`absolute inset-[10px] rounded-full border border-amber-200/45 ${active ? "animate-ping" : ""}`} />
      <span className="relative text-[17px] font-black tracking-[-0.08em] text-white drop-shadow">✦</span>
    </span>
  );
}

type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "tool" | "speaking" | "error";
export default function BurgerAssistant() {
  const pathname = usePathname();
  const router = useRouter();

  const items = useCart((state) => state.items);
  const orderMode = useCart((state) => state.orderMode);
  const addToCart = useCart((state) => state.addToCart);
  const removeFromCart = useCart((state) => state.remove);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"chat" | "voice">("chat");
  const [catalog, setCatalog] = useState<AssistantCatalogProductRuntime[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastSuggestedProductIds, setLastSuggestedProductIds] = useState<string[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState("");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceConfirmation, setVoiceConfirmation] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      content: INITIAL_ASSISTANT_TEXT,
    },
  ]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const catalogLoadRef = useRef<Promise<AssistantCatalogProductRuntime[]> | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingVoiceCheckoutRef = useRef(false);
  const voiceIdleTimerRef = useRef<number | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const meterContextRef = useRef<AudioContext | null>(null);

  const normalizedPathname =
    pathname && pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const visible = CUSTOMER_ASSISTANT_PATHS.has(normalizedPathname);

  const voiceActive = ["connecting", "listening", "thinking", "tool", "speaking"].includes(
    voiceState,
  );

  const stopVoice = useCallback(() => {
    pendingVoiceCheckoutRef.current = false;

    if (meterFrameRef.current != null) cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    void meterContextRef.current?.close();
    meterContextRef.current = null;
    setVoiceLevel(0);

    if (voiceIdleTimerRef.current != null) {
      window.clearTimeout(voiceIdleTimerRef.current);
      voiceIdleTimerRef.current = null;
    }

    try {
      dataChannelRef.current?.close();
    } catch {}
    dataChannelRef.current = null;

    try {
      peerRef.current?.close();
    } catch {}
    peerRef.current = null;

    for (const track of mediaStreamRef.current?.getTracks() || []) {
      try {
        track.stop();
      } catch {}
    }
    mediaStreamRef.current = null;

    if (remoteAudioRef.current) {
      try {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
      } catch {}
    }
    remoteAudioRef.current = null;

    setVoiceState("idle");
  }, []);

  useEffect(() => {
    if (!visible) {
      setOpen(false);
      stopVoice();
    }
  }, [stopVoice, visible]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [open]);

  useEffect(() => () => stopVoice(), [stopVoice]);

  useEffect(() => {
    if (!open || mode !== "chat") return;

    const timer = window.setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 30);

    return () => window.clearTimeout(timer);
  }, [messages, busy, open, mode]);

  const loadCatalog = useCallback(async () => {
    if (catalogLoadRef.current) return catalogLoadRef.current;

    const task = (async () => {
      setCatalogBusy(true);
      setCatalogError("");

      try {
        const [catalogResponse, groupsResponse] = await Promise.all([
          fetch("/api/catalog", {
            method: "GET",
            cache: "no-store",
            headers: { accept: "application/json" },
          }),
          fetch("/api/groups", {
            method: "GET",
            cache: "no-store",
            headers: { accept: "application/json" },
          }),
        ]);

        const payload = (await catalogResponse
          .json()
          .catch(() => ({}))) as CatalogPayload;
        if (!catalogResponse.ok || payload?.ok === false) {
          throw new Error(`CATALOG_${catalogResponse.status}`);
        }

        const groupsPayload = groupsResponse.ok
          ? ((await groupsResponse.json().catch(() => ({}))) as GroupsPayload)
          : {};

        const baseCatalog = normalizeCatalog(payload, orderMode);
        const groupedArticles = normalizeGroupCatalog(groupsPayload);
        const next = mergeAssistantCatalog(baseCatalog, groupedArticles);
        if (!next.length) throw new Error("CATALOG_EMPTY");

        setCatalog(next);
        return next;
      } catch (error) {
        console.error("[assistant] catalog load failed", error);
        setCatalogError(
          "Das Menü konnte gerade nicht geladen werden. Bitte versuche es gleich noch einmal.",
        );
        return [];
      } finally {
        setCatalogBusy(false);
      }
    })();

    catalogLoadRef.current = task;

    try {
      return await task;
    } finally {
      if (catalogLoadRef.current === task) catalogLoadRef.current = null;
    }
  }, [orderMode]);

  useEffect(() => {
    if (!open) return;
    void loadCatalog();
  }, [open, loadCatalog]);

  useEffect(() => {
    if (!open || !catalog.length) return;

    const onCatalogSync = () => {
      setCatalog([]);
      void loadCatalog();
    };

    window.addEventListener("bb:catalog-sync", onCatalogSync);
    window.addEventListener("bb:refresh-catalog", onCatalogSync);
    window.addEventListener("bb:groups-sync", onCatalogSync);

    return () => {
      window.removeEventListener("bb:catalog-sync", onCatalogSync);
      window.removeEventListener("bb:refresh-catalog", onCatalogSync);
      window.removeEventListener("bb:groups-sync", onCatalogSync);
    };
  }, [catalog.length, loadCatalog, open]);

  useEffect(() => {
    if (!open || !catalog.length) return;

    const campaigns = loadNormalizedCampaigns();
    setCatalog((current) =>
      current.map((product) => {
        const pricing = priceWithCampaign(
          {
            id: product.id,
            sku: product.sku,
            name: product.name,
            price: product.basePrice,
            category: product.category as Category,
          },
          campaigns,
          orderMode,
        );

        return {
          ...product,
          displayPrice: pricing.final,
          badge: cleanString(pricing.badge),
        };
      }),
    );
    // Deliberately only reacts to order mode; including catalog would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderMode, open]);

  const cartContext = useMemo(() => cartLinesToContext(items), [items]);

  const historyForServer = useMemo(
    () =>
      messages
        .filter((message) => message.id !== "assistant-welcome")
        .slice(-10)
        .map(({ role, content }) => ({ role, content })),
    [messages],
  );

  const executeAction = useCallback(
    (action: AssistantAction, currentCatalog: AssistantCatalogProductRuntime[]) => {
      if (action.type === "go_checkout") {
        setOpen(false);
        stopVoice();
        router.push("/checkout");
        return true;
      }

      const product = actionProduct(action, currentCatalog);
      if (!product) return false;
      if (action.type === "show_product") return true;

      const extras: ExtraOption[] = action.extraIds.flatMap((extraId) => {
        const extra = product.extras.find((entry) => entry.id === extraId);
        if (!extra) return [];

        return [
          {
            id: extra.id,
            name: extra.name,
            label: extra.name,
            price: extra.price,
          },
        ];
      });

      const menuItem = {
        id: product.id,
        sku: product.sku || undefined,
        name: product.name,
        price: product.basePrice,
        category: product.category,
        description: product.description || undefined,
        addable: product.extras.map((extra) => ({
          id: extra.id,
          name: extra.name,
          label: extra.name,
          price: extra.price,
        })),
        pfandType: product.pfandType ?? product.depositType ?? "none",
        pfandAmount: Number(product.pfandAmount ?? product.depositAmount ?? 0) || 0,
        depositType: product.depositType ?? product.pfandType ?? "none",
        depositAmount: Number(product.depositAmount ?? product.pfandAmount ?? 0) || 0,
      } as MenuItem & {
        pfandType?: string;
        pfandAmount?: number;
        depositType?: string;
        depositAmount?: number;
      };

      addToCart({
        category: product.category,
        item: menuItem,
        add: extras,
        rm: action.remove,
        qty: action.quantity,
        note: undefined,
      });

      return true;
    },
    [addToCart, router, stopVoice],
  );

  const updateExistingCartLine = useCallback(
    (
      lineId: string,
      productId: string,
      extraIds: string[],
      remove: string[],
      currentCatalog: AssistantCatalogProductRuntime[],
    ) => {
      const currentLine = items.find((line) => cleanString(line.id) === cleanString(lineId));
      if (!currentLine) return false;

      const currentProductId = cleanString(
        currentLine.item?.id ?? currentLine.item?.sku,
      );
      if (!currentProductId || currentProductId !== cleanString(productId)) {
        return false;
      }

      const product = currentCatalog.find((entry) => entry.id === currentProductId);
      if (!product) return false;

      const requestedExtras = extraIds.flatMap((extraId) => {
        const extra = product.extras.find((entry) => entry.id === extraId);
        if (!extra) return [];

        return [
          {
            id: extra.id,
            name: extra.name,
            label: extra.name,
            price: extra.price,
          } satisfies ExtraOption,
        ];
      });

      if (requestedExtras.length !== extraIds.length) return false;

      const mergedExtras = new Map<string, ExtraOption>();
      for (const extra of Array.isArray(currentLine.add) ? currentLine.add : []) {
        const id = cleanString(extra?.id);
        if (!id) continue;
        mergedExtras.set(id, {
          id,
          name: cleanString(extra?.name ?? extra?.label ?? id),
          label: cleanString(extra?.label ?? extra?.name ?? id),
          price: Math.max(0, cleanNumber(extra?.price)),
        });
      }
      for (const extra of requestedExtras) mergedExtras.set(extra.id, extra);

      const mergedRemove = Array.from(
        new Set([
          ...(Array.isArray(currentLine.rm) ? currentLine.rm : []),
          ...remove,
        ].map((entry) => cleanString(entry)).filter(Boolean)),
      );

      const menuItem = {
        id: product.id,
        sku: product.sku || undefined,
        name: product.name,
        price: product.basePrice,
        category: product.category,
        description: product.description || undefined,
        addable: product.extras.map((extra) => ({
          id: extra.id,
          name: extra.name,
          label: extra.name,
          price: extra.price,
        })),
        pfandType: product.pfandType ?? product.depositType ?? "none",
        pfandAmount: Number(product.pfandAmount ?? product.depositAmount ?? 0) || 0,
        depositType: product.depositType ?? product.pfandType ?? "none",
        depositAmount: Number(product.depositAmount ?? product.pfandAmount ?? 0) || 0,
      } as MenuItem & {
        pfandType?: string;
        pfandAmount?: number;
        depositType?: string;
        depositAmount?: number;
      };

      removeFromCart(currentLine.id);
      addToCart({
        category: product.category,
        item: menuItem,
        add: Array.from(mergedExtras.values()),
        rm: mergedRemove,
        qty: Math.max(1, Number(currentLine.qty || 1)),
        note: cleanString(currentLine.note) || undefined,
      });

      return true;
    },
    [addToCart, items, removeFromCart],
  );

  const addSuggested = useCallback(
    (action: AssistantAction) => {
      const safeAction: AssistantAction = {
        ...action,
        type: "add_to_cart",
        requiresConfirmation: false,
      };

      if (!executeAction(safeAction, catalog)) return;

      setLastSuggestedProductIds([]);
      const product = actionProduct(action, catalog);
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          content: product
            ? `✓ ${product.name} wurde in den Warenkorb gelegt.`
            : "✓ In den Warenkorb gelegt.",
        },
      ]);
    },
    [catalog, executeAction],
  );

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || busy) return;

      let currentCatalog = catalog;
      if (!currentCatalog.length) currentCatalog = await loadCatalog();
      if (!currentCatalog.length) return;

      setMessages((current) => [
        ...current,
        { id: makeId(), role: "user", content: message },
      ]);
      setInput("");
      setBusy(true);

      try {
        const response = await fetch("/api/assistant/chat", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            message,
            history: historyForServer,
            catalog: currentCatalog,
            cart: cartContext,
            orderMode,
            lastSuggestedProductIds,
          }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
          throw new Error(cleanString(payload?.error, `ASSISTANT_${response.status}`));
        }

        const result = safeAssistantResult(payload);
        if (!result) throw new Error("ASSISTANT_INVALID_RESPONSE");

        const showActions = result.actions.filter(
          (action) => action.type === "show_product",
        );
        setLastSuggestedProductIds(
          showActions.map((action) => action.productId).filter(Boolean),
        );

        const executable = result.actions.filter(
          (action) =>
            action.requiresConfirmation !== true &&
            (action.type === "add_to_cart" || action.type === "go_checkout"),
        );

        let successfulAdds = 0;
        let checkoutAction: AssistantAction | null = null;

        for (const action of executable) {
          if (action.type === "go_checkout") {
            checkoutAction = action;
            continue;
          }
          if (executeAction(action, currentCatalog)) successfulAdds += 1;
        }

        setMessages((current) => [
          ...current,
          {
            id: makeId(),
            role: "assistant",
            content: plainAssistantText(result.reply),
            actions: showActions,
          },
          ...(successfulAdds > 0
            ? [
                {
                  id: makeId(),
                  role: "assistant" as const,
                  content: `✓ ${successfulAdds} Auswahl${successfulAdds > 1 ? "en" : ""} wurde${successfulAdds > 1 ? "n" : ""} in den Warenkorb gelegt.`,
                },
              ]
            : []),
        ]);

        if (checkoutAction) {
          window.setTimeout(() => executeAction(checkoutAction as AssistantAction, currentCatalog), 350);
        }
      } catch (error) {
        console.error("[assistant] request failed", error);
        setMessages((current) => [
          ...current,
          {
            id: makeId(),
            role: "assistant",
            content:
              "Gerade ist etwas schiefgelaufen. Dein Warenkorb wurde nicht verändert. Bitte versuche es noch einmal.",
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      cartContext,
      catalog,
      executeAction,
      historyForServer,
      lastSuggestedProductIds,
      loadCatalog,
      orderMode,
    ],
  );

  const startVoice = useCallback(async () => {
    if (voiceActive) return;

    setVoiceError("");

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setVoiceState("error");
      setVoiceError(
        "Sprachchat braucht HTTPS. Lokal funktioniert er am PC über localhost; auf dem iPhone testen wir ihn nach dem HTTPS-Deploy.",
      );
      return;
    }

    let currentCatalog = catalog;
    if (!currentCatalog.length) currentCatalog = await loadCatalog();
    if (!currentCatalog.length) {
      setVoiceState("error");
      setVoiceError("Das aktuelle Menü konnte nicht geladen werden.");
      return;
    }

    setVoiceState("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const AudioContextClass = window.AudioContext;
      const meterContext = new AudioContextClass();
      meterContextRef.current = meterContext;
      const analyser = meterContext.createAnalyser();
      analyser.fftSize = 256;
      meterContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        analyser.getByteFrequencyData(samples);
        const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
        setVoiceLevel(Math.min(1, average / 72));
        meterFrameRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();

      const peer = new RTCPeerConnection();
      peerRef.current = peer;

      const remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      remoteAudio.setAttribute("playsinline", "");
      remoteAudioRef.current = remoteAudio;

      peer.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0] || new MediaStream([event.track]);
        void remoteAudio.play().catch(() => {});
      };

      for (const track of stream.getTracks()) peer.addTrack(track, stream);

      const channel = peer.createDataChannel("oai-events");
      dataChannelRef.current = channel;

      const sendRealtimeEvent = (payload: unknown) => {
        if (channel.readyState !== "open") return false;
        channel.send(JSON.stringify(payload));
        return true;
      };

      const armVoiceIdleStop = () => {
        if (voiceIdleTimerRef.current != null) {
          window.clearTimeout(voiceIdleTimerRef.current);
        }
        voiceIdleTimerRef.current = window.setTimeout(() => {
          stopVoice();
          setVoiceState("idle");
        }, 60_000);
      };

      channel.onopen = () => {
        setVoiceState("listening");
        armVoiceIdleStop();
      };
      channel.onerror = () => {
        setVoiceState("error");
        setVoiceError("Sprachverbindung konnte nicht stabil aufgebaut werden.");
      };

      channel.onmessage = (messageEvent) => {
        let event: any;
        try {
          event = JSON.parse(String(messageEvent.data || "{}"));
        } catch {
          return;
        }

        if (event?.type === "input_audio_buffer.speech_started") {
          armVoiceIdleStop();
          setVoiceState("listening");
          return;
        }

        if (event?.type === "input_audio_buffer.speech_stopped") {
          armVoiceIdleStop();
          setVoiceState("thinking");
          return;
        }

        if (event?.type === "output_audio_buffer.started") {
          armVoiceIdleStop();
          setVoiceState("speaking");
          return;
        }

        if (event?.type === "output_audio_buffer.stopped") {
          armVoiceIdleStop();
          if (pendingVoiceCheckoutRef.current) {
            pendingVoiceCheckoutRef.current = false;
            window.setTimeout(() => {
              stopVoice();
              setOpen(false);
              router.push("/checkout");
            }, 120);
          } else {
            setVoiceState("listening");
          }
          return;
        }

        if (event?.type === "conversation.item.input_audio_transcription.completed") {
          const transcript = plainAssistantText(event?.transcript);
          if (transcript) {
            setMessages((current) => [
              ...current,
              { id: makeId(), role: "user", content: transcript },
            ]);
          }
          return;
        }

        if (event?.type === "response.output_audio_transcript.done") {
          const transcript = plainAssistantText(event?.transcript);
          if (transcript) {
            setMessages((current) => [
              ...current,
              { id: makeId(), role: "assistant", content: transcript },
            ]);
          }
          return;
        }

        if (event?.type === "response.function_call_arguments.done") {
          let args: any = {};
          try {
            args = JSON.parse(String(event?.arguments || "{}"));
          } catch {}

          if (event?.name === "search_menu") {
            setVoiceState("tool");
            let matches = searchMenuCatalog(
              currentCatalog,
              args?.query,
              args?.category,
            );
            if (!matches.length && args?.category) {
              matches = searchMenuCatalog(currentCatalog, args?.query);
            }

            sendRealtimeEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: event.call_id,
                output: JSON.stringify({
                  ok: true,
                  query: cleanString(args?.query),
                  matches,
                  count: matches.length,
                }),
              },
            });
            sendRealtimeEvent({ type: "response.create" });
            return;
          }

          if (event?.name === "list_category") {
            setVoiceState("tool");
            const listing = listMenuCategory(currentCatalog, args?.category);
            sendRealtimeEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: event.call_id,
                output: JSON.stringify({ ok: Boolean(listing.category), ...listing }),
              },
            });
            sendRealtimeEvent({ type: "response.create" });
            return;
          }

          if (event?.name === "get_cart") {
            sendRealtimeEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: event.call_id,
                output: JSON.stringify({ ok: true, cart: readLiveCartContext() }),
              },
            });
            sendRealtimeEvent({ type: "response.create" });
            return;
          }

          if (event?.name === "add_to_cart") {
            const action: AssistantAction = {
              type: "add_to_cart",
              productId: cleanString(args?.productId),
              quantity: Math.max(1, Math.min(10, Math.round(cleanNumber(args?.quantity) || 1))),
              extraIds: Array.isArray(args?.extraIds)
                ? args.extraIds.map((entry: unknown) => cleanString(entry)).filter(Boolean).slice(0, 12)
                : [],
              remove: Array.isArray(args?.remove)
                ? args.remove.map((entry: unknown) => cleanString(entry)).filter(Boolean).slice(0, 8)
                : [],
              note: "",
              requiresConfirmation: false,
            };

            const product = actionProduct(action, currentCatalog);
            const ok = Boolean(product && executeAction(action, currentCatalog));
            if (ok && product) {
              setVoiceConfirmation(`✓ ${product.name} hinzugefügt · ${euro(product.displayPrice)}`);
              window.setTimeout(() => setVoiceConfirmation(""), 2600);
            }

            sendRealtimeEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: event.call_id,
                output: JSON.stringify({
                  ok,
                  product: ok ? product?.name : null,
                  message: ok ? "Cart updated successfully." : "Invalid product or extras; cart was not changed.",
                  cart: readLiveCartContext(),
                }),
              },
            });
            sendRealtimeEvent({ type: "response.create" });
            return;
          }

          if (event?.name === "update_cart_item") {
            const lineId = cleanString(args?.lineId);
            const productId = cleanString(args?.productId);
            const extraIds = Array.isArray(args?.extraIds)
              ? args.extraIds
                  .map((entry: unknown) => cleanString(entry))
                  .filter(Boolean)
                  .slice(0, 12)
              : [];
            const remove = Array.isArray(args?.remove)
              ? args.remove
                  .map((entry: unknown) => cleanString(entry))
                  .filter(Boolean)
                  .slice(0, 8)
              : [];

            const ok = updateExistingCartLine(
              lineId,
              productId,
              extraIds,
              remove,
              currentCatalog,
            );
            const product = currentCatalog.find((entry) => entry.id === productId);

            sendRealtimeEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: event.call_id,
                output: JSON.stringify({
                  ok,
                  product: ok ? product?.name : null,
                  message: ok
                    ? "Existing cart item updated successfully."
                    : "The requested cart line, product, or extras were invalid; cart was not changed.",
                  cart: readLiveCartContext(),
                }),
              },
            });
            sendRealtimeEvent({ type: "response.create" });
            return;
          }

          if (event?.name === "check_delivery_area") {
            setVoiceState("tool");
            void fetch("/api/assistant/delivery-area", {
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify({ postalCode: cleanString(args?.postalCode) }),
            })
              .then(async (response) => {
                const result = await response.json().catch(() => ({ ok: false }));
                return response.ok ? result : { ok: false, error: "delivery_lookup_failed" };
              })
              .catch(() => ({ ok: false, error: "delivery_lookup_failed" }))
              .then((result) => {
                sendRealtimeEvent({
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: event.call_id,
                    output: JSON.stringify(result),
                  },
                });
                sendRealtimeEvent({ type: "response.create" });
              });
            return;
          }

          if (event?.name === "go_checkout") {
            pendingVoiceCheckoutRef.current = true;
            sendRealtimeEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: event.call_id,
                output: JSON.stringify({ ok: true, message: "Checkout navigation approved." }),
              },
            });
            sendRealtimeEvent({ type: "response.create" });
            return;
          }
        }

        if (event?.type === "error") {
          console.error("[assistant/realtime]", event?.error || event);
          setVoiceState("error");
          setVoiceError(
            cleanString(event?.error?.message, "Sprachchat hat einen Fehler gemeldet."),
          );
        }
      };

      peer.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
          if (peer.connectionState !== "closed") {
            setVoiceState("error");
            setVoiceError("Die Sprachverbindung wurde unterbrochen.");
          }
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      // Safari can update/normalize the local SDP as part of setLocalDescription.
      // Prefer the peer's installed localDescription and only fall back to the
      // original offer object. This also avoids forwarding an empty/stale offer.
      const localSdp = peer.localDescription?.sdp || offer.sdp || "";
      if (!localSdp.trim()) throw new Error("VOICE_EMPTY_LOCAL_SDP");

      const response = await fetch("/api/assistant/realtime", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/sdp, text/plain",
        },
        body: JSON.stringify({
          sdp: localSdp,
          cart: cartContext,
          orderMode,
        }),
      });

      const answerSdp = await response.text();
      if (!response.ok || !answerSdp.trim()) {
        let reason = `VOICE_${response.status}`;
        try {
          const parsed = JSON.parse(answerSdp);
          reason = cleanString(parsed?.error, reason);
        } catch {}
        throw new Error(reason);
      }

      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (error) {
      console.error("[assistant/realtime] start failed", error);
      stopVoice();
      setVoiceState("error");
      setVoiceError(
        error instanceof Error && error.name === "NotAllowedError"
          ? "Mikrofon izni verilmedi. Safari ayarlarından mikrofon iznini açabilirsin."
          : "Sprachchat konnte gerade nicht gestartet werden. Bitte versuche es erneut.",
      );
    }
  }, [
    cartContext,
    catalog,
    executeAction,
    loadCatalog,
    orderMode,
    router,
    stopVoice,
    updateExistingCartLine,
    voiceActive,
  ]);

  const closeAssistant = useCallback(() => {
    stopVoice();
    setOpen(false);
    setMode("chat");
  }, [stopVoice]);

  const switchMode = useCallback(
    (next: "chat" | "voice") => {
      setMode(next);
      setVoiceError("");

      if (next === "chat") {
        stopVoice();
        return;
      }

      void startVoice();
    },
    [startVoice, stopVoice],
  );

  const voiceStatus =
    voiceState === "connecting"
      ? "Verbindung wird aufgebaut …"
      : voiceState === "listening"
        ? "Ich höre dir zu"
      : voiceState === "thinking"
          ? "Einen Moment …"
          : voiceState === "tool"
            ? "Ich prüfe die Karte …"
          : voiceState === "speaking"
            ? "Burger Brothers AI spricht"
            : voiceState === "error"
              ? "Sprachchat pausiert"
              : "Bereit, wenn du es bist";
  const latestVoiceReply = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.id !== "assistant-welcome")
    ?.content;

  if (!visible) return null;

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+142px)] right-4 z-[70] flex items-center gap-2 rounded-full border border-amber-300/25 bg-black/88 p-1.5 pr-3.5 text-sm font-semibold text-white shadow-[0_12px_38px_rgba(0,0,0,.65)] backdrop-blur-xl transition active:scale-[0.97] sm:bottom-6 sm:right-6"
          aria-label="Burger Brothers AI öffnen"
        >
          <AssistantOrbIcon />
          <span className="leading-none">
            <span className="block text-[10px] uppercase tracking-[0.16em] text-amber-300/70">Burger Brothers</span>
            <span className="mt-1 block">AI Assistent</span>
          </span>
        </button>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-[100] h-[100dvh] overflow-hidden bg-[#050403] text-white"
          role="dialog"
          aria-modal="true"
          aria-label="Burger Brothers AI"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(245,158,11,.19),transparent_34%),radial-gradient(circle_at_15%_75%,rgba(120,53,15,.14),transparent_30%),linear-gradient(180deg,#080604_0%,#030303_55%,#050403_100%)]" />
          <div className="pointer-events-none absolute left-1/2 top-[18%] h-64 w-64 -translate-x-1/2 rounded-full bg-amber-500/[0.035] blur-3xl" />

          <div className="relative mx-auto flex h-full w-full max-w-5xl flex-col pt-[env(safe-area-inset-top)]">
            <header className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative h-11 w-11 overflow-hidden rounded-full border border-amber-300/20 bg-black/50 shadow-[0_0_22px_rgba(245,158,11,.14)]">
                  <Image
                    src="/logo-burger-brothers.webp"
                    alt="Burger Brothers"
                    fill
                    sizes="44px"
                    className="object-contain p-1"
                    priority
                  />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold tracking-tight sm:text-xl">
                    Burger Brothers AI
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-stone-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,.6)]" />
                    Menü verstehen · auswählen · Warenkorb vorbereiten
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={closeAssistant}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-2xl text-stone-200 active:scale-95"
                aria-label="Schließen"
              >
                ×
              </button>
            </header>

            <div className={`shrink-0 px-4 pt-3 sm:px-6 ${mode === "voice" ? "hidden" : ""}`}>
              <div className="mx-auto flex w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.035] p-1">
                <button
                  type="button"
                  onClick={() => switchMode("chat")}
                  className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    mode === "chat"
                      ? "bg-amber-500 text-black shadow"
                      : "text-stone-300"
                  }`}
                >
                  Schreiben
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("voice")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    mode === "voice"
                      ? "bg-amber-500 text-black shadow"
                      : "text-stone-300"
                  }`}
                >
                  <span aria-hidden>🎙</span>
                  Sprechen
                </button>
              </div>
            </div>

            {mode === "chat" ? (
              <>
                <div
                  ref={scrollRef}
                  className="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
                >
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={
                        message.role === "user"
                          ? "ml-auto max-w-[88%] sm:max-w-[72%]"
                          : "mr-auto max-w-[94%] sm:max-w-[78%]"
                      }
                    >
                      {message.role === "assistant" ? (
                        <div className="mb-1.5 flex items-center gap-2 px-1 text-[10px] uppercase tracking-[0.15em] text-amber-300/60">
                          <AssistantOrbIcon />
                          <span>AI Assistent</span>
                        </div>
                      ) : null}

                      <div
                        className={
                          message.role === "user"
                            ? "rounded-[24px] rounded-br-lg bg-gradient-to-br from-amber-400 to-amber-500 px-4 py-3 text-[15px] font-medium leading-relaxed text-black shadow-[0_8px_28px_rgba(245,158,11,.12)]"
                            : "rounded-[24px] rounded-bl-lg border border-white/[0.08] bg-white/[0.055] px-4 py-3 text-[15px] leading-relaxed text-stone-100 shadow-[0_12px_34px_rgba(0,0,0,.18)]"
                        }
                      >
                        {message.content}
                      </div>

                      {message.role === "assistant" && message.actions?.length ? (
                        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                          {message.actions.map((action, index) => {
                            const product = actionProduct(action, catalog);
                            if (!product) return null;

                            return (
                              <div
                                key={`${message.id}-${action.productId}-${index}`}
                                className="rounded-[22px] border border-amber-400/20 bg-amber-400/[0.065] p-3.5 shadow-[0_10px_30px_rgba(0,0,0,.18)]"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-white">{product.name}</div>
                                    <div className="mt-1 text-xs text-stone-400">
                                      {product.category}{product.badge ? ` · ${product.badge}` : ""}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-sm font-bold text-amber-300">{euro(product.displayPrice)}</div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => addSuggested(action)}
                                  className="mt-3 w-full rounded-xl bg-amber-500 px-3 py-2.5 text-sm font-bold text-black active:scale-[0.99]"
                                >
                                  In den Warenkorb
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ))}

                  {catalogError ? (
                    <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">{catalogError}</div>
                  ) : null}

                  {busy || catalogBusy ? (
                    <div className="mr-auto flex max-w-[80%] items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.05] px-4 py-3 text-sm text-stone-300">
                      <AssistantOrbIcon active />
                      <span>{catalogBusy ? "Menü wird geladen …" : "Ich denke kurz nach …"}</span>
                    </div>
                  ) : null}
                </div>

                <div className="shrink-0 border-t border-white/[0.07] bg-black/35 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur-xl sm:px-6">
                  <div className="mx-auto w-full max-w-3xl">
                    <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
                      {["Was empfiehlst du?", "Etwas Scharfes", "Vegan", "Unter 15 €"].map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          disabled={busy || catalogBusy}
                          onClick={() => void send(suggestion)}
                          className="shrink-0 rounded-full border border-white/10 bg-white/[0.045] px-3.5 py-2 text-stone-300 disabled:opacity-40"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 rounded-[22px] border border-white/[0.1] bg-white/[0.06] p-1.5 pl-4 focus-within:border-amber-400/45 focus-within:bg-white/[0.075]">
                      <input
                        type="text"
                        value={input}
                        onChange={(event) => setInput(event.target.value.slice(0, 800))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            void send(input);
                          }
                        }}
                        enterKeyHint="send"
                        autoComplete="off"
                        autoCorrect="on"
                        spellCheck
                        placeholder="Frag mich einfach …"
                        className="min-w-0 flex-1 bg-transparent py-2.5 text-[16px] text-white outline-none placeholder:text-stone-500"
                      />

                      {input.trim() ? (
                        <button
                          type="button"
                          onClick={() => void send(input)}
                          disabled={busy || catalogBusy}
                          className="h-11 shrink-0 rounded-2xl bg-amber-500 px-4 text-sm font-bold text-black disabled:opacity-40 active:scale-95"
                        >
                          Senden
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => switchMode("voice")}
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-500 text-xl text-black active:scale-95"
                          aria-label="Sprachchat starten"
                        >
                          🎙
                        </button>
                      )}
                    </div>

                    <div className="mt-2 text-center text-[10px] leading-tight text-stone-500">
                      Preise und Verfügbarkeit kommen aus dem aktuellen Menü. Bezahlt wird erst im normalen Checkout.
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
                  <div
                    className={`bb-voice-orb bb-voice-orb--${voiceState} ${voiceConfirmation ? "bb-voice-orb--success" : ""}`}
                    style={{ "--voice-level": voiceLevel } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    <span className="bb-voice-orb__halo" />
                    <span className="bb-voice-orb__body" />
                    <span className="bb-voice-orb__light" />
                    <span className="bb-voice-orb__core" />
                  </div>

                  <div className="mt-8 text-lg font-semibold tracking-tight" aria-live="polite">{voiceStatus}</div>
                  {latestVoiceReply ? (
                    <div className="mt-3 max-w-lg line-clamp-2 text-sm leading-relaxed text-stone-400" aria-live="polite">
                      {latestVoiceReply}
                    </div>
                  ) : null}
                  {voiceConfirmation ? (
                    <div className="mt-4 rounded-full border border-amber-300/25 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-100" aria-live="polite">
                      {voiceConfirmation}
                    </div>
                  ) : null}

                  {voiceError ? (
                    <div className="mt-5 max-w-lg rounded-2xl border border-amber-300/20 bg-amber-400/[0.08] px-4 py-3 text-sm leading-relaxed text-amber-100">
                      {voiceError}
                    </div>
                  ) : null}

                </div>

                <div className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 backdrop-blur-xl">
                  <div className="mx-auto grid max-w-md grid-cols-3 gap-3">
                    <button type="button" onClick={() => switchMode("chat")} aria-label="Zum Schreiben wechseln" className="rounded-2xl border border-white/10 bg-white/[.055] px-3 py-3 text-sm font-semibold">Schreiben</button>
                    <button type="button" onClick={() => { stopVoice(); setOpen(false); router.push("/checkout"); }} aria-label="Warenkorb öffnen" className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-3 py-3 text-sm font-semibold text-amber-100">Warenkorb</button>
                    <button type="button" onClick={closeAssistant} aria-label="Sprachsession beenden" className="rounded-2xl border border-white/10 bg-white/[.055] px-3 py-3 text-sm font-semibold">Beenden</button>
                  </div>
                </div>
                <style jsx>{`
                  .bb-voice-orb { --voice-level: 0; position: relative; width: min(64vw, 19rem); aspect-ratio: 1; animation: bb-breathe 5.5s ease-in-out infinite; filter: drop-shadow(0 0 42px rgba(245,158,11,.18)); }
                  .bb-voice-orb span { position: absolute; inset: 0; border-radius: 46% 54% 51% 49% / 52% 43% 57% 48%; }
                  .bb-voice-orb__halo { inset: -8% !important; background: radial-gradient(circle,rgba(245,158,11,.16),transparent 66%); filter: blur(16px); }
                  .bb-voice-orb__body { border: 1px solid rgba(252,211,77,.22); background: radial-gradient(circle at 42% 38%,#241706 0,#090704 43%,#020202 72%); box-shadow: inset -22px -24px 55px #000,inset 15px 12px 38px rgba(251,191,36,.12); }
                  .bb-voice-orb__light { inset: 7% !important; opacity: .75; background: conic-gradient(from 30deg,transparent,rgba(245,158,11,.58),transparent 38%,rgba(120,53,15,.28),transparent 74%); filter: blur(18px); animation: bb-turn 8s linear infinite; }
                  .bb-voice-orb__core { inset: 25% !important; background: radial-gradient(circle at 48% 52%,rgba(255,225,138,.48),rgba(245,158,11,.14) 36%,transparent 70%); filter: blur(10px); }
                  .bb-voice-orb--listening { transform: scale(calc(1 + var(--voice-level) * .045)); }
                  .bb-voice-orb--speaking { animation: bb-speak 1.15s ease-in-out infinite; }
                  .bb-voice-orb--thinking .bb-voice-orb__light,.bb-voice-orb--tool .bb-voice-orb__light { animation-duration: 2.2s; opacity: 1; }
                  .bb-voice-orb--success { animation: bb-success .7s ease-out; }
                  @keyframes bb-breathe { 50% { transform: scale(1.025) rotate(.6deg); } }
                  @keyframes bb-turn { to { transform: rotate(360deg); } }
                  @keyframes bb-speak { 35% { transform: scale(1.035) rotate(-1deg); } 70% { transform: scale(.99) rotate(1deg); } }
                  @keyframes bb-success { 45% { transform: scale(1.08); filter: drop-shadow(0 0 60px rgba(251,191,36,.55)); } }
                  @media (prefers-reduced-motion: reduce) { .bb-voice-orb,.bb-voice-orb span { animation: none !important; transition: none !important; } }
                `}</style>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
