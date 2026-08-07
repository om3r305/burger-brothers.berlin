"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useCart } from "@/components/store";
import {
  optimizedLocalImageUrl,
  restoreLocalImageFallback,
} from "@/lib/media/local-optimized-image";

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
  pfandType?: "none" | "einweg" | "mehrweg" | "custom" | string;
  pfandAmount?: number;
  depositType?: string;
  depositAmount?: number;
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
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const cat: NonNullable<Props["category"]> = (category ?? "drinks") as any;
  const displayImage = optimizedLocalImageUrl(image) || image || "";

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
            pfandType: v.pfandType ?? v.depositType ?? "none",
            pfandAmount: Number(v.pfandAmount ?? v.depositAmount ?? 0) || 0,
            depositType: v.depositType ?? v.pfandType ?? "none",
            depositAmount: Number(v.depositAmount ?? v.pfandAmount ?? 0) || 0,
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

  // Modal ESC + gerçek mobil viewport scroll kilidi
  useEffect(() => {
    if (!portalReady || !open) return;

    const body = document.body;
    const root = document.documentElement;
    const scrollY = window.scrollY;
    const hadRootClass = root.classList.contains("bb-modal-open");
    const hadBodyClass = body.classList.contains("bb-modal-open");
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscroll = root.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousBodyPosition = body.style.position;
    const previousBodyTop = body.style.top;
    const previousBodyLeft = body.style.left;
    const previousBodyRight = body.style.right;
    const previousBodyWidth = body.style.width;
    const previousBodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);

    root.classList.add("bb-modal-open");
    body.classList.add("bb-modal-open");
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      if (!hadRootClass) root.classList.remove("bb-modal-open");
      if (!hadBodyClass) body.classList.remove("bb-modal-open");
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscroll;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      body.style.position = previousBodyPosition;
      body.style.top = previousBodyTop;
      body.style.left = previousBodyLeft;
      body.style.right = previousBodyRight;
      body.style.width = previousBodyWidth;
      body.style.paddingRight = previousBodyPaddingRight;
      window.scrollTo(0, scrollY);
    };
  }, [open, portalReady]);

  return (
    <article className="card product-card p-4 flex flex-col min-h-[380px]">
      {/* ==== BODY ==== */}
      <div className="product-card__body">
        {/* Kapak — h-48 ile daha büyük görsel */}
        <div className="bb-menu-product-cover relative mb-2 h-48 w-full overflow-hidden rounded-xl">
          {displayImage ? (
            <Image
              src={displayImage}
              alt={name}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              className="object-cover"
              onError={(event) =>
                restoreLocalImageFallback(event.currentTarget, image)
              }
            />
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
      {portalReady && open && !outOfStock
        ? createPortal(
            <div
              className="bb-product-modal fixed inset-0 flex items-center justify-center overflow-hidden bg-black/70 backdrop-blur-[2px]"
              style={{
                zIndex: 2147482500,
                paddingTop: "max(12px, env(safe-area-inset-top))",
                paddingRight: "max(12px, env(safe-area-inset-right))",
                paddingBottom: "max(12px, env(safe-area-inset-bottom))",
                paddingLeft: "max(12px, env(safe-area-inset-left))",
              }}
              onClick={() => setOpen(false)}
              role="dialog"
              aria-modal="true"
              aria-label={`${name} auswählen`}
            >
              <div
                className="bb-modal-shell w-full max-w-2xl overflow-hidden rounded-2xl border border-stone-700/60 bg-stone-900/95"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="shrink-0 border-b border-stone-700/60 px-4 pb-3 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 text-lg font-semibold leading-tight">
                      {name}
                    </div>
                    <button
                      type="button"
                      className="btn-ghost shrink-0"
                      onClick={() => setOpen(false)}
                    >
                      Schließen
                    </button>
                  </div>
                </div>

                <div
                  className="bb-modal-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3"
                  style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
                >
                  <div className="space-y-3">
                    {variants.map((v) => {
                      const avail = isVAvail(v);
                      return (
                        <div
                          key={v.id}
                          className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${avail ? "border-stone-700/40 bg-stone-900/60" : "border-stone-800/50 bg-stone-900/40 opacity-60"}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="break-words text-sm font-medium">
                              {v.name}
                              {!avail && (
                                <span className="ml-2 rounded-full bg-stone-700/60 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                                  Nicht verfügbar
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-stone-400">{fmt(v.price)}</div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                            <div className="hidden w-20 text-right text-sm text-stone-300 min-[390px]:block">
                              {fmt((counts[v.id] || 0) * v.price)}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="qty"
                                onClick={() => avail && dec(v.id)}
                                disabled={!avail}
                              >
                                −
                              </button>
                              <span className="w-8 text-center">{counts[v.id] || 0}</span>
                              <button
                                type="button"
                                className="qty"
                                onClick={() => avail && inc(v.id)}
                                disabled={!avail}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-medium">Hinweis (optional)</label>
                    <input
                      value={note}
                      onChange={(e) => setHinweise(e.target.value)}
                      className="w-full rounded-lg border border-stone-700/60 bg-stone-800/60 p-2 outline-none"
                      placeholder="z. B. ohne Eis / ohne Salz"
                    />
                  </div>
                </div>

                <div className="bb-modal-footer shrink-0 border-t border-stone-700/60 bg-stone-900/95 px-4 pt-3">
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" className="btn-ghost w-full sm:w-auto" onClick={reset}>
                      Alles zurücksetzen
                    </button>
                    <button
                      type="button"
                      className="card-cta w-full sm:w-auto"
                      disabled={totals.count === 0}
                      onClick={handleAdd}
                    >
                      Hinzufügen – {totals.count} Artikel • {fmt(totals.price)}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </article>
  );
}
