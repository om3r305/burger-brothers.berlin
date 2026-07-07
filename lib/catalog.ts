// lib/catalog.ts
// -------------------------------------------------------------
// Gemeinsame Catalog-/Kampagnen-Helfer (modus- & zeitabhängig)
// -------------------------------------------------------------

export type Category =
  | "burger"
  | "vegan"
  | "extras"
  | "sauces"
  | "drinks"
  | "hotdogs"
  | "donuts"
  | "bubbletea"
  | "bubbleTea";

export type Mode = "delivery" | "pickup";

/** Admin/DB/cache ürün modeli */
export type ProductLike = {
  id: string;
  sku?: string;
  code?: string;
  name: string;
  price: number;
  category: Category;

  active?: boolean;
  activeFrom?: string; // ISO
  activeTo?: string; // ISO

  startAt?: string; // ISO
  endAt?: string; // ISO
};

/** Kampanya modeli */
export type Campaign = {
  id: string;
  name: string;
  type: "percentOffCategory" | "percentOffProduct";
  percent: number;
  targetCategory?: Category;
  targetProductId?: string;
  productIds?: string[];
  mode?: "delivery" | "pickup" | "both";
  active?: boolean;
  startsAt?: string;
  endsAt?: string;
  priority?: number;
  badgeText?: string;
};

/* ===================== yardımcılar ===================== */

function hasWindow() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function toDate(value?: string | null): Date | null {
  if (!value) return null;

  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** Fiyat yuvarlama — 0,10 € adımına klasik yuvarlama */
function roundPrice(n: number, step = 0.1): number {
  return +(Math.round(n / step) * step).toFixed(2);
}

function normalizeCategory(value: any): Category {
  const raw = String(value ?? "").toLowerCase().trim();

  if (raw.includes("vegan")) return "vegan";
  if (raw.includes("drink") || raw.includes("getränk") || raw.includes("getraenk")) return "drinks";
  if (raw.includes("sauce") || raw.includes("soß") || raw.includes("soss") || raw.includes("sos")) return "sauces";
  if (raw.includes("hotdog") || raw.includes("hot dog")) return "hotdogs";
  if (raw.includes("donut") || raw.includes("doughnut")) return "donuts";
  if (raw.includes("bubble")) return "bubbletea";
  if (raw.includes("extra") || raw.includes("pommes") || raw.includes("fries")) return "extras";
  if (raw.includes("burger")) return "burger";

  if (
    raw === "burger" ||
    raw === "vegan" ||
    raw === "extras" ||
    raw === "sauces" ||
    raw === "drinks" ||
    raw === "hotdogs" ||
    raw === "donuts" ||
    raw === "bubbletea" ||
    raw === "bubbleTea"
  ) {
    return raw as Category;
  }

  return "burger";
}

export function isProductAvailable(p: ProductLike, now = new Date()): boolean {
  if (p.active === false) return false;

  const from = toDate(p.activeFrom ?? p.startAt);
  const to = toDate(p.activeTo ?? p.endAt);

  if (from && now < from) return false;
  if (to && now > to) return false;

  return true;
}

export function formatCountdown(endsAt?: string, now = new Date()): string | null {
  if (!endsAt) return null;

  const end = toDate(endsAt);
  if (!end) return null;

  const diff = end.getTime() - now.getTime();

  if (diff <= 0) return "beendet";

  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);

  return d > 0 ? `${d}T ${h}Std` : `${h}Std ${m}Min`;
}

function appliesToMode(c: Campaign, mode: Mode): boolean {
  return !c.mode || c.mode === "both" || c.mode === mode;
}

function isCampaignActive(c: Campaign, now = new Date()): boolean {
  if (c.active === false) return false;

  const start = toDate(c.startsAt ?? (c as any)?.start);
  const end = toDate(c.endsAt ?? (c as any)?.end);
  const t = now.getTime();
  const s = start ? start.getTime() : -Infinity;
  const e = end ? end.getTime() : Infinity;

  return t >= s && t <= e;
}

/** ürün eşleşmesi — çoklu ürün ids’ini de destekler */
function appliesToProduct(p: ProductLike, c: Campaign): boolean {
  if (c.type === "percentOffCategory") {
    return normalizeCategory(c.targetCategory) === normalizeCategory(p.category);
  }

  if (c.type === "percentOffProduct") {
    const ids =
      Array.isArray(c.productIds) && c.productIds.length
        ? c.productIds.map(String)
        : c.targetProductId
          ? [String(c.targetProductId)]
          : [];

    return ids.includes(String(p.id));
  }

  return false;
}

