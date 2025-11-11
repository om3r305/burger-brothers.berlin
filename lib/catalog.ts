// lib/catalog.ts
// -------------------------------------------------------------
// Gemeinsame Etagealog-/Kampagnen-Helfer (modus- & zeitabhängig)
// -------------------------------------------------------------

export type Category =
  | "burger"
  | "vegan"
  | "extras"
  | "sauces"
  | "drinks"
  | "hotdogs";

export type Mode = "delivery" | "pickup";

/** Admin/LS ürün modeli */
export type ProductLike = {
  id: string;
  name: string;
  price: number;
  category: Category;

  active?: boolean;
  activeFrom?: string; // ISO
  activeTo?: string;   // ISO

  startAt?: string; // ISO
  endAt?: string;   // ISO
};

/** Kampanya modeli */
export type Campaign = {
  id: string;
  name: string;
  type: "percentOffCategory" | "percentOffProduct";
  percent: number;
  targetCategory?: Category;
  targetProductId?: string;
  /** 🔧 çoklu ürün desteği (normalize ile gelir) */
  productIds?: string[];
  mode?: "delivery" | "pickup" | "both";
  active?: boolean;
  startsAt?: string;
  endsAt?: string;
  priority?: number;
  badgeText?: string;
};

/* ===================== yardımcılar ===================== */
function toDate(v?: string | null): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** 🔢 Fiyat yuvarlama — 0,10 € adımına klasik yuvarlama */
function roundPrice(n: number, step = 0.1): number {
  // Örn: 8.07 -> 8.1 , 8.03 -> 8.0 , 8.56 -> 8.6
  return +(Math.round(n / step) * step).toFixed(2);
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
  const end   = toDate(c.endsAt   ?? (c as any)?.end);
  const t = now.getTime();
  const s = start ? start.getTime() : -Infinity;
  const e = end   ? end.getTime()   :  Infinity;
  return t >= s && t <= e;
}

/** 🔧 ürün eşleşmesi — çoklu ürün ids’ini de destekle */
function appliesToProduct(p: ProductLike, c: Campaign): boolean {
  if (c.type === "percentOffCategory") return c.targetCategory === p.category;
  if (c.type === "percentOffProduct")  {
    const ids = (Array.isArray(c.productIds) && c.productIds.length)
      ? c.productIds.map(String)
      : (c.targetProductId ? [String(c.targetProductId)] : []);
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
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (b.percent || 0) - (a.percent || 0)
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
    // Kampanya yoksa bile görsel & sepette aynı olsun diye orijinali de adımına yuvarla
    const base = roundPrice(p.price);
    return { final: base, original: undefined, badge: null, countdown: null, campaign: null };
  }
  const percent = Math.max(0, Math.min(100, Number(cmp.percent) || 0));
  const discount = (p.price * percent) / 100;
  const rawFinal = Math.max(0, p.price - discount);
  const final = roundPrice(rawFinal);
  const originalRounded = roundPrice(p.price);

  const badge = (cmp.badgeText || "").trim() || (percent ? `-${percent}%` : "Aktion");
  const countdown = formatCountdown(cmp.endsAt ?? (cmp as any)?.end, now);
  return { final, original: originalRounded, badge, countdown, campaign: cmp };
}

/* ===================== merkezi indirim entegrasyonu ===================== */
export type PricingOverrides = { discountRate?: number; };

export function priceWithAdjustments(
  p: ProductLike,
  campaigns: Campaign[],
  mode: Mode,
  overrides?: PricingOverrides,
  now = new Date(),
  stackStrategy: "max" | "stack" = "max"
) {
  // Kampanya hesaplaması (kampanya rozeti, countdown vs. korunur)
  const base = priceWithCampaign(p, campaigns, mode, now);

  const campaignPct = base.campaign ? Math.max(0, Math.min(100, Number(base.campaign.percent) || 0)) : 0;
  const basePct = Math.max(0, Math.min(1, overrides?.discountRate ?? 0)) * 100;

  const effectivePct =
    stackStrategy === "stack" ? Math.min(100, campaignPct + basePct) : Math.max(campaignPct, basePct);

  const startPrice = p.price;
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
    meta: { campaignPercent: campaignPct, basePercent: basePct, appliedPercent: effectivePct, strategy: stackStrategy },
  };
}

export function filterAvailable<T extends ProductLike>(list: T[], now = new Date()): T[] {
  return (list || []).filter((p) => isProductAvailable(p, now));
}

/* ===========================================================
   🆕 Menü sıralaması + popülerlik (kümülatif)
   - Kampanyalı ürünler her zaman en üstte
   - Kampanya yoksa da: gold → silver → bronze → diğerleri (ADA GÖRE)
   - Popülerlik: 14. gün BİTTİKTEN sonra başlar ve SIFIRLANMAZ
   =========================================================== */

const LS_ORDERS = "bb_orders_v1";
const LS_SETTINGS = "bb_settings_v6";

type OrderLine = { id?: string; sku?: string; qty?: number; item?: { id?: string; sku?: string } };
type OrderLike = { items?: OrderLine[]; ts?: number; createdAt?: number };

