// components/types.ts

/* ───────── Sipariş / Durum ───────── */
export type OrderMode = "pickup" | "delivery";
export type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

export type Customer = {
  name?: string;
  phone?: string;
  address?: string; // "Street House | ZIP City | ..." (delivery)
};

/* ───────── Menü & Sepet tipleri ───────── */

/** Extra/ek malzeme. Bazı yerler name, bazı yerler label beklediği için ikisini de destekle. */
export type ExtraOption = {
  id: string;
  /** UI’lerde gösterilecek metin – ikisi de opsiyonel, en az birini doldururuz. */
  name?: string;
  label?: string;
  price: number;
};

/** Mağaza ürünü */
export type MenuItem = {
  id: string;
  name: string;
  price: number;

  /** Kategori isimleri projede kullanılanlarla uyumlu */
  category: "burger" | "drinks" | "extras" | "sauces" | "vegan" | "hotdogs" | string;

  // Opsiyonel alanlar – seed.ts ve kartlarda kullanılıyor
  desc?: string;
  description?: string; // bazı yerlerde description geçiyor
  imageUrl?: string;
  videoUrl?: string;
  tags?: string[];

  /** Çıkarılabilir malzemeler */
  removable?: string[];
  /** Eklenebilir malzemeler */
  addable?: ExtraOption[];

  /** SKU / alternatif kimlik */
  sku?: string;
};

/** Sepet satırı */
export type CartItem = {
  id: string;              // satır id
  item: MenuItem;          // ürün
  qty?: number;            // adet
  add?: ExtraOption[];     // ekstralar
  rm?: string[];           // çıkarılacaklar
  note?: string;           // satır notu
  category?: MenuItem["category"];
};

/* ───────── Sipariş kaydı (dashboard/TV) ───────── */
export type StoredOrder = {
  id: string;
  ts: number;              // oluşturma ms
  mode: OrderMode;
  status: OrderStatus;
  etaMin?: number;
  planned?: string;        // "08:30" gibi
  channel?: string;
  customer?: Customer;
  items?: Array<{
    name: string;
    qty: number;
    price?: number;
    note?: string;
    add?: Array<{ name?: string; label?: string }>;
    rm?: string[];
    group?: string;
  }>;
  notes?: string;
  total?: number;

  // driver binding
  driverId?: string;
  driverName?: string;
  driverAssignedAt?: number;
  driverDeliveredAt?: number;
};

/* ───────── Şoför ve ayarlar (eski kullanım uyumluluğu) ───────── */
export type Driver = {
  id: string;
  name: string;
  pin: string;
  deviceId?: string;
  active?: boolean;
};

export type Settings = {
  hours?: {
    avgPickupMinutes?: number;
    avgDeliveryMinutes?: number;
    newGraceMinutes?: number;
  };
  security?: {
    qrAccessWindowMin?: number;
  };
  dashboard?: {
    password?: string;
  };
  drivers?: Driver[];
};
