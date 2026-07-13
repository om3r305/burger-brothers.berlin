// lib/conditional-campaign.ts
// Bağımsız sepet teklifi motoru. Ürün/kategori kampanyalarına dokunmaz.

export type ConditionalCampaignMode = "pickup" | "delivery" | "both";

export type CartOffer = {
  id: string;
  name: string;
  enabled: boolean;
  percent: number;
  minNetTotal: number;
  mode: ConditionalCampaignMode;
  startAt?: string;
  endAt?: string;
  priority?: number;
  customerNotice?: string;
  overrideStandardDiscount?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

export type ConditionalCampaignResult = {
  hasCampaign: boolean;
  eligible: boolean;
  active: boolean;
  campaign: CartOffer | null;
  campaignName: string;
  percent: number;
  rate: number;
  standardRate: number;
  effectiveRate: number;
  baseAmount: number;
  netAmount: number;
  /** Geriye dönük alan adı; artık indirimsiz Mindest-Warenwert anlamındadır. */
  minNetTotal: number;
  /** Kampanyayı açan indirimsiz Warenwert eşiği. */
  requiredBaseAmount: number;
  missingBaseAmount: number;
  discountAmount: number;
  badgeText: string;
  customerNotice: string;
  overridesStandardDiscount: boolean;
};

function toNum(value: any, fallback = 0) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function toDateMs(value: any, fallback: number) {
  if (!value) return fallback;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : fallback;
}

export function normalizeCartOfferMode(value: any): ConditionalCampaignMode {
  const text = String(value || "").toLowerCase().trim();
  if (["pickup", "abholung", "apollo", "apollon"].includes(text)) return "pickup";
  if (["delivery", "lieferung", "lifa", "liefa", "lieferando"].includes(text)) return "delivery";
  return "both";
}

export function normalizeCartOffers(value: any): CartOffer[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((raw: any, index: number) => ({
      id: String(raw?.id || `cart-offer-${index + 1}`),
      name: String(raw?.name || raw?.title || "Warenkorb-Angebot"),
      enabled: raw?.enabled !== false && raw?.active !== false,
      percent: Math.max(0, Math.min(99.99, toNum(raw?.percent ?? raw?.value, 0))),
      minNetTotal: Math.max(0, toNum(raw?.minNetTotal, 0)),
      mode: normalizeCartOfferMode(raw?.mode),
      startAt: raw?.startAt || raw?.startsAt || undefined,
      endAt: raw?.endAt || raw?.endsAt || undefined,
      priority: toNum(raw?.priority, 100),
      customerNotice: raw?.customerNotice ? String(raw.customerNotice) : undefined,
      overrideStandardDiscount: raw?.overrideStandardDiscount !== false,
      createdAt: raw?.createdAt || undefined,
      updatedAt: raw?.updatedAt || undefined,
    }))
    .filter((offer) => offer.id && offer.name && offer.percent > 0 && offer.minNetTotal > 0);
}

function offerIsInDateRange(offer: CartOffer, mode: "pickup" | "delivery", nowMs: number) {
  if (!offer.enabled) return false;
  if (offer.mode !== "both" && offer.mode !== mode) return false;
  const start = toDateMs(offer.startAt, -Infinity);
  const end = toDateMs(offer.endAt, Infinity);
  return nowMs >= start && nowMs <= end;
}

export function evaluateConditionalCartCampaign(params: {
  cartOffers?: CartOffer[] | any[];
  // Eski çağrılar derlenmeye devam etsin; runtime artık cartOffers kullanır.
  campaigns?: any[];
  mode: "pickup" | "delivery";
  baseAmount: number;
  standardRate: number;
  now?: Date | number;
}): ConditionalCampaignResult {
  const offers = normalizeCartOffers(params.cartOffers ?? []);
  const baseAmount = Math.max(0, toNum(params.baseAmount, 0));
  const standardRate = Math.max(0, Math.min(0.9999, toNum(params.standardRate, 0)));
  const nowMs = params.now instanceof Date ? params.now.getTime() : typeof params.now === "number" ? params.now : Date.now();

  const candidates = offers
    .filter((offer) => offerIsInDateRange(offer, params.mode, nowMs))
    .map((offer) => {
      const rate = offer.percent / 100;

      /*
       * ÖNEMLİ:
       * minNetTotal alanı geriye dönük uyumluluk için adını koruyor.
       * Fakat kampanyanın açılma şartı müşterinin indirimsiz Warenwert'idir.
       *
       * Dahil:
       * - Ürünler
       * - Seçilen ekstralar
       * - Sos / içecek / donut / bubble tea ürünleri
       *
       * Dahil değil:
       * - Standart Abholung/Lieferung indirimi
       * - Warenkorb-Angebot indirimi
       * - Lieferaufschläge
       * - Gutschein
       * - Trinkgeld
       * - Gratis-Artikel indirimi
       */
      const requiredBaseAmount = offer.minNetTotal;
      const netAtOffer = +(baseAmount * (1 - rate)).toFixed(2);
      const eligible =
        baseAmount + 0.000001 >= requiredBaseAmount;

      return {
        offer,
        rate,
        requiredBaseAmount,
        netAtOffer,
        eligible,
      };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.offer.priority || 0) - (a.offer.priority || 0) || b.offer.percent - a.offer.percent);

  const selected = candidates[0] || null;
  if (!selected) {
    const discountAmount = +(baseAmount * standardRate).toFixed(2);
    return {
      hasCampaign: false, eligible: false, active: false, campaign: null,
      campaignName: "", percent: 0, rate: 0, standardRate, effectiveRate: standardRate,
      baseAmount, netAmount: +(baseAmount - discountAmount).toFixed(2), minNetTotal: 0,
      requiredBaseAmount: 0, missingBaseAmount: 0, discountAmount, badgeText: "",
      customerNotice: "", overridesStandardDiscount: false,
    };
  }

  const overrides = selected.offer.overrideStandardDiscount !== false;
  const effectiveRate = selected.eligible ? (overrides ? selected.rate : Math.max(standardRate, selected.rate)) : standardRate;
  const discountAmount = +(baseAmount * effectiveRate).toFixed(2);
  return {
    hasCampaign: true,
    eligible: selected.eligible,
    active: selected.eligible,
    campaign: selected.offer,
    campaignName: selected.offer.name,
    percent: selected.offer.percent,
    rate: selected.rate,
    standardRate,
    effectiveRate,
    baseAmount,
    netAmount: +(baseAmount - discountAmount).toFixed(2),
    minNetTotal: selected.offer.minNetTotal,
    requiredBaseAmount: +selected.requiredBaseAmount.toFixed(2),
    missingBaseAmount: +Math.max(0, selected.requiredBaseAmount - baseAmount).toFixed(2),
    discountAmount,
    badgeText: `${selected.offer.percent}% Aktion`,
    customerNotice: selected.offer.customerNotice || "",
    overridesStandardDiscount: overrides,
  };
}
