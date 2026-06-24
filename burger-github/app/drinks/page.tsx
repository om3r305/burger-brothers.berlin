// app/drinks/page.tsx
"use client";

import NextImage from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CartSummary, { CartSummaryMobile } from "@/components/CartSummary";
import VariantGroupCard from "@/components/shared/VariantGroupCard";
import NavBar from "@/components/NavBar";

/* ===== Tipler & LS-Key ===== */
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

const LS_DRINK_GROUPS = "bb_drink_groups_v1";

export default function DrinksPage() {
  const router = useRouter();

  const [groups, setGroups] = useState<VariantGroup[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_DRINK_GROUPS);
      const arr = raw ? (JSON.parse(raw) as VariantGroup[]) : [];
      const safe: VariantGroup[] = (Array.isArray(arr) ? arr : []).map((g: any) => ({
        sku: String(g?.sku ?? ""),
        name: String(g?.name ?? ""),
        description: g?.description ? String(g.description) : undefined,
        image: g?.image ? String(g.image) : undefined,
        variants: Array.isArray(g?.variants)
          ? g.variants
              .filter((v: any) => v && (v.id || v.name))
              .map((v: any) => ({
                id: String(v.id || v.name || Math.random()),
                name: String(v.name ?? ""),
                price: Number(v.price) || 0,
                image: v.image ? String(v.image) : undefined,
                active: v.active !== false,
                startAt: v.startAt ? String(v.startAt) : undefined,
                endAt: v.endAt ? String(v.endAt) : undefined,
              }))
          : [],
      }));
      setGroups(safe);
    } catch {
      setGroups([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  /* --- ÜST SEKMELER: yatay kaydırma + oklar + aktif sekmeyi ortalama --- */
  const railRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  // ► Scroll pozisyonunu sayfa bazında koru (ilk yüklemede zıplama olmasın)
  const keepKeyRef = useRef<string>(
    `bb_tabs_scroll_${typeof window !== "undefined" ? window.location.pathname : "/drinks"}`
  );

  const updateArrows = () => {
    const el = railRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanLeft(scrollLeft > 2);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 2);
    // konumu sakla
    try {
      sessionStorage.setItem(keepKeyRef.current, String(scrollLeft));
    } catch {}
  };

  // Ray içinde bir sekmeyi merkeze hizala
  const centerEl = (pill: HTMLElement | null, smooth = true) => {
    const rail = railRef.current;
    if (!rail || !pill) return;
    // offsetLeft ile hesapla (başlangıç zıplamasını engeller)
    const left =
      pill.offsetLeft + pill.offsetWidth / 2 - rail.clientWidth / 2;
    rail.scrollTo({ left: Math.max(0, left), behavior: smooth ? "smooth" : "auto" });
    setTimeout(updateArrows, smooth ? 250 : 0);
  };

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    // İlk açılışta: eğer önceden scrollLeft kaydedilmişse onu kullan;
    // yoksa aktif sekmeyi "animasyonsuz" merkeze al (başa zıplama yok).
    const saved = (() => {
      try {
        const v = sessionStorage.getItem(keepKeyRef.current);
        return v ? Number(v) : NaN;
      } catch {
        return NaN;
      }
    })();

    const active =
      (rail.querySelector(".nav-pill--active") as HTMLElement) ||
      (rail.querySelector('[aria-current="page"]') as HTMLElement) ||
      (rail.querySelector('[data-active-tab="true"]') as HTMLElement);

    if (!Number.isNaN(saved)) {
      rail.scrollLeft = saved;
      updateArrows();
    } else {
      // animasyonsuz merkezle
      requestAnimationFrame(() => centerEl(active || null, false));
    }

    rail.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(rail);

    // Sekmeye tıklanınca yeni aktifi merkeze al (smooth)
    const onClick = (e: Event) => {
      const t = e.target as HTMLElement;
      const pill = t.closest(".nav-pill") as HTMLElement | null;
      if (pill) setTimeout(() => centerEl(pill, true), 40);
    };
    rail.addEventListener("click", onClick);

    return () => {
      rail.removeEventListener("scroll", updateArrows);
      rail.removeEventListener("click", onClick);
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

  // Sekme navigasyonu: Drinks bu sayfada, Extras /extras, diğerleri /menu?cat=...
  const handleTabChange = (key: string) => {
    if (key === "drinks") return;
    if (key === "extras") {
      router.push("/extras");
    } else {
      router.push(`/menu?cat=${encodeURIComponent(key)}`);
    }
  };

  return (
    <main className="mx-auto max-w-7xl p-6">
      {/* KOPF: Logo + Navigation (yatay kaydırmalı sekmeler) */}
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

        {/* Sekmeler — oklar sadece gerekirse görünür, aktif sekme ortalanır */}
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
              tab={"drinks" as any}
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
              Noch keine Getränke-Gruppen vorhanden. Bitte im Admin-Bereich unter
              <b> Getränke-Gruppen</b> Gruppen anlegen (Key: <code>{LS_DRINK_GROUPS}</code>).
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
                  category="drinks"
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

      {/* Stil – hizalı, sade + sekme okları */}
      <style jsx global>{`
        /* sekme rail + oklar */
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

        /* grid/card */
        .grid-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
          align-items: start;
        }
        .grid-cards > .menu-card { display: flex; }
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
        .grid-cards > .menu-card .product-card .product-card__cta { margin-top: auto; }
      `}</style>
    </main>
  );
}
