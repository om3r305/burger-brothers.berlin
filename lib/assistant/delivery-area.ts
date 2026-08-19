export type CustomerDeliveryAreaResult = {
  postalCode: string;
  deliverable: boolean;
  minimumOrder?: number;
};

type DeliverySettingsShape = {
  delivery?: {
    plzMin?: Record<string, unknown>;
    minOrderAfterDiscountByPLZ?: Record<string, unknown>;
  };
  pricingOverrides?: { plzMin?: Record<string, unknown> };
};

/** Build a new allowlisted result from the same PLZ map as checkout. */
export function buildCustomerDeliveryAreaResult(
  settings: DeliverySettingsShape,
  value: unknown,
): CustomerDeliveryAreaResult {
  const postalCode = String(value ?? "").replace(/\D/g, "").slice(0, 5);
  const checkoutMinimums = settings.delivery?.plzMin || {};
  const minimums = Object.keys(checkoutMinimums).length
    ? checkoutMinimums
    : {
        ...(settings.pricingOverrides?.plzMin || {}),
        ...(settings.delivery?.minOrderAfterDiscountByPLZ || {}),
      };
  const minimumOrder = Number(minimums[postalCode]);
  const deliverable = /^\d{5}$/.test(postalCode) && Number.isFinite(minimumOrder);

  return deliverable
    ? { postalCode, deliverable: true, minimumOrder: Math.max(0, minimumOrder) }
    : { postalCode, deliverable: false };
}
