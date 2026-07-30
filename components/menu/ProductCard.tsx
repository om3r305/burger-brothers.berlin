"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCart } from "@/components/store";
import { optimizedLocalImageUrl } from "@/lib/media/local-optimized-image";

type ExtraInput =
  | { id: string; label: string; price?: number }
  | { id: string; name: string; price?: number };

type Props = {
  sku: string;
  productId?: string;
  name: string;
  price: number;
  originalPrice?: number;
  description?: string;
  extrasOptions?: ExtraInput[];
  image?: string;
  images?: string[];
  coverRatio?: string;
  normalizeTransparentImage?: boolean;
  compact?: boolean;
  category?: "burger" | "vegan" | "extras" | "sauces" | "drinks" | "hotdogs";
  outOfStock?: boolean;
  campaignLabel?: string;
  topSellerRank?: 1 | 2 | 3;
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
    1: "/badges/medal-gold.webp",
    2: "/badges/medal-silver.webp",
    3: "/badges/medal-bronze.webp",
  };
  const [fail, setFail] = useState(false);

  if (!fail) {
    return (
      <div
        className="pointer-events-none absolute right-2 z-10"
        style={{ top: offsetTop }}
        aria-hidden
      >
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
            alt={rank === 1 ? "Gold medal" : rank === 2 ? "Silber medal" : "Bronze medal"}
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


type NormalizedImageLayout = {
  left: number;
  top: number;
  scale: number;
};

const DEFAULT_NORMALIZED_IMAGE_LAYOUT: NormalizedImageLayout = {
  left: 0,
  top: 0,
  scale: 1,
};

const IMAGE_LAYOUT_CACHE_KEY = "bb_product_image_layout_v2";
const imageLayoutCache = new Map<string, NormalizedImageLayout>();
let imageLayoutCacheHydrated = false;

function hydrateImageLayoutCache() {
  if (imageLayoutCacheHydrated || typeof window === "undefined") return;
  imageLayoutCacheHydrated = true;
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(IMAGE_LAYOUT_CACHE_KEY) || "{}",
    ) as Record<string, NormalizedImageLayout>;
    for (const [key, value] of Object.entries(parsed)) {
      if (
        Number.isFinite(value?.left) &&
        Number.isFinite(value?.top) &&
        Number.isFinite(value?.scale)
      ) {
        imageLayoutCache.set(key, value);
      }
    }
  } catch {
    // A fresh in-memory cache is enough when sessionStorage is unavailable.
  }
}

function cachedImageLayout(src: string) {
  hydrateImageLayoutCache();
  return imageLayoutCache.get(src);
}

