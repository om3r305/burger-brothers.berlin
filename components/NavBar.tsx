// components/NavBar.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { useCart } from "@/components/store";

type Variant = "menu" | "plain";

/* ───────── feature flags (donuts / bubbleTea) ───────── */
const LS_SETTINGS = "bb_settings_v6";

function readFeatureEnabled(key: "donuts" | "bubbleTea"): boolean {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return true; // default: visible
    const s = JSON.parse(raw);
    return !!s?.features?.[key]?.enabled;
  } catch {
    return true;
  }
}

function useFeatureFlags() {
  const [donutsOn, setDonutsOn] = useState<boolean>(true);
  const [btOn, setBtOn] = useState<boolean>(true);

  useEffect(() => {
    const sync = () => {
      setDonutsOn(readFeatureEnabled("donuts"));
      setBtOn(readFeatureEnabled("bubbleTea"));
    };
    sync();

    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === LS_SETTINGS) sync();
    };
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

/* ───────── component ───────── */
export default function NavBar(props: {
  variant: Variant;
  tab?: "burger" | "vegan";
  onTabChange?: (t: "burger" | "vegan") => void;
  showLocationCaption?: boolean;
}) {
  const { variant, tab = "burger", onTabChange } = props;
  const pathname = usePathname();
  const search = useSearchParams();
  const { donutsOn, btOn } = useFeatureFlags();

  const pill = (href: string, extra = "") =>
    `nav-pill${pathname === href ? " nav-pill--active" : ""}${extra ? " " + extra : ""}`;

  // cart pill
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

  const TabBtn = ({
    active,
    vegan,
    children,
    onClick,
  }: {
    active?: boolean;
    vegan?: boolean;
    children: React.ReactNode;
    onClick: () => void;
  }) => (
    <button
      type="button"
      className={`nav-pill ${active ? "nav-pill--active" : ""} ${
        vegan && active ? "nav-pill--vegan" : ""
      }`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </button>
  );

  const isVeganActivePlain = pathname === "/menu" && search?.get("tab") === "vegan";

  return (
    <nav className="flex items-center gap-2">
      {variant === "menu" ? (
        <>
          {/* Burger tab / link */}
          {pathname === "/menu" ? (
            <TabBtn active={tab === "burger"} onClick={() => onTabChange?.("burger")}>
              Burger
            </TabBtn>
          ) : (
            <Link href="/menu" className={pill("/menu")}>Burger</Link>
          )}

          {/* Vegan – sadece /menu ve aktifken yeşil */}
          {pathname === "/menu" ? (
            <TabBtn active={tab === "vegan"} vegan onClick={() => onTabChange?.("vegan")}>
              <span className="mr-1" aria-hidden>🌿</span>
              Vegan / Vegetarisch
            </TabBtn>
          ) : (
            <Link
              href={{ pathname: "/menu", query: { tab: "vegan" } }}
              className="nav-pill" /* nötr görünüm: diğer sayfalarda yeşil değil */
              aria-label="Vegan / Vegetarisch"
            >
              <span className="mr-1" aria-hidden>🌿</span>
              Vegan / Vegetarisch
            </Link>
          )}

          {/* Diğer kategoriler */}
          <Link href="/extras"  className={pill("/extras")}>Extras</Link>
          <Link href="/drinks"  className={pill("/drinks")}>Getränke</Link>
          <Link href="/sauces"  className={pill("/sauces")}>Soßen</Link>
          <Link href="/hotdogs" className={pill("/hotdogs")}>Hot Dogs</Link>
          {donutsOn && <Link href="/donuts" className={pill("/donuts")}>Donuts</Link>}
          {btOn && <Link href="/bubble-tea" className={pill("/bubble-tea")}>Bubble Tea</Link>}

          <NavCartPill />
        </>
      ) : (
        <>
          {/* plain: her sayfada linkler */}
          <Link href="/menu" className={pill("/menu")}>Burger</Link>

          {/* Vegan – sadece /menu?tab=vegan iken yeşil + aktif */}
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
