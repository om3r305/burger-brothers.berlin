// lib/pricing/types.ts
export type FreebieInfo = {
  allowed: number;
  used: number;
  discountedAmount: number;
};

export type PricingSummary = {
  merchandise: number;
  surcharges: number;
  subtotal: number;
  discount: number;
  total: number;
  freebie?: FreebieInfo;

  // aşağıdakiler opsiyonel – başka yerlerde kullanılıyor olabilir:
  meetsMin?: boolean;
  requiredMin?: number;
  plzKnown?: boolean;
};
