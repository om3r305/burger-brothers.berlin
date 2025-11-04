"use client";

import Image from "next/image";
import { useState } from "react";
import { useCart } from "@/components/store";

type ExtraInput =
  | { id: string; label: string; price?: number }
  | { id: string; name: string; price?: number };

type Props = {
  sku: string;
  name: string;
  price: number;
  originalPrice?: number;
  description?: string;
  extrasOptions?: ExtraInput[];
  image?: string;
  images?: string[];
  coverRatio?: string;
  compact?: boolean;
  category?: "burger" | "vegan" | "extras" | "sauces" | "drinks" | "hotdogs";
  outOfStock?: boolean;
  campaignLabel?: string;
  topSellerRank?: 1 | 2 | 3; // rozet
  allergens?: string[];
  allergenHinweise?: string;
};

type Extra = { id: string; label: string; price?: number };
type PerItemConfig = { extras: Extra[]; note: string };

const ALLERGEN_LEGEND: Record<string, string> = {
  A: "Glutenhaltiges Getreide",
  A1: "Weizen",
  A2: "Roggen",
  A3: "Gerste",
  A4: "Hafer",
  A5: "Dinkel",
  B: "Krebstiere",
  C: "Eier",
  D: "Fisch",
  E: "Erdnüsse",
  F: "Soja",
  G: "Milch (inkl. Laktose)",
  H: "Schalenfrüchte (z. B. Mandeln, Haselnüsse)",
  L: "Sellerie",
  M: "Senf",
  N: "Sesam",
  O: "Schwefeldioxid/Sulfite",
  P: "Lupinen",
  R: "Weichtiere",
};

const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

/* ====== Görsel madalya rozeti (PNG) + failover CSS medal ====== */
function MedalBadgeImage({
  rank,
  offsetTop,
}: {
  rank: 1 | 2 | 3;
  offsetTop: number;
}) {
  const sizeMap: Record<1 | 2 | 3, number> = { 1: 70, 2: 55, 3: 40 };
  const srcMap: Record<1 | 2 | 3, string> = {
    1: "/badges/medal-gold.png",
    2: "/badges/medal-silver.png",
    3: "/badges/medal-bronze.png",
  };
  const [fail, setFail] = useState(false);

  if (!fail) {
    return (
      <div
        className="pointer-events-none absolute right-2 z-10"
        style={{ top: offsetTop }}
        aria-hidden
      >
        {/* “kurdele” için küçük bir gölge tabanı */}
        <div
          style={{
            width: sizeMap[rank] * 0.6,
            height: 8,
            borderRadius: 4,
            background: "linear-gradient(90deg,rgba(0,0,0,.25),rgba(0,0,0,.15))",
            filter: "blur(1px)",
            opacity: 0.35,
            margin: "0 auto 2px auto",
          }}
        />
        <div
          style={{
            position: "relative",
            width: sizeMap[rank],
            height: sizeMap[rank],
          }}
        >
          <Image
            src={srcMap[rank]}
            alt={rank === 1 ? "Gold medal" : rank === 2 ? "Löschenver medal" : "Bronze medal"}
            fill
            sizes="48px"
            onError={() => setFail(true)}
            priority={false}
            style={{ objectFit: "contain" }}
          />
        </div>
      </div>
    );
  }

  // ---- PNG bulunamazsa: zarif CSS yedek rozet ----
  const gradient =
    rank === 1
      ? "linear-gradient(135deg,#F7D774,#C99817)"
      : rank === 2
      ? "linear-gradient(135deg,#E6EAED,#9AA3A8)"
      : "linear-gradient(135deg,#E8C3A1,#A66A33)";

  const shadow =
    rank === 1
      ? "0 2px 8px rgba(201,152,23,0.35)"
      : rank === 2
      ? "0 2px 8px rgba(154,163,168,0.35)"
      : "0 2px 8px rgba(166,106,51,0.35)";

  const size = sizeMap[rank];

  return (
    <div
      className="pointer-events-none absolute right-2 z-10"
      style={{ top: offsetTop }}
      aria-hidden
    >
      <div
        style={{
          width: size * 0.6,
          height: 8,
          background:
            rank === 1
              ? "linear-gradient(90deg,#C99817,#E8BE43)"
              : rank === 2
              ? "linear-gradient(90deg,#9AA3A8,#C9D1D6)"
              : "linear-gradient(90deg,#A66A33,#C58B57)",
          clipPath: "polygon(0 0, 100% 0, 85% 100%, 15% 100%)",
          margin: "0 auto 4px auto",
          opacity: 0.95,
          boxShadow: shadow,
        }}
      />
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "999px",
          background: gradient,
          boxShadow: shadow,
          border: "1px solid rgba(0,0,0,0.25)",
          display: "grid",
          placeItems: "center",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 3,
            borderRadius: "999px",
            border: "2px solid rgba(255,255,255,0.35)",
            opacity: 0.9,
          }}
        />
        <span
          style={{
            fontWeight: 800,
            fontSize: 16,
            color: "rgba(0,0,0,0.8)",
            textShadow: "0 1px 0 rgba(255,255,255,0.5)",
          }}
        >
          {rank}
        </span>
      </div>
    </div>
  );
}
/* ====================================================== */

