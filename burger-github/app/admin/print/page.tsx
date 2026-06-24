
"use client";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { readSettings } from "@/lib/settings";

const LS_ORDERS = "bb_orders_v1";
const fmt = (n:number)=> new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(n);

function useOrder(){
  const sp = useSearchParams();
  const id = sp.get("id") || "";
  const raw = typeof window!=="undefined" ? localStorage.getItem(LS_ORDERS) : "[]";
  const list = raw? JSON.parse(raw): [];
  const order = Array.isArray(list)? list.find((o:any)=> String(o?.id||"")===id) : null;
  return { type: sp.get("type") || "kitchen", order };
}

export default function PrintPage(){
  const { type, order } = useOrder();
  const s = readSettings();
  const addrLine = order?.customer?.address || order?.addressLine || "";
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addrLine)}`;

  const groups = useMemo(()=>{
    const g: Record<string, any[]> = {};
    for(const it of (order?.items||[])){
      const cat = (it.category || "DIVERSE").toString().toUpperCase();
      if (!g[cat]) g[cat]=[];
      g[cat].push(it);
    }
    return g;
  },[order]);

  if (!order) return <main className="p-6">Order not found.</main>;

  return (
    <main className="p-6 print:p-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-2 mb-3">
        <div className="flex items-center gap-3">
          {s.printing?.logoUrl && (
            <img src={s.printing.logoUrl} alt="logo" width={80} height={80} />
          )}
          <div className="text-xs opacity-70">#{order.id}</div>
        </div>
        <div className="text-2xl font-extrabold">{order.mode==="pickup"?"ABHOLUNG":"LIEFERUNG"}</div>
      </div>

      <div className="text-xs opacity-80 mb-2">{new Date(order.ts).toLocaleString()}</div>

      {/* Kunde / Adressese / QR */}
      <div className="mb-3">
        <div className="font-semibold">{order.customer?.name || order.customerName || "—"}</div>
        <div>{order.customer?.phone || order.phone || "—"}</div>
        {order.mode==="delivery" && (
          <>
            <div className="mt-1">{addrLine}</div>
            {s.printing?.showQR && addrLine && (
              <img
                alt="qr"
                width={160}
                height={160}
                src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(maps)}`}
                className="mt-2"
              />
            )}
            {addrLine && <div className="text-xs opacity-70">{maps}</div>}
          </>
        )}
        {order.mode==="pickup" && order.customer?.note && (
          <div className="mt-2 rounded border p-2 text-sm">{order.customer?.note}</div>
        )}
      </div>

      {/* Items grouped */}
      <div className="mb-3">
        {Object.keys(groups).map((cat)=>(
          <div key={cat} className="mb-2">
            <div className="font-bold">{cat}</div>
            <div className="mt-1 space-y-1">
              {groups[cat].map((it:any,idx:number)=>{
                const addSum = (it.add||[]).reduce((a:number,b:any)=>a+(Number(b?.price)||0),0) || 0;
                const unit = Number(it.price)+addSum;
                return (
                  <div key={idx}>
                    <div className="font-semibold">{it.name} × {it.qty}</div>
                    {(it.add?.length || it.rm?.length) && (
                      <div className="text-xs opacity-80">
                        {it.add?.length? "Extras: "+it.add.map((a:any)=>a.label||a.name).join(", "): ""}
                        {it.rm?.length? " Ohne: "+(it.rm||[]).join(", "): ""}
                      </div>
                    )}
                    {type!=="kitchen" && <div className="text-xs">{fmt(unit * (it.qty||0))}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Summary (skip for kitchen) */}
      {type!=="kitchen" && (
        <div className="mt-3">
          <div>Warenwert: <b>{fmt(Number(order.merchandise||0))}</b></div>
          {Number(order.surcharges||0)>0 && <div>Aufschläge: <b>{fmt(Number(order.surcharges||0))}</b></div>}
          {Number(order.discount||0)>0 && <div>Rabatt: <b>-{fmt(Number(order.discount||0))}</b></div>}
          <div className="text-lg font-bold">Gesamt: {fmt(Number(order.total||0))}</div>
        </div>
      )}

      {s.printing?.footerHinweise && <div className="mt-4 text-xs opacity-70">{s.printing.footerHinweise}</div>}
    </main>
  );
}
