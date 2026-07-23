import type { OrderMode } from "@/components/store";

export type CheckoutPaymentMethod = "cash" | "online" | "split_contactless";
export type CheckoutPaymentStatus = "pending" | "paid" | "failed";

export type CheckoutAddress = {
  name: string;
  phone: string;
  email?: string;
  emailOptIn?: boolean;
  street: string;
  house: string;
  zip: string;
  city: string;
  floor?: string;
  entrance?: string;
  note?: string;
};

export type CheckoutOrderItemExtra = {
  label?: string;
  name?: string;
  price: number;
};

export type CheckoutOrderItem = {
  id?: string;
  sku?: string;
  name: string;
  description?: string;
  category?: string;
  price: number;
  qty: number;
  add?: CheckoutOrderItemExtra[];
  note?: string;
  rm?: string[];
  [key: string]: unknown;
};

export type CheckoutOrderDraft = {
  ts: number;
  mode: OrderMode;
  source: "web";
  channel: "web";
  orderChannel: "abholung" | "lieferung";
  plz: string | null;
  items: CheckoutOrderItem[];
  merchandise: number;
  discount: number;
  surcharges: number;
  total: number;
  coupon?: string;
  couponDiscount: number;
  orderNote?: string;
  customer: {
    name: string;
    phone: string;
    email?: string;
    emailOptIn: boolean;
    address?: string;
    deliveryHint?: string;
    street?: string;
    house?: string;
    zip?: string;
    plz?: string;
    city?: string;
    floor?: string;
    entrance?: string;
  };
  planned?: string;
  meta: {
    coupon: string | null;
    couponMeta: unknown;
    conditionalCampaign: Record<string, unknown> | null;
    emailOptIn: boolean;
    payment: {
      method: CheckoutPaymentMethod;
      status: CheckoutPaymentStatus;
      provider: "manual" | "stripe_checkout";
      testMode: boolean;
      tip: number;
      baseTotal: number;
      payableTotal: number;
    };
    routeDeal: Record<string, unknown> | null;
    routeDealDiscount: number;
    tip: number;
    pfand: {
      amount: number;
      lines: unknown[];
      excludedFromDiscounts: true;
    };
    couponLifecycle: Record<string, unknown> | null;
    emergencyMode?: boolean;
    emergencyStartedAt?: string;
    emergencySubmittedAt?: string;
    emergencyLastError?: string;
    [key: string]: unknown;
  };
};

export type ActivePaymentRecovery = {
  paymentSessionId: string;
  recoveryToken: string;
  manageUrl: string;
  paymentKind: "online" | "split_contactless";
  expiresAt?: string | null;
};

export type SavedPaymentMethod = {
  id: string;
  type: string;
  label: string;
};

export type PaymentProfileResponse = {
  ok: boolean;
  remembered: boolean;
  methods: SavedPaymentMethod[];
};

export type CanonicalPricingSnapshot = {
  merchandise: number;
  discount: number;
  surcharges: number;
  couponDiscount: number;
  total: number;
};

export type PricingAdjustmentReason =
  | "none"
  | "breakdown_only"
  | "rounding"
  | "canonical_reprice";

export type PricingAdjustment = {
  changed: boolean;
  payableChanged: boolean;
  breakdownChanged: boolean;
  reason: PricingAdjustmentReason;
  differenceCents: number;
  submitted: CanonicalPricingSnapshot;
  canonical: CanonicalPricingSnapshot;
};

export type PaymentPrepareResponse = {
  ok: boolean;
  paymentSessionId: string;
  recoveryToken: string;
  recoveryExpiresAt: string | null;
  url: string;
  manageUrl: string;
  message?: string;
  error?: string;
  pricingAdjusted: boolean;
  pricingAdjustment?: PricingAdjustment;
  canonicalPricing?: CanonicalPricingSnapshot;
  splitAdjusted: boolean;
};

export type PaymentSessionResponse = {
  ok: boolean;
  status: string;
  finalized: boolean;
  cancelled?: boolean;
  recoveryExpiresAt?: string | null;
  message?: string;
  error?: string;
};

export type OrderCreateResult = {
  id: string;
  etaMin: number;
  planned: string;
  trackingToken: string;
  emergencyMode: boolean;
  pricingAdjusted: boolean;
  pricingAdjustment?: PricingAdjustment;
  canonicalPricing?: CanonicalPricingSnapshot;
};

export type OrderCreateEnvelope = {
  ok: boolean;
  couponError: boolean;
  message?: string;
  error?: string;
  orderId?: string;
  id?: string;
  etaMin?: unknown;
  planned?: unknown;
  trackingToken?: unknown;
  emergencyMode?: boolean;
  pricingAdjusted?: boolean;
  pricingAdjustment?: PricingAdjustment;
  canonicalPricing?: CanonicalPricingSnapshot;
  order?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

export type CheckoutToastTone = "success" | "error" | "warning" | "info";

export type CheckoutToast = {
  id: string;
  message: string;
  tone: CheckoutToastTone;
};