function cacheImageLayout(src: string, value: NormalizedImageLayout) {
  imageLayoutCache.set(src, value);
  if (typeof window === "undefined") return;
  try {
    const compact = Object.fromEntries(
      Array.from(imageLayoutCache.entries()).slice(-80),
    );
    sessionStorage.setItem(IMAGE_LAYOUT_CACHE_KEY, JSON.stringify(compact));
  } catch {
    // Layout remains cached in memory for the current page.
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function NormalizedTransparentImage({
  src,
  alt,
  onError,
}: {
  src: string;
  alt: string;
  onError: () => void;
}) {
  const [layout, setLayout] = useState<NormalizedImageLayout>(
    () => cachedImageLayout(src) || DEFAULT_NORMALIZED_IMAGE_LAYOUT,
  );
  const scheduledAnalysisRef = useRef<{
    id: number;
    mode: "idle" | "timeout";
  } | null>(null);

  useEffect(() => {
    setLayout(cachedImageLayout(src) || DEFAULT_NORMALIZED_IMAGE_LAYOUT);
    return () => {
      const scheduled = scheduledAnalysisRef.current;
      if (!scheduled) return;
      if (scheduled.mode === "idle") {
        const idleWindow = window as Window & {
          cancelIdleCallback?: (id: number) => void;
        };
        idleWindow.cancelIdleCallback?.(scheduled.id);
      } else {
        window.clearTimeout(scheduled.id);
      }
      scheduledAnalysisRef.current = null;
    };
  }, [src]);

  const analyzeImage = (element: HTMLImageElement) => {
    try {
      const cached = cachedImageLayout(src);
      if (cached) {
        setLayout(cached);
        return;
      }

      const naturalWidth = element.naturalWidth;
      const naturalHeight = element.naturalHeight;

      if (!naturalWidth || !naturalHeight) return;

      const sampleWidth = Math.min(240, naturalWidth);
      const sampleHeight = Math.max(
        1,
        Math.round((sampleWidth / naturalWidth) * naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;

      const context = canvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!context) return;

      context.clearRect(0, 0, sampleWidth, sampleHeight);
      context.drawImage(element, 0, 0, sampleWidth, sampleHeight);

      const pixels = context.getImageData(
        0,
        0,
        sampleWidth,
        sampleHeight,
      ).data;
      const columnHits = new Uint16Array(sampleWidth);
      const rowHits = new Uint16Array(sampleHeight);
      let opaquePixelCount = 0;

      for (let y = 0; y < sampleHeight; y += 1) {
        for (let x = 0; x < sampleWidth; x += 1) {
          const alpha = pixels[(y * sampleWidth + x) * 4 + 3];
          if (alpha < 24) continue;

          columnHits[x] += 1;
          rowHits[y] += 1;
          opaquePixelCount += 1;
        }
      }

      // Görsel gerçekten şeffaf değilse mevcut davranışı koru.
      if (opaquePixelCount > sampleWidth * sampleHeight * 0.96) return;

      const minColumnHits = Math.max(2, Math.floor(sampleHeight * 0.004));
      const minRowHits = Math.max(2, Math.floor(sampleWidth * 0.004));

      let minX = 0;
      while (minX < sampleWidth && columnHits[minX] < minColumnHits) minX += 1;

      let maxX = sampleWidth - 1;
      while (maxX >= 0 && columnHits[maxX] < minColumnHits) maxX -= 1;

      let minY = 0;
      while (minY < sampleHeight && rowHits[minY] < minRowHits) minY += 1;

      let maxY = sampleHeight - 1;
      while (maxY >= 0 && rowHits[maxY] < minRowHits) maxY -= 1;

      if (minX >= maxX || minY >= maxY) return;

      const x0 = minX / sampleWidth;
      const x1 = (maxX + 1) / sampleWidth;
      const y0 = minY / sampleHeight;
      const y1 = (maxY + 1) / sampleHeight;
      const visibleWidth = x1 - x0;
      const visibleHeight = y1 - y0;

      if (visibleWidth <= 0 || visibleHeight <= 0) return;

      // Menü kartlarında bütün burgerler yaklaşık aynı görünür alanı kaplar.
      const targetWidth = 0.82;
      const targetHeight = 0.84;
      const targetBottom = 0.92;
      const scale = clamp(
        Math.min(targetWidth / visibleWidth, targetHeight / visibleHeight),
        0.72,
        2.35,
      );
      const left = (1 - visibleWidth * scale) / 2 - x0 * scale;
      const top = targetBottom - y1 * scale;

      const nextLayout = { left, top, scale };
      setLayout(nextLayout);
      cacheImageLayout(src, nextLayout);
    } catch {
      // Uzak görsel CORS nedeniyle okunamazsa güvenli object-contain fallback'i kalır.
      setLayout(DEFAULT_NORMALIZED_IMAGE_LAYOUT);
    }
  };

  const scheduleAnalysis = (element: HTMLImageElement) => {
    if (cachedImageLayout(src)) return;
    const run = () => {
      scheduledAnalysisRef.current = null;
      analyzeImage(element);
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
    };
    if (idleWindow.requestIdleCallback) {
      scheduledAnalysisRef.current = {
        id: idleWindow.requestIdleCallback(run, { timeout: 650 }),
        mode: "idle",
      };
    } else {
      scheduledAnalysisRef.current = {
        id: window.setTimeout(run, 32),
        mode: "timeout",
      };
    }
  };

  return (
    <div
      className="absolute"
      style={{
        left: `${layout.left * 100}%`,
        top: `${layout.top * 100}%`,
        width: `${layout.scale * 100}%`,
        height: `${layout.scale * 100}%`,
      }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 639px) 46vw, (max-width: 1023px) 33vw, 25vw"
        className="select-none object-fill"
        onLoad={(event) => scheduleAnalysis(event.currentTarget)}
        onError={onError}
      />
    </div>
  );
}

export default function ProductCard({
  sku,
  productId,
  name,
  price,
  originalPrice,
  description,
  extrasOptions = [],
  image,
  images,
  coverRatio = "16/10",
  normalizeTransparentImage = false,
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
  const [portalReady, setPortalReady] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("product");
    if (!target) return;

    const normalizedTarget = target.trim().toLowerCase();
    const matches = [productId, sku]
      .filter(Boolean)
      .some((value) => String(value).trim().toLowerCase() === normalizedTarget);
    if (!matches) return;

    const timer = window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (!outOfStock) setOpen(true);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [outOfStock, productId, sku]);

  /*
   * Modal açıkken arka sayfayı sabit tutar. Özellikle iPhone Safari/PWA'da
   * arka içeriğin kaymasını ve modalın ekranın aşağısına taşınmasını önler.
   */
  useEffect(() => {
    if (!portalReady || (!open && !showLegend)) return;

    const body = document.body;
    const root = document.documentElement;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const previousOverscroll = body.style.overscrollBehavior;
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth,
    );

    root.classList.add("bb-modal-open");
    body.classList.add("bb-modal-open");
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      root.classList.remove("bb-modal-open");
      body.classList.remove("bb-modal-open");
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      body.style.overscrollBehavior = previousOverscroll;
    };
  }, [open, portalReady, showLegend]);

  useEffect(() => {
    if (!open && !showLegend) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (showLegend) {
        setShowLegend(false);
        return;
      }

      closeReset();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
    // closeReset yalnızca mevcut state setter'larını kullanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showLegend]);

  const normalizedExtras: Extra[] = (extrasOptions as any[]).map((e) => ({
    id: String(e?.id ?? ""),
    label: String((e as any)?.label ?? (e as any)?.name ?? ""),
    price: Number.isFinite(Number((e as any)?.price)) ? Number((e as any)?.price) : undefined,
  }));

  const activeItem = items[active] || items[0] || { extras: [], note: "" };

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
      item: {
        sku,
        name,
        price,
        ...(category ? { category } : {}),
        ...(allergens?.length ? { allergens } : {}),
        ...(description ? { description } : {}),
      },
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
      const ids = [...cfg.extras]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((e) => `${e.id}:${e.price || 0}`)
        .join("|");
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
        item: {
          sku,
          name,
          price,
          ...(category ? { category } : {}),
          ...(allergens?.length ? { allergens } : {}),
          ...(description ? { description } : {}),
        },
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

  const imgs = (Array.isArray(images) && images.length ? images : image ? [image] : [])
    .filter(Boolean)
    .slice(0, 3);

  const CoverSingle = ({ src }: { src: string }) => {
    const optimizedSrc = optimizedLocalImageUrl(src) || src;
    if (normalizeTransparentImage) {
      if (useNativeImg) {
        return (
          <img
            src={src}
            alt={name}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-contain"
          />
        );
      }

      return (
        <NormalizedTransparentImage
          src={optimizedSrc}
          alt={name}
          onError={() => setUseNativeImg(true)}
        />
      );
    }

    return useNativeImg ? (
      <img src={src} alt={name} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
    ) : (
      <Image
        src={optimizedSrc}
        alt={name}
        fill
        sizes="(max-width: 639px) 46vw, (max-width: 1023px) 33vw, 25vw"
        className="object-cover"
        onError={() => setUseNativeImg(true)}
      />
    );
  };

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

  const medalOffset = outOfStock ? 48 : 8;

  const emoji =
    topSellerRank === 1 ? "" : topSellerRank === 2 ? "" : topSellerRank === 3 ? "" : "";

  return (
    <article
      ref={cardRef}
      id={`product-${encodeURIComponent(String(productId || sku))}`}
      className={`card product-card ${compact ? "p-3" : "p-4"} h-full flex flex-col`}
      data-product-id={productId || undefined}
      data-sku={sku}
    >
      {/* ==== BODY ==== */}
      <div className="product-card__body flex-1 flex flex-col">
        {/* Kapak */}
        <div
          className={`cover relative ${compact ? "mb-2" : "mb-3"} ${normalizeTransparentImage ? "bb-menu-product-cover" : "bg-stone-800/50"} overflow-hidden rounded-xl`}
          style={{ aspectRatio: coverRatio }}
        >
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
            {hasStrike && (
              <span className="mr-2 align-middle text-xs font-normal text-stone-300 line-through">
                {fmt(originalPrice!)}
              </span>
            )}
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
              <button
                type="button"
                className="ml-1 rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-0.5 text-xs text-stone-200 hover:bg-stone-800"
                onClick={() => setShowLegend(true)}
                aria-label="Produktspezifische Allergen-Hinweise"
                title="Produktspezifische Allergen-Hinweise"
              >
                ?
              </button>
            )}
            <button
              type="button"
              className="ml-1 rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-0.5 text-xs text-stone-200 hover:bg-stone-800"
              onClick={() => setShowLegend(true)}
              aria-label="Allergen-Information"
              title="Allergen-Information"
            >
              ℹ️ Allergene
            </button>
          </div>
        )}

        {/* Açıklama */}
        {description ? (
          <p className="product-card__desc text-sm opacity-80" title={description}>
            {description}
          </p>
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

      {/* Modal — body portalı sayesinde her zaman gerçek viewport'a sabitlenir */}
      {portalReady && open && !outOfStock
        ? createPortal(
            <div
              className="bb-product-modal fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
              style={{
                zIndex: 2147482500,
                paddingTop: "max(12px, env(safe-area-inset-top))",
                paddingRight: "max(12px, env(safe-area-inset-right))",
                paddingBottom: "max(12px, env(safe-area-inset-bottom))",
                paddingLeft: "max(12px, env(safe-area-inset-left))",
              }}
              role="dialog"
              aria-modal="true"
              aria-label={`${name} konfigurieren`}
              onClick={closeReset}
            >
          <div
            className="bb-modal-shell w-full max-w-2xl overflow-hidden rounded-2xl border border-stone-700/60 bg-stone-900/95"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal üst alan */}
            <div className="shrink-0 border-b border-stone-700/60 px-4 pb-3 pt-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 text-lg font-semibold leading-tight">{name}</div>
                <button type="button" className="btn-ghost shrink-0" onClick={closeReset}>
                  Schließen
                </button>
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
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button type="button" className="qty" onClick={() => syncQty(qty - 1)}>
                    −
                  </button>
                  <span className="w-8 text-center">{qty}</span>
                  <button type="button" className="qty" onClick={() => syncQty(qty + 1)}>
                    +
                  </button>
                </div>
                <div className="text-sm opacity-90">
                  Gesamt: <b>{fmt(totalPrice)}</b>
                </div>
              </div>
            </div>

            {/* Modal scroll alanı */}
            <div className="bb-modal-scroll flex-1 overflow-y-auto px-4 py-3">
              {/* Tabs */}
              <div className="sticky top-0 z-10 -mx-4 bg-stone-900/95 px-4 pb-3 pt-1">
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: qty }).map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`pill ${i === active ? "active" : ""}`}
                      onClick={() => setActive(i)}
                    >
                      {i + 1}. {category === "vegan" ? "Burger (vegan)" : "Burger"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editor */}
              <div className="rounded-xl border border-stone-700/60 bg-stone-800/40 p-3">
                <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-medium">
                    {active + 1}. — Einzelpreis: {fmt(unitPrice(activeItem))}
                  </div>
                  {!!activeItem.extras.length && (
                    <div className="text-xs opacity-80">
                      Extras: {activeItem.extras.map((e) => e.label).join(", ")}
                    </div>
                  )}
                </div>

                {!!normalizedExtras.length && (
                  <>
                    <div className="mb-2 text-sm font-medium">Extras</div>
                    <div className="mb-3 flex flex-wrap gap-2">
                      {normalizedExtras.map((e) => {
                        const activeOnThis = !!activeItem.extras.find((x) => x.id === e.id);
                        return (
                          <button
                            key={e.id}
                            type="button"
                            className={`pill ${activeOnThis ? "active" : ""}`}
                            onClick={() => toggleExtra(active, e)}
                          >
                            {e.label} {typeof e.price === "number" ? `(+${fmt(e.price)})` : ""}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                <div className="mb-2 text-sm font-medium">Hinweis</div>
                <input
                  value={activeItem.note}
                  onChange={(ev) => setHinweise(active, ev.target.value)}
                  className="w-full rounded-lg border border-stone-700/60 bg-stone-800/60 p-2 outline-none"
                  placeholder="z. B. gut durchgebraten / ohne Zwiebel"
                />
              </div>
            </div>

            {/* Modal alt sabit CTA alanı */}
            <div className="bb-modal-footer shrink-0 border-t border-stone-700/60 bg-stone-900/95 px-4 pt-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button type="button" className="btn-ghost" onClick={addSameForAll}>
                  Alle {qty} mit gleicher Einstellung – {fmt(unitPrice(items[0]) * qty)}
                </button>
                <button type="button" className="card-cta" onClick={addAllIndividually}>
                  {qty} einzeln hinzufügen – {fmt(totalPrice)}
                </button>
              </div>
            </div>
          </div>
            </div>,
            document.body,
          )
        : null}

      {/* Allergen-Legende Modal — aynı şekilde gerçek viewport portalı */}
      {portalReady && showLegend
        ? createPortal(
            <div
              className="bb-product-modal fixed inset-0 grid place-items-center bg-black/70 backdrop-blur-[2px]"
              style={{
                zIndex: 2147482600,
                paddingTop: "max(12px, env(safe-area-inset-top))",
                paddingRight: "max(12px, env(safe-area-inset-right))",
                paddingBottom: "max(12px, env(safe-area-inset-bottom))",
                paddingLeft: "max(12px, env(safe-area-inset-left))",
              }}
              role="dialog"
              aria-modal="true"
              aria-label="Allergen-Information"
              onClick={() => setShowLegend(false)}
            >
          <div
            className="w-full max-w-lg rounded-2xl border border-stone-700/60 bg-stone-900/95 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">Allergen-Information</div>
              <button type="button" className="btn-ghost" onClick={() => setShowLegend(false)}>
                Schließen
              </button>
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
                    <span className="mt-0.5 inline-block min-w-[2.5rem] rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-0.5 text-xs font-medium">
                      {k}
                    </span>
                    <span className="text-stone-200">{v}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-3 text-xs text-stone-400">
              Hinweis: Bei starken Allergien kontaktiere uns bitte vor der Bestellung.
            </div>
          </div>
            </div>,
            document.body,
          )
        : null}

      {/* Bileşene özel stil — mobilde sabit yükseklikler */}
      <style jsx>{`
        :root {
          --bb-lh: 1.25rem;
        }

        .product-card__title {
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
          overflow: hidden;
          min-height: calc(var(--bb-lh) * 1.2);
        }

        .product-card__desc {
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

        .bb-modal-shell {
          display: flex;
          flex-direction: column;
          max-height: 92vh;
        }

        .bb-modal-scroll {
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }

        .bb-modal-footer {
          padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
        }

        @supports (height: 100dvh) {
          .bb-modal-shell {
            max-height: 92dvh;
          }
        }

        @media (min-width: 640px) {
          .bb-modal-shell {
            max-height: 90vh;
          }
        }

        @media (max-width: 480px) {
          .cover {
            min-height: 160px;
          }
        }
      `}</style>
    </article>
  );
}
