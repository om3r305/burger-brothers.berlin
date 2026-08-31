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
const SNAP_AFTER_COLLAPSE_MS = 340;

type Position = { x: number; y: number };
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

function clampPosition(position: Position, width: number, height: number): Position {
  const maxX = Math.max(EDGE_GAP_PX, window.innerWidth - width - EDGE_GAP_PX);
  const maxY = Math.max(EDGE_GAP_PX, window.innerHeight - height - EDGE_GAP_PX);
  return {
    x: Math.min(maxX, Math.max(EDGE_GAP_PX, position.x)),
    y: Math.min(maxY, Math.max(EDGE_GAP_PX, position.y)),
  };
}

function snapPositionToNearestEdge(
  position: Position,
  width: number,
  height: number,
): Position {
  const clamped = clampPosition(position, width, height);
  const useLeftEdge = clamped.x + width / 2 <= window.innerWidth / 2;

  return clampPosition(
    {
      x: useLeftEdge
        ? EDGE_GAP_PX
        : window.innerWidth - width - EDGE_GAP_PX,
      y: clamped.y,
    },
    width,
    height,
  );
}

export default function BurgerStudioEntry() {
  const pathname = usePathname();
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [position, setPosition] = useState<Position | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const draggedRef = useRef(false);
  const collapseTimerRef = useRef<number | null>(null);
  const snapTimerRef = useRef<number | null>(null);

  const persistPosition = useCallback((next: Position) => {
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

    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const snapCurrentButtonToEdge = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const next = snapPositionToNearestEdge(
      { x: rect.left, y: rect.top },
      rect.width,
      rect.height,
    );
    persistPosition(next);
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

  useEffect(() => {
    const sync = (value?: any) => setEnabled(enabledFromSettings(value));
    const onSettings = (event: Event) => {
      sync((event as CustomEvent).detail);
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "bb_settings_v6") sync();
    };

    // CatalogProvider already warms /api/settings for customer catalog routes
    // and emits bb_settings_changed when the payload changes. Reuse that
    // central cache instead of adding a second Burger Studio network request.
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
    if (!CUSTOMER_MENU_PATHS.has(pathname)) return;

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
        setExpanded(false);

        if (snapTimerRef.current) {
          window.clearTimeout(snapTimerRef.current);
        }
        snapTimerRef.current = window.setTimeout(() => {
          snapTimerRef.current = null;
          const rect = buttonRef.current?.getBoundingClientRect();
          if (!rect) return;
          persistPosition(
            snapPositionToNearestEdge(
              { x: Number(parsed.x), y: Number(parsed.y) },
              rect.width,
              rect.height,
            ),
          );
        }, SNAP_AFTER_COLLAPSE_MS);
      }
    } catch {
      // Default anchored position remains available when storage is unavailable.
    }

    if (!restored) {
      setPosition(null);
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
  }, [armCollapse, pathname, persistPosition]);

  useEffect(() => {
    const onResize = () => {
      const button = buttonRef.current;
      if (!button || !position) return;
      const rect = button.getBoundingClientRect();
      persistPosition(
        snapPositionToNearestEdge(position, rect.width, rect.height),
      );
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

  if (!CUSTOMER_MENU_PATHS.has(pathname)) return null;

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
              setExpanded(false);
              if (collapseTimerRef.current) {
                window.clearTimeout(collapseTimerRef.current);
                collapseTimerRef.current = null;
              }
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
              const rect = event.currentTarget.getBoundingClientRect();
              setExpanded(false);
              setPosition(
                clampPosition(
                  { x: rect.left, y: rect.top },
                  rect.width,
                  rect.height,
                ),
              );
              scheduleSnap();
              window.setTimeout(() => {
                draggedRef.current = false;
              }, 0);
            }
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            draggedRef.current = false;
          }}
          onClick={(event) => {
            if (draggedRef.current) {
              event.preventDefault();
              return;
            }
            openStudio();
          }}
          style={
            position
              ? {
                  left: `${position.x}px`,
                  top: `${position.y}px`,
                  right: "auto",
                  touchAction: "none",
                }
              : { touchAction: "none" }
          }
          className={`group fixed z-[45] flex select-none items-center rounded-full border border-amber-300/35 bg-black/90 py-2 text-xs font-black text-white shadow-[0_12px_38px_rgba(0,0,0,.45),0_0_28px_rgba(245,158,11,.13)] backdrop-blur-xl transition-[padding,border-color,box-shadow] duration-300 hover:border-amber-300/65 ${
            position
              ? ""
              : "right-3 top-[calc(env(safe-area-inset-top)+78px)] sm:right-5 sm:top-[calc(env(safe-area-inset-top)+86px)]"
          } ${expanded ? "gap-2 px-3 sm:px-4 sm:text-sm" : "gap-0 px-2"}`}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-400 text-base text-black shadow-[0_0_18px_rgba(245,158,11,.28)] transition group-hover:scale-105">
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
