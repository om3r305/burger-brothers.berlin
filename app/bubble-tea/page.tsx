// app/bubble-tea/page.tsx
"use client";

import NextImage from "next/image";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CartSummary, { CartSummaryMobile } from "@/components/CartSummary";
import SauceCard from "@/components/sauces/SauceCard";
import NavBar from "@/components/NavBar";

import { useCart } from "@/components/store";
import { loadNormalizedCampaigns } from "@/lib/campaigns-compat";
import { priceWithCampaign, type Campaign, type Category } from "@/lib/catalog";

const LS_PRODUCTS = "bb_products_v1";
const SCROLL_KEY = "bb_tabs_x";
const EDGE = 12;
const SWEET = 0.35;

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
  sku?: string;
  name: string;
  price: number;
  category: LocalCategory;
  imageUrl?: string | null;
  description?: string | null;
  active?: boolean;
  activeFrom?: string;
  activeTo?: string;
  startAt?: string;
  endAt?: string;
  order?: number;
};

function normalizeCategory(value: any): LocalCategory {
  const s = String(value ?? "").toLowerCase().replace(/[\s_-]+/g, "");

  if (s.includes("bubble") || s.includes("boba")) return "bubbletea";
  if (s.includes("donut") || s.includes("doughnut")) return "donuts";
  if (s.includes("hotdog")) return "hotdogs";
  if (s.includes("vegan") || s.includes("vegetar")) return "vegan";
  if (s.includes("sauce") || s.includes("soß") || s.includes("sos")) return "sauces";
  if (s.includes("drink") || s.includes("getränk") || s.includes("getraenk")) return "drinks";
  if (s.includes("extra") || s.includes("pommes") || s.includes("fries")) return "extras";

  return "burger";
}

function normalizeProducts(payload: any): Product[] {
  const arr = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.products)
      ? payload.products
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.data?.products)
          ? payload.data.products
          : [];

  return arr
    .filter(Boolean)
    .map((p: any) => ({
      id: String(p?.id ?? p?.sku ?? p?.code ?? p?.name ?? ""),
      sku: p?.sku ? String(p.sku) : undefined,
      name: String(p?.name ?? "Produkt"),
      price: Number(p?.price) || 0,
      category: normalizeCategory(p?.category),
      imageUrl: p?.imageUrl ?? p?.image ?? undefined,
      description: p?.description ?? p?.desc ?? undefined,
      active:
        typeof p?.active === "boolean"
          ? p.active
          : typeof p?.enabled === "boolean"
            ? p.enabled
            : true,
      activeFrom: p?.activeFrom ?? p?.startAt ?? p?.startsAt ?? undefined,
      activeTo: p?.activeTo ?? p?.endAt ?? p?.endsAt ?? undefined,
      startAt: p?.startAt ?? p?.activeFrom ?? p?.startsAt ?? undefined,
      endAt: p?.endAt ?? p?.activeTo ?? p?.endsAt ?? undefined,
      order: Number.isFinite(Number(p?.order)) ? Number(p.order) : undefined,
    }))
    .filter((p: Product) => p.id && p.name);
}

function readCampaigns(payload: any): Campaign[] {
  const arr = Array.isArray(payload?.campaigns)
    ? payload.campaigns
    : Array.isArray(payload?.data?.campaigns)
      ? payload.data.campaigns
      : [];

  return arr as Campaign[];
}