/** (opsiyonel) Ayarlardan popularity.startAt (ISO ya da millis) oku */
function readPopularityStartAtFromSettings(): number | null {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return null;
    const js = JSON.parse(raw);
    const v = js?.popularity?.startAt;
    if (!v && v !== 0) return null;
    const t = typeof v === "number" ? v : Date.parse(String(v));
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

/** Sistemdeki ilk sipariş + offset gün (default 14) */
function inferStartAtFromOrders(orders: OrderLike[], offsetDays = 14): number | null {
  if (!orders.length) return null;
  const min = Math.min(
    ...orders
      .map(o => Number(o?.createdAt ?? o?.ts ?? NaN))
      .filter(n => Number.isFinite(n))
  );
  if (!Number.isFinite(min)) return null;
  return min + offsetDays * 24 * 60 * 60 * 1000;
}

/** fromMs verilirse o tarihten sonrasını, verilmezse tüm siparişleri getirir */
function readOrdersSince(fromMs?: number): OrderLike[] {
  try {
    const raw = localStorage.getItem(LS_ORDERS);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    if (!fromMs) return arr;
    return arr.filter(o => {
      const t = Number(o?.createdAt ?? o?.ts ?? NaN);
      return Number.isFinite(t) ? t >= fromMs : false;
    });
  } catch { return []; }
}

/** Kümülatif: başlangıç noktasını bul (settings veya ilk sipariş +14gün) ve oradan say */
function readOrdersCumulative(defaultOffsetDays = 14): OrderLike[] {
  const all = readOrdersSince(); // hepsi
  const fromSettings = readPopularityStartAtFromSettings();
  const startAt = fromSettings ?? inferStartAtFromOrders(all, defaultOffsetDays);
  return startAt ? readOrdersSince(startAt) : all;
}

/** (Eski API için bırakıldı) — backward compatibility */
export function readOrdersLastNDays(days = 14): OrderLike[] {
  const now = Date.now();
  const since = now - days * 24 * 60 * 60 * 1000;
  return readOrdersSince(since);
}

/** Ürün id → toplam adet */
export function computePopularityCounts(orders: OrderLike[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of orders || []) {
    for (const li of (o.items || [])) {
      const id = String(li?.item?.id ?? li?.id ?? li?.sku ?? "").trim();
      if (!id) continue;
      const qty = Number(li?.qty ?? 1);
      m.set(id, (m.get(id) || 0) + (Number.isFinite(qty) ? qty : 1));
    }
  }
  return m;
}

/** Aktif kampanyalardaki tüm ürün id’leri (pin için) */
export function activeCampaignProductIds(
  campaigns: Campaign[],
  mode: Mode,
  now = new Date()
): Set<string> {
  const out = new Set<string>();
  for (const c of campaigns || []) {
    if (!isCampaignActive(c, now) || !appliesToMode(c, mode)) continue;
    if (c.type === "percentOffProduct") {
      const ids = (Array.isArray(c.productIds) && c.productIds.length)
        ? c.productIds
        : (c.targetProductId ? [c.targetProductId] : []);
      for (const id of ids) if (id) out.add(String(id));
    }
  }
  return out;
}

/** Menü listesi için sıralama (kampanyalı → top3 → diğerleri(alfabetik)) */
export function sortProductsForMenu<T extends ProductLike>(
  list: T[],
  campaigns: Campaign[],
  mode: Mode,
  now = new Date()
): T[] {
  const pins = activeCampaignProductIds(campaigns, mode, now);

  // Kümülatif popülerlik sayacı
  const counts = computePopularityCounts(readOrdersCumulative(/* offsetDays= */ 14));
  const isBV = (x: ProductLike) => x.category === "burger" || x.category === "vegan";

  // 1) Kampanyalılar
  const pinArr = list.filter(p => pins.has(p.id))
    .sort((a, b) => {
      // Kampanyalılar kendi aralarında da popülerliğe göre (eşitse ada göre)
      const ca = counts.get(a.id) || 0;
      const cb = counts.get(b.id) || 0;
      if (ca !== cb) return cb - ca;
      return a.name.localeCompare(b.name, "de");
    });

  // 2) Geri kalan
  const rest = list.filter(p => !pins.has(p.id));

  // 2a) Rest içindeki Burger/Vegan’larda top3’ü bul (kümülatif)
  const bvRest = rest.filter(isBV);
  const bvSortedByCount = [...bvRest].sort(
    (a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0)
  );
  const topIds = Array.from(new Set(bvSortedByCount.map(p => p.id))).slice(0, 3);

  const topArr = rest
    .filter(p => topIds.includes(p.id))
    .sort((a, b) => topIds.indexOf(a.id) - topIds.indexOf(b.id)); // gold → silver → bronze

  // 2b) Kalanların hepsi alfabetik
  const remaining = rest
    .filter(p => !topIds.includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  // 3) Sonuç
  return [...pinArr, ...topArr, ...remaining];
}

/** Top 3 rozeti (gold/silver/bronze) — Burger & Vegan için */
export function popularityBadgeFor(
  id: string,
  products: ProductLike[]
): "gold" | "silver" | "bronze" | null {
  const counts = computePopularityCounts(readOrdersCumulative(/* offsetDays= */ 14));
  const bv = products.filter(p => p.category === "burger" || p.category === "vegan");
  const sorted = [...bv].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));
  const top = sorted.slice(0, 3).map(p => p.id);
  if (top[0] === id) return "gold";
  if (top[1] === id) return "silver";
  if (top[2] === id) return "bronze";
  return null;
}