/* ===================== kampanya seçimi ===================== */

export function bestCampaignForProduct(
  p: ProductLike,
  campaigns: Campaign[],
  mode: Mode,
  now = new Date()
): Campaign | null {
  const hits = (campaigns || []).filter(
    (c) => isCampaignActive(c, now) && appliesToMode(c, mode) && appliesToProduct(p, c)
  );

  if (hits.length === 0) return null;

  hits.sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      (Number(b.percent) || 0) - (Number(a.percent) || 0)
  );

  return hits[0];
}

export function priceWithCampaign(
  p: ProductLike,
  campaigns: Campaign[],
  mode: Mode,
  now = new Date()
): {
  final: number;
  original?: number;
  badge: string | null;
  countdown: string | null;
  campaign: Campaign | null;
} {
  const cmp = bestCampaignForProduct(p, campaigns, mode, now);

  if (!cmp) {
    const base = roundPrice(Number(p.price) || 0);

    return {
      final: base,
      original: undefined,
      badge: null,
      countdown: null,
      campaign: null,
    };
  }

  const percent = Math.max(0, Math.min(100, Number(cmp.percent) || 0));
  const price = Number(p.price) || 0;
  const discount = (price * percent) / 100;
  const rawFinal = Math.max(0, price - discount);
  const final = roundPrice(rawFinal);
  const originalRounded = roundPrice(price);

  const badge = (cmp.badgeText || "").trim() || (percent ? `-${percent}%` : "Aktion");
  const countdown = formatCountdown(cmp.endsAt ?? (cmp as any)?.end, now);

  return {
    final,
    original: originalRounded,
    badge,
    countdown,
    campaign: cmp,
  };
}

/* ===================== merkezi indirim entegrasyonu ===================== */

export type PricingOverrides = {
  discountRate?: number;
};

export function priceWithAdjustments(
  p: ProductLike,
  campaigns: Campaign[],
  mode: Mode,
  overrides?: PricingOverrides,
  now = new Date(),
  stackStrategy: "max" | "stack" = "max"
) {
  const base = priceWithCampaign(p, campaigns, mode, now);

  const campaignPct = base.campaign
    ? Math.max(0, Math.min(100, Number(base.campaign.percent) || 0))
    : 0;

  const basePct = Math.max(0, Math.min(1, overrides?.discountRate ?? 0)) * 100;

  const effectivePct =
    stackStrategy === "stack"
      ? Math.min(100, campaignPct + basePct)
      : Math.max(campaignPct, basePct);

  const startPrice = Number(p.price) || 0;
  const rawFinal = Math.max(0, startPrice - (startPrice * effectivePct) / 100);
  const final = roundPrice(rawFinal);
  const originalRounded = final !== startPrice ? roundPrice(startPrice) : undefined;

  const extraBadge = !base.campaign && basePct > 0 ? `-${Math.round(basePct)}%` : null;

  return {
    final,
    original: originalRounded,
    badge: base.badge || extraBadge,
    countdown: base.countdown,
    campaign: base.campaign,
    meta: {
      campaignPercent: campaignPct,
      basePercent: basePct,
      appliedPercent: effectivePct,
      strategy: stackStrategy,
    },
  };
}

export function filterAvailable<T extends ProductLike>(list: T[], now = new Date()): T[] {
  return (list || []).filter((p) => isProductAvailable(p, now));
}

/* ===========================================================
   Menü sıralaması + popülerlik
   - Kampanyalı ürünler en üstte
   - Kampanya yoksa: gold → silver → bronze → diğerleri
   - Popülerlik cache/order sync üzerinden okunur
   =========================================================== */

const LS_ORDERS = "bb_orders_v1";
const LS_SETTINGS = "bb_settings_v6";

type OrderLine = {
  id?: string;
  sku?: string;
  productId?: string;
  productSku?: string;
  code?: string;
  name?: string;
  title?: string;
  qty?: number;
  quantity?: number;
  category?: string;
  item?: {
    id?: string;
    sku?: string;
    code?: string;
    name?: string;
    title?: string;
  };
  product?: {
    id?: string;
    sku?: string;
    code?: string;
    name?: string;
    title?: string;
  };
};

type OrderLike = {
  items?: OrderLine[];
  ts?: number | string | Date;
  createdAt?: number | string | Date;
  created_at?: number | string | Date;
  status?: string;
  mode?: string;
  meta?: Record<string, any>;
};

