import type {
  ActivePaymentRecovery,
  CanonicalPricingSnapshot,
  OrderCreateEnvelope,
  PaymentPrepareResponse,
  PaymentProfileResponse,
  PricingAdjustment,
  PricingAdjustmentReason,
  PaymentSessionResponse,
  SavedPaymentMethod,
} from "@/types/checkout";

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonUnknown(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function numberValue(value: unknown, fallback = 0): number {
  const normalized =
    typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function recordValue(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isActivePaymentRecovery(
  value: unknown,
): value is ActivePaymentRecovery {
  if (!isRecord(value)) return false;

  const paymentKind = value.paymentKind;
  const expiresAt = value.expiresAt;

  return (
    typeof value.paymentSessionId === "string" &&
    value.paymentSessionId.trim().length > 0 &&
    typeof value.recoveryToken === "string" &&
    value.recoveryToken.trim().length > 0 &&
    typeof value.manageUrl === "string" &&
    value.manageUrl.trim().length > 0 &&
    (paymentKind === "online" || paymentKind === "split_contactless") &&
    (expiresAt === undefined || expiresAt === null || typeof expiresAt === "string")
  );
}

function parseCanonicalPricingSnapshot(
  value: unknown,
): CanonicalPricingSnapshot | undefined {
  if (!isRecord(value)) return undefined;

  const merchandise = numberValue(value.merchandise, Number.NaN);
  const discount = numberValue(value.discount, Number.NaN);
  const surcharges = numberValue(value.surcharges, Number.NaN);
  const couponDiscount = numberValue(value.couponDiscount, Number.NaN);
  const total = numberValue(value.total, Number.NaN);

  if (
    ![merchandise, discount, surcharges, couponDiscount, total].every(
      Number.isFinite,
    )
  ) {
    return undefined;
  }

  return {
    merchandise,
    discount,
    surcharges,
    couponDiscount,
    total,
  };
}

function parsePricingAdjustmentReason(
  value: unknown,
): PricingAdjustmentReason {
  return value === "breakdown_only" ||
    value === "rounding" ||
    value === "canonical_reprice"
    ? value
    : "none";
}

function parsePricingAdjustment(
  value: unknown,
): PricingAdjustment | undefined {
  if (!isRecord(value)) return undefined;

  const submitted = parseCanonicalPricingSnapshot(value.submitted);
  const canonical = parseCanonicalPricingSnapshot(value.canonical);
  if (!submitted || !canonical) return undefined;

  return {
    changed: value.changed === true,
    payableChanged: value.payableChanged === true,
    breakdownChanged: value.breakdownChanged === true,
    reason: parsePricingAdjustmentReason(value.reason),
    differenceCents: Math.round(numberValue(value.differenceCents, 0)),
    submitted,
    canonical,
  };
}

function parseSavedPaymentMethod(value: unknown): SavedPaymentMethod | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (typeof value.label !== "string" || !value.label.trim()) return null;

  return {
    id: value.id,
    type: typeof value.type === "string" ? value.type : "unknown",
    label: value.label,
  };
}

export function parsePaymentProfileResponse(
  value: unknown,
): PaymentProfileResponse {
  if (!isRecord(value)) {
    return { ok: false, remembered: false, methods: [] };
  }

  const methods = Array.isArray(value.methods)
    ? value.methods
        .map(parseSavedPaymentMethod)
        .filter((item): item is SavedPaymentMethod => item !== null)
        .slice(0, 6)
    : [];

  return {
    ok: value.ok !== false,
    remembered: value.remembered === true,
    methods,
  };
}

export function parsePaymentPrepareResponse(
  value: unknown,
  fallbackRecoveryToken: string,
): PaymentPrepareResponse {
  const record = recordValue(value);

  return {
    ok: record.ok !== false,
    paymentSessionId: stringValue(record.paymentSessionId),
    recoveryToken:
      stringValue(record.recoveryToken) || fallbackRecoveryToken,
    recoveryExpiresAt:
      typeof record.recoveryExpiresAt === "string"
        ? record.recoveryExpiresAt
        : null,
    url: stringValue(record.url),
    manageUrl: stringValue(record.manageUrl),
    message: optionalString(record.message),
    error: optionalString(record.error),
    pricingAdjusted: record.pricingAdjusted === true,
    pricingAdjustment: parsePricingAdjustment(record.pricingAdjustment),
    canonicalPricing: parseCanonicalPricingSnapshot(record.canonicalPricing),
    splitAdjusted: record.splitAdjusted === true,
  };
}

export function parsePaymentSessionResponse(
  value: unknown,
): PaymentSessionResponse {
  const record = recordValue(value);

  return {
    ok: record.ok !== false,
    status: stringValue(record.status).toLowerCase(),
    finalized: record.finalized === true,
    cancelled: record.cancelled === true,
    recoveryExpiresAt:
      typeof record.recoveryExpiresAt === "string"
        ? record.recoveryExpiresAt
        : null,
    message: optionalString(record.message),
    error: optionalString(record.error),
  };
}

export function parseOrderCreateEnvelope(value: unknown): OrderCreateEnvelope {
  const record = recordValue(value);

  return {
    ok: record.ok !== false,
    couponError: record.couponError === true,
    message: optionalString(record.message),
    error: optionalString(record.error),
    orderId: optionalString(record.orderId),
    id: optionalString(record.id),
    etaMin: record.etaMin,
    planned: record.planned,
    trackingToken: record.trackingToken,
    emergencyMode: record.emergencyMode === true,
    pricingAdjusted: record.pricingAdjusted === true,
    pricingAdjustment: parsePricingAdjustment(record.pricingAdjustment),
    canonicalPricing: parseCanonicalPricingSnapshot(record.canonicalPricing),
    order: isRecord(record.order) ? record.order : undefined,
    data: isRecord(record.data) ? record.data : undefined,
  };
}

export function errorMessage(
  error: unknown,
  fallback = "Unbekannter Fehler",
): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export function isAllowedNavigationUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;

  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || url.origin === window.location.origin;
  } catch {
    return false;
  }
}
