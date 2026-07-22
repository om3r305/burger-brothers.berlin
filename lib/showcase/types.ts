export type ShowcaseSceneType =
  | "hero"
  | "video"
  | "product"
  | "menu"
  | "campaign"
  | "image"
  | "qr"
  | "message";

export type ShowcaseTransition = "fade" | "slide" | "zoom" | "none";
export type ShowcaseMediaFit = "cover" | "contain";
export type ShowcasePreviewAspect = "landscape" | "portrait" | "ultrawide";
export type ShowcaseMenuColumns = 2 | 3;

export type ShowcaseScene = {
  id: string;
  type: ShowcaseSceneType;
  name: string;
  enabled: boolean;
  durationSeconds: number;
  transition: ShowcaseTransition;
  startAt?: string;
  endAt?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  badge?: string;
  mediaUrl?: string;
  posterUrl?: string;

  /** Eski tek ürün sahneleriyle geriye dönük uyumluluk. */
  productId?: string;
  /** Ürün akışında gösterilecek ürünlerin sıralı kimlikleri. */
  productIds?: string[];
  /** Ürün başına toplam gösterim süresi. */
  productSeconds?: number;
  /** Ürün görselleri için bağımsız yerleşim ayarları. */
  productImageFit?: ShowcaseMediaFit;
  productImageScale?: number;
  productImageX?: number;
  productImageY?: number;

  /** Dijital menüde gösterilecek DB kategori anahtarları. */
  menuCategories?: string[];
  /** Bir menü sayfasındaki en fazla ürün sayısı. */
  menuItemsPerPage?: number;
  /** Her menü sayfasının ekranda kalma süresi. */
  menuPageSeconds?: number;
  /** Dijital menü kolon sayısı. */
  menuColumns?: ShowcaseMenuColumns;
  /** Dijital menüde kısa ürün açıklamalarını gösterir. */
  menuShowDescriptions?: boolean;
  /** Dijital menü satırlarında küçük ürün görsellerini gösterir. */
  menuShowImages?: boolean;
  /** Dijital menü küçük görsel boyutu (px). */
  menuImageSize?: number;

  campaignId?: string;
  qrUrl?: string;
  qrLabel?: string;
  accent?: string;
  fit?: ShowcaseMediaFit;
  showLogo?: boolean;
  showQr?: boolean;
  showPrice?: boolean;
  muted?: boolean;
};

export type ShowcaseSettings = {
  name: string;
  defaultDurationSeconds: number;
  refreshSeconds: number;
  showClock: boolean;
  showProgress: boolean;
  showConnectionState: boolean;
  qrUrl: string;
  qrLabel: string;
  ticker: string;
  background: "theme" | "dark" | "black";
};

export type ShowcaseDocument = {
  schemaVersion: 1;
  version: string;
  enabled: boolean;
  updatedAt: string;
  publishedAt?: string;
  settings: ShowcaseSettings;
  scenes: ShowcaseScene[];
};

export type ShowcaseProduct = {
  id: string;
  sku?: string;
  name: string;
  description?: string;
  ingredientsText?: string;
  allergens?: string[];
  imageUrl?: string;
  category?: string;
  categoryLabel?: string;
  /** İçecek/ekstra gibi mevcut VariantGroup başlığı. */
  groupKey?: string;
  groupLabel?: string;
  order?: number;
  depositAmount?: number;

  /** DB'deki normal ürün fiyatı. */
  price: number;
  /** Aktif kampanya uygulanmış vitrin fiyatı. */
  displayPrice: number;
  /** Kampanya varsa üstü çizilecek normal fiyat. */
  originalPrice?: number;
  campaignBadge?: string;
  campaignTitle?: string;
  campaignMode?: "delivery" | "pickup" | "both";
  campaignEndsAt?: string;

  active?: boolean;
};

export type ShowcaseCampaign = {
  id: string;
  title: string;
  badgeText?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  payload?: Record<string, any>;
};

export type ShowcaseBranding = {
  shopName: string;
  logoUrl: string;
  themeId: string;
  themeColor: string;
  themeVideoUrl: string;
  themeDecorationsEnabled: boolean;
  themeMotionEnabled: boolean;
  themeSnow: boolean;
  themeCornerLeft: string;
  themeCornerRight: string;
  themeParticles: string[];
  locationLabel: string;
  siteUrl: string;
};

export type ShowcaseSnapshot = {
  ok: boolean;
  source: "db" | "memory_fallback" | "default_fallback";
  generatedAt: string;
  document: ShowcaseDocument;
  products: ShowcaseProduct[];
  campaigns: ShowcaseCampaign[];
  branding: ShowcaseBranding;
};

export type ShowcaseMediaItem = {
  id: string;
  key: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};
