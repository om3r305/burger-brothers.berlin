function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Round only to the currency cent. Never normalize order totals to 0.10 EUR. */
export function roundCurrencyCents(value: unknown) {
  const number = finiteNumber(value, 0);
  return +(Math.round((number + Number.EPSILON) * 100) / 100).toFixed(2);
}

/**
 * Standard/cart-offer eligibility is resolved from merchandise elsewhere.
 * This applies that already-resolved rate to the gross delivery category
 * surcharge, excluding Pfand and tip.
 */
export function standardSurchargeDiscount(
  grossSurcharge: unknown,
  effectiveRate: unknown,
) {
  const gross = roundCurrencyCents(Math.max(0, finiteNumber(grossSurcharge, 0)));
  const rate = Math.max(0, Math.min(0.9999, finiteNumber(effectiveRate, 0)));
  return Math.min(gross, roundCurrencyCents(gross * rate));
}
