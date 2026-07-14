// app/extras/page.tsx
"use client";

import NextImage from "next/image";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CartSummary, { CartSummaryMobile } from "@/components/CartSummary";
import VariantGroupCard from "@/components/shared/VariantGroupCard";
import NavBar from "@/components/NavBar";

/* ===== Tipler ===== */
type Variant = {
  id: string;
  name: string;
  price: number;
  image?: string;
  active?: boolean;
  startAt?: string;
  endAt?: string;
};

type VariantGroup = {
  sku: string;
  name: string;
  description?: string;
  image?: string;
  variants: Variant[];
};

/* DB’den Extras-Gruppen yükle */
async function loadGroupsWithFallback(): Promise<VariantGroup[]> {
  try {
    const r = await fetch("/api/groups", { cache: "no-store" });
    const j = await r.json();
    return Array.isArray(j.extraGroups) ? j.extraGroups : [];
  } catch {
    return [];
  }
}

export default function ExtrasPage() {
  const router = useRouter();

  const [groups, setGroups] = useState<VariantGroup[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;

    const reloadGroups = async () => {
      try {
        const data = await loadGroupsWithFallback();
        if (mounted) setGroups(data);
      } finally {
        if (mounted) setLoaded(true);
      }
    };

    const onGroupsSync = () => {
      void reloadGroups();
    };

    const onFocus = () => {
      void reloadGroups();
    };

    void reloadGroups();

    window.addEventListener(
      "bb:groups-sync",
      onGroupsSync as EventListener,
    );
    window.addEventListener("focus", onFocus);

    return () => {
      mounted = false;
      window.removeEventListener(
        "bb:groups-sync",
        onGroupsSync as EventListener,
      );
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  /* --- ÜST SEKMELER: yatay kaydırma + oklar + aktif sekmeyi ortalama --- */
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
   * Böylece sayfa açılırken ray önce Burger başlangıcına dönüp
   * ardından aktif kategoriye kaymaz.
   */
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const placeActiveTab = () => {
      const active =
        rail.querySelector<HTMLElement>(
          '[data-bb-tab-key="extras"]',
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
    if (k === "extras") return;
    if (k === "drinks") return router.push("/drinks");
    if (k === "sauces") return router.push("/sauces");
    if (k === "hotdogs") return router.push("/hotdogs");
    if (k === "donuts") return router.push("/donuts");
    if (k === "bubbletea") return router.push("/bubble-tea");
    router.push(`/menu?cat=${encodeURIComponent(k)}`);
  };

  return (
    <main className="mx-auto max-w-7xl p-6">
      {/* KOPF: Logo + Navigation (oklu yatay sekmeler) */}
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

        {/* Sekmeler — oklar yalnızca gerektiğinde görünür, aktif sekme ortalanır */}
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
              tab={"extras" as any}
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

      {/* GRID + RECHTS: Warenkorb */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        {/* Sol: Kartlar */}
        <div className="grid-cards">
          {!loaded ? (
            <div className="text-sm text-stone-400">Lädt …</div>
          ) : groups.length === 0 ? (
            <div className="text-sm text-stone-400">
              Noch keine Extras-Gruppen vorhanden. Bitte im Admin-Bereich unter
              <b> Extras-Gruppen</b> Gruppen anlegen.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.sku || g.name} className="menu-card">
                <VariantGroupCard
                  sku={g.sku || g.name}
                  name={g.name}
                  description={g.description}
                  image={g.image}
                  variants={g.variants}
                  category="extras"
                />
              </div>
            ))
          )}
        </div>

        {/* Sağ: Sepet */}
        <div className="lg:sticky lg:top-4 lg:h-fit">
          <CartSummary />
        </div>
      </div>

      {/* Mobil sabit checkout butonu */}
      <CartSummaryMobile />

      {/* Stil */}
      <style jsx global>{`
        .bb-tabs-scroll {
          position: relative;
        }
        .bb-tabs-scroll__rail {
          overflow-x: auto;
          overflow-y: hidden;
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
        .grid-cards > .menu-card .product-card {
          display: flex;
          flex-direction: column;
          min-height: 300px;
          height: auto;
        }
        .grid-cards > .menu-card .product-card .product-card__body {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
        }
        .grid-cards > .menu-card .product-card .product-card__cta {
          margin-top: auto;
        }
      `}</style>
    </main>
  );
}
