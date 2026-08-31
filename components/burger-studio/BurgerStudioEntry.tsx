"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { startAppNavigation } from "@/components/AppRouteTransition";
import DeliveryAddressEntry from "@/components/customer/DeliveryAddressEntry";
import { readSettings } from "@/lib/settings";

const CUSTOMER_MENU_PATHS = new Set([
  "/menu",
  "/extras",
  "/drinks",
  "/sauces",
  "/hotdogs",
  "/donuts",
  "/bubble-tea",
]);

const POSITION_KEY = "bb_burger_studio_floating_position_v1";
const COLLAPSE_DELAY_MS = 4_500;
const EDGE_GAP_PX = 10;
const MOBILE_SAFE_TOP_PX = 88;
const MOBILE_SAFE_BOTTOM_PX = 96;
const SNAP_AFTER_COLLAPSE_MS = 340;
const PROMO_FIRST_REVEAL_MS = 1_200;
const PROMO_INTERVAL_MS = 20_000;

type Position = { x: number; y: number };
type Edge = "left" | "right" | null;
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

function enabledFromSettings(value?: any) {
  const settings = value && typeof value === "object" ? value : readSettings();
  return settings?.menu?.burgerStudio?.enabled === true;
}

function verticalBounds(height: number) {
  const mobile = window.innerWidth < 640;
  const minY = mobile ? MOBILE_SAFE_TOP_PX : EDGE_GAP_PX;
  const bottomGap = mobile ? MOBILE_SAFE_BOTTOM_PX : EDGE_GAP_PX;
  const maxY = Math.max(minY, window.innerHeight - height - bottomGap);
  return { minY, maxY };
}

function clampPosition(position: Position, width: number, height: number): Position {
  const maxX = Math.max(EDGE_GAP_PX, window.innerWidth - width - EDGE_GAP_PX);
  const { minY, maxY } = verticalBounds(height);
  return {
    x: Math.min(maxX, Math.max(EDGE_GAP_PX, position.x)),
    y: Math.min(maxY, Math.max(minY, position.y)),
  };
}

function snapPositionToNearestEdge(
  position: Position,
  width: number,
  height: number,
): { position: Position; edge: Exclude<Edge, null> } {
  const clamped = clampPosition(position, width, height);
  const useLeftEdge = clamped.x + width / 2 <= window.innerWidth / 2;
  const edge: Exclude<Edge, null> = useLeftEdge ? "left" : "right";

  return {
    edge,
    position: clampPosition(
      {
        x: useLeftEdge
          ? EDGE_GAP_PX
          : window.innerWidth - width - EDGE_GAP_PX,
        y: clamped.y,
      },
      width,
      height,
    ),
  };
}

