"use client";
import { CartItem, PricingSummary, Category, OrderMode } from "@/components/types";
import { loadSettings } from "@/lib/settings";
import { loadCoupons } from "@/lib/coupons";
import { allocateFreebies } from "@/lib/freebies";

const EUR = (n:number) => +n.toFixed(2);

export function computeBase(items: CartItem[]): Omit<PricingSummary,"discount"|"total"|"freebie"|"meetsMin"|"requiredMin"|"plzKnown"> {
  const merchandise = EUR(items.reduce((sum, ci)=>{
    const add = (ci.add||[]).reduce((a,b)=>a+(b.price||0),0);
    return sum + (ci.item.price + add) * (ci.qty||1);
  },0));
  return { merchandise, surcharges: 0, subtotal: merchandise };
}

/**
 * Gutscheinu doğrula + indirim tutarını hesapla
 */
export function applyCoupon(items: CartItem[], code: string|undefined|null): number {
  if(!code) return 0;
  const coupons = loadCoupons();
  const now = Date.now();
  const c = coupons.find(x => x.enabled && x.code.toLowerCase() === code.trim().toLowerCase()
    && (!x.startAt || now >= Date.parse(x.startAt)) && (!x.endAt || now <= Date.parse(x.endAt)));
  if(!c) return 0;

  let base = 0;
  if(c.scope==="all"){
    base = items.reduce((s,ci)=>{
      const add = (ci.add||[]).reduce((a,b)=>a+(b.price||0),0);
      return s + (ci.item.price + add)*(ci.qty||1);
    },0);
  } else if(c.scope==="category"){
    base = items.filter(ci => c.categories?.includes(ci.item.category))
      .reduce((s,ci)=>{
        const add=(ci.add||[]).reduce((a,b)=>a+(b.price||0),0);
        return s+(ci.item.price+add)*(ci.qty||1);
      },0);
  } else {
    // product scope
    base = items.filter(ci => {
      const sku = ci.item.id || (ci.item as any).sku || "";
      return c.productSkus?.includes(sku);
    }).reduce((s,ci)=>{
      const add=(ci.add||[]).reduce((a,b)=>a+(b.price||0),0);
      return s+(ci.item.price+add)*(ci.qty||1);
    },0);
  }

  if(base<=0) return 0;
  return c.kind==="percent" ? EUR(base * (c.value/100)) : EUR(Math.min(c.value, base));
}

/**
 * Settings → surcharges + lifa + freebies
 */
export function applySettingsAdjustments(
  items: CartItem[],
  mode: OrderMode,
  couponCode?: string
): Pick<PricingSummary,"discount"|"total"|"freebie"|"surcharges"|"subtotal"> {

  const settings = loadSettings();

  // 1) Surcharges (kategori başına sabit ek) – siparişe 1 kez uygula: o kategori siparişte varsa
  let surcharges = 0;
  const catsInCart = new Set<Category>();
  items.forEach(ci => { if(ci.item?.category) catsInCart.add(ci.item.category); });
  for (const [cat, fee] of Object.entries(settings.pricing.categorySurcharges||{})) {
    if (catsInCart.has(cat as Category)) surcharges += Number(fee)||0;
  }
  surcharges = EUR(surcharges);

  // 2) Merchandise hesapla + subtotal
  const merchandise = EUR(items.reduce((sum, ci)=>{
    const add = (ci.add||[]).reduce((a,b)=>a+(b.price||0),0);
    return sum + (ci.item.price + add)*(ci.qty||1);
  },0));
  const subtotal = EUR(merchandise + surcharges);

  // 3) Freebies
  let freebieDiscount = 0;
  let freebie:
    | { allowed: number; used: number; discountedAmount: number }
    | undefined = undefined;

  if (settings.freebies.enabled && merchandise >= settings.freebies.minOrder) {
    const fb = allocateFreebies(
      items.map(ci => ({
        id: ci.id, qty: ci.qty,
        item: { price: ci.item.price, name: ci.item.name, category: ci.item.category }
      })),
      {
        qualifyingCategories: ["burger","vegan","hotdogs"], // ana ürünler
        sauceCategory: settings.freebies.targetCategory,
        rewardPerItem: 0, // burada qty bazlı değil; minOrder + sabit freeCount kuralı
      }
    );
    // minOrder + sabit adet → dağıtımı biz yöneteceğiz: en ucuz soslardan freeCount kadar
    // allocateFreebies default "cheapest-first" olduğundan kural: applied = min(freeCount, sauceUnits)
    // Bunu override edelim:
    const sauceUnits = fb.sauceUnits;
    const used = Math.min(settings.freebies.freeCount, sauceUnits);
    if (used > 0) {
      // sos satırlarını fiyatlarına göre sırala ve "used" adete kadar birim fiyat kadar indir
      const sauceLines = items
        .filter(ci => ci.item.category === settings.freebies.targetCategory && (ci.qty||0) > 0)
        .map(ci => ({ unitPrice: ci.item.price, qty: ci.qty||0 }))
        .sort((a,b)=> a.unitPrice - b.unitPrice);
      let remain = used;
      let disc = 0;
      for(const line of sauceLines){
        if(remain<=0) break;
        const take = Math.min(remain, line.qty);
        disc += take * line.unitPrice;
        remain -= take;
      }
      freebieDiscount = EUR(disc);
      freebie = { allowed: settings.freebies.freeCount, used, discountedAmount: freebieDiscount };
    }
  }

  // 4) Gutschein
  const couponDiscount = EUR(applyCoupon(items, couponCode));

  // 5) Lifa (sadece delivery mod)
  const lifaDiscount = mode==="delivery" ? EUR(merchandise * ((settings.pricing.lifaPercent||0)/100)) : 0;

  const discount = EUR(freebieDiscount + couponDiscount + lifaDiscount);
  const total = EUR(subtotal - discount);

  return { surcharges, subtotal, discount, total, freebie };
}