/** Ayarlardan popularity.startAt oku */
function readPopularityStartAtFromSettings(): number | null {
  if (!hasWindow()) return null;

  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return null;

    const js = JSON.parse(raw);
    const v = js?.popularity?.startAt;

    if (!v && v !== 0) return null;

    const t = typeof v === "number" ? v : Date.parse(String(v));
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function toMs(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.getTime();
  }

  if (typeof value === "string" && value.trim()) {
    const text = value.trim();
    const asNumber = Number(text);

    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;

    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function normalizeKey(value: any) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function productKeys(p: Partial<ProductLike> | any): string[] {
  return uniq([
    normalizeKey(p?.id),
    normalizeKey(p?.sku),
    normalizeKey(p?.code),
    normalizeKey(p?.name),
  ]);
}

function lineKeys(li: OrderLine | any): string[] {
  return uniq([
    normalizeKey(li?.productId),
    normalizeKey(li?.productSku),
    normalizeKey(li?.sku),
    normalizeKey(li?.id),
    normalizeKey(li?.code),
    normalizeKey(li?.item?.sku),
    normalizeKey(li?.item?.id),
    normalizeKey(li?.item?.code),
    normalizeKey(li?.product?.sku),
    normalizeKey(li?.product?.id),
    normalizeKey(li?.product?.code),
    normalizeKey(li?.name),
    normalizeKey(li?.title),
    normalizeKey(li?.item?.name),
    normalizeKey(li?.item?.title),
    normalizeKey(li?.product?.name),
    normalizeKey(li?.product?.title),
  ]);
}

function lineQty(li: OrderLine | any) {
  const raw = Number(li?.qty ?? li?.quantity ?? 1);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function normalizeOrderStatus(value: any) {
  const text = String(value || "").toLowerCase().trim();

  if (
    text === "cancelled" ||
    text === "canceled" ||
    text === "storniert" ||
    text === "storno" ||
    text === "iptal"
  ) {
    return "cancelled";
  }

  return text;
}

function isCancelledPopularityOrder(order: OrderLike | any) {
  const meta = order?.meta && typeof order.meta === "object" ? order.meta : {};
  const status = normalizeOrderStatus(meta?.statusManual ?? order?.status ?? meta?.status);

  return status === "cancelled";
}

/** fromMs verilirse o tarihten sonrasını, verilmezse tüm siparişleri getirir */
function readOrdersSince(fromMs?: number): OrderLike[] {
  if (!hasWindow()) return [];

  try {
    const raw = localStorage.getItem(LS_ORDERS);
    const arr = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(arr)) return [];

    const withoutCancelled = arr.filter((order) => !isCancelledPopularityOrder(order));

    if (!fromMs) return withoutCancelled;

    return withoutCancelled.filter((order) => {
      const t = toMs(order?.createdAt ?? order?.created_at ?? order?.ts);
      return t != null ? t >= fromMs : false;
    });
  } catch {
    return [];
  }
}

/**
 * Kümülatif popülerlik.
 * Admin ayarlarında popularity.startAt varsa o tarihten sonrası sayılır.
 * Yoksa tüm siparişler sayılır; böylece ilk 14 gün ürünler sahte boş sıralamaya düşmez.
 */
function readOrdersCumulative(_defaultOffsetDays = 14): OrderLike[] {
  const all = readOrdersSince();
  const startAt = readPopularityStartAtFromSettings();

  return startAt ? readOrdersSince(startAt) : all;
}

/** Eski API için bırakıldı — backward compatibility */
export function readOrdersLastNDays(days = 14): OrderLike[] {
  const now = Date.now();
  const since = now - days * 24 * 60 * 60 * 1000;

  return readOrdersSince(since);
}

/** Ürün anahtarı → toplam adet */
export function computePopularityCounts(orders: OrderLike[]): Map<string, number> {
  const m = new Map<string, number>();

  for (const order of orders || []) {
    if (isCancelledPopularityOrder(order)) continue;

    for (const li of order.items || []) {
      const keys = lineKeys(li);
      if (!keys.length) continue;

      const qty = lineQty(li);

      for (const key of keys) {
        m.set(key, (m.get(key) || 0) + qty);
      }
    }
  }

  return m;
}

function sameProductKey(left: Partial<ProductLike> | any, rightId: string) {
  const target = normalizeKey(rightId);

  if (!target) return false;

  return productKeys(left).includes(target);
}

function computeProductPopularityCounts<T extends ProductLike>(
  products: T[],
  orders: OrderLike[],
): Map<string, number> {
  const out = new Map<string, number>();
  const keyToProductId = new Map<string, string>();

  for (const product of products || []) {
    for (const key of productKeys(product)) {
      if (!keyToProductId.has(key)) {
        keyToProductId.set(key, product.id);
      }
    }
  }

  for (const order of orders || []) {
    if (isCancelledPopularityOrder(order)) continue;

    for (const li of order.items || []) {
      const keys = lineKeys(li);
      const productId = keys.map((key) => keyToProductId.get(key)).find(Boolean);

      if (!productId) continue;

      out.set(productId, (out.get(productId) || 0) + lineQty(li));
    }
  }

  return out;
}

/** Aktif kampanyalardaki tüm ürün id’leri */
export function activeCampaignProductIds(
  campaigns: Campaign[],
  mode: Mode,
  now = new Date()
): Set<string> {
  const out = new Set<string>();

  for (const c of campaigns || []) {
    if (!isCampaignActive(c, now) || !appliesToMode(c, mode)) continue;

    if (c.type === "percentOffProduct") {
      const ids =
        Array.isArray(c.productIds) && c.productIds.length
          ? c.productIds
          : c.targetProductId
            ? [c.targetProductId]
            : [];

      for (const id of ids) {
        const key = normalizeKey(id);
        if (key) out.add(key);
      }
    }
  }

  return out;
}

function productIsPinned(p: ProductLike, pins: Set<string>) {
  return productKeys(p).some((key) => pins.has(key));
}

function popularProductsForCategory<T extends ProductLike>(
  products: T[],
  counts: Map<string, number>,
  category: Category,
): T[] {
  return products
    .filter((p) => normalizeCategory(p.category) === category)
    .filter((p) => (counts.get(p.id) || 0) > 0)
    .sort((a, b) => {
      const ca = counts.get(a.id) || 0;
      const cb = counts.get(b.id) || 0;

      if (ca !== cb) return cb - ca;

      return a.name.localeCompare(b.name, "de");
    });
}

/** Menü listesi için sıralama */
export function sortProductsForMenu<T extends ProductLike>(
  list: T[],
  campaigns: Campaign[],
  mode: Mode,
  now = new Date()
): T[] {
  const pins = activeCampaignProductIds(campaigns, mode, now);
  const orders = readOrdersCumulative(14);
  const counts = computeProductPopularityCounts(list, orders);

  const pinArr = list
    .filter((p) => productIsPinned(p, pins))
    .sort((a, b) => {
      const ca = counts.get(a.id) || 0;
      const cb = counts.get(b.id) || 0;

      if (ca !== cb) return cb - ca;

      return a.name.localeCompare(b.name, "de");
    });

  const rest = list.filter((p) => !productIsPinned(p, pins));

  const topIds = new Set<string>();

  for (const category of ["burger", "vegan"] as Category[]) {
    for (const p of popularProductsForCategory(rest, counts, category).slice(0, 3)) {
      topIds.add(p.id);
    }
  }

  const topArr = rest
    .filter((p) => topIds.has(p.id))
    .sort((a, b) => {
      const catA = normalizeCategory(a.category);
      const catB = normalizeCategory(b.category);

      if (catA !== catB) {
        return catA.localeCompare(catB, "de");
      }

      const ca = counts.get(a.id) || 0;
      const cb = counts.get(b.id) || 0;

      if (ca !== cb) return cb - ca;

      return a.name.localeCompare(b.name, "de");
    });

  const remaining = rest
    .filter((p) => !topIds.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  return [...pinArr, ...topArr, ...remaining];
}

/** Top 3 rozeti — Burger ve Vegan ayrı ayrı */
export function popularityBadgeFor(
  id: string,
  products: ProductLike[]
): "gold" | "silver" | "bronze" | null {
  const current = products.find((p) => sameProductKey(p, id));
  if (!current) return null;

  const category = normalizeCategory(current.category);
  if (category !== "burger" && category !== "vegan") return null;

  const counts = computeProductPopularityCounts(products, readOrdersCumulative(14));

  const sorted = popularProductsForCategory(products, counts, category).slice(0, 3);

  if (!sorted.length) return null;

  if (sameProductKey(sorted[0], id)) return "gold";
  if (sorted[1] && sameProductKey(sorted[1], id)) return "silver";
  if (sorted[2] && sameProductKey(sorted[2], id)) return "bronze";

  return null;
}
