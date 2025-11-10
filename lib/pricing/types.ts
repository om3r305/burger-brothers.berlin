// lib/pricing/types.ts
export type PricingSummary = {
  merchandise: number;
  surcharges: number;
  subtotal: number;
  discount: number;
  total: number;
  freebie?: { allowed: number; used: number; discountedAmount: number };
  meetsMin?: boolean;
  requiredMin?: number;
  plzKnown?: boolean;
};
