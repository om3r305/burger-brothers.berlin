// lib/campaigns.ts
export function applyVariantPromo(basePrice: number, promoPercent?: number | null) {
  if (!promoPercent || promoPercent <= 0) return { price: basePrice, original: null as number | null };
  const price = +(basePrice * (1 - promoPercent / 100)).toFixed(2);
  return { price, original: basePrice };
}
