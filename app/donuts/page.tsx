// app/donuts/page.tsx
"use client";

import NextImage from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import CartSummary, { CartSummaryMobile } from "@/components/CartSummary";
import SauceCard from "@/components/sauces/SauceCard"; // Generic kart
import NavBar from "@/components/NavBar";

import { useCart } from "@/components/store";
import { loadNormalizedCampaigns } from "@/lib/campaigns-compat";
import { priceWithCampaign, type Campaign, type Category } from "@/lib/catalog";

const LS_PRODUCTS = "bb_products_v1";
const SS_TABS_X = "bb_tabs_scroll_x_v1"; // sekme rayı kaydı

type LocalCategory =
  | "burger"
  | "vegan"
  | "extras"
  | "sauces"
  | "drinks"
  | "hotdogs"
  | "donuts"
  | "bubbletea";

type Product = {
  id: string;
  name: string;
  price: number;
  category: LocalCategory | string;
  imageUrl?: string;
  description?: string;
  active?: boolean;
  startAt?: string;
  endAt?: string;
  order?: number;
};

function isAvailable(p: Product): boolean {
  const now = Date.now();
  const s = p.startAt ? Date.parse(p.startAt) : NaN;
  const e = p.endAt ? Date.parse(p.endAt) : NaN;
  if (p.active === false) return false;
  if (!Number.isNaN(s) && now < s) return false;
  if (!Number.isNaN(e) && now > e) return false;
  return true;
}

