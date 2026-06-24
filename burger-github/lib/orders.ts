// lib/orders.ts
// LocalStorage tabanlı sipariş deposu (frontend)
// Kanal isimleri: "abholung" (mağazadan al) ve "lieferung" (teslimat).
// Eski kayıtlar otomatik eşlenir: apollo→abholung, lieferando/direct→lieferung.

export const LS_ORDERS = "bb_orders_v1";

/* ───────── Types ───────── */

export type OrderStatus =
  | "new"              // yeni oluşturuldu
  | "preparing"        // hazırlanıyor
  | "ready"            // hazır (pickup) / teslimata hazır
  | "out_for_delivery" // yolda (delivery)
  | "done"             // tamamlandı/kapatıldı
  | "cancelled";

// YENİ kanal tipi — sadece iki değer (UI tarafında Apollon/Lieferando ile map ediliyor):
export type OrderChannel = "abholung" | "lieferung";

export type OrderItem = {
  id?: string;
  sku?: string;
  name: string;
  category?: string;
  price: number;
  qty: number;
  add?: { name?: string; label?: string; price?: number }[];
  /** Opsiyonel açıklama (detay modali gösterir) */
  note?: string;
  /** “Ohne ..” kaldırılanlar (detay modali gösterir) */
  rm?: string[];
};

export type OrderHistoryEntry = {
  ts: number;                 // unix ms
  action: string;             // 'status:new', 'status:out_for_delivery', 'driver:set', 'eta:+5', 'print:label' vb.
  note?: string;
  by?: string;                // 'TV', 'Dashboard', deviceId, driverName vb.
};

/** Yazdırma istatistikleri (tamamen opsiyonel) */
export type PrintBucket = {
  count: number;   // toplam basım
  lastAt?: number; // son basım zamanı (ms)
};
export type OrderPrintStats = {
  label?: PrintBucket;   // fiş/etiket
  kitchen?: PrintBucket; // mutfak fişi (kullanırsan)
  barcode?: PrintBucket; // sadece barkod
};

export type StoredOrder = {
  /** Sipariş No */
  id: string;
  /** Oluşturulma zamanı (ms) */
  ts: number;
  /** Mod: Abholung / Lieferung */
  mode: "pickup" | "delivery";

  /** Kaynak kanal (Dashboard’tan değiştirilebilir) */
  channel?: OrderChannel;

  /* Toplamlar (opsiyonel) */
  merchandise?: number;
  discount?: number;
  surcharges?: number;
  total: number;
  coupon?: string | null;
  couponDiscount?: number;

  /** Satır kalemleri */
  items: OrderItem[];

  /** Müşteri bilgileri */
  customer: {
    name: string;
    phone?: string;
    /** Delivery’de birleştirilmiş adres string’i */
    address?: string;
  };

  /** “HH:mm” (bugün) – planlı zaman */
  planned?: string;

  /** Durum */
  status?: OrderStatus;

  /** Beklenen süre (dakika) – ETA (baz) */
  etaMin?: number;

  /** ETA ayarlamaları (± dak) — TV/Dashboard üzerinden +/− ile güncellenir */
  etaAdjustMin?: number;

  /** Şoför ataması (delivery) */
  driver?: {
    name?: string;
    id?: string;
    deviceId?: string;     // güvenilir cihaz eşlemesi için
    assignedAt?: number;   // ms
  };

  /** Zaman damgaları */
  doneAt?: number;
  cancelledAt?: number;

  /** Serbest meta alanı */
  meta?: Record<string, any>;

  /** Geçmiş (kim-ne-zaman) */
  history?: OrderHistoryEntry[];

  /** ✅ Yazdırma istatistikleri (opsiyonel; yoksa oluşturulmaz) */
  print?: OrderPrintStats;
};

/* ───────── Helpers ───────── */

const rid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function now() { return Date.now(); }

/** Eski kanal değerlerini yeni şemaya dönüştürür. */
function normalizeChannel(c: any): OrderChannel {
  const v = String(c || "").toLowerCase();
  if (v === "apollo" || v === "abholung" || v === "pickup") return "abholung";
  // lieferando, direct, web, boş vb. hepsi teslimat sütununa düşsün:
  return "lieferung";
}

/** internal: boş print bucket oluştur */
function makeBucket(b?: PrintBucket | null): PrintBucket {
  return {
    count: Math.max(0, Number(b?.count || 0)) || 0,
    lastAt: Number.isFinite(Number(b?.lastAt)) ? Number(b!.lastAt) : undefined,
  };
}

