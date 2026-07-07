// app/menu/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import ProductCard from "@/components/menu/ProductCard";
import CartSummary, { CartSummaryMobile } from "@/components/CartSummary";
import NavBar from "@/components/NavBar";
import { useCart } from "@/components/store";
import {
  isProductAvailable,
  priceWithCampaign,
  type Campaign,
  type Category,
  sortProductsForMenu,
  popularityBadgeFor,
} from "@/lib/catalog";
import { loadNormalizedCampaigns } from "@/lib/campaigns-compat";
import CategoryBlurb from "@/components/CategoryBlurb";

/* ==== LS anahtarları — artık sadece cache/fallback ==== */
const LS_PRODUCTS = "bb_products_v1";
const LS_SETTINGS = "bb_settings_v6";

/* ==== Tipler ==== */
type Extra = { id: string; name: string; price: number };

type Product = {
  id?: string;
  sku?: string;
  code?: string;
  name: string;
  price: number;
  category: any;
  imageUrl?: string;
  description?: string;
  extras?: Extra[];
  allergens?: string[];
  allergenHinweise?: string;
  active?: boolean;
  activeFrom?: string;
  activeTo?: string;
};

type ProductAvailabilityEntry = {
  disabled?: boolean;
  mode?: "today" | "manual" | string;
  until?: string | null;
  by?: string;
  updatedAt?: number;
  productId?: string;
  name?: string;
};

type ProductAvailabilityMap = Record<string, ProductAvailabilityEntry | null | undefined>;

type FeatureFlags = {
  donuts: boolean;
  bubbleTea: boolean;
  productAvailability: ProductAvailabilityMap;
};

/* === Sekmeler / başlıklar === */
type TabKey =
  | "burger"
  | "vegan"
  | "extras"
  | "sauces"
  | "hotdogs"
  | "drinks"
  | "donuts"
  | "bubbletea";

/*
  ProductCard şu anda sadece eski ana kategorileri kabul ediyor.
  Menüde Donuts ve Bubble Tea gerçek kategori olarak kalır,
  fakat ProductCard'a güvenli görsel/sepet kategorisi gönderilir.
*/
type ProductCardCategory =
  | "burger"
  | "vegan"
  | "extras"
  | "sauces"
  | "drinks"
  | "hotdogs";

function toProductCardCategory(tab: TabKey): ProductCardCategory {
  if (tab === "donuts") return "extras";
  if (tab === "bubbletea") return "drinks";
  return tab;
}

const ALL_TABS: TabKey[] = [
  "burger",
  "vegan",
  "extras",
  "sauces",
  "hotdogs",
  "drinks",
  "donuts",
  "bubbletea",
];

const TAB_TITLE: Record<TabKey, string> = {
  burger: "Burger",
  vegan: "Vegan / Vegetarisch",
  extras: "Extras",
  sauces: "Soßen",
  hotdogs: "Hot Dogs",
  drinks: "Getränke",
  donuts: "Donuts",
  bubbletea: "Bubble Tea",
};

/* Bu tab’lar kendi route’larına gider; Burger/Vegan /menu’da kalır */
const ROUTE_MAP: Partial<Record<TabKey, string>> = {
  extras: "/extras",
  sauces: "/sauces",
  drinks: "/drinks",
  hotdogs: "/hotdogs",
  donuts: "/donuts",
  bubbletea: "/bubble-tea",
};

/* =======================
   Genel yardımcılar
   ======================= */

function safeJsonParse<T = any>(value: any, fallback: T): T {
  try {
    if (typeof value !== "string") return value ?? fallback;
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.products)) return value.products;
  if (Array.isArray(value?.campaigns)) return value.campaigns;
  return [];
}

function normalizeProductKey(value: any) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function productAvailabilityLookupKeys(product: Partial<Product> | any) {
  return [
    product?.id,
    product?.sku,
    product?.code,
    product?.name,
  ]
    .map(normalizeProductKey)
    .filter(Boolean);
}

