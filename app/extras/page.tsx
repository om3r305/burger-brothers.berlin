// app/extras/page.tsx
"use client";

import NextImage from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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

const LS_EXTRA_GROUPS = "bb_extra_groups_v1";

/** JSON’u güvenli şekilde VariantGroup[]’e normalle */
function normalizeGroups(input: any): VariantGroup[] {
  const arr = Array.isArray(input) ? input : [];
  return arr.map((g: any) => ({
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
}

/** API yanıtı şunlardan biri olabilir:
 *  - Doğrudan VariantGroup[]
 *  - { bb_extra_groups_v1: "json-string" }
 *  - { data: VariantGroup[] } / { items: VariantGroup[] }
 */
function extractGroupsFromApiPayload(payload: any): VariantGroup[] | null {
  if (!payload) return null;
  if (Array.isArray(payload)) return normalizeGroups(payload);
  if (payload?.bb_extra_groups_v1) {
    try {
      const parsed = JSON.parse(payload.bb_extra_groups_v1);
      return normalizeGroups(parsed);
    } catch {}
  }
  if (Array.isArray(payload?.data)) return normalizeGroups(payload.data);
  if (Array.isArray(payload?.items)) return normalizeGroups(payload.items);
  return null;
}

export default function ExtrasPage() {
  const router = useRouter();

  const [groups, setGroups] = useState<VariantGroup[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;

    const readFromLS = (): VariantGroup[] | null => {
      try {
        const raw = localStorage.getItem(LS_EXTRA_GROUPS);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return normalizeGroups(parsed);
      } catch {
        return null;
      }
    };

    const writeToLS = (val: VariantGroup[]) => {
      try {
        localStorage.setItem(LS_EXTRA_GROUPS, JSON.stringify(val));
        // Diğer sekmeler cihazında senkron olsun
        window.dispatchEvent(new Event("storage"));
        window.dispatchEvent(new Event("bb_settings_changed" as any));
      } catch {}
    };

    const SOURCES = [
      "/api/extras-groups",
      "/api/data/extras-groups",
      "/api/bootstrap?keys=bb_extra_groups_v1",
      "/data/extras-groups.json",
      "/data/extras.json",
      "/extras.json",
    ];

    const tryFetchChain = async (): Promise<VariantGroup[] | null> => {
      for (const url of SOURCES) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) continue;
          const payload = await res.json().catch(() => null);
          const got = extractGroupsFromApiPayload(payload) ?? normalizeGroups(payload);
          if (got && got.length) return got;
        } catch {
          /* ignore and continue */
        }
      }
      return null;
    };

    (async () => {
      // 1) Önce LS
      const lsVal = readFromLS();
      if (lsVal && lsVal.length) {
        if (!mounted) return;
        setGroups(lsVal);
        setLoaded(true);
        // Arka planda sessiz güncelleme (varsa)
        try {
          const fresh = await tryFetchChain();
          if (fresh && mounted) {
            setGroups(fresh);
            writeToLS(fresh);
          }
        } catch {}
        return;
      }

      // 2) LS boşsa zincirden getir → LS’ye yaz → kullan
      const fetched = await tryFetchChain();
      if (mounted) {
        if (fetched && fetched.length) {
          setGroups(fetched);
          writeToLS(fetched);
        } else {
          setGroups([]);
        }
        setLoaded(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  /* --- ÜST SEKMELER: yatay kaydırma + oklar + aktif sekmeyi ortalama --- */
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

  // Ray içinde bir sekmeyi merkeze hizala
  const centerEl = (pill: HTMLElement | null) => {
    const rail = railRef.current;
    if (!rail || !pill) return;
    const railRect = rail.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const targetLeft =
      rail.scrollLeft +
      (pillRect.left + pillRect.width / 2 - (railRect.left + railRect.width / 2));
    rail.scrollTo({ left: targetLeft, behavior: "smooth" });
    setTimeout(updateArrows, 250);
  };

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    // İlk açılışta aktif "Extras" sekmesini ortala
    const active =
      (rail.querySelector(".nav-pill--active") as HTMLElement) ||
      (rail.querySelector('[aria-current="page"]') as HTMLElement) ||
      (rail.querySelector('[data-active-tab="true"]') as HTMLElement);
    requestAnimationFrame(() => centerEl(active));

    updateArrows();
    rail.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(rail);

    // Sekmeye tıklanınca yeni aktifi ortala
    const onClick = (e: Event) => {
      const t = e.target as HTMLElement;
      const pill = t.closest(".nav-pill") as HTMLElement | null;
      if (pill) setTimeout(() => centerEl(pill), 40);
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

  // Sekme tıklanınca doğru sayfaya git
  // burger/vegan -> /menu?cat=..., drinks -> /drinks, sauces -> /sauces, hotdogs -> /hotdogs,
  // donuts -> /donuts, bubbletea -> /bubble-tea, extras -> bu sayfa
  const handleTabChange = (key: string) => {
    const k = key.toLowerCase();
    if (k === "extras") return;
    if (k === "drinks") return router.push("/drinks");
    if (k === "sauces") return router.push("/sauces");
    if (k === "hotdogs") return router.push("/hotdogs");
    if (k === "donuts") return router.push("/donuts");
    if (k === "bubbletea") return router.push("/bubble-tea");
    // burger/vegan ve diğerleri menu sayfasında
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
              <b> Extras-Gruppen</b> Gruppen anlegen (Key: <code>{LS_EXTRA_GROUPS}</code>).
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

      {/* Stil – hizalı, boşluk optimize + sekme okları */}
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
