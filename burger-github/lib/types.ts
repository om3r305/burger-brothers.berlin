// lib/types.ts
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
  address?: string; // "Street House | ZIP City | ...", delivery için
};

export type StoredOrder = {
  id: string;
  ts: number;              // sipariş oluşturma zamanı (ms)
  mode: OrderMode;
  status: OrderStatus;
  etaMin?: number;         // siparişe özel ETA
  planned?: string;        // "08:30" gibi, bugün içinde planlı saat
  channel?: string;        // "apollo" / "lieferando" vs.
  customer?: Customer;
  items?: Array<{
    name: string;
    qty: number;
    price?: number;
    note?: string;
    add?: Array<{ name?: string; label?: string }>;
    rm?: string[];
    group?: string; // opsiyonel gruplama
  }>;
  notes?: string;          // sipariş genel notu
  total?: number;          // toplam tutar (opsiyonel)

  // driver binding
  driverId?: string;
  driverName?: string;
  driverAssignedAt?: number; // ms
  driverDeliveredAt?: number; // ms
};

export type Driver = {
  id: string;         // dahili id
  name: string;       // "Ali"
  pin: string;        // "1234"
  deviceId?: string;  // bu cihaz o şoföre aitse
  active?: boolean;   // aktif/pasif
};

export type Settings = {
  hours?: {
    avgPickupMinutes?: number;
    avgDeliveryMinutes?: number;
    newGraceMinutes?: number; // "Eingegangen" görünmesi süresi
  };
  security?: {
    qrAccessWindowMin?: number; // varsayılan 120
  };
  dashboard?: {
    password?: string;
  };
  drivers?: Driver[];
};

/* ───────────────────────────────
 * Eklenen tipler (seed.ts ve diğerleri için)
 * ─────────────────────────────── */

// Menü öğesi tipi (seed.ts burada bunu kullanacak)
export type MenuItem = {
  id: string;
  name: string;
  desc?: string;
  price: number;
  imageUrl?: string;
  /** opsiyonel vitrin videosu */
  videoUrl?: string;
  /** kategoriler — seed’te kullanılan değerler */
  category: "burger" | "vegan" | "extra" | "drink" | "sauce";
  /** etiketler (örn. "beliebt") */
  tags?: string[];
  /** kaldırılabilir içerikler (örn. "Zwiebel") */
  removable?: string[];
  /** eklenebilir opsiyonlar */
  addable?: Array<{ id: string; name: string; price: number }>;
};

// WhatsApp/metin çıktılarında kullanılan basit sepet kalemi
export type CartItem = {
  qty: number;
  item?: {
    id?: string;
    name?: string;
    description?: string;
  };
  add?: Array<{ id?: string; name: string; price?: number }>;
  rm?: string[];
  note?: string;
};
