"use client";
import { useMemo } from "react";
import { useCart } from "./cart.store";
import { siteConfig } from "@/config/site.config";

export default function CartPanel(){
  const lines = useCart(s=>s.lines);
  const removeLine = useCart(s=>s.removeLine);

  const { subtotal, discount, total, meetsMin } = useMemo(()=>{
    const sub = lines.reduce((a,l)=> a + (l.price + (l.extras?.reduce((x,e)=>x+e.price,0)||0)) * l.qty, 0);
    const meets = sub >= siteConfig.rules.minOrderTotal;
    const disc = sub >= siteConfig.rules.discountThreshold ? sub*siteConfig.rules.discountRate : 0;
    const tot = sub - disc;
    return { subtotal: sub, discount: disc, total: tot, meetsMin: meets };
  }, [lines]);

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">Bestellübersicht</h2>
      <div className="space-y-3">
        {lines.map((l)=> (
          <div key={l.id} className="rounded border border-stone-700/60 p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="font-medium">{l.name}{l.labelAddon? ` (${l.labelAddon})`:""}</div>
              <button className="text-xs opacity-70 hover:opacity-100" onClick={()=>removeLine(l.id)}>Entfernen</button>
            </div>
            <div className="opacity-80">Menge: {l.qty} • Einzel: {(l.price).toFixed(2)} €</div>
            {l.removes?.length ? <div className="opacity-80">Ohne: {l.removes.join(", ")}</div> : null}
            {l.extras?.length ? <div className="opacity-80">Extras: {l.extras.map(e=>`${e.label} (+${e.price.toFixed(2)}€)`).join(", ")}</div> : null}
            {l.note ? <div className="opacity-80">Hinweisiz: “{l.note}”</div> : null}
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between"><span>Zwischensumme</span><span>{subtotal.toFixed(2)} €</span></div>
        <div className="flex justify-between"><span>Rabatt</span><span>-{discount.toFixed(2)} €</span></div>
        <div className="flex justify-between font-semibold"><span>Gesamt</span><span>{total.toFixed(2)} €</span></div>
        {!meetsMin && <div className="mt-2 rounded bg-amber-500/10 p-2 text-amber-300">Min. Bestellwert {siteConfig.rules.minOrderTotal} € — lütfen ürün ekleyin.</div>}
      </div>
    </div>
  );
}
