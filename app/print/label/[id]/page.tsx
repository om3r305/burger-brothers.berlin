// app/print/label/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";

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
  orderId?: string;
  mode?: "pickup" | "delivery" | string;
  ts?: number;
  createdAt?: string;
  items?: OrderItem[];
  customer?: {
    name?: string;
    phone?: string;
    address?: string;
    addressLine?: string;
  };
  total?: number;
  merchandise?: number;
};

function normalizeOrder(raw: any): LocalOrder {
  const order = raw?.order && typeof raw.order === "object" ? raw.order : {};
  const customer =
    raw?.customer && typeof raw.customer === "object"
      ? raw.customer
      : order?.customer && typeof order.customer === "object"
        ? order.customer
        : {};

  const ts =
    typeof raw?.ts === "number"
      ? raw.ts
      : raw?.ts
        ? new Date(raw.ts).getTime()
        : raw?.createdAt
          ? new Date(raw.createdAt).getTime()
          : Date.now();

  return {
    id: String(raw?.id || raw?.orderId || ""),
    orderId: String(raw?.orderId || raw?.id || ""),
    mode: raw?.mode || order?.mode || "delivery",
    ts: Number.isFinite(ts) ? ts : Date.now(),
    createdAt: raw?.createdAt,
    items: Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(order?.items)
        ? order.items
        : [],
    customer: {
      ...customer,
      name: customer?.name ?? raw?.customerName ?? "",
      phone: customer?.phone ?? raw?.phone ?? "",
      address:
        customer?.address ??
        customer?.addressLine ??
        raw?.addressLine ??
        "",
      addressLine:
        customer?.addressLine ??
        customer?.address ??
        raw?.addressLine ??
        "",
    },
    total: Number(raw?.total ?? order?.total ?? 0),
    merchandise: Number(raw?.merchandise ?? order?.merchandise ?? 0),
  };
}

/** DB API’den siparişi oku */
async function readOrderById(id: string): Promise<LocalOrder | null> {
  try {
    const res = await fetch("/api/orders/list?scope=all&includeDone=1&take=1000", {
      cache: "no-store",
    });

    if (!res.ok) return null;

    const data = await res.json();

    const all = Array.isArray(data)
      ? data
      : Array.isArray(data?.orders)
        ? data.orders
        : Array.isArray(data?.items)
          ? data.items
          : [];

    const found = all.find((o: any) => String(o?.id || o?.orderId) === String(id));
    return found ? normalizeOrder(found) : null;
  } catch {
    return null;
  }
}

function groupItems(items: any[]) {
  return Array.isArray(items) ? items : [];
}

export default function LabelPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [order, setOrder] = useState<LocalOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      const found = await readOrderById(id);
      if (alive) {
        setOrder(found);
        setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) {
    return <div className="p-4 text-sm">Bestellung wird geladen...</div>;
  }

  if (!order) {
    return <div className="p-4 text-sm">Bestellung nicht gefunden.</div>;
  }

  const isDelivery = order.mode === "delivery";
  const modeLabel = isDelivery ? "Lieferung" : "Abholung";
  const when = order.ts ? new Date(order.ts).toLocaleString() : new Date().toLocaleString();

  const items = groupItems(order.items || []);
  const computedTotal = items.reduce(
    (sum: number, it: OrderItem) => sum + Number(it.price || 0) * Number(it.qty || 1),
    0
  );

  const total = Number(order.total || order.merchandise || computedTotal || 0);

  return (
    <main className="p-4 print:p-2">
      {/* Üst Başlık */}
      <div className="text-center">
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