export default function BurgerStudioEntry() {
  const pathname = usePathname();
  const router = useRouter();
  const isMenuPath = CUSTOMER_MENU_PATHS.has(pathname);
  const isCheckoutPath = pathname === "/checkout";
  const [enabled, setEnabled] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [position, setPosition] = useState<Position | null>(null);
  const [edge, setEdge] = useState<Edge>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const draggedRef = useRef(false);
  const collapseTimerRef = useRef<number | null>(null);
  const snapTimerRef = useRef<number | null>(null);
  const promoFirstTimerRef = useRef<number | null>(null);
  const promoIntervalRef = useRef<number | null>(null);

  const persistPosition = useCallback((next: Position, nextEdge?: Edge) => {
    setPosition((current) => {
      if (
        current &&
        Math.abs(current.x - next.x) < 0.5 &&
        Math.abs(current.y - next.y) < 0.5
      ) {
        return current;
      }
      return next;
    });

    if (nextEdge !== undefined) setEdge(nextEdge);

    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const snapCurrentButtonToEdge = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const snapped = snapPositionToNearestEdge(
      { x: rect.left, y: rect.top },
      rect.width,
      rect.height,
    );
    persistPosition(snapped.position, snapped.edge);
  }, [persistPosition]);

  const scheduleSnap = useCallback(() => {
    if (snapTimerRef.current) {
      window.clearTimeout(snapTimerRef.current);
    }
    snapTimerRef.current = window.setTimeout(() => {
      snapTimerRef.current = null;
      snapCurrentButtonToEdge();
    }, SNAP_AFTER_COLLAPSE_MS);
  }, [snapCurrentButtonToEdge]);

  const armCollapse = useCallback(() => {
    if (collapseTimerRef.current) {
      window.clearTimeout(collapseTimerRef.current);
    }
    collapseTimerRef.current = window.setTimeout(() => {
      setExpanded(false);
      scheduleSnap();
      collapseTimerRef.current = null;
    }, COLLAPSE_DELAY_MS);
  }, [scheduleSnap]);

  const revealTemporarily = useCallback(() => {
    if (dragRef.current) return;
    setExpanded(true);
    armCollapse();
  }, [armCollapse]);

  useEffect(() => {
    const sync = (value?: any) => setEnabled(enabledFromSettings(value));
    const onSettings = (event: Event) => {
      sync((event as CustomEvent).detail);
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "bb_settings_v6") sync();
    };

    sync();

    window.addEventListener("bb_settings_changed", onSettings as EventListener);
    window.addEventListener("bb:settings-sync", onSettings as EventListener);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(
        "bb_settings_changed",
        onSettings as EventListener,
      );
      window.removeEventListener(
        "bb:settings-sync",
        onSettings as EventListener,
      );
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!isMenuPath) return;

    let restored = false;

    try {
      const parsed = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
      if (
        parsed &&
        typeof parsed === "object" &&
        Number.isFinite(Number(parsed.x)) &&
        Number.isFinite(Number(parsed.y))
      ) {
        restored = true;
        setExpanded(true);

        if (snapTimerRef.current) {
          window.clearTimeout(snapTimerRef.current);
        }
        snapTimerRef.current = window.setTimeout(() => {
          snapTimerRef.current = null;
          const rect = buttonRef.current?.getBoundingClientRect();
          if (!rect) return;
          const snapped = snapPositionToNearestEdge(
            { x: Number(parsed.x), y: Number(parsed.y) },
            rect.width,
            rect.height,
          );
          persistPosition(snapped.position, snapped.edge);
          armCollapse();
        }, SNAP_AFTER_COLLAPSE_MS);
      }
    } catch {
      // Default anchored position remains available when storage is unavailable.
    }

    if (!restored) {
      setPosition(null);
      setEdge("right");
      setExpanded(true);
      armCollapse();
    }

    return () => {
      if (collapseTimerRef.current) {
        window.clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
      if (snapTimerRef.current) {
        window.clearTimeout(snapTimerRef.current);
        snapTimerRef.current = null;
      }
    };
  }, [armCollapse, isMenuPath, pathname, persistPosition]);

  useEffect(() => {
    if (!isMenuPath || !enabled) return;

    if (promoFirstTimerRef.current) {
      window.clearTimeout(promoFirstTimerRef.current);
    }
    if (promoIntervalRef.current) {
      window.clearInterval(promoIntervalRef.current);
    }

    promoFirstTimerRef.current = window.setTimeout(() => {
      promoFirstTimerRef.current = null;
      revealTemporarily();
    }, PROMO_FIRST_REVEAL_MS);

    promoIntervalRef.current = window.setInterval(() => {
      revealTemporarily();
    }, PROMO_INTERVAL_MS);

    return () => {
      if (promoFirstTimerRef.current) {
        window.clearTimeout(promoFirstTimerRef.current);
        promoFirstTimerRef.current = null;
      }
      if (promoIntervalRef.current) {
        window.clearInterval(promoIntervalRef.current);
        promoIntervalRef.current = null;
      }
    };
  }, [enabled, isMenuPath, revealTemporarily]);

  useEffect(() => {
    const onResize = () => {
      const button = buttonRef.current;
      if (!button || !position) return;
      const rect = button.getBoundingClientRect();
      const snapped = snapPositionToNearestEdge(position, rect.width, rect.height);
      persistPosition(snapped.position, snapped.edge);
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [persistPosition, position]);

  const openStudio = useCallback(() => {
    const href = "/burger-studio";
    startAppNavigation({
      href,
      source: "burger-studio-entry",
      scrollToTop: true,
    });
    router.push(href, { scroll: false });
  }, [router]);

  if (!isMenuPath) {
    return isCheckoutPath ? <DeliveryAddressEntry /> : null;
  }

  const positionedStyle = position
    ? edge === "right"
      ? {
          right: `${EDGE_GAP_PX}px`,
          top: `${position.y}px`,
          left: "auto",
          touchAction: "none" as const,
        }
      : edge === "left"
        ? {
            left: `${EDGE_GAP_PX}px`,
            top: `${position.y}px`,
            right: "auto",
            touchAction: "none" as const,
          }
        : {
            left: `${position.x}px`,
            top: `${position.y}px`,
            right: "auto",
            touchAction: "none" as const,
          }
    : { touchAction: "none" as const };

  return (
    <>
      <style jsx global>{`
        body:has([role="dialog"][aria-label="Bestellübersicht"])
          [data-bb-burger-studio="1"],
        body:has([role="dialog"][aria-label="Bestellübersicht"])
          [data-bb-assistant="1"],
        body:has([role="dialog"][aria-label="Bestellart wählen"])
          [data-bb-burger-studio="1"],
        body:has([role="dialog"][aria-label="Bestellart wählen"])
          [data-bb-assistant="1"] {
          display: none !important;
        }
      `}</style>

      <DeliveryAddressEntry />

      {enabled && (
        <button
          ref={buttonRef}
          type="button"
          data-bb-swipe-ignore
          data-bb-burger-studio="1"
          aria-label="Burger Studio öffnen oder verschieben"
          title="Burger Studio – gedrückt halten und verschieben"
          onPointerDown={(event) => {
            if (event.button !== 0 && event.pointerType === "mouse") return;
            const rect = event.currentTarget.getBoundingClientRect();
            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originX: rect.left,
              originY: rect.top,
              moved: false,
            };
            draggedRef.current = false;
            setPosition({ x: rect.left, y: rect.top });
            setEdge(null);
            setExpanded(true);
            if (collapseTimerRef.current) {
              window.clearTimeout(collapseTimerRef.current);
              collapseTimerRef.current = null;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;

            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            if (!drag.moved && Math.hypot(dx, dy) < 7) return;

            if (!drag.moved) {
              drag.moved = true;
              draggedRef.current = true;
            }

            const rect = event.currentTarget.getBoundingClientRect();
            setPosition(
              clampPosition(
                { x: drag.originX + dx, y: drag.originY + dy },
                rect.width,
                rect.height,
              ),
            );
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            dragRef.current = null;

            try {
              event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {}

            if (drag.moved) {
              setExpanded(true);
              window.requestAnimationFrame(() => {
                snapCurrentButtonToEdge();
                armCollapse();
              });
              window.setTimeout(() => {
                draggedRef.current = false;
              }, 0);
            } else {
              armCollapse();
            }
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            draggedRef.current = false;
            armCollapse();
          }}
          onClick={(event) => {
            if (draggedRef.current) {
              event.preventDefault();
              return;
            }
            openStudio();
          }}
          style={positionedStyle}
          className={`group fixed z-[48] flex min-h-12 min-w-12 select-none items-center rounded-full border border-amber-300/45 bg-black/92 py-2 text-xs font-black text-white shadow-[0_12px_38px_rgba(0,0,0,.5),0_0_30px_rgba(245,158,11,.2)] ring-1 ring-amber-300/10 backdrop-blur-xl transition-[padding,border-color,box-shadow] duration-300 hover:border-amber-300/70 ${
            position
              ? ""
              : "right-3 top-[calc(env(safe-area-inset-top)+78px)] sm:right-5 sm:top-[calc(env(safe-area-inset-top)+86px)]"
          } ${expanded ? "gap-2 px-3 sm:px-4 sm:text-sm" : "justify-center gap-0 px-2.5"}`}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-400 text-lg text-black shadow-[0_0_20px_rgba(245,158,11,.36)] transition group-hover:scale-105">
            🔥
          </span>
          <span
            className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-300 ${
              expanded ? "max-w-32 opacity-100" : "max-w-0 opacity-0"
            }`}
          >
            Burger Studio
          </span>
          <span
            className={`overflow-hidden text-amber-300 transition-[max-width,opacity] duration-300 ${
              expanded ? "max-w-5 opacity-100" : "max-w-0 opacity-0"
            }`}
          >
            →
          </span>
        </button>
      )}
    </>
  );
}