function normalizeProductAvailabilityMap(value: any): ProductAvailabilityMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: ProductAvailabilityMap = {};

  for (const [key, entry] of Object.entries(value)) {
    const cleanKey = normalizeProductKey(key);
    if (!cleanKey) continue;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      out[cleanKey] = null;
      continue;
    }

    out[cleanKey] = {
      disabled: (entry as any)?.disabled === true,
      mode: String((entry as any)?.mode || "manual"),
      until: (entry as any)?.until ? String((entry as any).until) : null,
      by: (entry as any)?.by ? String((entry as any).by) : undefined,
      updatedAt: Number((entry as any)?.updatedAt) || undefined,
      productId: (entry as any)?.productId ? String((entry as any).productId) : undefined,
      name: (entry as any)?.name ? String((entry as any).name) : undefined,
    };
  }

  return out;
}

function getProductAvailabilityEntry(
  product: Partial<Product> | any,
  availability: ProductAvailabilityMap,
) {
  for (const key of productAvailabilityLookupKeys(product)) {
    const entry = availability[key];
    if (entry) return entry;
  }

  return null;
}

function isProductClosedByTv(
  product: Partial<Product> | any,
  availability: ProductAvailabilityMap,
  now = new Date(),
) {
  const entry = getProductAvailabilityEntry(product, availability);

  if (!entry?.disabled) return false;
  if (!entry.until) return true;

  const untilMs = Date.parse(String(entry.until));
  if (!Number.isFinite(untilMs)) return true;

  return untilMs > now.getTime();
}

function toIso(input: any): string | undefined {
  if (!input && input !== 0) return undefined;

  if (input instanceof Date) {
    return Number.isFinite(input.valueOf()) ? input.toISOString() : undefined;
  }

  if (typeof input === "number") {
    const d = new Date(input);
    return Number.isFinite(d.valueOf()) ? d.toISOString() : undefined;
  }

  if (typeof input === "string") {
    const s = input.trim();
    if (!s) return undefined;

    const d = new Date(s);
    if (Number.isFinite(d.valueOf())) return d.toISOString();

    const m = s.match(
      /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/
    );

    if (m) {
      const [, dd, MM, yyyy, hh = "00", mm = "00", ss = "00"] = m;
      const parsed = new Date(
        Number(yyyy),
        Number(MM) - 1,
        Number(dd),
        Number(hh),
        Number(mm),
        Number(ss)
      );

      return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : undefined;
    }
  }

  return undefined;
}

function normalizeCategory(input: any): TabKey | null {
  const s = String(input ?? "").toLowerCase().trim();
  if (!s) return null;

  if (s.includes("vegan") || s.includes("vegetar")) return "vegan";
  if (s.includes("drink") || s.includes("getränk") || s.includes("getraenk")) {
    return "drinks";
  }
  if (s.includes("soß") || s.includes("sauce") || s.includes("sos")) {
    return "sauces";
  }
  if (
    s.includes("hotdog") ||
    s.includes("hot dog") ||
    (s.includes("hot") && s.includes("dog"))
  ) {
    return "hotdogs";
  }
  if (s.includes("donut") || s.includes("doughnut")) return "donuts";
  if (
    s.includes("bubble") ||
    s.includes("boba") ||
    s.includes("milk tea") ||
    s.includes("bubbletea")
  ) {
    return "bubbletea";
  }
  if (s.includes("extra") || s.includes("snack") || s.includes("pommes")) {
    return "extras";
  }
  if (s.includes("burger")) return "burger";

  return null;
}

function guessCategory(p: Product): TabKey {
  const fromField = normalizeCategory(p.category);
  if (fromField) return fromField;

  const sku = String(p.sku ?? p.code ?? p.id ?? "").toLowerCase();
  const text = `${String(p.name ?? "").toLowerCase()} ${String(
    p.description ?? ""
  ).toLowerCase()}`;

  const checks: Array<[RegExp, TabKey]> = [
    [/^vegan-/, "vegan"],
    [/^(drink|cola|fritz|jarritos|ayran|wasser|water|ice ?tea|fanta|sprite|mezzo)/, "drinks"],
    [/^sauce-/, "sauces"],
    [/^(hotdog|hot-dog|dog)-/, "hotdogs"],
    [/^(donut|doughnut|dn-)/, "donuts"],
    [/^(bubbletea|bubble-tea|btea|boba|milktea)-/, "bubbletea"],
    [/^(extra|snack|fries|pommes|rings|nugget|country)/, "extras"],
  ];

  for (const [re, key] of checks) {
    if (re.test(sku)) return key;
  }

  if (/(hot ?dog|hotdog)/.test(text)) return "hotdogs";
  if (/(donut|doughnut)/.test(text)) return "donuts";
  if (/(bubble ?tea|boba|milk ?tea|taro|matcha)/.test(text)) return "bubbletea";
  if (/(cola|fritz|jarritos|ayran|wasser|water|ice ?tea|fanta|sprite|mezzo)/.test(text)) {
    return "drinks";
  }
  if (/(ketchup|mayo|mayonna|aioli|bbq|barbecue|sauce|soß|dip|sour ?cream|chili)/.test(text)) {
    return "sauces";
  }
  if (/(snack|pommes|fries|country|nugget|mozzarella|onion ring|curly|süßkartoffel|coleslaw)/.test(text)) {
    return "extras";
  }

  return "burger";
}