/** Kayıt normalize (id / status / channel / yeni alanlar garanti edilir) */
function normalize(list: unknown): StoredOrder[] {
  const arr = Array.isArray(list) ? (list as any[]) : [];
  return arr.map((o: any) => {
    const id = (o?.id && String(o.id)) || String(o?.orderId || o?.no || rid());
    const status: OrderStatus = (o?.status as OrderStatus) || "new";
    const channel: OrderChannel = normalizeChannel(o?.channel);
    const etaAdjustMin = Number(o?.etaAdjustMin || 0) || 0;

    // print stats güvenli hale getir (varsa dokunma, yoksa undefined kalsın)
    const print: OrderPrintStats | undefined = o?.print
      ? {
          label: o.print?.label ? makeBucket(o.print.label) : undefined,
          kitchen: o.print?.kitchen ? makeBucket(o.print.kitchen) : undefined,
          barcode: o.print?.barcode ? makeBucket(o.print.barcode) : undefined,
        }
      : undefined;

    const history: OrderHistoryEntry[] = Array.isArray(o?.history) ? o.history : [];
    return {
      ...o,
      id,
      status,
      channel,
      etaAdjustMin,
      history,
      print,
    } as StoredOrder;
  });
}

/** Bugün mü kontrolü (dashboard/TV filtrelerinde) */
export function isToday(ms: number): boolean {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return ms >= start.getTime();
}

/** Baz ETA + ayarlama (dakika) */
export function effectiveEtaFor(
  order: StoredOrder,
  fallbackPickup = 15,
  fallbackDelivery = 35
): number {
  const base = order.etaMin ?? (order.mode === "pickup" ? fallbackPickup : fallbackDelivery);
  const adj = Number(order.etaAdjustMin || 0);
  return Math.max(0, base + adj);
}

/* ───────── CRUD ───────── */

export function readAllOrders(): StoredOrder[] {
  try {
    const raw = localStorage.getItem(LS_ORDERS);
    const arr = raw ? JSON.parse(raw) : [];
    return normalize(arr);
  } catch {
    return [];
  }
}

export function writeAllOrders(list: StoredOrder[]) {
  try {
    // Yazmadan önce kanalları garanti altına al ve tip güvenliği
    const safe = list.map((o) => ({
      ...o,
      channel: normalizeChannel(o.channel),
      etaAdjustMin: Number(o.etaAdjustMin || 0) || 0,
      history: Array.isArray(o.history) ? o.history : [],
      print: o.print
        ? {
            label: o.print.label ? makeBucket(o.print.label) : undefined,
            kitchen: o.print.kitchen ? makeBucket(o.print.kitchen) : undefined,
            barcode: o.print.barcode ? makeBucket(o.print.barcode) : undefined,
          }
        : undefined,
    }));
    localStorage.setItem(LS_ORDERS, JSON.stringify(safe));
  } catch {
    // no-op
  }
}

export function upsertOrder(o: StoredOrder) {
  const list = readAllOrders();
  const idx = list.findIndex((x) => x.id === o.id);
  const normalized: StoredOrder = {
    ...o,
    channel: normalizeChannel(o.channel),
    etaAdjustMin: Number(o.etaAdjustMin || 0) || 0,
    history: Array.isArray(o.history) ? o.history : [],
    print: o.print
      ? {
          label: o.print.label ? makeBucket(o.print.label) : undefined,
          kitchen: o.print.kitchen ? makeBucket(o.print.kitchen) : undefined,
          barcode: o.print.barcode ? makeBucket(o.print.barcode) : undefined,
        }
      : undefined,
  };
  if (idx >= 0) list[idx] = normalized;
  else list.push(normalized);
  writeAllOrders(list);
}

export function setOrderStatus(id: string, status: OrderStatus, by?: string) {
  const list = readAllOrders();
  const idx = list.findIndex((x) => x.id === id);
  if (idx >= 0) {
    list[idx].status = status;
    if (status === "done") list[idx].doneAt = now();
    if (status === "cancelled") list[idx].cancelledAt = now();
    pushHistory(list[idx], `status:${status}`, undefined, by);
    writeAllOrders(list);
  }
}

export function setOrderChannel(id: string, channel: OrderChannel, by?: string) {
  const list = readAllOrders();
  const idx = list.findIndex((x) => x.id === id);
  if (idx >= 0) {
    list[idx].channel = normalizeChannel(channel);
    pushHistory(list[idx], `channel:${list[idx].channel}`, undefined, by);
    writeAllOrders(list);
  }
}

