// app/menu/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import ProductCard from "@/components/menu/ProductCard";
import CartSummary, { CartSummaryMobile } from "@/components/CartSummary";
import NavBar from "@/components/NavBar";
import { useCart } from "@/components/store";
import {
  isProductAvailable,
  priceWithCampaign,
  type Campaign,
  type Category,
  sortProductsForMenu,
  popularityBadgeFor,
} from "@/lib/catalog";
import { loadNormalizedCampaigns } from "@/lib/campaigns-compat";
import CategoryBlurb from "@/components/CategoryBlurb";

/* ==== LS anahtarları ==== */
const LS_PRODUCTS = "bb_products_v1";

/* ====== Settings fallback (sadece ihtiyacımız olan kısım) ====== */
const LS_SETTINGS = "bb_settings_v6";
type FeatureFlags = { donuts: boolean; bubbleTea: boolean };

/* ==== Tipler ==== */
type Extra = { id: string; name: string; price: number };
type Product = {
  id?: string;
  sku?: string;
  code?: string;
  name: string;
  price: number;
  category: any;
  imageUrl?: string;
  description?: string;
  extras?: Extra[];
  allergens?: string[];
  allergenHinweise?: string;
  active?: boolean;
  activeFrom?: string;
  activeTo?: string;
};

/* === Sekmeler / başlıklar === */
type TabKey =
  | "burger"
  | "vegan"
  | "extras"
  | "sauces"
  | "hotdogs"
  | "drinks"
  | "donuts"
  | "bubbletea";

const ALL_TABS: TabKey[] = [
  "burger",
  "vegan",
  "extras",
  "sauces",
  "hotdogs",
  "drinks",
  "donuts",
  "bubbletea",
];

const TAB_TITLE: Record<TabKey, string> = {
  burger: "Burger",
  vegan: "Vegan / Vegetarisch",
  extras: "Extras",
  sauces: "Soßen",
  hotdogs: "Hot Dogs",
  drinks: "Getränke",
  donuts: "Donuts",
  bubbletea: "Bubble Tea",
};

/* --- Bu tab’lar kendi route’larına gider; diğerleri /menu’da kalır --- */
const ROUTE_MAP: Partial<Record<TabKey, string>> = {
  extras: "/extras",
  sauces: "/sauces",
  drinks: "/drinks",
  hotdogs: "/hotdogs",
  donuts: "/donuts",
  bubbletea: "/bubble-tea",
};

/* === Yardımcılar === */
function normalizeCategory(input: any): TabKey | null {
  const s = String(input ?? "").toLowerCase().trim();
  if (!s) return null;
  if (s.includes("vegan") || s.includes("vegetar")) return "vegan";
  if (s.includes("drink") || s.includes("getränk") || s.includes("getraenk")) return "drinks";
  if (s.includes("soß") || s.includes("sauce") || s.includes("sos")) return "sauces";
  if (s.includes("hotdog") || s.includes("hot dog") || (s.includes("hot") && s.includes("dog"))) return "hotdogs";
  if (s.includes("donut") || s.includes("doughnut")) return "donuts";
  if (s.includes("bubble") || s.includes("boba") || s.includes("milk tea") || s.includes("bubbletea")) return "bubbletea";
  if (s.includes("extra") || s.includes("snack") || s.includes("pommes")) return "extras";
  if (s.includes("burger")) return "burger";
  return null;
}
function guessCategory(p: Product): TabKey {
  const fromField = normalizeCategory(p.category);
  if (fromField) return fromField;

  const sku = String(p.sku ?? p.code ?? p.id ?? "").toLowerCase();
  const text = `${String(p.name ?? "").toLowerCase()} ${String(p.description ?? "").toLowerCase()}`;

  const checks: Array<[RegExp, TabKey]> = [
    [/^vegan-/, "vegan"],
    [/^(drink|cola|fritz|jarritos|ayran|wasser|water|ice ?tea|fanta|sprite|mezzo)/, "drinks"],
    [/^sauce-/, "sauces"],
    [/^(hotdog|hot-dog|dog)-/, "hotdogs"],
    [/^(donut|doughnut|dn-)/, "donuts"],
    [/^(bubbletea|bubble-tea|btea|boba|milktea)-/, "bubbletea"],
    [/^(extra|snack|fries|pommes|rings|nugget|country)/, "extras"],
  ];
  for (const [re, key] of checks) if (re.test(sku)) return key;

  if (/(hot ?dog|hotdog)/.test(text)) return "hotdogs";
  if (/(donut|doughnut)/.test(text)) return "donuts";
  if (/(bubble ?tea|boba|milk ?tea|taro|matcha)/.test(text)) return "bubbletea";
  if (/(cola|fritz|jarritos|ayran|wasser|water|ice ?tea|fanta|sprite|mezzo)/.test(text)) return "drinks";
  if (/(ketchup|mayo|mayonna|aioli|bbq|barbecue|sauce|soß|dip|sour ?cream|chili)/.test(text)) return "sauces";
  if (/(snack|pommes|fries|country|nugget|mozzarella|onion ring|curly|süßkartoffel|coleslaw)/.test(text)) return "extras";

  return "burger";
}

