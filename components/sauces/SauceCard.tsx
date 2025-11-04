// components/sauces/SauceCard.tsx
"use client";

import Image from "next/image";
import { useState } from "react";
import { useCart } from "@/components/store";

type Props = {
  sku: string;
  name: string;
  price: number;
  image?: string | null;          // geri uyumlu
  images?: string[];              // 1–3 görsel kolaj
  coverRatio?: string;            // "4/3" | "16/10" | "1/1" ...
  compact?: boolean;              // boşlukları sıkılaştır
  description?: string | null;
  campaignLabel?: string;
  outOfStock?: boolean;
  disabled?: boolean;

  /** 🆕: Sepetteki gruplama için kategori override */
  category?:
    | "sauces"
    | "donuts"
    | "bubbletea"
    | "burger"
    | "vegan"
    | "extras"
    | "hotdogs"
    | "drinks";
};

const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

export default function SauceCard({
  sku,
  name,
  price,
  image = "/images/sauces/default.jpg",
  images,
  coverRatio = "4/3",
  compact = false,
  description,
  campaignLabel,
  outOfStock = false,
  disabled = false,
  category = "sauces", // ← default sos; Donut/Bubble Tea sayfaları override edecek
}: Props) {
  const addToCart = useCart((s: any) => s.addToCart);
  const [qty, setQty] = useState<number>(1);
  const [note, setHinweise] = useState<string>("");
  const [useNativeImg, setUseNativeImg] = useState<boolean>(false);

  const safeQty = Math.max(1, Number(qty) || 1);

  const onAdd = () => {
    if (disabled || outOfStock) return;

    addToCart({
      category, // ← artık prop’tan geliyor
      item: { sku, name, price, category },
      qty: safeQty,
      note,
    });

    setQty(1);
    setHinweise("");
  };

  // ---- Görseller (tek/çoklu) ----
  const imgs = (Array.isArray(images) && images.length ? images : (image ? [image] : []))
    .filter(Boolean)
    .slice(0, 3);

  const CoverSingle = ({ src }: { src: string }) =>
    useNativeImg ? (
      <img
        src={src}
        alt={name}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
    ) : (
      <Image
        src={src}
        alt={name}
        fill
        sizes="(max-width:768px) 100vw, 33vw"
        className="object-cover"
        onError={() => setUseNativeImg(true)}
        priority={false}
      />
    );

  const CoverCollage = () => {
    if (imgs.length === 2) {
      return (
        <div className="absolute inset-0 grid h-full w-full grid-cols-2 gap-1">
          {imgs.map((src, i) => (
            <div key={i} className="relative">
              <CoverSingle src={src} />
            </div>
          ))}
        </div>
      );
    }
    // 3 görsel: solda büyük, sağda iki küçük
    return (
      <div className="absolute inset-0 grid h-full w-full grid-cols-2 grid-rows-2 gap-1">
        <div className="relative col-span-1 row-span-2">
          <CoverSingle src={imgs[0]} />
        </div>
        <div className="relative">
          <CoverSingle src={imgs[1]} />
        </div>
        <div className="relative">
          <CoverSingle src={imgs[2]} />
        </div>
      </div>
    );
  };

  return (
    <div className={`card relative flex flex-col ${disabled ? "opacity-60" : ""}`} data-sku={sku}>
      {/* Kapak */}
      <div
        className={`relative ${compact ? "mb-2" : "mb-2"} w-full overflow-hidden rounded-xl bg-stone-800/60`}
        style={{ aspectRatio: coverRatio }}
      >
        {imgs.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-stone-400">Kein Bild</div>
        ) : imgs.length === 1 ? (
          <CoverSingle src={imgs[0]} />
        ) : (
          <CoverCollage />
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

        {!outOfStock && (
          <div className="absolute right-2 bottom-2 rounded-full bg-black/70 px-3 py-1 text-sm font-semibold text-white shadow">
            {fmt(price)}
          </div>
        )}
      </div>

      <div className={`${compact ? "mb-0.5" : "mb-1"} text-lg font-semibold`}>{name}</div>

      {!!description && (
        <div
          className={`${compact ? "mb-2" : "mb-2"} text-sm opacity-80`}
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          title={description || undefined}
        >
          {description}
        </div>
      )}

      <label className="mb-1 block text-xs font-medium">Hinweisiz (optional)</label>
      <input
        value={note}
        onChange={(e) => setHinweise(e.target.value)}
        placeholder="z. B."
        className="mb-3 w-full rounded-lg border border-stone-700/60 bg-stone-800/60 p-2 outline-none disabled:opacity-60"
        disabled={disabled}
        aria-label="Hinweisiz"
      />

      {/* CTA */}
      <div className="mt-auto footer flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost h-8 w-8 rounded-full"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            aria-label="Menge verringern"
            disabled={disabled || outOfStock}
          >
            −
          </button>
        <span className="min-w-[2ch] text-center tabular-nums">{safeQty}</span>
          <button
            className="btn-ghost h-8 w-8 rounded-full"
            onClick={() => setQty((q) => q + 1)}
            aria-label="Menge erhöhen"
            disabled={disabled || outOfStock}
          >
            +
          </button>
        </div>

        <button
          className={`card-cta ${disabled || outOfStock ? "pointer-events-none opacity-50" : ""}`}
          onClick={onAdd}
          title={disabled ? "Heute nicht verfügbar" : "Zur Bestellung hinzufügen"}
          aria-disabled={disabled || outOfStock}
        >
          {disabled || outOfStock ? "Nicht verfügbar" : `Hinzufügen • ${fmt(price * safeQty)}`}
        </button>
      </div>
    </div>
  );
}