export function getOrder(id: string): StoredOrder | null {
  return readAllOrders().find((x) => x.id === id) || null;
}

/* ───────── Advanced ops (ETA, driver, cancel/done) ───────── */

/** Geçmişe entry ekle */
function pushHistory(o: StoredOrder, action: string, note?: string, by?: string) {
  if (!o.history) o.history = [];
  o.history.push({ ts: now(), action, note, by });
}

/** ETA ayarlamasını (dakika) +/- artır/azalt; maxAbs ile sınırlı */
export function adjustOrderEta(
  id: string,
  deltaMin: number,
  step = 5,
  maxAbs = 60,
  by?: string
) {
  const list = readAllOrders();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return;

  // step’e yuvarla (örn. 5’in katı)
  const snapped = Math.round(deltaMin / step) * step;

  const cur = Number(list[idx].etaAdjustMin || 0);
  let next = cur + snapped;
  if (next > maxAbs) next = maxAbs;
  if (next < -maxAbs) next = -maxAbs;

  list[idx].etaAdjustMin = next;
  pushHistory(list[idx], `eta:${snapped >= 0 ? "+" : ""}${snapped}`, `sum=${next}`, by);
  writeAllOrders(list);
}

/** Şoför atama (mevcutta varsa force=false ise üzerine yazmaz) */
export function setOrderDriver(
  id: string,
  driver: { name?: string; id?: string; deviceId?: string },
  opts?: { force?: boolean; by?: string }
) {
  const list = readAllOrders();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return false;

  if (!list[idx].driver) list[idx].driver = {};
  if (list[idx].driver?.name && !opts?.force) {
    // zaten atanmışsa sessizce başarısız
    return false;
  }

  list[idx].driver = {
    ...list[idx].driver,
    ...driver,
    assignedAt: list[idx].driver?.assignedAt || now(),
  };
  pushHistory(list[idx], "driver:set", driver?.name, opts?.by);
  writeAllOrders(list);
  return true;
}

/** Şoför atamasını kaldır (ör. yanlış teslim alındıysa) */
export function clearOrderDriver(id: string, by?: string) {
  const list = readAllOrders();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return;

  const prev = list[idx].driver?.name;
  list[idx].driver = undefined;
  pushHistory(list[idx], "driver:clear", prev, by);
  writeAllOrders(list);
}

/** “Yolda” durumuna geçir (delivery) – şoför varsa korur, yoksa sadece durumu set eder */
export function markOrderOutForDelivery(id: string, by?: string) {
  setOrderStatus(id, "out_for_delivery", by);
}

/** Tamamla */
export function markOrderDone(id: string, by?: string) {
  setOrderStatus(id, "done", by);
}

/** İptal (reason opsiyonel not olarak kaydedilir) */
export function cancelOrder(id: string, reason?: string, by?: string) {
  const list = readAllOrders();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return;

  list[idx].status = "cancelled";
  list[idx].cancelledAt = now();
  pushHistory(list[idx], "status:cancelled", reason, by);
  writeAllOrders(list);
}

/** Bu sipariş şoför tarafından “claim” edilmiş mi? */
export function isOrderClaimed(o: StoredOrder): boolean {
  return !!o?.driver?.name;
}

/* ───────── ✅ Yazdırma istatistikleri (sessiz yazdırma entegrasyonu için) ───────── */

/** Yazdırma olduysa sayaçları güncelle ve history kaydı at. */
export function markPrinted(
  id: string,
  type: "label" | "kitchen" | "barcode" = "label",
  by?: string
) {
  const list = readAllOrders();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return;

  const o = list[idx];
  if (!o.print) o.print = {};
  const bucket = o.print[type] ? makeBucket(o.print[type]) : makeBucket();
  bucket.count = (bucket.count || 0) + 1;
  bucket.lastAt = now();
  o.print[type] = bucket;

  pushHistory(o, `print:${type}`, `count=${bucket.count}`, by);
  writeAllOrders(list);
}

/** Bu siparişin yazdırma istatistiklerini al (yoksa boş döner). */
export function getPrintStats(id: string): OrderPrintStats {
  const o = getOrder(id);
  return {
    label: o?.print?.label ? makeBucket(o.print.label) : undefined,
    kitchen: o?.print?.kitchen ? makeBucket(o.print.kitchen) : undefined,
    barcode: o?.print?.barcode ? makeBucket(o.print.barcode) : undefined,
  };
}
