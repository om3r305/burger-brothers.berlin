// app/print/label/[id]/page.tsx
"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { readOrder, StoredOrder } from "@/lib/orders";

function groupItems(items: any[]) {
  // İstersen ürün isimlerine göre grupla; burada düz liste bırakıyoruz
  return items;
}

export default function LabelPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [order, setOrder] = useState<StoredOrder | null>(null);

  useEffect(() => {
    setOrder(readOrder(id));
  }, [id]);

  if (!order) {
    return <div className="p-4 text-sm">Order not found.</div>;
  }

  const isDelivery = order.mode === "delivery";
  const modeLabel = isDelivery ? "Lieferung" : "Abholung";
  const when = new Date(order.ts).toLocaleString();

  const items = groupItems(order.items || []);
  const total = items.reduce(
    (sum: number, it: any) => sum + Number(it.price || 0) * Number(it.qty || 1),
    0
  );

  return (
    <main className="p-4 print:p-2">
      {/* Üst Başlık */}
      <div className="text-center">
        {/* Logon varsa */}
        {/* <Image src="/logo.svg" alt="Burger Brothers" width={120} height={40} className="mx-auto mb-2" /> */}
        <div className="text-2xl font-extrabold tracking-wide">Burger Brothers</div>
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        <div className="font-bold text-xl">{modeLabel}</div>
        <div className="opacity-80">#{order.id}</div>
      </div>

      <div className="mt-1 text-xs opacity-80">{when}</div>

      {/* Ürünler */}
      <div className="mt-3 border-t border-dashed border-stone-400/50 pt-2">
        <div className="text-sm font-semibold mb-1">Artikel</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-1">Name</th>
              <th className="py-1 text-right">Menge</th>
              <th className="py-1 text-right">Summe</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, i: number) => {
              const lineTotal = Number(it.price || 0) * Number(it.qty || 1);
              return (
                <tr key={i} className="align-top">
                  <td className="py-1">
                    <div className="font-medium">{it.name}</div>
                    {Array.isArray(it.add) && it.add.length > 0 && (
                      <div className="text-[11px] opacity-70">
                        Extras: {it.add.map((a: any) => a?.label || a?.name).filter(Boolean).join(", ")}
                      </div>
                    )}
                    {Array.isArray((it as any).rm) && (it as any).rm.length > 0 && (
                      <div className="text-[11px] opacity-70">
                        Ohne: {(it as any).rm.join(", ")}
                      </div>
                    )}
                    {it.note && (
                      <div className="text-[11px] opacity-90">{String(it.note)}</div>
                    )}
                  </td>
                  <td className="py-1 text-right">{it.qty}</td>
                  <td className="py-1 text-right">{lineTotal.toFixed(2)}€</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Tutarlar */}
      <div className="mt-2 border-t border-dashed border-stone-400/50 pt-2 text-sm">
        <div className="flex justify-between">
          <span className="font-medium">Summe</span>
          <span className="font-bold">{total.toFixed(2)}€</span>
        </div>
        {/* İstersen Lieferando komisyonu vb. kalemleri buraya ekle */}
      </div>

      {/* ⬇️ Adresse YOK (GDPR) — QR zaten haritaya götürecek */}

      {/* QR */}
      <div className="mt-4 flex justify-center">
        {/* Sunucudan dinamik PNG QR alıyoruz (token yoksa sunucu üretir) */}
        <img
          src={`/api/qr-image/${encodeURIComponent(order.id)}`}
          alt="QR"
          className="w-40 h-40"
        />
      </div>

      <div className="mt-1 text-center text-[11px] opacity-70">
        QR scannen → Adressese in Google Maps
      </div>
    </main>
  );
}
