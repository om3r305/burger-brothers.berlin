// components/NavBar.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCart } from "@/components/store";
import { startAppNavigation } from "@/components/AppRouteTransition";
import { warmCategoryData } from "@/lib/public-data-cache";

type Variant = "menu" | "plain";

type TabItem = {
  key: string;
  label: string;
};

type MenuKey =
  | "burger"
  | "vegan"
  | "extras"
  | "drinks"
  | "sauces"
  | "hotdogs"
  | "donuts"
  | "bubbletea";

const LS_SETTINGS = "bb_settings_v6";

const ROUTE_BY_KEY: Record<MenuKey, string> = {
  burger: "/menu?cat=burger",
  vegan: "/menu?cat=vegan",
  extras: "/extras",
  drinks: "/drinks",
  sauces: "/sauces",
  hotdogs: "/hotdogs",
  donuts: "/donuts",
  bubbletea: "/bubble-tea",
};

const PREFETCH_ROUTES = Array.from(
  new Set(Object.values(ROUTE_BY_KEY).map((href) => href.split("?")[0])),
);

function normalizeMenuKey(value: unknown): MenuKey {
  const raw = String(value || "")
    .trim()
    .toLowerCase();

  if (raw === "vegan") return "vegan";
  if (raw === "extras") return "extras";
  if (raw === "drinks") return "drinks";
  if (raw === "sauces") return "sauces";
  if (raw === "hotdogs" || raw === "hotdog") return "hotdogs";
  if (raw === "donuts" || raw === "donut") return "donuts";
  if (
    raw === "bubbletea" ||
    raw === "bubble-tea" ||
    raw === "bubble_tea"
  ) {
    return "bubbletea";
  }

  return "burger";
}

function activeKeyForLocation(pathname: string, search: URLSearchParams | null) {
  if (pathname === "/extras") return "extras";
  if (pathname === "/drinks") return "drinks";
  if (pathname === "/sauces") return "sauces";
  if (pathname === "/hotdogs") return "hotdogs";
  if (pathname === "/donuts") return "donuts";
  if (pathname === "/bubble-tea") return "bubbletea";

  if (pathname === "/menu") {
    return normalizeMenuKey(search?.get("cat") || search?.get("tab"));
  }

  return "";
}

function readFeatureEnabled(key: "donuts" | "bubbleTea") {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return true;

    const settings = JSON.parse(raw);

    return settings?.features?.[key]?.enabled !== false;
  } catch {
    return true;
  }
}

function useFeatureFlags() {
  const [donutsOn, setDonutsOn] = useState(true);
  const [bubbleTeaOn, setBubbleTeaOn] = useState(true);

  useEffect(() => {
    const sync = () => {
      setDonutsOn(readFeatureEnabled("donuts"));
      setBubbleTeaOn(readFeatureEnabled("bubbleTea"));
    };

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === LS_SETTINGS) {
        sync();
      }
    };

    sync();

    window.addEventListener("storage", onStorage);
    window.addEventListener(
      "bb_settings_changed",
      sync as EventListener,
    );
    window.addEventListener(
      "bb:settings-sync",
      sync as EventListener,
    );

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "bb_settings_changed",
        sync as EventListener,
      );
      window.removeEventListener(
        "bb:settings-sync",
        sync as EventListener,
      );
    };
  }, []);

  return {
    donutsOn,
    bubbleTeaOn,
  };
}

function hrefForKey(key: string) {
  return ROUTE_BY_KEY[normalizeMenuKey(key)];
}

