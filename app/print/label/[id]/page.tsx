// app/print/label/[id]/page.tsx
"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { readAllOrders } from "@/lib/orders";

/** Yerel, minimal tip (build güvenliği için) */
type OrderItem = {
  name?: string;
  price?: number;
  qty?: number;
  add?: Array<{ label?: string; name?: string; price?: number }>;
  rm?: string[];
  note?: string;
};

type LocalOrder = {
  id: string | number;
  mode?: "pickup" | "delivery" | string;
  ts?: number;
  items?: OrderItem[];
  customer?: {
    name?: string;
    phone?: string;
    address?: string;
  };
};

/** readOrder yoksa: readAllOrders ile bul */
function readOrderById(id: string): LocalOrder | null {
  try {
    const all = (readAllOrders?.() as LocalOrder[]) || [];
    const found = all.find((o) => String(o.id) === String(id));
    return found || null;
  } catch {
    return null;
  }
}

function groupItems(items: any[]) {
  // İstersen ürün isimlerine göre grupla; burada düz liste bırakıyoruz
  return Array.isArray(items) ? items : [];
}

export default function LabelPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [order, setOrder] = useState<LocalOrder | null>(null);

  useEffect(() => {
    setOrder(readOrderById(id));
  }, [id]);

  if (!order) {
    return <div className="p-4 text-sm">Order not found.</div>;
  }

  const isDelivery = order.mode === "delivery";
  const modeLabel = isDelivery ? "Lieferung" : "Abholung";
  const when = order.ts ? new Date(order.ts).toLocaleString() : new Date().toLocaleString();

  const items = groupItems(order.items || []);
  const total = items.reduce(
    (sum: number, it: OrderItem) => sum + Number(it.price || 0) * Number(it.qty || 1),
    0
  );

  return (
    <main className="p-4 print:p-2">
      {/* Üst Başlık */}
      <div className="text-center">
        {/* Eğer logoyu yazdıracaksan: */}
        {/* <Image src="/logo-burger-brothers.png" alt="Burger Brothers" width={120} height={120} className="mx-auto mb-2" /> */}
        <div className="text-2xl font-extrabold tracking-wide">Burger Brothers</div>
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        <div className="font-bold text-xl">{modeLabel}</div>
        <div className="opacity-80">#{String(order.id)}</div>
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
            {items.map((it: OrderItem, i: number) => {
              const lineTotal = Number(it.price || 0) * Number(it.qty || 1);
              const add = Array.isArray(it.add) ? it.add : [];
              const rm = Array.isArray(it.rm) ? it.rm : [];
              return (
                <tr key={i} className="align-top">
                  <td className="py-1">
                    <div className="font-medium">{it.name}</div>
                    {add.length > 0 && (
                      <div className="text-[11px] opacity-70">
                        Extras: {add.map((a) => a?.label || a?.name).filter(Boolean).join(", ")}
                      </div>
                    )}
                    {rm.length > 0 && (
                      <div className="text-[11px] opacity-70">Ohne: {rm.join(", ")}</div>
                    )}
                    {it.note && <div className="text-[11px] opacity-90">{String(it.note)}</div>}
                  </td>
                  <td className="py-1 text-right">{it.qty ?? 1}</td>
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
      </div>

      {/* QR */}
      <div className="mt-4 flex justify-center">
        <img
          src={`/api/qr-image/${encodeURIComponent(String(order.id))}`}
          alt="QR"
          className="w-40 h-40"
        />
      </div>

      <div className="mt-1 text-center text-[11px] opacity-70">
        QR scannen → Adresse in Google Maps
      </div>
    </main>
  );
}
