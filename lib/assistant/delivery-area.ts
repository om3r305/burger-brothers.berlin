/** The only delivery-settings data that may leave the server. */
export type CustomerDeliveryAreaResult = {
  postalCode: string;
  deliverable: boolean;
  minimumOrderAfterDiscount: number | null;
};

type DeliverySettings = {
  pricingOverrides?: { plzMin?: Record<string, unknown> };
  delivery?: {
    plzMin?: Record<string, unknown>;
    minOrderAfterDiscountByPLZ?: Record<string, unknown>;
  };
};

function customerMinimumMap(settings: DeliverySettings) {
  // Keep this order exactly aligned with normalizeAndMerge in lib/settings.ts.
  // Compatibility sources are additive and later sources win per postal code.
  return {
    ...(settings.pricingOverrides?.plzMin || {}),
    ...(settings.delivery?.plzMin || {}),
    ...(settings.delivery?.minOrderAfterDiscountByPLZ || {}),
  };
}

export function normalizeCustomerPostalCode(value: unknown) {
  const postalCode = String(value ?? "").replace(/\D/g, "").slice(0, 5);
  return postalCode.length === 5 ? postalCode : "";
}

export function buildCustomerDeliveryAreaResult(
  settings: DeliverySettings,
  value: unknown,
): CustomerDeliveryAreaResult {
  const postalCode = normalizeCustomerPostalCode(value);
  const minimums = customerMinimumMap(settings || {});
  const rawMinimum = postalCode ? minimums[postalCode] : undefined;
  const minimum = Number(rawMinimum);
  const deliverable = rawMinimum !== undefined && Number.isFinite(minimum) && minimum >= 0;

  return {
    postalCode,
    deliverable,
    minimumOrderAfterDiscount: deliverable ? minimum : null,
  };
}

export function extractDeliveryPostalCode(message: unknown) {
  const text = String(message ?? "");
  const match = text.match(/(?:^|\D)(\d{5})(?!\d)/);
  if (!match) return "";

  const lookupIntent =
    /\b(?:plz|postleitzahl|liefer(?:e|st|t|n|ung|gebiet|bar)?|mindestbestell(?:wert|ung)?|delivery|deliver|postal|postcode|zip|teslimat|minimum)\b/i;
  return lookupIntent.test(text) ? match[1] : "";
}
