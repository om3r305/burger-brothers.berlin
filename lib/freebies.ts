// lib/freebies.ts
// Ücretsiz sos / adet eşik mantığı (hesaplama + dağıtım)
//
// Bu modül tamamen saf (pure) fonksiyonlardan oluşur ve store dışı bağımlılık içermez.
// İki temel iş yapar:
//  1) Sepetteki “nitelikli” ana ürün adedine göre ücretsiz sos hakkını hesaplar.
//  2) Bu hakkı, sepetteki sos kalemlerine (varsayılan: en ucuzdan başlayarak) dağıtır
//     ve indirimi (0-fiyatlama) nasıl uygulayabileceğinize dair bir plan döner.
//
// Entegrasyon fikirleri:
//  - CartSummary içinde “Ücretsiz X sos hakkın var (kalan Y)” şeklinde banner göstermek için
//    `computeFreebies` sonucundaki allowance/applied/remaining değerlerini kullanın.
//  - Ödeme/hesaplamada bu indirimleri Prices Pipeline’a eklemek için `allocateFreebies`
//    dönen totalDiscount’u subtotal’dan düşebilirsiniz (ya da satır bazlı uygulayabilirsiniz).

/* ======================= Tipler & Varsayılan Ayarlar ======================= */

export type CartItemLike = {
  id: string;
  qty: number;
  item: {
    price: number;
    name?: string;
    category?: string; // "sauces" vb.
    sku?: string;
  };
  // Opsiyonel ek alanlar – dokunmuyoruz ama passthrough olabilir:
  add?: Array<{ id?: string; label?: string; price?: number; name?: string }>;
  rm?: string[];
  note?: string;
  category?: string; // bazı yerlerde üst düzeyde tutuluyor olabilir
};

export type FreebieConfig = {
  /** Hangi kategori(ler) nitelikli ana ürün sayılır (her birim için hak kazandırır). */
  qualifyingCategories: string[];
  /** Hangi kategori ücretsiz dağıtımın hedefi (genelde "sauces"). */
  sauceCategory: string;
  /** Her nitelikli birim başına kaç ücretsiz sos hakkı var. Örn: 1 → her burger için 1 sos. */
  rewardPerItem: number;
  /** Sipariş başına ücretsiz sos üst limiti (opsiyonel). Verilmezse limit yoktur. */
  maxFreePerOrder?: number;
  /**
   * Dağıtım stratejisi:
   *  - "cheapest-first": En ucuz soslardan başlayarak bedava uygula (varsayılan).
   *  - "expensive-first": En pahalıdan başla.
   *  - "as-listed": Sepet sırasına göre uygula.
   */
  distribution?: "cheapest-first" | "expensive-first" | "as-listed";
};

export const DEFAULT_FREEBIE_CONFIG: FreebieConfig = {
  qualifyingCategories: ["burger", "vegan", "hotdogs"], // ana kalemler
  sauceCategory: "sauces",
  rewardPerItem: 1, // her ana ürün için 1 sos
  maxFreePerOrder: undefined, // isterseniz 4 gibi bir limit koyabilirsiniz
  distribution: "cheapest-first",
};

export type FreebieCounters = {
  /** Nitelikli ana ürün toplam birimi (qty toplamı). */
  qualifyingUnits: number;
  /** Sepetteki sos toplam birimi (qty toplamı). */
  sauceUnits: number;
  /** Kurala göre hesaplanan ücretsiz sos hakkı. */
  allowance: number;
  /** Sepette gerçekten uygulanabilir ücretsiz sos adedi (min(allowance, sauceUnits)). */
  applied: number;
  /** Kullanılmamış ücretsiz hak (allowance - applied). */
  remaining: number;
};

export type FreebieDiscountLine = {
  /** Hangi satır (cart item) için */
  id: string;
  /** Bedava uygulanacak adet */
  freeQty: number;
  /** Satırın birim fiyatı (bilgi amaçlı) */
  unitPrice: number;
  /** Bu satır için toplam indirim (freeQty * unitPrice) */
  discountTotal: number;
};

export type AllocationResult = FreebieCounters & {
  /** Satır bazlı ücretsiz dağıtım planı */
  discounts: FreebieDiscountLine[];
  /** Tüm bedava dağıtım toplam indirimi */
  totalDiscount: number;
};

/* ======================= Yardımcılar ======================= */