export default function NavBar(props: {
  variant: Variant;
  tab?: string;
  onTabChange?: (tab: string) => void;
  showLocationCaption?: boolean;
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
  const searchParams = useSearchParams();
  const router = useRouter();

  const { donutsOn, bubbleTeaOn } = useFeatureFlags();

  const navRef = useRef<HTMLElement | null>(null);
  const primedAtRef = useRef<Record<string, number>>({});
  const navigationLockRef = useRef(false);
  const unlockTimerRef = useRef<number | null>(null);

  const locationActiveKey = useMemo(
    () => activeKeyForLocation(pathname, searchParams),
    [pathname, searchParams],
  );

  const controlledActiveKey = normalizeMenuKey(tab);
  const activeKey =
    variant === "menu" && Array.isArray(tabs) && tabs.length > 0
      ? controlledActiveKey
      : locationActiveKey;

  const visibleTabs = useMemo(() => {
    const source =
      Array.isArray(tabs) && tabs.length > 0
        ? tabs
        : [
            { key: "burger", label: "Burger" },
            { key: "vegan", label: "Vegan / Vegetarisch" },
            { key: "extras", label: "Extras" },
            { key: "drinks", label: "Getränke" },
            { key: "sauces", label: "Soßen" },
            { key: "hotdogs", label: "Hot Dogs" },
            { key: "donuts", label: "Donuts" },
            { key: "bubbletea", label: "Bubble Tea" },
          ];

    return source.filter((item) => {
      const key = normalizeMenuKey(item.key);
      if (key === "donuts") return donutsOn;
      if (key === "bubbletea") return bubbleTeaOn;
      return true;
    });
  }, [tabs, donutsOn, bubbleTeaOn]);

  useEffect(() => {
    for (const href of PREFETCH_ROUTES) {
      try {
        router.prefetch(href);
      } catch {}
    }
  }, [router]);

  const centerActiveTab = useCallback((behavior: ScrollBehavior) => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>(
      '[data-bb-tab-active="true"]',
    );
    const rail = active?.closest<HTMLElement>(
      ".bb-tabs-scroll__rail",
    );

    if (!active || !rail) return;

    const railRect = rail.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const nextLeft =
      rail.scrollLeft +
      activeRect.left -
      railRect.left -
      (rail.clientWidth - activeRect.width) / 2;

    rail.scrollTo({
      left: Math.max(0, nextLeft),
      behavior,
    });
  }, []);

  useEffect(() => {
    /*
     * Yeni route açılırken sadece bir kere ve animasyonsuz hizala.
     * Hot Dogs / Donuts sekmesinin önce başa gidip geri gelmesi biter.
     */
    const frame = window.requestAnimationFrame(() => {
      centerActiveTab("auto");
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeKey, centerActiveTab]);

  useEffect(() => {
    const unlock = () => {
      navigationLockRef.current = false;

      if (unlockTimerRef.current) {
        window.clearTimeout(unlockTimerRef.current);
        unlockTimerRef.current = null;
      }
    };

    window.addEventListener("bb:navigation-end", unlock as EventListener);

    return () => {
      if (unlockTimerRef.current) {
        window.clearTimeout(unlockTimerRef.current);
      }

      window.removeEventListener(
        "bb:navigation-end",
        unlock as EventListener,
      );
    };
  }, []);

  const beginNavigation = useCallback((href: string) => {
    if (navigationLockRef.current) return false;

    navigationLockRef.current = true;

    startAppNavigation({
      href,
      source: "menu-tabs",
      scrollToTop: true,
    });

    unlockTimerRef.current = window.setTimeout(() => {
      navigationLockRef.current = false;
    }, 1_500);

    return true;
  }, []);

  const primeCategory = useCallback(
    (keyInput: string) => {
      const key = normalizeMenuKey(keyInput);
      const now = Date.now();
      const previous = primedAtRef.current[key] || 0;

      if (now - previous < 60_000) return;

      primedAtRef.current[key] = now;

      const href = hrefForKey(key);

      try {
        router.prefetch(href.split("?")[0]);
      } catch {}

      void warmCategoryData(key);
    },
    [router],
  );

  const handleTabClick = useCallback(
    (keyInput: string) => {
      const key = normalizeMenuKey(keyInput);
      const href = hrefForKey(key);

      if (key === activeKey) {
        centerActiveTab("smooth");
        return;
      }

      if (!beginNavigation(href)) return;

      /*
       * Menu sayfası kendi burger/vegan state'ini yönetiyorsa mevcut callback
       * korunur. Diğer bütün sayfalarda mevcut route isimleri aynen kullanılır.
       */
      if (typeof onTabChange === "function") {
        onTabChange(key);
        return;
      }

      router.push(href, {
        scroll: false,
      });
    },
    [
      activeKey,
      beginNavigation,
      centerActiveTab,
      onTabChange,
      router,
    ],
  );

  const items = useCart((state: any) => state.items);
  const computePricing = useCart((state: any) => state.computePricing);

  const cartCount = useMemo(
    () =>
      (items || []).reduce(
        (total: number, item: any) =>
          total + (Number(item?.qty) || 1),
        0,
      ),
    [items],
  );

  const cartTotal = useMemo(() => {
    try {
      const pricing = computePricing?.();

      if (pricing && typeof pricing.total === "number") {
        return pricing.total;
      }
    } catch {}

    return (items || []).reduce((sum: number, item: any) => {
      const extras = (item?.add || []).reduce(
        (extraTotal: number, extra: any) =>
          extraTotal + (Number(extra?.price) || 0),
        0,
      );

      const base = Number(item?.price ?? item?.item?.price ?? 0);
      const quantity = Number(item?.qty || 1);

      return sum + (base + extras) * quantity;
    }, 0);
  }, [items, computePricing]);

  const formattedCartTotal = useMemo(
    () =>
      new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
      }).format(cartTotal),
    [cartTotal],
  );

  const openCart = useCallback(() => {
    const href = "/checkout";

    if (!beginNavigation(href)) return;

    router.push(href, {
      scroll: false,
    });
  }, [beginNavigation, router]);

  return (
    <nav
      ref={navRef}
      aria-label="Menükategorien"
      className={`bb-app-nav ${className}`}
    >
      {variant === "plain" && showLocationCaption ? (
        <span className="bb-app-nav__location">Berlin Tegel</span>
      ) : null}

      <div className="bb-app-nav__tabs" role="tablist">
        {visibleTabs.map((item) => {
          const key = normalizeMenuKey(item.key);
          const active = key === activeKey;
          const vegan = key === "vegan";

          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              data-bb-tab-key={key}
              data-bb-tab-active={active ? "true" : "false"}
              className={[
                "nav-pill",
                "bb-app-nav__tab",
                active ? "nav-pill--active" : "",
                vegan && active ? "nav-pill--vegan" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onPointerDown={() => primeCategory(key)}
              onMouseEnter={() => primeCategory(key)}
              onFocus={() => primeCategory(key)}
              onClick={() => handleTabClick(key)}
            >
              {vegan ? (
                <span aria-hidden className="mr-1">
                  🌿
                </span>
              ) : null}

              {item.label}
            </button>
          );
        })}

        <button
          type="button"
          className="nav-pill nav-pill--cart bb-app-nav__cart"
          aria-label="Warenkorb öffnen"
          onClick={openCart}
        >
          <span aria-hidden>🛒</span>
          <span className="font-medium">{cartCount}</span>
          <span aria-hidden className="opacity-55">
            •
          </span>
          <span className="font-semibold">{formattedCartTotal}</span>
        </button>
      </div>
    </nav>
  );
}
