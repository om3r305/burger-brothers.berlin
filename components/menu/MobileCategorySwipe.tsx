"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startAppNavigation } from "@/components/AppRouteTransition";
import { warmCategoryData } from "@/lib/public-data-cache";
import { fetchAndApplyRemoteSettings, readSettings } from "@/lib/settings";
import { normalizeMenuTransitionSettings } from "@/lib/menu-transitions";
import {
  MENU_NAV_ITEMS,
  MENU_NAV_KEYS,
  MENU_NAV_ROUTES,
  type MenuNavKey,
} from "@/lib/menu-navigation";

const MENU_PATHS = new Set([
  "/menu",
  "/extras",
  "/drinks",
  "/sauces",
  "/hotdogs",
  "/donuts",
  "/bubble-tea",
]);

const START_EDGE_GUARD_PX = 22;
const AXIS_LOCK_PX = 10;
const COMPLETE_DISTANCE_PX = 72;
const FAST_DISTANCE_PX = 36;
const FAST_VELOCITY_PX_MS = 0.46;
const ARRIVE_MS = 180;
const LEAVE_FALLBACK_MS = 2_500;

// Sade geçiş: renkli şerit, etiket ve video yok. Commit olunca içerik kısa bir
// opacity geçişi yapar (bkz. globals.css "MOBILE CATEGORY SWIPE — sade geçiş").
const LEAVING_CLASS = "bb-swipe-leaving";
const ARRIVING_CLASS = "bb-swipe-arriving";

type Axis = "pending" | "horizontal" | "vertical";

type GestureState = {
  active: boolean;
  axis: Axis;
  startX: number;
  startY: number;
  lastX: number;
  lastAt: number;
  velocityX: number;
  keys: MenuNavKey[];
  target: MenuNavKey | null;
};

function emptyGesture(): GestureState {
  return {
    active: false,
    axis: "pending",
    startX: 0,
    startY: 0,
    lastX: 0,
    lastAt: 0,
    velocityX: 0,
    keys: [],
    target: null,
  };
}

function isMenuNavKey(value: string): value is MenuNavKey {
  return (MENU_NAV_KEYS as readonly string[]).includes(value);
}

function menuKeyForLocation(
  pathname: string,
  searchParams: URLSearchParams | null,
): MenuNavKey | null {
  if (pathname === "/extras") return "extras";
  if (pathname === "/drinks") return "drinks";
  if (pathname === "/sauces") return "sauces";
  if (pathname === "/hotdogs") return "hotdogs";
  if (pathname === "/donuts") return "donuts";
  if (pathname === "/bubble-tea") return "bubbletea";

  if (pathname !== "/menu") return null;

  const raw = String(
    searchParams?.get("cat") || searchParams?.get("tab") || "burger",
  )
    .trim()
    .toLowerCase();

  return isMenuNavKey(raw) ? raw : "burger";
}

function visibleMenuKeysFromPage(currentKey: MenuNavKey): MenuNavKey[] {
  const found = Array.from(
    document.querySelectorAll<HTMLElement>("[data-bb-tab-key]"),
  )
    .map((element) => String(element.dataset.bbTabKey || ""))
    .filter(isMenuNavKey);

  const unique = Array.from(new Set(found));

  if (unique.length > 1 && unique.includes(currentKey)) {
    return unique;
  }

  return MENU_NAV_ITEMS.map((item) => item.key);
}

function isHorizontallyScrollable(element: Element) {
  let node: Element | null = element;

  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const style = window.getComputedStyle(node);
      const overflowX = style.overflowX;

      if (
        (overflowX === "auto" || overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 2
      ) {
        return true;
      }
    }

    node = node.parentElement;
  }

  return false;
}

function shouldIgnoreGestureTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;

  if (
    target.closest(
      [
        "a",
        "button",
        "input",
        "textarea",
        "select",
        "option",
        "label",
        "[contenteditable='true']",
        "[role='dialog']",
        "[aria-modal='true']",
        "[data-bb-swipe-ignore]",
        ".bb-product-modal",
        ".bb-modal-shell",
        ".bb-tabs-scroll",
      ].join(","),
    )
  ) {
    return true;
  }

  return isHorizontallyScrollable(target);
}

function supportsMobileSwipe() {
  const viewportWidth = Math.min(
    window.innerWidth,
    document.documentElement.clientWidth || window.innerWidth,
  );

  return viewportWidth <= 900;
}

function transitionEnabled(raw?: unknown) {
  const incoming =
    raw && typeof raw === "object"
      ? (raw as { menuTransitions?: unknown }).menuTransitions
      : readSettings().menuTransitions;
  return normalizeMenuTransitionSettings(incoming).enabled;
}

export default function MobileCategorySwipe() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() || "";
  const router = useRouter();

  const currentKey = useMemo(
    () => menuKeyForLocation(pathname, searchParams),
    [pathname, searchKey, searchParams],
  );

  const gestureRef = useRef<GestureState>(emptyGesture());
  const navigationLockedRef = useRef(false);
  const primedRef = useRef(new Set<MenuNavKey>());
  const fadeEnabledRef = useRef(true);

  useEffect(() => {
    const apply = (raw?: unknown) => {
      fadeEnabledRef.current = transitionEnabled(raw);
    };
    const onSettings = (event: Event) => {
      apply((event as CustomEvent).detail);
    };

    apply();

    void fetchAndApplyRemoteSettings()
      .then((next) => apply(next))
      .catch(() => undefined);

    window.addEventListener("bb_settings_changed", onSettings as EventListener);
    window.addEventListener("bb:settings-sync", onSettings as EventListener);

    return () => {
      window.removeEventListener("bb_settings_changed", onSettings as EventListener);
      window.removeEventListener("bb:settings-sync", onSettings as EventListener);
    };
  }, []);

  // Yeni kategori render olduysa soluk içerik geri gelir. NavBar sayfa ile
  // birlikte yeniden mount olabildiği için durum html sınıfında tutulur.
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains(LEAVING_CLASS)) return;

    root.classList.remove(LEAVING_CLASS);
    root.classList.add(ARRIVING_CLASS);

    const timer = window.setTimeout(() => {
      root.classList.remove(ARRIVING_CLASS);
    }, ARRIVE_MS);

    return () => window.clearTimeout(timer);
  }, [pathname, searchKey]);

  useEffect(() => {
    const unlock = () => {
      navigationLockedRef.current = false;
      document.documentElement.classList.remove(LEAVING_CLASS);
    };

    window.addEventListener("bb:navigation-end", unlock as EventListener);

    return () => {
      window.removeEventListener("bb:navigation-end", unlock as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!currentKey || !MENU_PATHS.has(pathname)) return;

    const primeTarget = (target: MenuNavKey) => {
      if (primedRef.current.has(target)) return;
      primedRef.current.add(target);

      const href = MENU_NAV_ROUTES[target];

      try {
        router.prefetch(href.split("?")[0]);
      } catch {}

      void warmCategoryData(target).catch(() => undefined);
    };

    const targetFor = (keys: MenuNavKey[], deltaX: number) => {
      const currentIndex = keys.indexOf(currentKey);
      const targetIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;

      return currentIndex >= 0 && targetIndex >= 0 && targetIndex < keys.length
        ? keys[targetIndex]
        : null;
    };

    const navigateTo = (target: MenuNavKey) => {
      if (navigationLockedRef.current) return;

      navigationLockedRef.current = true;
      const href = MENU_NAV_ROUTES[target];
      const root = document.documentElement;

      if (fadeEnabledRef.current) {
        root.classList.remove(ARRIVING_CLASS);
        root.classList.add(LEAVING_CLASS);
        window.setTimeout(() => {
          root.classList.remove(LEAVING_CLASS);
        }, LEAVE_FALLBACK_MS);
      }

      // Burger ↔ Vegan aynı sayfa (/menu?cat=…): sunucuya gitmeden yalnızca
      // URL değişir, menü sayfası searchParams'tan sekmeyi anında seçer.
      // Route bekleme durumu (progress çizgisi, dokunma kilidi) açılmaz.
      const nextPath = href.split("?")[0];
      if (nextPath === pathname) {
        window.history.pushState(null, "", href);
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        window.setTimeout(() => {
          navigationLockedRef.current = false;
        }, ARRIVE_MS);
        return;
      }

      startAppNavigation({
        href,
        source: "menu-swipe",
        scrollToTop: true,
      });

      router.push(href, {
        scroll: false,
      });
    };

    const onTouchStart = (event: TouchEvent) => {
      if (
        event.defaultPrevented ||
        navigationLockedRef.current ||
        !supportsMobileSwipe() ||
        event.touches.length !== 1 ||
        document.documentElement.classList.contains("bb-route-pending") ||
        shouldIgnoreGestureTarget(event.target)
      ) {
        return;
      }

      const touch = event.touches[0];
      const viewportWidth = window.innerWidth;

      if (
        touch.clientX <= START_EDGE_GUARD_PX ||
        touch.clientX >= viewportWidth - START_EDGE_GUARD_PX
      ) {
        return;
      }

      gestureRef.current = {
        active: true,
        axis: "pending",
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastAt: performance.now(),
        velocityX: 0,
        keys: visibleMenuKeysFromPage(currentKey),
        target: null,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;

      if (!gesture.active || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (gesture.axis === "pending") {
        if (Math.max(absX, absY) < AXIS_LOCK_PX) return;

        if (absY > absX * 1.05) {
          gesture.axis = "vertical";
          return;
        }

        if (absX > absY * 1.15) {
          gesture.axis = "horizontal";
        } else {
          return;
        }
      }

      if (gesture.axis !== "horizontal") return;

      event.preventDefault();

      const now = performance.now();
      const elapsed = Math.max(1, now - gesture.lastAt);
      gesture.velocityX = (touch.clientX - gesture.lastX) / elapsed;
      gesture.lastX = touch.clientX;
      gesture.lastAt = now;

      gesture.target = targetFor(gesture.keys, deltaX);
      if (gesture.target) primeTarget(gesture.target);
    };

    const finishGesture = (event: TouchEvent) => {
      const gesture = gestureRef.current;

      if (!gesture.active) return;

      const endingTouch = event.changedTouches[0];
      const finalX = endingTouch?.clientX ?? gesture.lastX;
      const absX = Math.abs(finalX - gesture.startX);
      const fastEnough =
        absX >= FAST_DISTANCE_PX &&
        Math.abs(gesture.velocityX) >= FAST_VELOCITY_PX_MS;
      const farEnough = absX >= COMPLETE_DISTANCE_PX;
      const target = gesture.target;

      gestureRef.current = emptyGesture();

      if (gesture.axis === "horizontal" && target && (farEnough || fastEnough)) {
        navigateTo(target);
      }
    };

    const cancelGesture = () => {
      gestureRef.current = emptyGesture();
    };

    document.addEventListener("touchstart", onTouchStart, {
      passive: true,
      capture: true,
    });
    document.addEventListener("touchmove", onTouchMove, {
      passive: false,
      capture: true,
    });
    document.addEventListener("touchend", finishGesture, {
      passive: true,
      capture: true,
    });
    document.addEventListener("touchcancel", cancelGesture, {
      passive: true,
      capture: true,
    });

    return () => {
      gestureRef.current = emptyGesture();
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", finishGesture, true);
      document.removeEventListener("touchcancel", cancelGesture, true);
    };
  }, [currentKey, pathname, router, searchKey]);

  return null;
}