function normalizeExtras(value: any): Extra[] {
  const arr = typeof value === "string" ? safeJsonParse<any[]>(value, []) : value;
  if (!Array.isArray(arr)) return [];

  return arr
    .filter(Boolean)
    .map((e: any) => ({
      id: String(e?.id ?? e?.sku ?? e?.code ?? e?.name ?? ""),
      name: String(e?.name ?? e?.label ?? "Extra"),
      price: Number(e?.price) || 0,
    }))
    .filter((e) => e.id || e.name);
}

function normalizeAllergens(value: any): string[] {
  const arr = typeof value === "string" ? safeJsonParse<any[]>(value, []) : value;
  if (!Array.isArray(arr)) return [];

  return arr.map((x: any) => String(x ?? "").trim()).filter(Boolean);
}

function normalizeProduct(raw: any): Product | null {
  if (!raw) return null;

  const id = String(raw?.id ?? raw?.sku ?? raw?.code ?? raw?.name ?? "").trim();
  const sku = String(raw?.sku ?? raw?.code ?? raw?.id ?? raw?.name ?? "").trim();
  const name = String(raw?.name ?? raw?.title ?? "").trim();

  if (!id && !sku && !name) return null;

  const category = raw?.category ?? raw?.cat ?? "burger";

  return {
    id: id || sku || name,
    sku: sku || id || name,
    code: raw?.code ? String(raw.code) : undefined,
    name: name || "Produkt",
    price: Number(raw?.price) || 0,
    category,
    imageUrl: raw?.imageUrl ?? raw?.image ?? raw?.cover ?? raw?.photoUrl ?? undefined,
    description: raw?.description ?? raw?.desc ?? "",
    extras: normalizeExtras(raw?.extras ?? raw?.extrasJson ?? raw?.extras_json),
    allergens: normalizeAllergens(raw?.allergens),
    allergenHinweise:
      raw?.allergenHinweise ?? raw?.allergenNotes ?? raw?.allergenText ?? undefined,
    active:
      typeof raw?.active === "boolean"
        ? raw.active
        : typeof raw?.enabled === "boolean"
          ? raw.enabled
          : true,
    activeFrom: toIso(raw?.activeFrom ?? raw?.startAt ?? raw?.startsAt),
    activeTo: toIso(raw?.activeTo ?? raw?.endAt ?? raw?.endsAt),
  };
}

function normalizeProducts(raw: any): Product[] {
  return toArray(raw).map(normalizeProduct).filter(Boolean) as Product[];
}

/* =======================
   Campaign normalize
   DB Campaign row:
   { id, title, badgeText, startsAt, endsAt, payload }
   ======================= */

function mapCampaignMode(m: any): Campaign["mode"] {
  if (!m) return "both";

  if (typeof m === "object") {
    const d = !!(m.delivery ?? m.lieferung ?? m.liefa ?? m.lifa);
    const p = !!(m.pickup ?? m.abholung ?? m.apollon ?? m.apollo);

    if (d && p) return "both";
    if (d) return "delivery";
    if (p) return "pickup";
    return "both";
  }

  const s = String(m).toLowerCase().trim();

  if (["both", "her ikisi", "ikisi", "alle", "beide"].some((k) => s.includes(k))) {
    return "both";
  }

  const hasDelivery = /(liefer|lieferung|delivery|lifa|liefa)/.test(s);
  const hasPickup = /(abhol|abholung|pickup|apollon|apollo)/.test(s);

  if (hasDelivery && hasPickup) return "both";
  if (hasDelivery) return "delivery";
  if (hasPickup) return "pickup";

  return s === "delivery" ? "delivery" : s === "pickup" ? "pickup" : "both";
}