export default function DonutsPage() {
  const router = useRouter();

  // Sepet modu (kampanya uygulamada gerekli)
  const orderMode = useCart((s: any) => s.orderMode) as "pickup" | "delivery";

  const [products, setProducts] = useState<Product[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loaded, setLoaded] = useState(false);

  // ürünler
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_PRODUCTS);
      const arr = raw ? (JSON.parse(raw) as Product[]) : [];
      setProducts(Array.isArray(arr) ? arr : []);
    } catch {
      setProducts([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  // kampanyalar
  useEffect(() => {
    try {
      setCampaigns(loadNormalizedCampaigns());
    } catch {
      setCampaigns([]);
    }
  }, []);

  // sadece donuts – varsa order’a göre, yoksa ada göre
  const donuts = useMemo(
    () =>
      products
        .filter((p) => String(p.category).toLowerCase() === "donuts")
        .sort((a: any, b: any) => {
          const ao = Number.isFinite(a?.order) ? a.order : Number.MAX_SAFE_INTEGER;
          const bo = Number.isFinite(b?.order) ? b.order : Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return a.name.localeCompare(b.name);
        }),
    [products]
  );

  /* ------- Üst sekme rayı ------- */
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

  const centerEl = (pill: HTMLElement | null, bias = 0.55) => {
    const rail = railRef.current;
    if (!rail || !pill) return;
    const railRect = rail.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const targetViewportX = railRect.left + railRect.width * bias;
    const delta = pillRect.left + pillRect.width / 2 - targetViewportX;
    rail.scrollTo({ left: rail.scrollLeft + delta, behavior: "smooth" });
    setTimeout(updateArrows, 250);
  };

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    try {
      const saved = Number(sessionStorage.getItem(SS_TABS_X) || "0");
      if (Number.isFinite(saved) && saved > 0) rail.scrollLeft = saved;
    } catch {}
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const active =
      (rail.querySelector(".nav-pill--active") as HTMLElement) ||
      (rail.querySelector('[aria-current="page"]') as HTMLElement) ||
      (rail.querySelector('[data-active-tab="true"]') as HTMLElement);

    requestAnimationFrame(() => centerEl(active, 0.55));

    updateArrows();
    rail.addEventListener("scroll", updateArrows, { passive: true });

    const onClick = (e: Event) => {
      const t = e.target as HTMLElement;
      const pill = t.closest(".nav-pill") as HTMLElement | null;
      if (pill) {
        try { sessionStorage.setItem(SS_TABS_X, String(rail.scrollLeft)); } catch {}
        setTimeout(() => centerEl(pill, 0.55), 40);
      }
    };
    rail.addEventListener("click", onClick, true);

    const ro = new ResizeObserver(updateArrows);
    ro.observe(rail);

    return () => {
      rail.removeEventListener("scroll", updateArrows);
      rail.removeEventListener("click", onClick, true);
      ro.disconnect();
    };
  }, []);

  const nudge = (dir: "left" | "right") => {
    const el = railRef.current;
    if (!el) return;
    const step = Math.round(el.clientWidth * 0.6);
    el.scrollBy({ left: dir === "left" ? -step : step, behavior: "smooth" });
    setTimeout(updateArrows, 250);
  };

  const handleTabChange = (key: string) => {
    const k = key.toLowerCase();
    if (k === "donuts") return;
    if (k === "extras") return router.push("/extras");
    if (k === "drinks") return router.push("/drinks");
    if (k === "hotdogs") return router.push("/hotdogs");
    if (k === "sauces") return router.push("/sauces");
    if (k === "bubbletea" || k === "bubble-tea") return router.push("/bubble-tea");
    router.push(`/menu?cat=${encodeURIComponent(k)}`);
  };

  return (
    <main className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex items-center gap-3">
          <NextImage
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

        <div className="bb-tabs-scroll -mx-6 px-6 sm:mx-0 sm:px-0">
          {canLeft && (
            <button
              aria-label="Tabs nach links"
              className="bb-tabs-scroll__btn bb-tabs-scroll__btn--left"
              onClick={() => nudge("left")}
            >
              ‹
            </button>
          )}

          <div ref={railRef} className="bb-tabs-scroll__rail whitespace-nowrap">
            <NavBar
              variant="menu"
              tab={"donuts" as any}
              onTabChange={handleTabChange as any}
              showLocationCaption={false}
            />
          </div>

          {canRight && (
            <button
              aria-label="Tabs nach rechts"
              className="bb-tabs-scroll__btn bb-tabs-scroll__btn--right"
              onClick={() => nudge("right")}
            >
              ›
            </button>
          )}
        </div>
      </div>

      {/* Grid + sağ özet */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="grid-cards">
          {!loaded ? (
            <div className="text-sm text-stone-400">Lädt …</div>
          ) : donuts.length === 0 ? (
            <div className="text-sm text-stone-400">
              Donut ürünü yok. Admin’de <b>“Donuts”</b> kategorisinde ürün ekleyin (LS:{" "}
              <code>{LS_PRODUCTS}</code>).
            </div>
          ) : (
            donuts.map((s) => {
              // kampanya: sepet moduna göre
              const applied = priceWithCampaign(
                { id: s.id, name: s.name, price: s.price, category: "donuts" as Category },
                campaigns,
                orderMode
              );
              const out = !isAvailable(s);
              return (
                <div key={s.id} className="menu-card">
                  <SauceCard
                    sku={s.id}
                    name={s.name}
                    price={applied?.final ?? s.price}
                    image={s.imageUrl}
                    description={s.description}
                    campaignLabel={applied?.badge ?? undefined} {/* ← null → undefined */}
                    outOfStock={out}
                    category="donuts"
                  />
                </div>
              );
            })
          )}
        </div>

        <div className="lg:sticky lg:top-4 lg:h-fit">
          <CartSummary />
        </div>
      </div>

      <CartSummaryMobile />

      {/* styles (Sauces ile aynı) */}
      <style jsx global>{`
        .bb-tabs-scroll { position: relative; }
        .bb-tabs-scroll__rail {
          overflow-x: auto;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
        }
        .bb-tabs-scroll__rail::-webkit-scrollbar { display: none; }
        .bb-tabs-scroll__btn {
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
        .bb-tabs-scroll__btn--left { left: 0.25rem; }
        .bb-tabs-scroll__btn--right { right: 0.25rem; }

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
          min-height: 320px;
        }
        .grid-cards > .menu-card .product-card__body {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
        }
        .grid-cards > .menu-card .product-card__cta { margin-top: auto; }
        .grid-cards > .menu-card .cover,
        .grid-cards > .menu-card [data-media] {
          aspect-ratio: 16/10;
          width: 100%;
          border-radius: 12px;
          overflow: hidden;
        }
        .grid-cards > .menu-card [data-desc] {
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
      `}</style>
    </main>
  );
}