export default function ProductCard({
  sku,
  name,
  price,
  originalPrice,
  description,
  extrasOptions = [],
  image,
  images,
  coverRatio = "16/10",
  compact = false,
  category,
  outOfStock = false,
  campaignLabel,
  topSellerRank,
  allergens = [],
  allergenHinweise,
}: Props) {
  const addToCart = useCart((s: any) => s.addToCart);

  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [items, setItems] = useState<PerItemConfig[]>([{ extras: [], note: "" }]);
  const [active, setActive] = useState(0);
  const [useNativeImg, setUseNativeImg] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  const normalizedExtras: Extra[] = (extrasOptions as any[]).map((e) => ({
    id: String(e?.id ?? ""),
    label: String((e as any)?.label ?? (e as any)?.name ?? ""),
    price: Number.isFinite(Number((e as any)?.price)) ? Number((e as any)?.price) : undefined,
  }));

  const syncQty = (nextQty: number) => {
    const n = Math.max(1, nextQty);
    setQty(n);
    setItems((prev) => {
      const copy = [...prev];
      if (n > copy.length) while (copy.length < n) copy.push({ extras: [], note: "" });
      else if (n < copy.length) copy.length = n;
      if (active > n - 1) setActive(n - 1);
      return copy;
    });
  };

  const toggleExtra = (idx: number, e: Extra) => {
    setItems((arr) =>
      arr.map((cfg, i) => {
        if (i !== idx) return cfg;
        const exists = cfg.extras.find((x) => x.id === e.id);
        return { ...cfg, extras: exists ? cfg.extras.filter((x) => x.id !== e.id) : [...cfg.extras, e] };
      })
    );
  };

  const setHinweise = (idx: number, note: string) =>
    setItems((arr) => arr.map((cfg, i) => (i === idx ? { ...cfg, note } : cfg)));

  const unitPrice = (cfg: PerItemConfig) => price + cfg.extras.reduce((a, e) => a + (e.price || 0), 0);
  const totalPrice = items.reduce((sum, cfg) => sum + unitPrice(cfg), 0);

  const addSameForAll = () => {
    const first = items[0];
    addToCart({
      category,
      item: { sku, name, price, ...(category ? { category } : {}), ...(allergens?.length ? { allergens } : {}), ...(description ? { description } : {}) },
      add: first.extras.map((e) => ({ id: e.id, label: e.label, price: e.price || 0 })),
      rm: [],
      qty,
      note: first.note,
    });
    closeReset();
  };

  const addAllIndividually = () => {
    type Group = { add: Extra[]; note: string; qty: number };
    const groups = new Map<string, Group>();
    const keyOf = (cfg: PerItemConfig) => {
      if (cfg.extras.length === 0 && !cfg.note) return "base::";
      const ids = [...cfg.extras].sort((a, b) => a.id.localeCompare(b.id)).map((e) => `${e.id}:${e.price || 0}`).join("|");
      return `${ids}::${cfg.note || ""}`;
    };
    items.forEach((cfg) => {
      const k = keyOf(cfg);
      const g = groups.get(k);
      if (g) g.qty += 1;
      else groups.set(k, { add: cfg.extras, note: cfg.note, qty: 1 });
    });
    for (const [, g] of groups) {
      addToCart({
        category,
        item: { sku, name, price, ...(category ? { category } : {}), ...(allergens?.length ? { allergens } : {}), ...(description ? { description } : {} ) },
        add: g.add.map((e) => ({ id: e.id, label: e.label, price: e.price || 0 })),
        rm: [],
        qty: g.qty,
        note: g.note,
      });
    }
    closeReset();
  };

  const closeReset = () => {
    setOpen(false);
    setQty(1);
    setItems([{ extras: [], note: "" }]);
    setActive(0);
  };

  const hasStrike = typeof originalPrice === "number" && originalPrice > price;

  // Görseller
  const imgs = (Array.isArray(images) && images.length ? images : (image ? [image] : []))
    .filter(Boolean)
    .slice(0, 3);

  const CoverSingle = ({ src }: { src: string }) =>
    useNativeImg ? (
      <img src={src} alt={name} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
    ) : (
      <Image src={src} alt={name} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" onError={() => setUseNativeImg(true)} />
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
    return (
      <div className="absolute inset-0 grid h-full w-full grid-cols-2 grid-rows-2 gap-1">
        <div className="relative col-span-1 row-span-2"><CoverSingle src={imgs[0]} /></div>
        <div className="relative"><CoverSingle src={imgs[1]} /></div>
        <div className="relative"><CoverSingle src={imgs[2]} /></div>
      </div>
    );
  };

  // outOfStock etiketi sağ-üstte olduğundan, madalyanın üstten offset’i dinamik
  const medalOffset = outOfStock ? 48 : 8;

  // Başlıkta minik emoji
  const emoji =
    topSellerRank === 1 ? "" : topSellerRank === 2 ? "" : topSellerRank === 3 ? "" : "";

  return (
    <article className={`card product-card ${compact ? "p-3" : "p-4"} h-full flex flex-col`} data-sku={sku}>
      {/* ==== BODY ==== */}
      <div className="product-card__body flex-1 flex flex-col">
        {/* Kapak */}
        <div className={`cover relative ${compact ? "mb-2" : "mb-3"} overflow-hidden rounded-xl bg-stone-800/50`} style={{ aspectRatio: coverRatio }}>
          {imgs.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center text-stone-400">Kein Bild</div>
          ) : imgs.length === 1 ? (
            <CoverSingle src={imgs[0]} />
          ) : (
            <CoverCollage />
          )}

          {/* Sol-üst: Kampanya etiketi */}
          {campaignLabel && (
            <div className="pointer-events-none absolute left-2 top-2 rounded-full border border-amber-300/60 bg-amber-400 px-3 py-1 text-xs font-semibold text-black shadow">
              {campaignLabel}
            </div>
          )}

          {/* Sağ-üst: “Bugün yok” etiketi */}
          {outOfStock && (
            <div className="pointer-events-none absolute right-2 top-2 rounded-full border border-rose-300/70 bg-rose-500 px-3 py-1 text-xs font-semibold text-white shadow">
              Heute nicht verfügbar
            </div>
          )}

          {/* Sağ-üst: Madalya (PNG → failover CSS) */}
          {typeof topSellerRank === "number" && topSellerRank >= 1 && topSellerRank <= 3 && (
            <MedalBadgeImage rank={topSellerRank} offsetTop={medalOffset} />
          )}

          {/* Sağ-alt: Fiyat */}
          <div className="absolute right-2 bottom-2 rounded-full bg-black/70 px-3 py-1 text-sm font-semibold text-white shadow">
            {hasStrike && <span className="mr-2 align-middle text-xs font-normal text-stone-300 line-through">{fmt(originalPrice!)}</span>}
            <span>{fmt(price)}</span>
          </div>
        </div>

        {/* Başlık */}
        <div className="product-card__title mb-1 text-lg font-semibold">
          {name}
          {emoji}
        </div>

        {/* Alerjenler */}
        {Array.isArray(allergens) && allergens.length > 0 && (
          <div className={`${compact ? "mb-1.5" : "mb-2"} flex flex-wrap items-center gap-1`}>
            {allergens.map((a, i) => (
              <span
                key={`${a}-${i}`}
                className="rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-0.5 text-xs font-medium text-stone-200"
                title={ALLERGEN_LEGEND[a] || "Allergen"}
              >
                {String(a).trim()}
              </span>
            ))}
            {allergenHinweise && (
              <button type="button" className="ml-1 rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-0.5 text-xs text-stone-200 hover:bg-stone-800" onClick={() => setShowLegend(true)} aria-label="Produktspezifische Allergen-Hinweise" title="Produktspezifische Allergen-Hinweise">?</button>
            )}
            <button type="button" className="ml-1 rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-0.5 text-xs text-stone-200 hover:bg-stone-800" onClick={() => setShowLegend(true)} aria-label="Allergen-Information" title="Allergen-Information">ℹ️ Allergene</button>
          </div>
        )}

        {/* Açıklama */}
        {description ? (
          <p className="product-card__desc text-sm opacity-80" title={description}>{description}</p>
        ) : (
          <span className="product-card__desc product-card__desc--empty" />
        )}
      </div>

      {/* CTA */}
      <div className="product-card__cta mt-auto">
        <button
          className={`card-cta card-cta--lg w-full ${outOfStock ? "pointer-events-none opacity-50" : ""}`}
          onClick={() => !outOfStock && setOpen(true)}
          aria-label={`${name} anpassen und in den Warenkorb`}
          title={outOfStock ? "Heute nicht verfügbar" : undefined}
        >
          {outOfStock ? "Nicht verfügbar" : "Anpassen & In den Warenkorb"}
        </button>
      </div>

      {/* Modal */}
      {open && !outOfStock && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={closeReset}>
          <div className="w-full max-w-2xl rounded-2xl border border-stone-700/60 bg-stone-900/95 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">{name}</div>
              <button className="btn-ghost" onClick={closeReset}>Schließen</button>
            </div>

            {Array.isArray(allergens) && allergens.length > 0 && (
              <div className="mb-2 text-xs text-stone-300">
                <span className="mr-1 font-medium text-stone-200">Allergene:</span>
                {allergens.map((a) => `${a}${ALLERGEN_LEGEND[a] ? ` (${ALLERGEN_LEGEND[a]})` : ""}`).join(", ")}
              </div>
            )}
            {allergenHinweise && (
              <div className="mb-3 rounded-lg border border-stone-700/60 bg-stone-800/40 p-2 text-xs text-stone-200">
                <span className="font-medium">Hinweis zu diesem Produkt:</span> {allergenHinweise}
              </div>
            )}

            {/* Menge */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button className="qty" onClick={() => syncQty(qty - 1)}>−</button>
                <span className="w-8 text-center">{qty}</span>
                <button className="qty" onClick={() => syncQty(qty + 1)}>+</button>
              </div>
              <div className="text-sm opacity-90">Gesamt: <b>{fmt(totalPrice)}</b></div>
            </div>

            {/* Tabs */}
            <div className="mb-3 flex flex-wrap gap-2">
              {Array.from({ length: qty }).map((_, i) => (
                <button key={i} className={`pill ${i === active ? "active" : ""}`} onClick={() => setActive(i)}>
                  {i + 1}. {category === "vegan" ? "Burger (vegan)" : "Burger"}
                </button>
              ))}
            </div>

            {/* Editor */}
            <div className="rounded-xl border border-stone-700/60 bg-stone-800/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium">{active + 1}. — Einzelpreis: {fmt(unitPrice(items[active]))}</div>
                {!!items[active].extras.length && (
                  <div className="text-xs opacity-80">Extras: {items[active].extras.map((e) => e.label).join(", ")}</div>
                )}
              </div>

              {!!normalizedExtras.length && (
                <>
                  <div className="mb-2 text-sm font-medium">Extras</div>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {normalizedExtras.map((e) => {
                      const activeOnThis = !!items[active].extras.find((x) => x.id === e.id);
                      return (
                        <button key={e.id} className={`pill ${activeOnThis ? "active" : ""}`} onClick={() => toggleExtra(active, e)}>
                          {e.label} {typeof e.price === "number" ? `(+${fmt(e.price)})` : ""}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="mb-2 text-sm font-medium">Hinweisiz</div>
              <input
                value={items[active].note}
                onChange={(ev) => setHinweise(active, ev.target.value)}
                className="w-full rounded-lg border border-stone-700/60 bg-stone-800/60 p-2 outline-none"
                placeholder="z. B. gut durchgebraten / ohne Zwiebel"
              />
            </div>

            {/* CTAs */}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button className="btn-ghost" onClick={addSameForAll}>Alle {qty} mit gleicher Einstellung – {fmt(unitPrice(items[0]) * qty)}</button>
              <button className="card-cta" onClick={addAllIndividually}>{qty} einzeln hinzufügen – {fmt(totalPrice)}</button>
            </div>
          </div>
        </div>
      )}

      {/* Allergen-Legende Modal */}
      {showLegend && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setShowLegend(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-stone-700/60 bg-stone-900/95 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">Allergen-Information</div>
              <button className="btn-ghost" onClick={() => setShowLegend(false)}>Schließen</button>
            </div>
            {allergenHinweise && (
              <div className="mb-3 rounded-lg border border-stone-700/60 bg-stone-800/40 p-2 text-xs text-stone-200">
                <span className="font-medium">Hinweis zu diesem Produkt:</span> {allergenHinweise}
              </div>
            )}
            <div className="max-h-[60vh] overflow-auto pr-1">
              <ul className="space-y-1 text-sm">
                {Object.entries(ALLERGEN_LEGEND).map(([k, v]) => (
                  <li key={k} className="flex items-start gap-2">
                    <span className="mt-0.5 inline-block min-w-[2.5rem] rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-0.5 text-xs font-medium">{k}</span>
                    <span className="text-stone-200">{v}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-3 text-xs text-stone-400">Hinweis: Bei starken Allergien kontaktiere uns bitte vor der Bestellung.</div>
          </div>
        </div>
      )}

      {/* Bileşene özel stil — mobilde sabit yükseklikler */}
      <style jsx>{`
        :root { --bb-lh: 1.25rem; }

        .product-card__title{
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
          overflow: hidden;
          min-height: calc(var(--bb-lh) * 1.2);
        }
        .product-card__desc{
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          min-height: calc(var(--bb-lh) * 2.2);
          margin-bottom: 0.5rem;
        }
        .product-card__desc--empty {
          display: block;
          min-height: calc(var(--bb-lh) * 2.2);
          margin-bottom: 0.5rem;
        }
        @media (max-width: 480px){
          .cover{ min-height: 160px; }
        }
      `}</style>
    </article>
  );
}