export default function MenuPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const orderMode = useCart((s: any) => s.orderMode) as "pickup" | "delivery";

  const [tab, setTab] = useState<TabKey>("burger");

  /* --- URL'de menü-dışı bir kategori geldiyse ilgili route’a yönlendir --- */
  useEffect(() => {
    const raw = (searchParams?.get("cat") || searchParams?.get("tab") || "").toLowerCase() as TabKey;
    if (!raw) return;
    const route = ROUTE_MAP[raw];
    if (route) {
      router.replace(route);
      return;
    }
    if (ALL_TABS.includes(raw)) setTab(raw);
  }, [searchParams, router]);

  useEffect(() => {
    const cls = "theme-vegan";
    if (tab === "vegan") document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [tab]);

  /* ==== Settings (bubbleTea/donuts) – API + LS fallback ==== */
  const [features, setFeatures] = useState<FeatureFlags>({ donuts: true, bubbleTea: true });

  useEffect(() => {
    let mounted = true;

    const fromLS = () => {
      try {
        const raw = localStorage.getItem(LS_SETTINGS);
        if (!raw) return null;
        const js = JSON.parse(raw);
        return {
          donuts: !!js?.features?.donuts?.enabled,
          bubbleTea: !!js?.features?.bubbleTea?.enabled,
        } as FeatureFlags;
      } catch {
        return null;
      }
    };

    const init = async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          if (mounted) {
            setFeatures({
              donuts: !!j?.features?.donuts?.enabled,
              bubbleTea: !!j?.features?.bubbleTea?.enabled,
            });
          }
          return;
        }
      } catch {}

      const ls = fromLS();
      if (mounted && ls) setFeatures(ls);
    };

    init();
    return () => {
      mounted = false;
    };
  }, []);

  const enabledTabs = useMemo<TabKey[]>(() => {
    return ALL_TABS.filter((t) => {
      if (t === "donuts" && !features.donuts) return false;
      if (t === "bubbletea" && !features.bubbleTea) return false;
      return true;
    });
  }, [features]);

  useEffect(() => {
    if (!enabledTabs.includes(tab)) {
      const next = enabledTabs[0] ?? "burger";
      setTab(next);
      const sp = new URLSearchParams(searchParams?.toString() || "");
      sp.set("cat", next);
      sp.delete("tab");
      router.replace(`${pathname}?${sp.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledTabs]);

  /* LS veri */
  const [products, setProducts] = useState<Product[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_PRODUCTS);
      setProducts(raw ? (JSON.parse(raw) as Product[]) : []);
    } catch {
      setProducts([]);
    }
    try {
      const cmps = loadNormalizedCampaigns();
      setCampaigns(cmps || []);
    } catch {
      setCampaigns([]);
    }
  }, []);

  /* --- tab değişince özel route’a git; aksi halde /menu?cat=... --- */
  const handleTabChange = (t: TabKey) => {
    const route = ROUTE_MAP[t];
    if (route) {
      router.push(route);
      return;
    }
    setTab(t);
    const sp = new URLSearchParams(searchParams?.toString() || "");
    sp.set("cat", t);
    sp.delete("tab");
    router.replace(`${pathname}?${sp.toString()}`);
  };

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

    // İlk yüklemede aktif sekmeyi ortala
    const active =
      (rail.querySelector(".nav-pill--active") as HTMLElement) ||
      (rail.querySelector('[aria-current="page"]') as HTMLElement) ||
      (rail.querySelector('[data-active-tab="true"]') as HTMLElement);
    requestAnimationFrame(() => centerEl(active));

    updateArrows();
    rail.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(rail);

    // Tıklamada yeni aktifi ortala
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

  /* Liste */
  const now = new Date();

  const filteredByTab = useMemo(() => {
    return (products || []).filter((p) => {
      const cat = guessCategory(p);
      if (cat === "donuts" && !features.donuts) return false;
      if (cat === "bubbletea" && !features.bubbleTea) return false;
      return cat === tab;
    });
  }, [products, tab, features]);

  const baseListForTab = useMemo(() => {
    return filteredByTab.map((p) => ({
      id: String(p.id ?? p.sku ?? p.code ?? p.name),
      name: p.name,
      price: p.price,
      category: guessCategory(p) as unknown as Category,
    }));
  }, [filteredByTab]);

  const sortedForMenu = useMemo(() => {
    return sortProductsForMenu(baseListForTab, campaigns, orderMode, now);
  }, [baseListForTab, campaigns, orderMode, now]);

  const byId = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of filteredByTab) {
      const id = String(p.id ?? p.sku ?? p.code ?? p.name);
      m.set(id, p);
    }
    return m;
  }, [filteredByTab]);

  const list = useMemo(() => {
    const isBV = tab === "burger" || tab === "vegan";

    return sortedForMenu.map((plike) => {
      const p = byId.get(plike.id)!;

      const availProbe = {
        id: plike.id,
        name: plike.name,
        price: plike.price,
        category: plike.category,
        active: (p as any)?.active,
        activeFrom: (p as any)?.activeFrom,
        activeTo: (p as any)?.activeTo,
      } as any;

      const available = isProductAvailable(availProbe, now);

      const pr = priceWithCampaign(
        { id: plike.id, name: plike.name, price: plike.price, category: plike.category },
        campaigns,
        orderMode,
        now
      );

      let topSellerRank: 1 | 2 | 3 | undefined;
      if (isBV) {
        const badge = popularityBadgeFor(plike.id, baseListForTab);
        topSellerRank =
          badge === "gold" ? 1 : badge === "silver" ? 2 : badge === "bronze" ? 3 : undefined;
      }

      return {
        p,
        available,
        price: pr.final,
        original: pr.original,
        badge: pr.badge,
        countdown: pr.countdown,
        topSellerRank,
      };
    });
  }, [sortedForMenu, byId, campaigns, orderMode, now, tab, baseListForTab]);

  const emptyMsgMap: Record<TabKey, string> = {
    burger:
      'Aktuell keine Burger vorhanden. Bitte im Admin-Bereich Produkte der Etageegorie „Burger“ hinzufügen.',
    vegan:
      'Aktuell keine veganen Burger vorhanden. Bitte im Admin-Bereich Produkte der Etageegorie „Vegan / Vegetarisch“ hinzufügen.',
    extras:
      'Noch keine Extras-Gruppen vorhanden. Bitte im Admin-Bereich unter „Extras-Gruppen“ Gruppen anlegen.',
    sauces:
      'Noch keine Soßen vorhanden. Bitte im Admin-Bereich Produkte der Etageegorie „Soßen“ hinzufügen.',
    hotdogs:
      'Noch keine Hot Dogs vorhanden. Bitte im Admin-Bereich Produkte der Etageegorie „Hot Dogs“ hinzufügen.',
    drinks:
      'Noch keine Getränke vorhanden. Bitte im Admin-Bereich Produkte der Etageegorie „Getränke“ hinzufügen.',
    donuts:
      'Noch keine Donuts vorhanden. Bitte im Admin-Bereich Produkte der Etageegorie „Donuts“ hinzufügen.',
    bubbletea:
      'Noch kein Bubble Tea vorhanden. Bitte im Admin-Bereich Produkte der Etageegorie „Bubble Tea“ hinzufügen.',
  };

  const showBlurb = tab === "burger" || tab === "vegan" || tab === "hotdogs";

  return (
    <main className="mx-auto max-w-7xl p-6">
      {/* Kopfbereich */}
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

        {/* SEKME RAIL — oklar sadece gerektiğinde, aktif tab merkezde */}
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
              tab={tab as any}
              onTabChange={handleTabChange as any}
              showLocationCaption={false}
              tabs={enabledTabs.map((k) => ({ key: k, label: TAB_TITLE[k] }))}
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

      {/* Produkt-Grid + Warenkorb */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          {showBlurb && <CategoryBlurb category={tab as "burger" | "vegan" | "hotdogs"} />}

          <div className="grid-cards">
            {list.length === 0 ? (
              <div className="col-span-full rounded-xl border border-stone-700/60 bg-stone-900/60 p-4 text-sm text-stone-300">
                {emptyMsgMap[tab]}
              </div>
            ) : (
              list.map(({ p, available, price, original, badge, countdown, topSellerRank }) => (
                <div key={(p.id ?? p.sku ?? p.code ?? p.name) as string} className="menu-card">
                  <ProductCard
                    sku={String(p.id ?? p.sku ?? p.code ?? p.name)}
                    name={p.name}
                    price={price}
                    originalPrice={original}
                    description={p.description || ""}
                    image={p.imageUrl}
                    category={guessCategory(p) as unknown as Category}
                    extrasOptions={(p.extras || []).map((e) => ({
                      id: e.id,
                      label: e.name,
                      price: e.price,
                    }))}
                    allergens={p.allergens}
                    allergenHinweise={p.allergenHinweise}
                    outOfStock={!available}
                    campaignLabel={badge ? (countdown ? `${badge} · ${countdown}` : badge) : undefined}
                    coverRatio="16/10"
                    topSellerRank={topSellerRank as 1 | 2 | 3 | undefined}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:sticky lg:top-4 lg:h-fit">
          <CartSummary />
        </div>
      </div>

      <CartSummaryMobile />

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

        /* grid/cards */
        .grid-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
          align-items: stretch;
        }
        .grid-cards > .menu-card {
          display: flex;
          height: 100%;
        }
        .grid-cards > .menu-card > article.product-card {
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        @media (max-width: 480px) {
          .product-card .cover { min-height: 160px; }
        }
        .product-card [data-desc-empty] {
          min-height: 1.25rem;
          display: block;
        }
        .grid-cards > .menu-card .card p,
        .grid-cards > .menu-card .card .desc,
        .grid-cards > .menu-card [data-desc] {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </main>
  );
}