function mapCampaignCategory(val: any): Category | undefined {
  const cat = normalizeCategory(val);
  if (!cat) return undefined;
  return cat as unknown as Category;
}

function pickCampaignProductIds(c: any): string[] {
  const out: string[] = [];

  if (Array.isArray(c?.productIds)) {
    for (const x of c.productIds) {
      const id = String(x ?? "").trim();
      if (id) out.push(id);
    }
  }

  if (Array.isArray(c?.products)) {
    for (const p of c.products) {
      const id = String(p?.id ?? p?.sku ?? p?.code ?? p?.name ?? "").trim();
      if (id) out.push(id);
    }
  }

  const single =
    c?.targetProductId ?? c?.productId ?? c?.sku ?? c?.code ?? c?.targetId;

  if (single) {
    const id = String(single).trim();
    if (id) out.push(id);
  }

  return Array.from(new Set(out));
}

function normalizeCampaignRow(row: any): Campaign | null {
  if (!row) return null;

  const payload =
    row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {};

  const c = {
    ...payload,
    ...row,
    payload,
  } as any;

  const scope = c?.scope ?? c?.target ?? c?.typeScope;
  const kind = c?.kind ?? c?.valueType ?? "percent";

  const explicitType = String(c?.type ?? "").trim();

  const type: Campaign["type"] =
    explicitType === "percentOffProduct" ||
    String(scope).toLowerCase().startsWith("product")
      ? "percentOffProduct"
      : "percentOffCategory";

  const rawValue = Number(c?.percent ?? c?.value ?? c?.amount ?? 0);

  const percent =
    String(kind).toLowerCase() === "percent" || explicitType.startsWith("percentOff")
      ? Math.max(0, Math.min(100, rawValue))
      : 0;

  let targetCategory: Category | undefined;

  if (type === "percentOffCategory") {
    if (c?.targetCategory) {
      targetCategory = mapCampaignCategory(c.targetCategory);
    } else if (Array.isArray(c?.categories) && c.categories.length) {
      targetCategory = mapCampaignCategory(c.categories[0]);
    } else if (c?.category) {
      targetCategory = mapCampaignCategory(c.category);
    }
  }

  const productIds = type === "percentOffProduct" ? pickCampaignProductIds(c) : [];
  const targetProductId = productIds.length ? productIds[0] : undefined;

  const startsAt = toIso(
    c?.startsAt ?? c?.startAt ?? c?.start ?? c?.from ?? row?.startsAt
  );

  const endsAt = toIso(
    c?.endsAt ?? c?.endAt ?? c?.end ?? c?.until ?? c?.to ?? row?.endsAt
  );

  return {
    id: String(row?.id ?? c?.id ?? c?.code ?? `campaign-${Date.now()}`),
    name: String(c?.name ?? c?.title ?? row?.title ?? "Aktion"),
    type,
    percent,
    targetCategory,
    targetProductId,
    productIds: productIds.length ? productIds : undefined,
    mode: mapCampaignMode(c?.mode),
    active: c?.enabled !== false && c?.active !== false,
    startsAt,
    endsAt,
    priority: Number(c?.priority ?? c?.prio ?? 0) || 0,
    badgeText: c?.badgeText ?? c?.badge ?? c?.label ?? row?.badgeText ?? undefined,
  };
}

function normalizeCampaigns(raw: any): Campaign[] {
  return toArray(raw).map(normalizeCampaignRow).filter(Boolean) as Campaign[];
}

/* =======================
   DB-FIRST loader
   ======================= */

async function dbLoadCatalog(): Promise<{
  products: Product[];
  campaigns: Campaign[];
  source: "db" | "local";
}> {
  try {
    const res = await fetch("/api/catalog", {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`catalog_${res.status}`);
    }

    const json = await res.json();

    const products = normalizeProducts(
      json?.products ?? json?.items ?? json?.data?.products ?? []
    );

    const campaigns = normalizeCampaigns(
      json?.campaigns ?? json?.data?.campaigns ?? []
    );

    /*
      DB başarılıysa ürün cache’i güncelliyoruz.
      Bu cache artık ana kaynak değil; sadece eski admin parçaları ve offline fallback için.
    */
    try {
      localStorage.setItem(LS_PRODUCTS, JSON.stringify(products));
    } catch {}

    return { products, campaigns, source: "db" };
  } catch {
    const products = readProductsFromLS();

    let campaigns: Campaign[] = [];
    try {
      campaigns = loadNormalizedCampaigns() || [];
    } catch {
      campaigns = [];
    }

    return { products, campaigns, source: "local" };
  }
}