function normCategory(ci: CartItemLike): string {
  // üst seviyedeki category → item.category öncelikleri
  const c =
    (ci.category ?? ci.item?.category ?? "").toString().trim().toLowerCase();
  return c;
}

function isQualifying(ci: CartItemLike, cfg: FreebieConfig): boolean {
  const cat = normCategory(ci);
  return cfg.qualifyingCategories.includes(cat);
}

function isSauce(ci: CartItemLike, cfg: FreebieConfig): boolean {
  const cat = normCategory(ci);
  return cat === cfg.sauceCategory;
}

/* ======================= 1) Hak Hesabı ======================= */

export function computeFreebies(
  items: CartItemLike[],
  config: Partial<FreebieConfig> = {}
): FreebieCounters {
  const cfg: FreebieConfig = { ...DEFAULT_FREEBIE_CONFIG, ...config };

  let qualifyingUnits = 0;
  let sauceUnits = 0;

  for (const ci of items) {
    const qty = Math.max(0, Number(ci?.qty ?? 0));
    if (qty <= 0) continue;

    if (isQualifying(ci, cfg)) qualifyingUnits += qty;
    if (isSauce(ci, cfg)) sauceUnits += qty;
  }

  let allowance = qualifyingUnits * Math.max(0, cfg.rewardPerItem);
  if (typeof cfg.maxFreePerOrder === "number") {
    allowance = Math.min(allowance, Math.max(0, cfg.maxFreePerOrder));
  }

  const applied = Math.min(allowance, sauceUnits);
  const remaining = Math.max(0, allowance - applied);

  return { qualifyingUnits, sauceUnits, allowance, applied, remaining };
}

/* ======================= 2) Dağıtım Planı ======================= */

export function allocateFreebies(
  items: CartItemLike[],
  config: Partial<FreebieConfig> = {}
): AllocationResult {
  const cfg: FreebieConfig = { ...DEFAULT_FREEBIE_CONFIG, ...config };

  // Önce hakları hesapla
  const counters = computeFreebies(items, cfg);
  let remaining = counters.applied;

  // Sadece sos satırlarını aday listesine al
  const sauceLines = items
    .filter((ci) => isSauce(ci, cfg) && (ci.qty ?? 0) > 0)
    .map((ci) => ({
      id: ci.id,
      unitPrice: Number(ci.item?.price ?? 0),
      qty: Number(ci.qty ?? 0),
    }));

  // Sıralama stratejisi
  if (cfg.distribution === "cheapest-first") {
    sauceLines.sort((a, b) => a.unitPrice - b.unitPrice);
  } else if (cfg.distribution === "expensive-first") {
    sauceLines.sort((a, b) => b.unitPrice - a.unitPrice);
  }
  // "as-listed" → hiçbir şey yapma

  const discounts: FreebieDiscountLine[] = [];

  for (const line of sauceLines) {
    if (remaining <= 0) break;
    const freeQty = Math.min(remaining, line.qty);
    if (freeQty <= 0) continue;

    const discountTotal = +(freeQty * line.unitPrice).toFixed(2);
    discounts.push({
      id: line.id,
      freeQty,
      unitPrice: line.unitPrice,
      discountTotal,
    });

    remaining -= freeQty;
  }

  const totalDiscount = +discounts
    .reduce((s, d) => s + d.discountTotal, 0)
    .toFixed(2);

  return {
    ...counters,
    discounts,
    totalDiscount,
  };
}

/* ======================= Uygulama Örneği =======================

— Store.computePricing içinde (indirimleri hesaplarken):

  import { allocateFreebies } from "@/lib/freebies";

  const fb = allocateFreebies(items, {
    // projeye göre özelleştirilebilir:
    qualifyingCategories: ["burger", "vegan", "hotdogs"],
    sauceCategory: "sauces",
    rewardPerItem: 1,
    maxFreePerOrder: 4,         // örn. sipariş başı en fazla 4 bedava sos
    distribution: "cheapest-first",
  });

  // fb.totalDiscount → indirim olarak düşülebilir.
  // İsterseniz satır bazlı fiyatı 0’layıp "discount" olarak gösterebilirsiniz.

— UI (CartSummary) içinde banner:

  const { allowance, applied, remaining, qualifyingUnits } = computeFreebies(items);
  if (allowance > 0) {
    // "Ücretsiz sos hakkın: X (kalan Y)" benzeri bir badge gösterebilirsiniz.
  }

======================================================================== */
