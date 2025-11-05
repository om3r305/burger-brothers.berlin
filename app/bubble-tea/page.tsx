// app/bubble-tea/page.tsx
"use client";

import NextImage from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import CartSummary, { CartSummaryMobile } from "@/components/CartSummary";
import SauceCard from "@/components/sauces/SauceCard";
import NavBar from "@/components/NavBar";

import { loadNormalizedCampaigns } from "@/lib/campaigns-compat";
import { priceWithCampaign, type Campaign, type Category } from "@/lib/catalog";

const LS_PRODUCTS = "bb_products_v1";
const SCROLL_KEY = "bb_tabs_x";
const EDGE = 12;
const SWEET = 0.35;

type LocalCategory =
  | "burger" | "vegan" | "extras" | "sauces" | "drinks"
  | "hotdogs" | "donuts" | "bubbletea";

type Product = {
  id: string;
  name: string;
  price: number;
  category: LocalCategory | string;
  imageUrl?: string | null;     // ← null gelebiliyor, tipte izin verdik
  description?: string | null;  // ← aynısı
  active?: boolean;
  startAt?: string;
  endAt?: string;
};

function isAvailable(p: Product) {
  const now = Date.now();
  const s = p.startAt ? Date.parse(p.startAt) : NaN;
  const e = p.endAt ? Date.parse(p.endAt) : NaN;
  if (p.active === false) return false;
  if (!Number.isNaN(s) && now < s) return false;
  if (!Number.isNaN(e) && now > e) return false;
  return true;
}

function scrollToSweetSpot(rail: HTMLElement, pill: HTMLElement, smooth = false) {
  const leftWanted = pill.offsetLeft - (rail.clientWidth * SWEET - pill.clientWidth / 2);
  const maxLeft = rail.scrollWidth - rail.clientWidth;
  const next = Math.max(0, Math.min(leftWanted, maxLeft));
  if (smooth) rail.scrollTo({ left: next, behavior: "smooth" });
  else rail.scrollLeft = next;
}

export default function BubbleTeaPage() {
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loaded, setLoaded] = useState(false);

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

  useEffect(() => {
    try { setCampaigns(loadNormalizedCampaigns()); }
    catch { setCampaigns([]); }
  }, []);

  const teas = useMemo(
    () =>
      products
        .filter((p) => String(p.category).toLowerCase().replace(/\s+/g, "") === "bubbletea")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

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

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    try {
      const saved = sessionStorage.getItem(SCROLL_KEY);
      if (saved) rail.scrollLeft = parseInt(saved, 10) || 0;
    } catch {}

    const active =
      (rail.querySelector(".nav-pill--active") as HTMLElement) ||
      (rail.querySelector('[aria-current="page"]') as HTMLElement) ||
      (rail.querySelector('a[href="/bubble-tea"]') as HTMLElement);

    if (active) {
      const rr = rail.getBoundingClientRect();
      const pr = active.getBoundingClientRect();
      const outLeft = pr.left < rr.left + EDGE;
      const outRight = pr.right > rr.right - EDGE;
      if (outLeft || outRight) scrollToSweetSpot(rail, active, false);
    }
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    updateArrows();
    const onScroll = () => {
      updateArrows();
      try { sessionStorage.setItem(SCROLL_KEY, String(rail.scrollLeft)); } catch {}
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(rail);
    return () => {
      rail.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const rail = railRef.current; if (!rail) return;
    const onClick = (e: Event) => {
      const t = e.target as HTMLElement;
      const pill = t.closest(".nav-pill") as HTMLElement | null;
      if (pill) scrollToSweetSpot(rail, pill, true);
    };
    rail.addEventListener("click", onClick);
    return () => rail.removeEventListener("click", onClick);
  }, []);

  const nudge = (dir: "left" | "right") => {
    const el = railRef.current;
    if (!el) return;
    const step = Math.round(el.clientWidth * 0.6);
    el.scrollBy({ left: dir === "left" ? -step : step, behavior: "smooth" });
  };

  const handleTabChange = (key: string) => {
    const k = key.toLowerCase();
    if (k === "bubbletea" || k === "bubble-tea") return;
    if (k === "extras") return router.push("/extras");
    if (k === "drinks") return router.push("/drinks");
    if (k === "hotdogs") return router.push("/hotdogs");
    if (k === "sauces") return router.push("/sauces");
    if (k === "donuts") return router.push("/donuts");
    router.push(`/menu?cat=${encodeURIComponent(k)}`);
  };

  // Kampanya modu (TS kesin)
  const mode: "pickup" | "delivery" = (() => {
    try {
      const m = localStorage.getItem("bb_order_mode");
      return m === "pickup" ? "pickup" : "delivery";
    } catch { return "delivery"; }
  })();

  return (
    <main className="mx-auto max-w-7xl p-6">
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
            >‹</button>
          )}
          <div ref={railRef} className="bb-tabs-scroll__rail whitespace-nowrap">
            <NavBar variant="menu" tab={"bubbletea" as any} onTabChange={handleTabChange as any} showLocationCaption={false} />
          </div>
          {canRight && (
            <button
              aria-label="Tabs nach rechts"
              className="bb-tabs-scroll__btn bb-tabs-scroll__btn--right"
              onClick={() => nudge("right")}
            >›</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="grid-cards">
          {!loaded ? (
            <div className="text-sm text-stone-400">Lädt …</div>
          ) : teas.length === 0 ? (
            <div className="text-sm text-stone-400">
              “Bubble Tea” kategorisinde ürün yok. (LS: <code>{LS_PRODUCTS}</code>)
            </div>
          ) : (
            teas.map((s) => {
              const applied = priceWithCampaign(
                { id: s.id, name: s.name, price: s.price, category: "bubbletea" as unknown as Category },
                campaigns,
                mode
              );
              const out = !isAvailable(s);
              return (
                <div key={s.id} className="menu-card">
                  <SauceCard
                    sku={s.id}
                    name={s.name}
                    price={applied?.final ?? s.price}
                    image={s.imageUrl ?? undefined}         {/* ← null → undefined */}
                    description={s.description ?? undefined} {/* ← null → undefined */}
                    campaignLabel={applied?.badge}
                    outOfStock={out}
                    category="bubbletea"
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

      <style jsx global>{`
        .bb-tabs-scroll { position: relative; }
        .bb-tabs-scroll__rail { overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain; scroll-behavior: auto; }
        .bb-tabs-scroll__rail::-webkit-scrollbar { display: none; }
        .bb-tabs-scroll__btn { position: absolute; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border-radius: 9999px; display: grid; place-items: center; background: rgba(32,32,32,.85); color: #e7e5e4; border: 1px solid rgba(120,113,108,.5); box-shadow: 0 6px 18px rgba(0,0,0,.22); z-index: 10; }
        .bb-tabs-scroll__btn--left { left: .25rem; }
        .bb-tabs-scroll__btn--right { right: .25rem; }
        .grid-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; align-items: start; }
        .grid-cards > .menu-card { display: flex; }
        .grid-cards > .menu-card > .card, .grid-cards > .menu-card > .product-card { display: flex; flex-direction: column; height: auto; min-height: 320px; }
        .grid-cards > .menu-card .product-card__body { flex: 1 1 auto; display: flex; flex-direction: column; }
        .grid-cards > .menu-card .product-card__cta { margin-top: auto; }
        .grid-cards > .menu-card .cover, .grid-cards > .menu-card [data-media] { aspect-ratio: 16/10; width: 100%; border-radius: 12px; overflow: hidden; }
        .grid-cards > .menu-card [data-desc] { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      `}</style>
    </main>
  );
}
