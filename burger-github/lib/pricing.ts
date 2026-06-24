// lib/pricing.ts
import { getPricingOverrides } from "@/lib/settings";

export type Mode = "pickup" | "delivery";

const toNum = (n: any, fb = 0) => {
  const x = Number(String(n ?? "").replace(",", "."));
  return Number.isFinite(x) ? x : fb;
};

const catKey = (name?: string) => {
  const t = (name || "").toLowerCase();
  if (t.includes("burger")) return "burger";
  if (/(drink|getränk|getraenk|cola|wasser|fritz)/.test(t)) return "drinks";
  if (/(sauce|soße|soßen|sossen|sos|ketchup|mayo)/.test(t)) return "sauces";
  if (t.includes("donut") || t.includes("dessert")) return "donuts";
  if (t.includes("hotdog")) return "hotdogs";
  if (t.includes("vegan")) return "vegan";
  if (t.includes("bubble")) return "bubbleTea";
  if (t.includes("extra")) return "extras";
  return t;
};

export function sumCartMerchandise(items: any[]) {
  let sum = 0;
  for (const ci of items) {
    const base = toNum(ci?.item?.price, 0);
    const addSum = (Array.isArray(ci?.add) ? ci.add : []).reduce(
      (a: number, b: any) => a + toNum(b?.price, 0), 0
    );
    sum += (base + addSum) * toNum(ci?.qty, 1);
  }
  return +sum.toFixed(2);
}

export function computePricingV6(items: any[], mode: Mode, plz?: string | null) {
  const ov = getPricingOverrides(mode); // indirim oranı, surcharges, plzMin, freebies
  const rate = toNum(ov.discountRate, 0);

  const merchandise = sumCartMerchandise(items);
  const discount = +(merchandise * rate).toFixed(2);
  const afterDiscount = +(merchandise - discount).toFixed(2);

  const map = ov.plzMin || {};
  const code = (plz || "").replace(/[^\d]/g, "").slice(0, 5);
  const requiredMin = typeof map[code] === "number" ? toNum(map[code], 0) : null;
  const plzKnown = requiredMin != null;

  let surcharges = 0;
  if (mode === "delivery" && ov.surcharges) {
    for (const ci of items) {
      const key = catKey(ci?.item?.category || ci?.item?.name || "");
      const s = toNum((ov.surcharges as any)[key], 0);
      if (s > 0) surcharges += s * toNum(ci?.qty, 1);
    }
  }
  surcharges = +surcharges.toFixed(2);

  const meetsMin = mode === "delivery"
    ? (plzKnown ? afterDiscount >= toNum(requiredMin, 0) : false)
    : true;

  const total = +(afterDiscount + surcharges).toFixed(2);

  return { merchandise, discount, surcharges, total, requiredMin: requiredMin ?? null, plzKnown, meetsMin };
}
