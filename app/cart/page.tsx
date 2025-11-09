// app/cart/page.tsx
"use client";

import { useCart } from "@/components/store";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

export default function CartPage() {
  const { items, remove, setQty } = useCart();

  const extrasSum = (add?: Array<{ price?: number }>) =>
    (add ?? []).reduce((a, b) => a + Number(b?.price ?? 0), 0);

  const lineUnit = (i: any) => Number(i.item?.price ?? 0) + extrasSum(i.add);
  const lineQty = (i: any) => Math.max(1, Number(i.qty ?? 1));

  const subtotal = items.reduce((s, i) => s + lineUnit(i) * lineQty(i), 0);
  const discount = subtotal >= 15 ? +(subtotal * 0.1).toFixed(2) : 0;
  const total = +(subtotal - discount).toFixed(2);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <Header />
      <main className="mx-auto max-w-4xl px-4 pb-24">
        <h1 className="my-6 text-2xl font-semibold">Warenkorb</h1>

        <div className="space-y-3">
          {items.map((i) => {
            const qty = lineQty(i);
            const unit = lineUnit(i);
            const addArr = i.add ?? [];
            const rmArr = i.rm ?? [];
            return (
              <div key={i.id} className="rounded-xl border border-stone-700/60 bg-stone-900/50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {i.item?.name} × {qty}
                    </div>
                    {i.item?.description && (
                      <div className="text-sm text-stone-400">{i.item.description}</div>
                    )}
                    {!!rmArr.length && (
                      <div className="text-sm">Ohne: {rmArr.join(", ")}</div>
                    )}
                    {!!addArr.length && (
                      <div className="text-sm">
                        Extras: {addArr.map((a: any) => a?.name ?? a?.label ?? "").join(", ")}
                      </div>
                    )}
                    {!!i.note && (
                      <div className="text-sm italic text-stone-300">Hinweis: {i.note}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm">Einzel: {fmt(unit)}</div>
                    <div className="text-base font-semibold">{fmt(unit * qty)}</div>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-md bg-stone-800 px-2"
                      onClick={() => setQty(i.id, Math.max(1, qty - 1))}
                    >
                      -
                    </button>
                    <span>{qty}</span>
                    <button
                      className="rounded-md bg-stone-800 px-2"
                      onClick={() => setQty(i.id, qty + 1)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="rounded-md bg-stone-700 px-3 py-1"
                    onClick={() => remove(i.id)}
                  >
                    Entfernen
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 space-y-1 text-right">
          <div>
            Zwischensumme: <b>{fmt(subtotal)}</b>
          </div>
          {discount > 0 && (
            <div className="text-emerald-400">Rabatt (10% ab 15€): -{fmt(discount)}</div>
          )}
          <div className="text-xl font-bold">Gesamt: {fmt(total)}</div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
