// components/NavBar.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { useCart } from "@/components/store";

type Variant = "menu" | "plain";

/* ——— Feature flags (donuts / bubbleTea) ——— */
const LS_SETTINGS = "bb_settings_v6";
function readFeatureEnabled(key: "donuts" | "bubbleTea"): boolean {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return true;
    const s = JSON.parse(raw);
    return !!s?.features?.[key]?.enabled;
  } catch { return true; }
}
function useFeatureFlags() {
  const [donutsOn, setDonutsOn] = useState(true);
  const [btOn, setBtOn] = useState(true);
  useEffect(() => {
    const sync = () => {
      setDonutsOn(readFeatureEnabled("donuts"));
      setBtOn(readFeatureEnabled("bubbleTea"));
    };
    sync();
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key === LS_SETTINGS) sync(); };
    const onCustom = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener("bb_settings_changed" as any, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bb_settings_changed" as any, onCustom);
    };
  }, []);
  return { donutsOn, btOn };
}

/* ——— Props ——— */
type TabItem = { key: string; label: string };

export default function NavBar(props: {
  variant: Variant;
  /** Aktif tab anahtarı (örn. 'burger', 'drinks'...) */
  tab?: string;
  /** Sekme değiştirici (sadece variant='menu' ve butonlu sekmelerde kullanılır) */
  onTabChange?: (t: string) => void;
  showLocationCaption?: boolean;
  /** Opsiyonel sekme listesi: verilirse butonlu sekme şeridi render edilir */
  tabs?: TabItem[];
  className?: string;
}) {
  const {
    variant,
    tab = "burger",
    onTabChange,
    showLocationCaption = true,
    tabs,
    className = "",
  } = props;

  const pathname = usePathname();
  const search = useSearchParams();
  const { donutsOn, btOn } = useFeatureFlags();

  const pill = (href: string, extra = "") =>
    `nav-pill${pathname === href ? " nav-pill--active" : ""}${extra ? " " + extra : ""}`;

  // Cart pill
  const NavCartPill = () => {
    const items = useCart((s: any) => s.items);
    const computePricing = useCart((s: any) => s.computePricing);

    const count = useMemo(
      () => (items || []).reduce((acc: number, ci: any) => acc + (Number(ci?.qty) || 1), 0),
      [items]
    );

    const total = useMemo(() => {
      try {
        const res = computePricing?.();
        if (res && typeof res.total === "number") return res.total;
      } catch {}
      return (items || []).reduce((sum: number, ci: any) => {
        const add = (ci?.add || []).reduce((a: number, b: any) => a + (Number(b?.price) || 0), 0);
        const base = Number(ci?.price ?? ci?.item?.price ?? 0);
        const qty = Number(ci?.qty || 1);
        return sum + (base + add) * qty;
      }, 0);
    }, [items, computePricing]);

    const fmt = (n: number) =>
      new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

    return (
      <Link href="/checkout" className="nav-pill nav-pill--cart" aria-label="Warenkorb öffnen">
        <span className="mr-1">🛒</span>
        <span className="font-medium">{count}</span>
        <span className="mx-1">•</span>
        <span className="font-semibold">{fmt(total)}</span>
      </Link>
    );
  };

  // Buton sekme bileşeni (menu varyantında kullanılır)
  const TabBtn = ({
    active, vegan, children, onClick,
  }: {
    active?: boolean;
    vegan?: boolean;
    children: React.ReactNode;
    onClick: () => void;
  }) => (
    <button
      type="button"
      className={`nav-pill ${active ? "nav-pill--active" : ""} ${vegan && active ? "nav-pill--vegan" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </button>
  );

  const isVeganActivePlain = pathname === "/menu" && search?.get("tab") === "vegan";

  return (
    <nav className={`flex items-center gap-2 ${className}`}>
      {variant === "menu" ? (
        // Eğer props.tabs verildiyse: butonlu sekme şeridi (page.tsx ile uyumlu)
        Array.isArray(tabs) && tabs.length > 0 ? (
          <>
            {tabs.map((t) => (
              <TabBtn
                key={t.key}
                active={String(tab) === String(t.key)}
                vegan={String(t.key) === "vegan"}
                onClick={() => onTabChange?.(t.key)}
              >
                {String(t.key) === "vegan" ? <><span className="mr-1" aria-hidden>🌿</span>{t.label}</> : t.label}
              </TabBtn>
            ))}
            <NavCartPill />
          </>
        ) : (
          // Aksi halde: eski link bazlı navbar (geri uyumluluk)
          <>
            <Link href="/menu" className={pill("/menu")}>Burger</Link>
            <Link
              href={{ pathname: "/menu", query: { tab: "vegan" } }}
              className={`nav-pill${isVeganActivePlain ? " nav-pill--active nav-pill--vegan" : ""}`}
              aria-label="Vegan / Vegetarisch"
              aria-current={isVeganActivePlain ? "page" : undefined}
            >
              <span className="mr-1" aria-hidden>🌿</span>
              Vegan / Vegetarisch
            </Link>
            <Link href="/extras"  className={pill("/extras")}>Extras</Link>
            <Link href="/drinks"  className={pill("/drinks")}>Getränke</Link>
            <Link href="/sauces"  className={pill("/sauces")}>Soßen</Link>
            <Link href="/hotdogs" className={pill("/hotdogs")}>Hot Dogs</Link>
            {donutsOn && <Link href="/donuts" className={pill("/donuts")}>Donuts</Link>}
            {btOn && <Link href="/bubble-tea" className={pill("/bubble-tea")}>Bubble Tea</Link>}
            <NavCartPill />
          </>
        )
      ) : (
        // plain varyantı: her sayfada linkler
        <>
          {showLocationCaption && <span className="text-xs opacity-70 mr-1">Berlin Tegel</span>}
          <Link href="/menu" className={pill("/menu")}>Burger</Link>
          <Link
            href={{ pathname: "/menu", query: { tab: "vegan" } }}
            className={`nav-pill${isVeganActivePlain ? " nav-pill--active nav-pill--vegan" : ""}`}
            aria-label="Vegan / Vegetarisch"
            aria-current={isVeganActivePlain ? "page" : undefined}
          >
            <span className="mr-1" aria-hidden>🌿</span>
            Vegan / Vegetarisch
          </Link>
          <Link href="/extras"  className={pill("/extras")}>Extras</Link>
          <Link href="/drinks"  className={pill("/drinks")}>Getränke</Link>
          <Link href="/sauces"  className={pill("/sauces")}>Soßen</Link>
          <Link href="/hotdogs" className={pill("/hotdogs")}>Hot Dogs</Link>
          {donutsOn && <Link href="/donuts" className={pill("/donuts")}>Donuts</Link>}
          {btOn && <Link href="/bubble-tea" className={pill("/bubble-tea")}>Bubble Tea</Link>}
          <NavCartPill />
        </>
      )}
    </nav>
  );
}