async function loadCatalogDbFirst(): Promise<{
  products: Product[];
  campaigns: Campaign[];
}> {
  try {
    const res = await fetch("/api/catalog", {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    if (!res.ok) throw new Error(`CATALOG_${res.status}`);

    const json = await res.json().catch(() => ({}));
    const products = normalizeProducts(json);
    const campaigns = readCampaigns(json);

    try {
      localStorage.setItem(LS_PRODUCTS, JSON.stringify(products));
    } catch {}

    return { products, campaigns };
  } catch {
    let products: Product[] = [];
    let campaigns: Campaign[] = [];

    try {
      const raw = localStorage.getItem(LS_PRODUCTS);
      products = normalizeProducts(raw ? JSON.parse(raw) : []);
    } catch {
      products = [];
    }

    try {
      campaigns = loadNormalizedCampaigns();
    } catch {
      campaigns = [];
    }

    return { products, campaigns };
  }
}

function isAvailable(p: Product) {
  const now = Date.now();
  const startRaw = p.activeFrom ?? p.startAt;
  const endRaw = p.activeTo ?? p.endAt;

  const start = startRaw ? Date.parse(startRaw) : NaN;
  const end = endRaw ? Date.parse(endRaw) : NaN;

  if (p.active === false) return false;
  if (!Number.isNaN(start) && now < start) return false;
  if (!Number.isNaN(end) && now > end) return false;

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
  const orderMode = useCart((s: any) => s.orderMode) as "pickup" | "delivery";
  const now = new Date();

  const [products, setProducts] = useState<Product[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reloadCatalog = async () => {
    const catalog = await loadCatalogDbFirst();
    setProducts(catalog.products);
    setCampaigns(catalog.campaigns);
    setLoaded(true);
  };

  useEffect(() => {
    void reloadCatalog();

    const onFocus = () => void reloadCatalog();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void reloadCatalog();
    };
    const onCatalogSync = () => void reloadCatalog();

    window.addEventListener("focus", onFocus);
    window.addEventListener("bb:catalog-sync", onCatalogSync as EventListener);
    window.addEventListener("bb:refresh-catalog", onCatalogSync as EventListener);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("bb:catalog-sync", onCatalogSync as EventListener);
      window.removeEventListener("bb:refresh-catalog", onCatalogSync as EventListener);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const teas = useMemo(
    () =>
      products
        .filter((p) => p.category === "bubbletea")
        .sort((a, b) => {
          const ao = Number.isFinite(a?.order as any) ? (a.order as number) : Number.MAX_SAFE_INTEGER;
          const bo = Number.isFinite(b?.order as any) ? (b.order as number) : Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return a.name.localeCompare(b.name);
        }),
    [products]
  );

  const railRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = () => {
    const rail = railRef.current;
    if (!rail) return;

    const { scrollLeft, scrollWidth, clientWidth } = rail;

    setCanLeft(scrollLeft > 2);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 2);
  };

  /*
   * Aktif sekme ilk çizimden önce doğru konuma alınır.
   * Böylece sayfa açılırken kategori rayı Burger başlangıcına dönmez.
   */
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const placeActiveTab = () => {
      const active =
        rail.querySelector<HTMLElement>(
          '[data-bb-tab-key="bubbletea"]',
        ) ||
        rail.querySelector<HTMLElement>(
          '[data-bb-tab-active="true"]',
        ) ||
        rail.querySelector<HTMLElement>(
          '[aria-selected="true"]',
        );

      if (!active) return;

      const maxLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
      const desiredLeft =
        active.offsetLeft -
        rail.clientWidth / 2 +
        active.clientWidth / 2;

      rail.scrollLeft = Math.max(0, Math.min(desiredLeft, maxLeft));

      const { scrollLeft, scrollWidth, clientWidth } = rail;
      setCanLeft(scrollLeft > 2);
      setCanRight(scrollLeft + clientWidth < scrollWidth - 2);
    };

    placeActiveTab();

    const frame = window.requestAnimationFrame(placeActiveTab);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const frame = window.requestAnimationFrame(updateArrows);

    rail.addEventListener("scroll", updateArrows, {
      passive: true,
    });

    const observer = new ResizeObserver(updateArrows);
    observer.observe(rail);

    return () => {
      window.cancelAnimationFrame(frame);
      rail.removeEventListener("scroll", updateArrows);
      observer.disconnect();
    };
  }, []);

  const nudge = (dir: "left" | "right") => {
    const rail = railRef.current;
    if (!rail) return;

    const step = Math.round(rail.clientWidth * 0.6);

    rail.scrollBy({
      left: dir === "left" ? -step : step,
      behavior: "smooth",
    });
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

  return (
    <main className="bb-menu-page bb-category-page bb-bubble-tea-page mx-auto max-w-7xl p-6">
      <div className="bb-menu-header bb-category-header bb-bubble-tea-header mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
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

                {/* Sekmeler — Extras sayfasında doğrulanan tam genişlik düzeni */}
        <div className="bb-bubble-tea-tabs relative -mx-6 px-6 sm:mx-0 sm:px-0">
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

          <div
            ref={railRef}
            className="bb-bubble-tea-tabs__rail bb-tabs-scroll bb-tabs-mask"
          >
            <div className="whitespace-nowrap">
              <NavBar
                variant="menu"
                tab={"bubbletea" as any}
                onTabChange={handleTabChange as any}
                showLocationCaption={false}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bb-bubble-tea-layout grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="bb-bubble-tea-content min-w-0">
          <div className="bb-bubble-tea-grid grid-cards">
          {!loaded ? (
            <div className="text-sm text-stone-400">Lädt …</div>
          ) : teas.length === 0 ? (
            <div className="text-sm text-stone-400">
              Noch keine <strong>Bubble Tea</strong> Produkte vorhanden. Bitte im Admin-Bereich Produkte
              mit der Kategorie <b>„Bubble Tea“</b> anlegen.
            </div>
          ) : (
            teas.map((tea) => {
              const applied = priceWithCampaign(
                {
                  id: tea.id,
                  name: tea.name,
                  price: tea.price,
                  category: "bubbletea" as Category,
                },
                campaigns,
                orderMode,
                now
              );

              const out = !isAvailable(tea);

              return (
                <div key={tea.id} className="bb-bubble-tea-card menu-card">
                  <SauceCard
                    sku={tea.id}
                    name={tea.name}
                    price={applied?.final ?? tea.price}
                    image={tea.imageUrl ?? undefined}
                    description={tea.description ?? undefined}
                    campaignLabel={applied?.badge ?? undefined}
                    outOfStock={out}
                    category="bubbletea"
                  />
                </div>
              );
            })
          )}
          </div>
        </div>

        <div className="lg:sticky lg:top-4 lg:h-fit">
          <CartSummary />
        </div>
      </div>

      <CartSummaryMobile />

      <style jsx global>{`
        .bb-tabs-scroll {
          position: relative;
        }

        .bb-tabs-scroll__rail {
          overflow-x: auto;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-x: contain;
          scroll-behavior: auto;
        }

        .bb-tabs-scroll__rail::-webkit-scrollbar {
          display: none;
        }

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

        .bb-tabs-scroll__btn--left {
          left: 0.25rem;
        }

        .bb-tabs-scroll__btn--right {
          right: 0.25rem;
        }

        .grid-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
          align-items: start;
        }

        .grid-cards > .menu-card {
          display: flex;
        }

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

        .grid-cards > .menu-card .product-card__cta {
          margin-top: auto;
        }

        .grid-cards > .menu-card .cover,
        .grid-cards > .menu-card [data-media] {
          aspect-ratio: 16/10;
          width: 100%;
          border-radius: 12px;
          overflow: hidden;
        }

        .grid-cards > .menu-card [data-desc] {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }


        /* BUBBLE-TEA — Extras sayfasında doğrulanan mobil tam genişlik */
        .bb-bubble-tea-page,
        .bb-bubble-tea-header,
        .bb-bubble-tea-layout,
        .bb-bubble-tea-content,
        .bb-bubble-tea-grid,
        .bb-bubble-tea-card {
          min-width: 0;
        }

        .bb-bubble-tea-tabs {
          min-width: 0;
          max-width: 100%;
        }

        .bb-bubble-tea-tabs__rail {
          overflow-x: auto;
          overflow-y: hidden;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-x: contain;
          scroll-behavior: auto;
        }

        .bb-bubble-tea-tabs__rail::-webkit-scrollbar {
          display: none;
        }

        .bb-bubble-tea-grid > .bb-bubble-tea-card {
          display: flex;
          height: 100%;
        }

        .bb-bubble-tea-grid > .bb-bubble-tea-card > .card,
        .bb-bubble-tea-grid > .bb-bubble-tea-card > .product-card {
          width: 100%;
          min-width: 0;
          max-width: none;
        }

        @media (max-width: 639px) {
          .bb-bubble-tea-page {
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
            overflow-x: clip;
          }

          .bb-bubble-tea-header {
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
          }

          .bb-bubble-tea-tabs {
            box-sizing: border-box;
            width: calc(100% + 3rem);
            max-width: none;
            margin-inline: -1.5rem;
            padding-inline: 1.5rem;
          }

          .bb-bubble-tea-tabs__rail {
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
            margin-inline: 0 !important;
            padding-inline: 0 !important;
            scroll-padding-inline: 30vw;
          }

          .bb-bubble-tea-layout {
            display: block !important;
            width: 100%;
            max-width: 100%;
          }

          .bb-bubble-tea-content,
          .bb-bubble-tea-grid {
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
          }

          .bb-bubble-tea-grid {
            grid-template-columns: minmax(0, 1fr) !important;
            gap: 1rem;
          }

          .bb-bubble-tea-card,
          .bb-bubble-tea-card > .card,
          .bb-bubble-tea-card > .product-card {
            box-sizing: border-box;
            width: 100% !important;
            min-width: 0 !important;
            max-width: none !important;
          }
        }
      `}</style>
    </main>
  );
}