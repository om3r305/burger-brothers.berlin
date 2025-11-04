// types.ts

/* ================================
 * Ortak Tipler
 * ================================ */

export type Category =
  | "burger"
  | "vegan"
  | "extras"
  | "sauces"
  | "drinks"
  | "hotdogs";

export type OrderMode = "pickup" | "delivery";

export type ExtraOption = {
  id: string;
  name: string;
  price: number;
};

/**
 * EU-Allergene (Buchstaben) + gängige Untercodes (A1–A5) + Zusatzstoffe (Ziffern).
 * Beispiel: A,G,A1 sowie 2,5
 */
export type AllergenCode =
  // Allergene (Auszug + Untercodes)
  | "A" | "A1" | "A2" | "A3" | "A4" | "A5"
  | "C"
  | "G"
  | "H"
  | "L"
  | "M"
  | "N"
  | "R"
  // Zusatzstoffe (häufig verwendet – Nummern)
  | "1" // mit Farbstoff
  | "2" // mit Konservierungsstoff
  | "3" // mit Antioxidationsmittel
  | "4" // mit Geschmacksverstärker
  | "5"; // mit Süßungsmittel

/** Lesbare Labels für UI-Darstellung (kann im Admin angezeigt werden) */
export const ALLERGEN_LABELS: Record<AllergenCode, string> = {
  A:  "Enthält glutenhaltiges Getreide (z. B. Weizen, Roggen, Gerste, Hafer, Dinkel)",
  A1: "Weizen",
  A2: "Roggen",
  A3: "Gerste",
  A4: "Hafer",
  A5: "Dinkel",
  C:  "Enthält Eier und daraus gewonnene Erzeugnisse",
  G:  "Enthält Milch und Milcherzeugnisse (einschließlich Laktose)",
  H:  "Enthält Schalenfrüchte/Nüsse",
  L:  "Enthält Sellerie und Sellerieerzeugnisse",
  M:  "Enthält Senf und Senferzeugnisse",
  N:  "Enthält Sesamsamen und Sesamerzeugnisse",
  R:  "Enthält Weichtiere und Weichtiererzeugnisse",
  1:  "mit Farbstoff",
  2:  "mit Konservierungsstoff",
  3:  "mit Antioxidationsmittel",
  4:  "mit Geschmacksverstärker",
  5:  "mit Süßungsmittel",
};

/* ================================
 * Menü / Ürün Tipleri
 * ================================ */

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  imageUrl?: string;
  videoUrl?: string;
  /** UI/iş mantığı için zorunlu ortak kategori */
  category: Category;

  removable?: string[];
  addable?: ExtraOption[];
  description?: string;

  /** Alerjen/Zusatzstoff-Codes, z. B. ["A","G","A1","2","5"] */
  allergens?: AllergenCode[];

  /** Admin: ürün görünürlüğü ve zamanlaması */
  isActive?: boolean;            // anlık aktif/pasif
  activeFrom?: string | null;    // ISO (z. B. "2025-01-31T10:00:00+01:00")
  activeTo?: string | null;      // ISO
};

/** Sepet satırı */
export type CartItem = {
  id: string;
  item: MenuItem;
  qty: number;
  add: ExtraOption[];
  rm: string[];
  note?: string;
  /** Gruplama için — item.category ile aynı tutulmalı */
  category?: Category;
};

/* ================================
 * Varyant Grupları (İçecek/Extras)
 * ================================ */
export type Variant = { id: string; name: string; price: number; image?: string };
export type VariantGroup = {
  id?: string;      // Admin tarafında olabilir
  sku: string;      // grup anahtarı
  name: string;
  description?: string;
  image?: string;
  variants: Variant[];
  /** Kampanya/etiket uyumu için opsiyonel kategori bilgisi */
  category?: Category; // "drinks" | "extras" vb.
};

/* ================================
 * Kampanya (Promotions) Tipleri
 * ================================ */
export type PromotionType =
  | "percentOffCategory"   // kategori bazlı % ind.
  | "fixedOffItem"         // belirli üründe sabit ind.
  | "bogo"                 // buy one get one
  | "badgeOnly"            // sadece rozet/etiket gösterimi
  | "freeSauceThreshold";  // eşik bazlı ücretsiz sos

export type Promotion = {
  id: string;
  name: string;
  type: PromotionType;

  /** Hedef alanlar */
  targetCategory?: Category;
  targetItemIds?: string[];

  /** İndirim değerleri */
  percent?: number;     // 0–100
  amount?: number;      // € sabit indirim
  threshold?: number;   // merchandise eşiği (örn: free sauce)

  /** Rozet/etiket */
  badgeText?: string;   // "Aktion", "2 für 1", "%10" vb.
  badgeColor?: string;  // CSS color/tailwind class (opsiyonel)

  /** Zamanlama */
  active?: boolean;
  startsAt?: string | null; // ISO
  endsAt?: string | null;   // ISO

  /** Öncelik/sıralama */
  priority?: number;   // büyük olan önce uygulanır
};

/* ================================
 * Fiyatlama/Özet Tipleri (Store/Checkout)
 * ================================ */
export type PricingSummary = {
  merchandise: number;    // yalnız ürün + extras (surcharge hariç)
  surcharges: number;     // teslimat ekleri + özel extra sürşarj
  subtotal: number;       // merchandise + surcharges
  discount: number;       // kampanya + delivery ind. + ücretsiz sos indirimi
  total: number;          // ödenecek
  meetsMin: boolean;
  requiredMin?: number;
  plzKnown: boolean;
  freebie?: {
    allowed: number;
    used: number;
    discountedAmount: number;
  };
};

/* ================================
 * Sipariş Logları (Admin/İstatistik)
 * ================================ */
export type OrderLog = {
  id: string;
  createdAt: string;      // ISO
  mode: OrderMode;        // pickup/delivery
  plz?: string | null;

  items: Array<{
    sku?: string;
    name: string;
    category?: Category;
    qty: number;
    unitPrice: number;
    add?: ExtraOption[];
    rm?: string[];
  }>;

  merchandise: number;
  surcharges: number;
  discount: number;
  total: number;

  /** Serbest metin: kampanya özetleri / ücretsiz sos vb. */
  notes?: string[];
};
