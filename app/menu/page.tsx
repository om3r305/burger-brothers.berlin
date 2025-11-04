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
  // 🆕 menü sıralama + popülerlik için
  sortProductsForMenu,
  // 🆕 top rozetini hesaplamak için
  popularityBadgeFor,
} from "@/lib/catalog";
/* kampanyaları normalize eden ortak loader (siteConfig + LS) */
import { loadNormalizedCampaigns } from "@/lib/campaigns-compat";

/* ✅ eklendi: kategori açıklaması */
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

/* 🔒 Sıra: Burger → Vegan → ... (Vegan 2. sırada sabit) */
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
  vegan: "Vegan",
  extras: "Extras",
  sauces: "Soßen",
  hotdogs: "Hot Dogs",
  drinks: "Getränke",
  donuts: "Donuts",
  bubbletea: "Bubble Tea",
};

/* === Yardımcılar === */

/** Ürün kategorisini TabKey’e normalize et */
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

/** Fallback: sku/name/ipucu ile kategori yakala */
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

  /* URL -> tab (cat veya tab param) */
  const [tab, setTab] = useState<TabKey>("burger");
  useEffect(() => {
    const cat = (searchParams?.get("cat") || searchParams?.get("tab") || "").toLowerCase();
    if (ALL_TABS.includes(cat as TabKey)) setTab(cat as TabKey);
  }, [searchParams]);

  /* Vegan teması */
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
      } catch { return null; }
    };

    const init = async () => {
      // 1) Deneme: server settings
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
      } catch {/* geç */ }

      // 2) Fallback: localStorage (eski davranış)
      const ls = fromLS();
      if (mounted && ls) setFeatures(ls);
    };

    init();
    return () => { mounted = false; };
  }, []);

  /* Sekme listesi: özelliklere göre filtrele (sıra ALL_TABS'tan gelir) */
  const enabledTabs = useMemo<TabKey[]>(() => {
    return ALL_TABS.filter((t) => {
      if (t === "donuts" && !features.donuts) return false;
      if (t === "bubbletea" && !features.bubbleTea) return false;
      return true;
    });
  }, [features]);

  /* Aktif tab artık görünmüyorsa güvenli birine atla */
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

  /* LS’ten veri */
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
      // 🆕 tüm kampanyaları normalize eden ortak loader
      const cmps = loadNormalizedCampaigns();
      setCampaigns(cmps || []);
    } catch {
      setCampaigns([]);
    }
  }, []);

  /* Sekme değiştirme -> URL güncelle */
  const handleTabChange = (t: TabKey) => {
    setTab(t);
    const sp = new URLSearchParams(searchParams?.toString() || "");
    sp.set("cat", t);
    sp.delete("tab");
    router.replace(`${pathname}?${sp.toString()}`);
  };

  /* Sekme scroller okları için ref (opsiyonel) */
  const tabsWrapRef = useRef<HTMLDivElement | null>(null);
  const scrollTabs = (dir: "left" | "right") => {
    const el = tabsWrapRef.current;
    if (!el) return;
    const delta = Math.floor(el.clientWidth * 0.85);
    el.scrollBy({ left: dir === "left" ? -delta : delta, behavior: "smooth" });
  };

  /* Liste */
  const now = new Date();

  // 1) Aktif tab'a ait ürünleri topla
  const filteredByTab = useMemo(() => {
    return (products || []).filter((p) => {
      const cat = guessCategory(p);
      if (cat === "donuts" && !features.donuts) return false;
      if (cat === "bubbletea" && !features.bubbleTea) return false;
      return cat === tab;
    });
  }, [products, tab, features]);

  // 2) Menü sıralama (kampanyalılar en üstte + burger/vegan popülerlik)
  const baseListForTab = useMemo(() => {
    // ProductLike listesi
    return filteredByTab.map((p) => ({
      id: String(p.id ?? p.sku ?? p.code ?? p.name),
      name: p.name,
      price: p.price,
      category: (guessCategory(p) as unknown as Category),
    }));
  }, [filteredByTab]);

  const sortedForMenu = useMemo(() => {
    return sortProductsForMenu(baseListForTab, campaigns, orderMode, now);
  }, [baseListForTab, campaigns, orderMode, now]);

  // 3) ID -> Product map
  const byId = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of filteredByTab) {
      const id = String(p.id ?? p.sku ?? p.code ?? p.name);
      m.set(id, p);
    }
    return m;
  }, [filteredByTab]);

  // 4) Kartlara gidecek nihai liste (fiyat, rozet, stok bilgisi + 🏅 top rozet rank)
  const list = useMemo(() => {
    const isBV = tab === "burger" || tab === "vegan";

    return sortedForMenu.map((plike) => {
      const p = byId.get(plike.id)!;
      const available = isProductAvailable(p, now);
      const pr = priceWithCampaign(
        { id: plike.id, name: plike.name, price: plike.price, category: plike.category },
        campaigns,
        orderMode,
        now
      );

      // 🏅 sadece burger/vegan için top rozet (son 14 gün)
      let topSellerRank: 1 | 2 | 3 | undefined;
      if (isBV) {
        const badge = popularityBadgeFor(plike.id, baseListForTab); // "gold" | "silver" | "bronze" | null
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

  /* Boş mesaj */
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

  /* ✅ hangi sekmelerde blurb gösterilecek */
  const showBlurb =
    tab === "burger" || tab === "vegan" || tab === "hotdogs";

  return (
    <main className="mx-auto max-w-7xl p-6">
      {/* Kopfbereich */}
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        {/* Logo + Titel */}
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

        {/* Etageegori sekmeleri — logonun ALTINDA, yatay kaydırmalı */}
        <div className="relative -mx-6 px-6 sm:mx-0 sm:px-0">
          <button
            aria-label="Tabs nach links"
            className="bb-tab-arrow bb-tab-arrow--left"
            onClick={() => scrollTabs("left")}
          >
            ‹
          </button>
          <button
            aria-label="Tabs nach rechts"
            className="bb-tab-arrow bb-tab-arrow--right"
            onClick={() => scrollTabs("right")}
          >
            ›
          </button>

          <div ref={tabsWrapRef} className="bb-tabs-scroll bb-tabs-mask">
            <div className="whitespace-nowrap">
              <NavBar
                variant="menu"
                tab={tab as any}
                onTabChange={handleTabChange as any}
                showLocationCaption={false}
                tabs={enabledTabs.map((k) => ({ key: k, label: TAB_TITLE[k] }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Produkt-Grid + Warenkorb */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          {/* ✅ kategori açıklaması – sadece burger/vegan/hotdogs */}
          {showBlurb && (
            <CategoryBlurb category={tab as "burger" | "vegan" | "hotdogs"} />
          )}

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
                    category={(guessCategory(p) as unknown as Category)}
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
                    // 🏅 görsel madalya
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

      {/* Mobil sabit checkout butonu */}
      <CartSummaryMobile />

      {/* Grid/Card yardımcılar — kart yüksekliklerini eşitle + iOS aspect-ratio guard */}
      <style jsx global>{`
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
        .grid-cards > .menu-card [data-desc]{
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </main>
  );
}
