"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useCart } from "@/components/store";

/* ==== Tipler ==== */
type Variant = {
  id: string;
  name: string;
  price: number;
  image?: string;
  /** admin’den gelebilecek alanlar */
  active?: boolean;
  startAt?: string; // ISO
  endAt?: string;   // ISO
};

type Props = {
  sku: string;
  name: string;
  description?: string;
  image?: string;
  variants: Variant[];
  category?: "burger" | "vegan" | "extras" | "sauces" | "drinks" | "hotdogs";
  campaignLabel?: string;
  outOfStock?: boolean;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

export default function VariantGroupCard({
  sku,
  name,
  description,
  image,
  variants,
  category,
  campaignLabel,
  outOfStock = false,
}: Props) {
  const addToCart = useCart((s: any) => s.addToCart);

  const [open, setOpen] = useState(false);
  const [note, setHinweise] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [fallback, setFallback] = useState(false);

  const cat: NonNullable<Props["category"]> = (category ?? "drinks") as any;

  /** 🔐 Varyant erişilebilir mi? (aktif + tarih aralığı) */
  const isVAvail = (v: Variant) => {
    const now = Date.now();
    const s = v.startAt ? Date.parse(v.startAt) : NaN;
    const e = v.endAt ? Date.parse(v.endAt) : NaN;

    if (v.active === false) return false;
    if (!Number.isNaN(s) && now < s) return false;
    if (!Number.isNaN(e) && now > e) return false;
    return true;
  };

  const totals = useMemo(() => {
    let count = 0, price = 0;
    for (const v of variants) {
      const q = counts[v.id] || 0;
      count += q;
      price += q * v.price;
    }
    return { count, price };
  }, [counts, variants]);

  const inc = (id: string) => setCounts((s) => ({ ...s, [id]: (s[id] || 0) + 1 }));
  const dec = (id: string) => setCounts((s) => ({ ...s, [id]: Math.max(0, (s[id] || 0) - 1) }));
  const reset = () => { setCounts({}); setHinweise(""); };

  const handleAdd = () => {
    variants.forEach((v) => {
      const qty = counts[v.id] || 0;
      if (qty > 0 && isVAvail(v)) {
        addToCart({
          category: cat,
          item: {
            sku: `${sku}-${v.id}`,
            name: `${name} – ${v.name}`,
            price: v.price,
            category: cat,
            ...(v.image ? { imageUrl: v.image } : {}),
          },
          add: [],
          rm: [],
          qty,
          note: note || undefined,
        });
      }
    });
    reset();
    setOpen(false);
  };

  // Modal ESC + body scroll lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <article className="card product-card p-4 flex flex-col min-h-[380px]">
      {/* ==== BODY ==== */}
      <div className="product-card__body">
        {/* Kapak — h-48 ile daha büyük görsel */}
        <div className="relative mb-2 h-48 w-full overflow-hidden rounded-xl bg-stone-800/50">
          {image ? (
            fallback ? (
              <img src={image} alt={name} className="h-full w-full object-cover" />
            ) : (
              <Image
                src={image}
                alt={name}
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover"
                onError={() => setFallback(true)}
              />
            )
          ) : (
            <div className="absolute inset-0 grid place-items-center text-stone-400">Kein Bild</div>
          )}

          {campaignLabel && (
            <div className="pointer-events-none absolute left-2 top-2 rounded-full border border-amber-300/60 bg-amber-400 px-3 py-1 text-xs font-semibold text-black shadow">
              {campaignLabel}
            </div>
          )}
          {outOfStock && (
            <div className="pointer-events-none absolute right-2 top-2 rounded-full border border-rose-300/70 bg-rose-500 px-3 py-1 text-xs font-semibold text-white shadow">
              Heute nicht verfügbar
            </div>
          )}
        </div>

        {/* Başlık + açıklama (daha sıkı boşluklar) */}
        <div className="mb-1 text-lg font-semibold">{name}</div>
        {!!description && (
          <p className="mb-2 text-sm opacity-80" style={{display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}} title={description}>
            {description}
          </p>
        )}
      </div>

      {/* ==== CTA (alta sabit) ==== */}
      <div className="product-card__cta mt-auto">
        <button
          className={`card-cta card-cta--lg w-full ${outOfStock ? "pointer-events-none opacity-50" : ""}`}
          onClick={() => !outOfStock && setOpen(true)}
        >
          {outOfStock ? "Nicht verfügbar" : "Auswählen"}
        </button>
      </div>

      {/* ==== MODAL ==== */}
      {open && !outOfStock && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setOpen(false)} role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-2xl border border-stone-700/60 bg-stone-900/95 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">{name}</div>
              <button className="btn-ghost" onClick={() => setOpen(false)}>Schließen</button>
            </div>

            <div className="space-y-3">
              {variants.map((v) => {
                const avail = isVAvail(v);
                return (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between rounded-xl border p-3 ${avail ? "border-stone-700/40 bg-stone-900/60" : "border-stone-800/50 bg-stone-900/40 opacity-60"}`}
                  >
                    <div>
                      <div className="text-sm font-medium">
                        {v.name}
                        {!avail && (
                          <span className="ml-2 rounded-full bg-stone-700/60 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                            Nicht verfügbar
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-stone-400">{fmt(v.price)}</div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="w-20 text-right text-sm text-stone-300">
                        {fmt((counts[v.id] || 0) * v.price)}
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="qty" onClick={() => avail && dec(v.id)} disabled={!avail}>−</button>
                        <span className="w-8 text-center">{counts[v.id] || 0}</span>
                        <button className="qty" onClick={() => avail && inc(v.id)} disabled={!avail}>+</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium">Hinweisiz (optional)</label>
              <input
                value={note}
                onChange={(e) => setHinweise(e.target.value)}
                className="w-full rounded-lg border border-stone-700/60 bg-stone-800/60 p-2 outline-none"
                placeholder="z. B. ohne Eis / ohne Salz"
              />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button className="btn-ghost" onClick={reset}>Alles zurücksetzen</button>
              <button className="card-cta" disabled={totals.count === 0} onClick={handleAdd}>
                Hinzufügen – {totals.count} Artikel • {fmt(totals.price)}
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
