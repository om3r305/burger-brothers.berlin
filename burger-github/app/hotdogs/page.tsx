// app/hotdogs/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/store";
import CartSummary, { CartSummaryMobile } from "@/components/CartSummary";
import NavBar from "@/components/NavBar";

/* kategori açıklaması (DE) – 2 satır aşarsa “Mehr anzeigen” */
import CategoryBlurb from "@/components/CategoryBlurb";

/** €-Formatierung */
const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

/** Admin tipi (yalın) */
type Category = "burger" | "extras" | "drinks" | "sauces" | "vegan" | "hotdogs";
type Extra = { id: string; name: string; price: number };
type Product = {
  id: string;
  name: string;
  price: number;
  category: Category;
  imageUrl?: string;
  description?: string;
  extras?: Extra[];
};

/** Hot-Dog kartı tipi – imageUrl destekli */
type HotDogDef = {
  id: string;
  name: string;
  price: number;
  description?: string;
  imageUrl?: string | null;
};

const LS_PRODUCTS = "bb_products_v1";

/* 🔒 Sekme rayı kaydırma konumunu korumak için anahtar */
const SS_TABS_X = "bb_tabs_scroll_x_v1";

export default function HotDogsPage() {
  const router = useRouter();
  const addToCart = useCart((s: any) => s.addToCart);

  // Hot Dogs (Admin -> LS)
  const [hotdogs, setHotdogs] = useState<HotDogDef[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_PRODUCTS);
      const arr = raw ? (JSON.parse(raw) as Product[]) : [];
      const list = Array.isArray(arr) ? arr : [];
      const onlyDogs = list
        .filter((p) => p?.category === "hotdogs")
        .map<HotDogDef>((p) => ({
          id: String(p.id),
          name: String(p.name ?? ""),
          price: Number.isFinite(Number(p.price)) ? Number(p.price) : 0,
          description: p.description ? String(p.description) : undefined,
          imageUrl: p.imageUrl || null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setHotdogs(onlyDogs);
    } catch {
      setHotdogs([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Miktar + not
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setHinweise] = useState<Record<string, string>>({});

  useEffect(() => {
    const initQty = Object.fromEntries(hotdogs.map((h) => [h.id, 1]));
    setQty(initQty);
  }, [hotdogs]);

  const plus = (id: string) =>
    setQty((q) => ({ ...q, [id]: Math.max(1, (q[id] ?? 1) + 1) }));
  const minus = (id: string) =>
    setQty((q) => ({ ...q, [id]: Math.max(1, (q[id] ?? 1) - 1) }));

  const addLine = (h: HotDogDef) => {
    const q = Math.max(1, qty[h.id] ?? 1);
    const n = (note[h.id] ?? "").trim();

    addToCart({
      category: "hotdogs",
      item: {
        sku: h.id,
        name: h.name,
        price: h.price,
        category: "hotdogs",
        description: h.description,
      },
      qty: q,
      note: n || undefined,
      add: [],
      rm: [],
    });

    setQty((qs) => ({ ...qs, [h.id]: 1 }));
    setHinweise((ns) => ({ ...ns, [h.id]: "" }));
  };

  /* ── Sekmeler: yatay kaydırma + oklar ── */
  const railRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = () => {
    const el = railRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanLeft(scrollLeft > 2);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 2);
  };

  // Bir sekmeyi görünüm içinde "biraz ortaya" al (bias: 0.55 hafif sağa)
  const centerEl = (pill: HTMLElement | null, bias = 0.55) => {
    const rail = railRef.current;
    if (!rail || !pill) return;
    const railRect = rail.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const targetViewportX = railRect.left + railRect.width * bias;
    const delta = pillRect.left + pillRect.width / 2 - targetViewportX;
    const left = rail.scrollLeft + delta;
    rail.scrollTo({ left, behavior: "smooth" });
    setTimeout(updateArrows, 250);
  };

  // ⬅️➡️ oklar için
  const nudge = (dir: "left" | "right") => {
    const el = railRef.current;
    if (!el) return;
    const step = Math.round(el.clientWidth * 0.6);
    el.scrollBy({ left: dir === "left" ? -step : step, behavior: "smooth" });
    setTimeout(updateArrows, 250);
  };

  // İlk render'da zıplamayı engelle: kaydırma konumunu BOYAMADAN önce geri yükle
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    try {
      const saved = Number(sessionStorage.getItem(SS_TABS_X) || "0");
      if (Number.isFinite(saved) && saved > 0) {
        rail.scrollLeft = saved; // no animation, ilk karede
      }
    } catch {}
  }, []);

  // Mount sonrası: aktif sekmeyi biraz ortaya al + dinleyiciler
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const active =
      (rail.querySelector(".nav-pill--active") as HTMLElement) ||
      (rail.querySelector('[aria-current="page"]') as HTMLElement) ||
      (rail.querySelector('[data-active-tab="true"]') as HTMLElement);

    // İlk yüklemede hafif merkezle
    requestAnimationFrame(() => centerEl(active, 0.55));

    updateArrows();
    rail.addEventListener("scroll", updateArrows, { passive: true });

    // Tıklamada: önce mevcut scroll'u kaydet, sonra hedefi hafif merkeze al
    const onClick = (e: Event) => {
      const t = e.target as HTMLElement;
      const pill = t.closest(".nav-pill") as HTMLElement | null;
      if (pill) {
        try {
          sessionStorage.setItem(SS_TABS_X, String(rail.scrollLeft));
        } catch {}
        setTimeout(() => centerEl(pill, 0.55), 40);
      }
    };
    rail.addEventListener("click", onClick, true); // capture: Link push’tan önce kaydet

    const ro = new ResizeObserver(updateArrows);
    ro.observe(rail);

    return () => {
      rail.removeEventListener("scroll", updateArrows);
      rail.removeEventListener("click", onClick, true);
      ro.disconnect();
    };
  }, []);

  // Sekme navigasyonu
  const handleTabChange = (key: string) => {
    const k = key.toLowerCase();
    if (k === "hotdogs") return;
    if (k === "extras") return router.push("/extras");
    if (k === "drinks") return router.push("/drinks");
    if (k === "sauces") return router.push("/sauces");
    if (k === "donuts") return router.push("/donuts");
    if (k === "bubbletea") return router.push("/bubble-tea");
    router.push(`/menu?cat=${encodeURIComponent(k)}`);
  };

  return (
    <main className="mx-auto max-w-7xl p-6">
      {/* ——— Header (menu ile aynı) ——— */}
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo-burger-brothers.png"
            alt="Burger Brothers Berlin"
            width={42}
            height={42}
            className="h-10 w-10 rounded-full"
            priority
          />
          <div className="flex flex-col leading-tight">
            <h1 className="text-2xl font-semibold">Burger Brothers</h1>
            <span className="text-xs text-white/70">Berlin Tegel</span>
          </div>
        </Link>

        <div className="relative -mx-6 px-6 sm:mx-0 sm:px-0">
          {canLeft && (
            <button
              aria-label="Tabs nach links"
              className="bb-tab-arrow bb-tab-arrow--left"
              onClick={() => nudge("left")}
            >
              ‹
            </button>
          )}
          {canRight && (
            <button
              aria-label="Tabs nach rechts"
              className="bb-tab-arrow bb-tab-arrow--right"
              onClick={() => nudge("right")}
            >
              ›
            </button>
          )}
          <div ref={railRef} className="bb-tabs-scroll bb-tabs-mask whitespace-nowrap">
            <NavBar
              variant="menu"
              tab={"hotdogs" as any}
              onTabChange={handleTabChange as any}
              showLocationCaption={false}
            />
          </div>
        </div>
      </div>

      {/* GRID + sepet özeti ——— BLURB SOL KOLONDA */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        {/* Sol: blurb + kartlar (menü ile birebir) */}
        <div>
          <CategoryBlurb category="hotdogs" />

          <div className="grid-cards">
            {!loaded ? (
              <div className="text-sm text-stone-400">Lädt …</div>
            ) : hotdogs.length === 0 ? (
              <div className="text-sm text-stone-400">
                Noch keine <strong>Hot Dogs</strong> vorhanden. Bitte im Admin-Bereich Produkte mit der
                Etageegorie <code className="mx-1 rounded bg-stone-800 px-1 py-0.5">hotdogs</code> anlegen.
              </div>
            ) : (
              hotdogs.map((h) => (
                <div key={h.id} className="menu-card">
                  <article className="product-card card">
                    {/* Kapak görseli (16/10) */}
                    <div className="cover" aria-hidden>
                      {h.imageUrl ? (
                        <Image
                          src={h.imageUrl}
                          alt={h.name}
                          fill
                          sizes="(max-width:768px) 100vw, 33vw"
                          className="object-cover"
                        />
                      ) : (
                        <div className="cover-fallback" />
                      )}
                    </div>

                    <div className="product-card__body">
                      <div className="mb-1 text-lg font-semibold">{h.name}</div>
                      <div className="mb-2 text-stone-300">{fmt(h.price)}</div>
                      {h.description && (
                        <p className="mb-3 text-sm text-stone-400 line-clamp-2" data-desc>
                          {h.description}
                        </p>
                      )}

                      <label className="mb-2 block text-xs text-stone-300/80">Hinweisiz (optional)</label>
                      <textarea
                        rows={2}
                        value={note[h.id] ?? ""}
                        onChange={(e) => setHinweise((ns) => ({ ...ns, [h.id]: e.target.value }))}
                        className="mb-3 w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                        placeholder="z. B. ohne Zwiebeln"
                      />
                    </div>

                    <div className="product-card__cta flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button className="qty" onClick={() => minus(h.id)} aria-label="Menge verringern">
                          −
                        </button>
                        <span className="w-8 text-center">{qty[h.id] ?? 1}</span>
                        <button className="qty" onClick={() => plus(h.id)} aria-label="Menge erhöhen">
                          +
                        </button>
                      </div>

                      <button className="card-cta" onClick={() => addLine(h)}>
                        In den Warenkorb
                      </button>
                    </div>
                  </article>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Sağ: sepet özeti */}
        <div className="lg:sticky lg:top-4 lg:h-fit">
          <CartSummary />
        </div>
      </div>

      {/* Mobil checkout */}
      <CartSummaryMobile />

      {/* Stil – /menu ile aynı görünüm + kapak oranı */}
      <style jsx global>{`
        .bb-tab-arrow {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 36px;
          height: 36px;
          border-radius: 9999px;
          display: grid;
          place-items: center;
          background: rgba(32, 32, 32, 0.85);
          color: #e7e5e4;
          border: 1px solid rgba(120, 113, 108, 0.5);
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
          z-index: 10;
        }
        .bb-tab-arrow--left { left: 0.25rem; }
        .bb-tab-arrow--right { right: 0.25rem; }
        .bb-tabs-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
        .bb-tabs-scroll::-webkit-scrollbar { display: none; }
        .bb-tabs-mask { mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent); }

        .grid-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
          align-items: start;
        }
        .grid-cards > .menu-card { display: flex; }
        .grid-cards > .menu-card > .card,
        .grid-cards > .menu-card > .product-card {
          display: flex;
          flex-direction: column;
          height: auto;
          min-height: 360px;
        }

        /* Kapak görseli 16/10 (menu ile birebir) */
        .product-card .cover {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 10;
          border-radius: 0.75rem 0.75rem 0 0;
          overflow: hidden;
          background: #0b0f14;
        }
        .product-card .cover-fallback {
          width: 100%;
          height: 100%;
          background:
            radial-gradient(800px 400px at 10% -10%, rgba(59,130,246,.18), transparent),
            radial-gradient(700px 400px at 90% 0%, rgba(16,185,129,.14), transparent),
            linear-gradient(180deg,#0b0f14 0%,#111827 50%,#0b0f14 100%);
        }

        .grid-cards > .menu-card .product-card__body {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          padding-top: 0.5rem;
        }
        .grid-cards > .menu-card .product-card__cta { margin-top: auto; }
      `}</style>
    </main>
  );
}
