"use client";

import Image from "next/image";
import { useState } from "react";
import { useCart } from "@/components/store";

type Props = {
  sku: string;
  name: string;
  price: number;
  description?: string | null;
  image?: string | null;
  campaignLabel?: string;
  outOfStock?: boolean;
  disabled?: boolean;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

export default function ExtraCard({
  sku,
  name,
  price,
  description,
  image = "/images/extras/default.jpg",
  campaignLabel,
  outOfStock = false,
  disabled = false,
}: Props) {
  const addToCart = useCart((s: any) => s.addToCart);
  const [qty, setQty] = useState(1);
  const [note, setHinweise] = useState("");
  const [fallback, setFallback] = useState(false);

  const safeQty = Math.max(1, Number(qty) || 1);
  const lineTotal = price * safeQty;

  const handleAdd = () => {
    if (disabled || outOfStock) return;

    addToCart({
      id: `${sku}`,
      sku,
      name,
      price,                       // root price
      qty: safeQty,
      note,
      category: "extras",
      item: {                      // CartSummary uyumluluğu
        sku,
        name,
        price,
      },
    });

    setQty(1);
    setHinweise("");
  };

  return (
    <div
      className={`card relative flex min-h-[420px] flex-col ${disabled ? "opacity-60" : ""}`}
      data-sku={sku}
    >
      {/* Kapak + Badgeler */}
      <div className="cover relative mb-3 h-40 w-full overflow-hidden rounded-xl bg-stone-800/50">
        {fallback ? (
          <img
            src={image || "/logo-burger-brothers.png"}
            alt={name}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <Image
            src={image || "/logo-burger-brothers.png"}
            alt={name}
            fill
            className="object-cover"
            sizes="(max-width:768px) 100vw, 33vw"
            priority={false}
            onError={() => setFallback(true)}
          />
        )}

        {!!campaignLabel && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-amber-400 px-3 py-1 text-xs font-semibold text-black shadow">
            {campaignLabel}
          </div>
        )}
        {outOfStock && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-rose-500 px-3 py-1 text-xs font-semibold text-white shadow">
            Heute nicht verfügbar
          </div>
        )}
      </div>

      <div className="mb-1 text-lg font-semibold">{name}</div>

      {!!description && (
        <div
          className="mb-3 text-sm opacity-80"
          style={{ display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}
          title={description || undefined}
        >
          {description}
        </div>
      )}

      {!outOfStock && <div className="mb-2 text-sm opacity-90">{fmt(price)}</div>}

      <label className="mb-1 block text-xs font-medium">Hinweisiz (optional)</label>
      <input
        value={note}
        onChange={(e) => setHinweise(e.target.value)}
        placeholder="z. B. "
        className="mb-3 w-full rounded-lg border border-stone-700/60 bg-stone-800/60 p-2 outline-none disabled:opacity-60"
        disabled={disabled}
        aria-label="Hinweisiz für Extra"
      />

      {/* CTA — dibe sabit */}
      <div className="mt-auto footer flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost h-8 w-8 rounded-full"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            aria-label="Menge verringern"
            disabled={disabled || outOfStock}
          >−</button>
          <span className="min-w-[2ch] text-center tabular-nums">{safeQty}</span>
          <button
            className="btn-ghost h-8 w-8 rounded-full"
            onClick={() => setQty((q) => q + 1)}
            aria-label="Menge erhöhen"
            disabled={disabled || outOfStock}
          >+</button>
        </div>

        <button
          className={`card-cta ${disabled || outOfStock ? "pointer-events-none opacity-50" : ""}`}
          onClick={handleAdd}
          title={disabled ? "Heute nicht verfügbar" : "Zur Bestellung hinzufügen"}
          aria-disabled={disabled || outOfStock}
        >
          {disabled || outOfStock ? "Nicht verfügbar" : `Hinzufügen – ${fmt(lineTotal)}`}
        </button>
      </div>
    </div>
  );
}