function readProductsFromLS(): Product[] {
  try {
    const raw = localStorage.getItem(LS_PRODUCTS);
    const parsed = raw ? JSON.parse(raw) : [];
    return normalizeProducts(parsed);
  } catch {
    return [];
  }
}

/* =======================
   Settings/features DB-first
   ======================= */

function readFlag(value: any, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && typeof value.enabled === "boolean") {
    return value.enabled;
  }
  return fallback;
}

function parseFeatureFlags(settings: any): FeatureFlags | null {
  const root = settings?.settings ?? settings?.data ?? settings;
  const features = root?.features || {};

  return {
    donuts: readFlag(features?.donuts, true),
    bubbleTea: readFlag(features?.bubbleTea, true),
    productAvailability: normalizeProductAvailabilityMap(root?.productAvailability),
  };
}

function readFeaturesFromLS(): FeatureFlags | null {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return null;
    return parseFeatureFlags(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function dbLoadFeatureFlags(): Promise<FeatureFlags | null> {
  try {
    const res = await fetch("/api/settings", {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    if (!res.ok) throw new Error(`settings_${res.status}`);

    const json = await res.json();
    const flags = parseFeatureFlags(json);

    if (flags) return flags;
  } catch {}

  return readFeaturesFromLS();
}

/* =======================
   Page
   ======================= */

export default function MenuPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const orderMode = useCart((s: any) => s.orderMode) as "pickup" | "delivery";

  const [tab, setTab] = useState<TabKey>("burger");
  const [features, setFeatures] = useState<FeatureFlags>({
    donuts: true,
    bubbleTea: true,
    productAvailability: {},
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const loadSeq = useRef(0);

  const reloadDbFirst = async () => {
    const seq = ++loadSeq.current;

    const [catalog, flags] = await Promise.all([
      dbLoadCatalog(),
      dbLoadFeatureFlags(),
    ]);

    if (seq !== loadSeq.current) return;

    setProducts(catalog.products);
    setCampaigns(catalog.campaigns);

    if (flags) {
      setFeatures(flags);
    }
  };

  /* URL’den tab seçimi + dış rotalar */
  useEffect(() => {
    const raw = (
      searchParams?.get("cat") ||
      searchParams?.get("tab") ||
      ""
    ).toLowerCase() as TabKey;

    if (!raw) return;

    const route = ROUTE_MAP[raw];
    if (route) {
      router.replace(route);
      return;
    }

    if (ALL_TABS.includes(raw)) setTab(raw);
  }, [searchParams, router]);

  useEffect(() => {
    const cls = "theme-vegan";

    if (tab === "vegan") document.body.classList.add(cls);
    else document.body.classList.remove(cls);

    return () => document.body.classList.remove(cls);
  }, [tab]);

  /*
    DB-FIRST yükleme:
    - İlk açılışta /api/catalog ve /api/settings okunur.
    - Focus/visibility ile tekrar DB’den güncellenir.
    - localStorage sadece fallback/cache tetikleyici olarak kalır.
  */
  useEffect(() => {
    let alive = true;

    const safeReload = async () => {
      if (!alive) return;
      await reloadDbFirst();
    };

    safeReload();

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === LS_PRODUCTS || event.key === LS_SETTINGS) {
        safeReload();
      }
    };

    const onFocus = () => safeReload();

    const onVisibility = () => {
      if (document.visibilityState === "visible") safeReload();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enabledTabs = useMemo<TabKey[]>(
    () =>
      ALL_TABS.filter((t) => {
        if (t === "donuts" && !features.donuts) return false;
        if (t === "bubbletea" && !features.bubbleTea) return false;
        return true;
      }),
    [features]
  );

  useEffect(() => {
    if (!enabledTabs.includes(tab)) {
      const next = enabledTabs[0] ?? "burger";
      setTab(next);

      const sp = new URLSearchParams(searchParams?.toString() || "");
      sp.set("cat", next);
      sp.delete("tab");

      router.replace(`${pathname}?${sp.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledTabs]);

  /* Tab değişimi */
  const handleTabChange = (t: TabKey) => {
    const route = ROUTE_MAP[t];

    if (route) {
      router.push(route);
      return;
    }

    setTab(t);

    const sp = new URLSearchParams(searchParams?.toString() || "");
    sp.set("cat", t);
    sp.delete("tab");

    router.replace(`${pathname}?${sp.toString()}`);
  };

  const tabsWrapRef = useRef<HTMLDivElement | null>(null);

  const scrollTabs = (dir: "left" | "right") => {
    const el = tabsWrapRef.current;
    if (!el) return;

    const delta = Math.floor(el.clientWidth * 0.85);
    el.scrollBy({
      left: dir === "left" ? -delta : delta,
      behavior: "smooth",
    });
  };

  const now = new Date();

  const filteredByTab = useMemo(() => {
    return (products || []).filter((p) => {
      const cat = guessCategory(p);

      if (cat === "donuts" && !features.donuts) return false;
      if (cat === "bubbletea" && !features.bubbleTea) return false;

      return cat === tab;
    });
  }, [products, tab, features]);

  const baseListForTab = useMemo(
    () =>
      filteredByTab.map((p) => ({
        id: String(p.id ?? p.sku ?? p.code ?? p.name),
        name: p.name,
        price: Number(p.price) || 0,
        category: guessCategory(p) as unknown as Category,
      })),
    [filteredByTab]
  );

  const sortedForMenu = useMemo(
    () => sortProductsForMenu(baseListForTab, campaigns, orderMode, now),
    [baseListForTab, campaigns, orderMode, now]
  );

  const byId = useMemo(() => {
    const map = new Map<string, Product>();

    for (const p of filteredByTab) {
      const id = String(p.id ?? p.sku ?? p.code ?? p.name);
      map.set(id, p);
    }

    return map;
  }, [filteredByTab]);

  const list = useMemo(() => {
    const isBurgerOrVegan = tab === "burger" || tab === "vegan";

    return sortedForMenu
      .map((plike) => {
        const p = byId.get(plike.id);
        if (!p) return null;

        const availProbe = {
          id: plike.id,
          name: plike.name,
          price: plike.price,
          category: plike.category,
          active: p.active,
          activeFrom: p.activeFrom,
          activeTo: p.activeTo,
        } as any;

        const available =
          isProductAvailable(availProbe, now) &&
          !isProductClosedByTv(p, features.productAvailability, now);

        const pr = priceWithCampaign(
          {
            id: plike.id,
            name: plike.name,
            price: plike.price,
            category: plike.category,
          },
          campaigns,
          orderMode,
          now
        );

        let topSellerRank: 1 | 2 | 3 | undefined;

        if (isBurgerOrVegan) {
          const badge = popularityBadgeFor(plike.id, baseListForTab);
          topSellerRank =
            badge === "gold"
              ? 1
              : badge === "silver"
                ? 2
                : badge === "bronze"
                  ? 3
                  : undefined;
        }

        return {
          p,
          available,
          price: pr.final,
          original: pr.original,
          badge: pr.badge,
          countdown: pr.countdown,
          topSellerRank,
        };
      })
      .filter(Boolean) as Array<{
        p: Product;
        available: boolean;
        price: number;
        original?: number;
        badge: string | null;
        countdown: string | null;
        topSellerRank?: 1 | 2 | 3;
      }>;
  }, [
    sortedForMenu,
    byId,
    campaigns,
    orderMode,
    now,
    tab,
    baseListForTab,
    features.productAvailability,
  ]);

  const emptyMsgMap: Record<TabKey, string> = {
    burger:
      'Aktuell keine Burger vorhanden. Bitte im Admin-Bereich Produkte der Kategorie „Burger“ hinzufügen.',
    vegan:
      'Aktuell keine veganen Burger vorhanden. Bitte im Admin-Bereich Produkte der Kategorie „Vegan / Vegetarisch“ hinzufügen.',
    extras:
      'Noch keine Extras-Gruppen vorhanden. Bitte im Admin-Bereich unter „Extras-Gruppen“ Gruppen anlegen.',
    sauces:
      'Noch keine Soßen vorhanden. Bitte im Admin-Bereich Produkte der Kategorie „Soßen“ hinzufügen.',
    hotdogs:
      'Noch keine Hot Dogs vorhanden. Bitte im Admin-Bereich Produkte der Kategorie „Hot Dogs“ hinzufügen.',
    drinks:
      'Noch keine Getränke vorhanden. Bitte im Admin-Bereich Produkte der Kategorie „Getränke“ hinzufügen.',
    donuts:
      'Noch keine Donuts vorhanden. Bitte im Admin-Bereich Produkte der Kategorie „Donuts“ hinzufügen.',
    bubbletea:
      'Noch kein Bubble Tea vorhanden. Bitte im Admin-Bereich Produkte der Kategorie „Bubble Tea“ hinzufügen.',
  };

  const showBlurb = tab === "burger" || tab === "vegan" || tab === "hotdogs";

  return (
    <main className="mx-auto max-w-7xl p-6">
      {/* Kopfbereich */}
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo-burger-brothers.png"
            alt="Burger Brothers Berlin"
            width={42}
            height={42}
            className="h-10 w-10 rounded-full"
            priority
          />
          <div className="flex flex-col leading-tight">
            <h1 className="text-2xl font-semibold">Burger Brothers</h1>
            <span className="text-xs text-white/70">Berlin Tegel</span>
          </div>
        </Link>

        <div className="relative -mx-6 px-6 sm:mx-0 sm:px-0">
          <button
            aria-label="Tabs nach links"
            className="bb-tab-arrow bb-tab-arrow--left"
            onClick={() => scrollTabs("left")}
          >
            ‹
          </button>

          <button
            aria-label="Tabs nach rechts"
            className="bb-tab-arrow bb-tab-arrow--right"
            onClick={() => scrollTabs("right")}
          >
            ›
          </button>

          <div ref={tabsWrapRef} className="bb-tabs-scroll bb-tabs-mask">
            <div className="whitespace-nowrap">
              <NavBar
                variant="menu"
                tab={tab as any}
                onTabChange={handleTabChange as any}
                showLocationCaption={false}
                tabs={enabledTabs.map((key) => ({
                  key,
                  label: TAB_TITLE[key],
                }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Produkt-Grid + Warenkorb */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          {showBlurb && (
            <CategoryBlurb category={tab as "burger" | "vegan" | "hotdogs"} />
          )}

          <div className="grid-cards">
            {list.length === 0 ? (
              <div className="col-span-full rounded-xl border border-stone-700/60 bg-stone-900/60 p-4 text-sm text-stone-300">
                {emptyMsgMap[tab]}
              </div>
            ) : (
              list.map(
                ({
                  p,
                  available,
                  price,
                  original,
                  badge,
                  countdown,
                  topSellerRank,
                }) => {
                  const guessedCategory = guessCategory(p);

                  return (
                    <div
                      key={(p.id ?? p.sku ?? p.code ?? p.name) as string}
                      className="menu-card"
                    >
                      <ProductCard
                        sku={String(p.id ?? p.sku ?? p.code ?? p.name)}
                        name={p.name}
                        price={price}
                        originalPrice={original}
                        description={p.description || ""}
                        image={p.imageUrl}
                        category={toProductCardCategory(guessedCategory)}
                        extrasOptions={(p.extras || []).map((e) => ({
                          id: e.id,
                          label: e.name,
                          price: e.price,
                        }))}
                        allergens={p.allergens}
                        allergenHinweise={p.allergenHinweise}
                        outOfStock={!available}
                        campaignLabel={
                          badge ? (countdown ? `${badge} · ${countdown}` : badge) : undefined
                        }
                        coverRatio="16/10"
                        topSellerRank={topSellerRank}
                      />
                    </div>
                  );
                }
              )
            )}
          </div>
        </div>

        <div className="lg:sticky lg:top-4 lg:h-fit">
          <CartSummary />
        </div>
      </div>

      <CartSummaryMobile />

      <style jsx global>{`
        .grid-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
          align-items: stretch;
        }

        .grid-cards > .menu-card {
          display: flex;
          height: 100%;
        }

        .grid-cards > .menu-card > article.product-card {
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        @media (max-width: 480px) {
          .product-card .cover {
            min-height: 160px;
          }
        }

        .product-card [data-desc-empty] {
          min-height: 1.25rem;
          display: block;
        }

        .grid-cards > .menu-card .card p,
        .grid-cards > .menu-card .card .desc,
        .grid-cards > .menu-card [data-desc] {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </main>
  );
}